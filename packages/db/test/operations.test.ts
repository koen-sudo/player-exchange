import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import { buildDemoWorld, createFixtureProvider } from "@px/demo";
import { blockedFlows, runFootballDataContract, runPaymentContract, type PaymentCapability } from "@px/integrations";
import { decideApproval } from "../src/approvals.ts";
import { loadIdentity } from "../src/identity.ts";
import { balancesFor, ledgerInvariants } from "../src/ledger.ts";
import { createPaymentSimulator } from "../src/payment-simulator.ts";
import { handlePaymentWebhook, type PaymentsCtx } from "../src/payments.ts";
import { runReconciliation } from "../src/reconciliation.ts";
import {
  acknowledgeAlert, evaluateSignals, executeLedgerCorrection, latestContractRuns, listAlerts, pendingCorrections,
  requestLedgerCorrection, runContractTests, simulatorHarness, syncAlerts,
} from "../src/operations.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const w = buildDemoWorld();
const loginId = (login: string) => w.users.find((u) => u.login === login)!.id;
const ANNA = loginId("anna");
const isCode = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;

let t: TestDb;
let finance: NonNullable<Awaited<ReturnType<typeof loadIdentity>>>;
let approver: NonNullable<Awaited<ReturnType<typeof loadIdentity>>>;
beforeAll(async () => {
  t = await createTestDb({ seeded: true });
  finance = (await loadIdentity(t.db, loginId("beheer"), "demo"))!;
  approver = (await loadIdentity(t.db, loginId("approver"), "demo"))!;
}, 60_000);
afterAll(async () => t.drop());

const sim = () => createPaymentSimulator(t.db, { secret: "contract-secret" });

describe("adapter contracts (fase 8)", () => {
  it("the payment simulator passes every check of the payment contract", async () => {
    const results = await runPaymentContract(simulatorHarness(sim()));
    const failed = results.filter((r) => r.status === "FAILED");
    assert.deepEqual(failed, []);
    assert.equal(results.filter((r) => r.status === "BLOCKED").length, 0);
    assert.ok(results.length >= 12, `${results.length} checks`);
  });

  it("a provider without payouts or reports is reported as blocked, not silently passed", async () => {
    const full = sim();
    const limited = Object.create(full) as typeof full;
    const supported = new Set<PaymentCapability>([...full.capabilities().supported].filter((c) => c !== "PAYOUT" && c !== "RECONCILIATION_REPORT"));
    limited.capabilities = () => ({ adapter: "beperkt", environment: "sandbox", supported });
    const results = await runPaymentContract({ ...simulatorHarness(full), provider: limited });
    const blocked = results.filter((r) => r.status === "BLOCKED").map((r) => r.check);
    assert.deepEqual(blocked.sort(), ["Providerrapport", "Uitbetalen"]);
    assert.deepEqual(blockedFlows(limited.capabilities()).map((b) => b.flow).sort(), ["reconciliation", "withdrawal"]);
  });

  it("the fixture data provider passes the football data contract", async () => {
    const results = await runFootballDataContract(createFixtureProvider());
    assert.deepEqual(results.filter((r) => r.status !== "PASSED"), []);
  });

  it("contract runs are kept as evidence and do not disturb reconciliation", async () => {
    const ctx = { db: t.db, provider: sim(), providerName: "demo", mode: "demo" as const, simulator: sim() };
    await runContractTests(ctx, createFixtureProvider(), finance);
    const runs = await latestContractRuns(t.db);
    assert.deepEqual(runs.map((r) => [r.kind, r.failed]).sort(), [["FOOTBALL_DATA", 0], ["PAYMENT", 0]]);
    await assert.rejects(t.db.execute(sql`DELETE FROM adapter_contract_runs`));
    const r = await runReconciliation(t.db, ctx.provider, "demo");
    assert.equal(r.outcome, "MATCHED", "contract-test money is not customer money");
  });
});

