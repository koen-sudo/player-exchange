/**
 * Operational drills (fase 9): an incident is caused on purpose, the
 * monitoring must raise it with the right owner, and following the runbook
 * step by step must bring every signal back to "in orde". The runbooks are in
 * docs/runbooks/; each drill names the steps it follows.
 */
import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import { buildDemoWorld } from "@px/demo";
import { loadIdentity } from "../src/identity.ts";
import { balancesFor } from "../src/ledger.ts";
import { createPaymentSimulator, type SimScenario } from "../src/payment-simulator.ts";
import { pollOpenOperations, requestWithdrawal, type PaymentsCtx } from "../src/payments.ts";
import { approveBreakResolution, listBreaks, proposeBreakResolution, runReconciliation } from "../src/reconciliation.ts";
import { createOrderPreview, placeOrder } from "../src/trading.ts";
import { acknowledgeAlert, evaluateSignals, listAlerts, syncAlerts } from "../src/operations.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const w = buildDemoWorld();
const loginId = (login: string) => w.users.find((u) => u.login === login)!.id;
const ANNA = loginId("anna");
const isCode = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;
const noah = w.players.find((p) => p.displayName === "Noah Vermeer")!;

let t: TestDb;
type Id = NonNullable<Awaited<ReturnType<typeof loadIdentity>>>;
let finance: Id;
let approver: Id;
beforeAll(async () => {
  t = await createTestDb({ seeded: true });
  finance = (await loadIdentity(t.db, loginId("beheer"), "demo"))!;
  approver = (await loadIdentity(t.db, loginId("approver"), "demo"))!;
}, 60_000);
afterAll(async () => t.drop());

const ctx = (settle: SimScenario = "SUCCESS"): PaymentsCtx =>
  ({ db: t.db, provider: createPaymentSimulator(t.db, { secret: "drill", delaySeconds: 30, scenarioFor: (k) => (k === "SETTLE" ? settle : "SUCCESS") }), providerName: "demo", mode: "demo" });
const signal = async (key: string) => (await evaluateSignals(t.db)).find((s) => s.key === key)!;

describe("drill 1 — afwikkeling-blijft-open.md: the worker was down for 20 minutes during a settlement", () => {
  it("is raised for Financiën and closes after the worker resumes", async () => {
    // Anna buys from the demo book; the provider's answer times out and no worker polls.
    const ask = (await t.db.execute<{ p: string }>(sql`
      SELECT min(o.limit_price_cents)::text AS p FROM orders o JOIN player_markets pm ON pm.id = o.player_market_id
       WHERE pm.player_id = ${noah.id} AND o.side = 'SELL' AND o.state = 'ACTIVE' AND o.qty_open > 0`)).rows[0]!.p;
    const p = await createOrderPreview(t.db, "demo", ANNA, { side: "BUY", playerId: noah.id, quantity: 1, limitPriceMinor: ask, timeInForce: "ONE_DAY" });
    const r = await placeOrder(ctx("UNKNOWN_THEN_SUCCESS"), ANNA, { previewId: p.previewId, requestKey: randomUUID() });
    assert.equal(r.executions[0]?.status, "SUBMISSION_PENDING");
    await t.db.execute(sql`UPDATE settlement_operations SET created_at = now() - interval '20 minutes', updated_at = now() - interval '20 minutes' WHERE financially_processed_at IS NULL`);

    const s = await signal("settlement.pending");
    assert.deepEqual([s.status, s.owner, s.runbook], ["WARNING", "FINANCE_OPERATOR", "docs/runbooks/afwikkeling-blijft-open.md"]);
    await syncAlerts(t.db);
    const alert = (await listAlerts(t.db)).find((a) => a.signal_key === "settlement.pending" && a.status !== "RESOLVED")!;
    // Step 5 of the runbook: take it on with a note.
    await acknowledgeAlert(t.db, finance, { alertId: alert.id, note: "Drill: worker herstart, operatie bij partner geslaagd" });

    // Step 3: the worker resumes and asks the provider with the same key.
    await pollOpenOperations(ctx(), { olderThanSeconds: 0 });
    assert.equal((await balancesFor(t.db, ANNA)).inSettlement, 0);
    assert.equal((await signal("settlement.pending")).status, "OK");
    const res = await syncAlerts(t.db);
    assert.ok(res.resolved >= 1, "the alert closes when the signal is healthy");
  });
});

describe("drill 2 — reconciliatieverschil.md: the provider reports a deposit the platform never saw", () => {
  it("blocks payouts until two people close it with the cause, then everything matches", async () => {
    await t.db.execute(sql`
      INSERT INTO psp_sim.operations(idempotency_key, reference, kind, account_ref, amount_cents, status, scenario, resolved_at)
      VALUES ('drill-unknown-deposit', 'sim_deposit_drill', 'DEPOSIT', 'unknown', 1234, 'SUCCEEDED', 'DRILL', now())`);
    const run = await runReconciliation(t.db, ctx().provider, "demo");
    assert.equal(run.outcome, "BREAKS_FOUND");
    assert.equal((await signal("reconciliation.breaks")).status, "CRITICAL");
    // The difference cannot be tied to one customer, so all payouts wait (docs/10).
    await assert.rejects(requestWithdrawal(ctx(), { userId: ANNA, amount: 100, requestKey: randomUUID() }), isCode("RECONCILIATION_HOLD"));

    // Steps 1–3: look at the breaks; the partner confirms it was its own test payment and reverses it.
    const open = (await listBreaks(t.db, { open: true })).filter((b) => b.severity === "MATERIAL");
    assert.ok(open.some((b) => b.kind === "MISSING_IN_LEDGER"));
    await t.db.execute(sql`UPDATE psp_sim.operations SET status = 'FAILED', failure_reason = 'Gestorneerd door partner (drill)' WHERE idempotency_key = 'drill-unknown-deposit'`);
    // Step 5: one person proposes with the cause, another approves. One person alone cannot close it.
    for (const b of open) {
      await proposeBreakResolution(t.db, finance, { breakId: b.id, note: "Testbetaling van de partner, gestorneerd; geen klantgeld" });
      await assert.rejects(approveBreakResolution(t.db, finance, { breakId: b.id, reason: "zelf" }), isCode("ACTION_NOT_ALLOWED"));
      await approveBreakResolution(t.db, approver, { breakId: b.id, reason: "Bevestiging partner gezien" });
    }
    const again = await runReconciliation(t.db, ctx().provider, "demo");
    assert.equal(again.outcome, "MATCHED", "the cause is gone, so the next run matches");
    assert.equal((await signal("reconciliation.breaks")).status, "OK");
    const wd = await requestWithdrawal(ctx(), { userId: ANNA, amount: 100, requestKey: randomUUID() });
    assert.equal(wd.status, "PAID");
  });
});