describe("monitoring (docs/10)", () => {
  it("a forged webhook is refused and counted; the signal opens an alert with an owner that can be acknowledged", async () => {
    const ctx: PaymentsCtx = { db: t.db, provider: sim(), providerName: "demo", mode: "demo" };
    const r = await handlePaymentWebhook(ctx, { headers: { "x-psp-signature": "0".repeat(64) }, rawBody: '{"eventId":"evt_x"}' });
    assert.equal(r.http, 401);
    const signals = await evaluateSignals(t.db);
    const wh = signals.find((s) => s.key === "webhook.rejected")!;
    assert.deepEqual([wh.status, wh.value, wh.owner], ["WARNING", 1, "FINANCE_OPERATOR"]);
    assert.equal(signals.find((s) => s.key === "ledger.coverage")!.status, "OK");
    assert.equal(signals.find((s) => s.key === "inventory.diffs")!.status, "OK");
    assert.ok(signals.every((s) => s.runbook.startsWith("docs/runbooks/")));

    await syncAlerts(t.db);
    await syncAlerts(t.db);
    const alerts = (await listAlerts(t.db)).filter((a) => a.signal_key === "webhook.rejected");
    assert.equal(alerts.length, 1, "one open alert per signal");
    await acknowledgeAlert(t.db, finance, { alertId: alerts[0]!.id, note: "Bron onderzocht: testbericht" });
    await assert.rejects(acknowledgeAlert(t.db, finance, { alertId: alerts[0]!.id, note: "nogmaals" }), isCode("ACTION_NOT_ALLOWED"));
    // Healthy again → resolved.
    await t.db.execute(sql`UPDATE webhook_rejections SET received_at = now() - interval '2 days'`);
    const res = await syncAlerts(t.db);
    assert.ok(res.resolved >= 1);
  });
});

describe("ledger corrections (four-eyes)", () => {
  it("a correction is booked only after a second person approves, exactly once", async () => {
    const before = await balancesFor(t.db, ANNA);
    const approvalId = await requestLedgerCorrection(t.db, finance, { userId: ANNA, amountCents: 250, direction: "CREDIT", breakId: null, reason: "Dubbel afgeschreven servicekosten" });
    const payload = { userId: ANNA, amountCents: 250, direction: "CREDIT" as const, breakId: null };
    await assert.rejects(executeLedgerCorrection(t.db, finance, { approvalId, payload }), isCode("ACTION_NOT_ALLOWED"));
    await assert.rejects(decideApproval(t.db, finance, { approvalId, decision: "APPROVE", reason: "zelf" }), isCode("ACTION_NOT_ALLOWED"));
    await decideApproval(t.db, approver, { approvalId, decision: "APPROVE", reason: "Afschrift gecontroleerd" });
    assert.equal((await pendingCorrections(t.db)).length, 1);
    await executeLedgerCorrection(t.db, finance, { approvalId, payload });
    await assert.rejects(executeLedgerCorrection(t.db, finance, { approvalId, payload }), isCode("ACTION_NOT_ALLOWED"));
    assert.equal((await balancesFor(t.db, ANNA)).available, before.available + 250);
    assert.equal((await pendingCorrections(t.db)).length, 0);

    // Taking money back can never make a balance negative.
    const big = await requestLedgerCorrection(t.db, finance, { userId: ANNA, amountCents: 1_000_000, direction: "DEBIT", breakId: null, reason: "Test te grote terugboeking" });
    await decideApproval(t.db, approver, { approvalId: big, decision: "APPROVE", reason: "Testgoedkeuring" });
    await assert.rejects(executeLedgerCorrection(t.db, finance, { approvalId: big, payload: { userId: ANNA, amountCents: 1_000_000, direction: "DEBIT", breakId: null } }), isCode("INSUFFICIENT_AVAILABLE_FUNDS"));
    // Executing with other content than was approved is refused and voids the approval (AT-34).
    const other = await requestLedgerCorrection(t.db, finance, { userId: ANNA, amountCents: 100, direction: "CREDIT", breakId: null, reason: "Kleine correctie" });
    await decideApproval(t.db, approver, { approvalId: other, decision: "APPROVE", reason: "Akkoord" });
    await assert.rejects(executeLedgerCorrection(t.db, finance, { approvalId: other, payload: { userId: ANNA, amountCents: 2_500, direction: "CREDIT", breakId: null } }), isCode("ACTION_NOT_ALLOWED"));
    assert.equal((await balancesFor(t.db, ANNA)).available, before.available + 250);
    assert.deepEqual(await ledgerInvariants(t.db), { unbalancedEntries: 0, projectionMismatches: 0, negativeCustomerBalances: 0, reservedNotMatchingHolds: 0 });
  });
});
