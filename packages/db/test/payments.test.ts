import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import { buildDemoWorld } from "@px/demo";
import { balancesFor, ledgerInvariants } from "../src/ledger.ts";
import { createPaymentSimulator, type SimScenario } from "../src/payment-simulator.ts";
import { handlePaymentWebhook, pollOpenOperations, refreshDeposit, requestWithdrawal, startDeposit, type PaymentsCtx, type WebhookResult } from "../src/payments.ts";
import { approveBreakResolution, listBreaks, proposeBreakResolution, runReconciliation } from "../src/reconciliation.ts";
import { loadIdentity } from "../src/identity.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const w = buildDemoWorld();
const id = (login: string) => w.users.find((u) => u.login === login)!.id;
const ANNA = id("anna");
const SECRET = "test-webhook-secret";
const isCode = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb({ seeded: true });
});
afterAll(async () => t.drop());

/** A payments context whose simulator answers synchronous calls with `scenario`. */
function ctx(scenario: SimScenario = "SUCCESS") {
  const sim = createPaymentSimulator(t.db, { secret: SECRET, delaySeconds: 30, scenarioFor: () => scenario });
  const c: PaymentsCtx = { db: t.db, provider: sim, providerName: "demo", mode: "demo" };
  const results: WebhookResult["result"][] = [];
  const deliver = async (now?: Date) => {
    await sim.deliverDue(async (headers, rawBody) => {
      const r = await handlePaymentWebhook(c, { headers, rawBody });
      results.push(r.result);
      if (r.http >= 300) throw new Error(`webhook ${r.http}`);
    }, now);
    return results;
  };
  return { sim, c, deliver, results };
}
let key = 0;
const requestKey = () => `test-request-${++key}`;
const ret = (depositId: string) => `/betalingen/terug?storting=${depositId}`;
const entries = async (prefix: string) => (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM journal_entries WHERE business_event_id LIKE ${`${prefix}%`}`)).rows[0]!.n;
const depositStatus = async (depositId: string) => (await t.db.execute<{ status: string }>(sql`SELECT status FROM deposits WHERE id = ${depositId}`)).rows[0]!.status;
const reference = async (depositId: string) => (await t.db.execute<{ r: string }>(sql`SELECT provider_reference r FROM deposits WHERE id = ${depositId}`)).rows[0]!.r;
/** Let delayed provider events and resolutions become due ("time travel"). */
const fastForward = () => t.db.execute(sql`
  WITH a AS (UPDATE psp_sim.operations SET resolve_after = now() - interval '1 second' WHERE resolve_after > now() RETURNING 1)
  UPDATE psp_sim.events SET deliver_after = now() - interval '1 second' WHERE delivered_at IS NULL`);

describe("seed", () => {
  it("platform and simulated provider agree from the start", async () => {
    const { sim } = ctx();
    const r = await runReconciliation(t.db, sim, "demo");
    assert.equal(r.outcome, "MATCHED", JSON.stringify(await listBreaks(t.db)));
  });
});

describe("deposits", () => {
  it("returning from the checkout page books nothing; the provider's confirmation does (AT-11)", async () => {
    const { c, sim, deliver } = ctx();
    const before = await balancesFor(t.db, ANNA);
    const d = await startDeposit(c, { userId: ANNA, amount: 2_500, requestKey: requestKey(), returnUrl: ret });
    assert.match(d.redirectUrl ?? "", /^\/demo-betaalpagina\?ref=sim_deposit_/);
    // The person comes back "successfully" without having paid.
    assert.equal(await refreshDeposit(c, ANNA, d.depositId), "INITIATED");
    await deliver();
    assert.deepEqual(await balancesFor(t.db, ANNA), before);
    // Now the customer pays at the provider; the webhook confirms it.
    await sim.decideDeposit(await reference(d.depositId), "SUCCESS");
    assert.deepEqual(await deliver(), ["PROCESSED"]);
    assert.equal(await depositStatus(d.depositId), "CONFIRMED");
    assert.equal((await balancesFor(t.db, ANNA)).available, before.available + 2_500);
  });

  it("duplicate and repeated webhooks book one deposit (AT-10)", async () => {
    const { c, sim, deliver } = ctx();
    const before = (await balancesFor(t.db, ANNA)).available;
    const d = await startDeposit(c, { userId: ANNA, amount: 1_000, requestKey: requestKey(), returnUrl: ret });
    await sim.decideDeposit(await reference(d.depositId), "DUPLICATE_WEBHOOKS");
    await fastForward();
    const results = await deliver();
    assert.deepEqual(results, ["PROCESSED", "DUPLICATE", "PROCESSED"], "same event id stored once; a new event about the same fact changes nothing");
    assert.equal(await entries(`deposit:${d.depositId}`), 1);
    assert.equal((await balancesFor(t.db, ANNA)).available, before + 1_000);
    const inbox = (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM inbox_events WHERE payload->>'reference' = ${await reference(d.depositId)}`)).rows[0]!.n;
    assert.equal(inbox, 2);
  });

  it("a second click on the checkout page or a repeated form submit changes nothing", async () => {
    const { c, sim, deliver } = ctx();
    const k = requestKey();
    const d1 = await startDeposit(c, { userId: ANNA, amount: 700, requestKey: k, returnUrl: ret });
    const d2 = await startDeposit(c, { userId: ANNA, amount: 700, requestKey: k, returnUrl: ret });
    assert.deepEqual(d2, d1);
    await assert.rejects(startDeposit(c, { userId: ANNA, amount: 800, requestKey: k, returnUrl: ret }), isCode("IDEMPOTENCY_CONFLICT"));
    const ref = await reference(d1.depositId);
    await sim.decideDeposit(ref, "SUCCESS");
    await sim.decideDeposit(ref, "FAIL");
    await deliver();
    assert.equal(await depositStatus(d1.depositId), "CONFIRMED");
  });

  it("delayed certainty: first 'nog niet beschikbaar', spendable only after final confirmation", async () => {
    const { c, sim, deliver } = ctx();
    const before = await balancesFor(t.db, ANNA);
    const d = await startDeposit(c, { userId: ANNA, amount: 5_000, requestKey: requestKey(), returnUrl: ret });
    await sim.decideDeposit(await reference(d.depositId), "DELAYED");
    await deliver();
    let b = await balancesFor(t.db, ANNA);
    assert.deepEqual([b.available, b.pendingIncoming], [before.available, 5_000]);
    assert.equal(await depositStatus(d.depositId), "PENDING");
    await fastForward();
    await deliver();
    b = await balancesFor(t.db, ANNA);
    assert.deepEqual([b.available, b.pendingIncoming], [before.available + 5_000, 0]);
  });

  it("a failed payment books nothing spendable", async () => {
    const { c, sim, deliver } = ctx();
    const before = await balancesFor(t.db, ANNA);
    const d = await startDeposit(c, { userId: ANNA, amount: 900, requestKey: requestKey(), returnUrl: ret });
    await sim.decideDeposit(await reference(d.depositId), "FAIL");
    await deliver();
    assert.equal(await depositStatus(d.depositId), "FAILED");
    assert.deepEqual(await balancesFor(t.db, ANNA), before);
  });

  it("without any webhook, status polling finds the confirmed payment", async () => {
    const { c, sim } = ctx();
    const before = (await balancesFor(t.db, ANNA)).available;
    const d = await startDeposit(c, { userId: ANNA, amount: 600, requestKey: requestKey(), returnUrl: ret });
    await sim.decideDeposit(await reference(d.depositId), "NO_WEBHOOK");
    await pollOpenOperations(c, { olderThanSeconds: 0 });
    assert.equal(await depositStatus(d.depositId), "CONFIRMED");
    assert.equal((await balancesFor(t.db, ANNA)).available, before + 600);
  });

  it("a webhook with a wrong signature is refused and stored nowhere", async () => {
    const { c } = ctx();
    const raw = JSON.stringify({ eventId: "evt_forged", type: "deposit.succeeded", reference: "sim_deposit_x", amountCents: 100_000 });
    const r = await handlePaymentWebhook(c, { headers: { "x-psp-signature": "0".repeat(64) }, rawBody: raw });
    assert.deepEqual(r, { http: 401, result: "INVALID_SIGNATURE" });
    const n = (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM inbox_events WHERE external_event_id = 'evt_forged'`)).rows[0]!.n;
    assert.equal(n, 0);
  });

  it("refuses unverified users and amounts outside the limits", async () => {
    const { c } = ctx();
    await assert.rejects(startDeposit(c, { userId: id("bram"), amount: 2_000, requestKey: requestKey(), returnUrl: ret }), isCode("VERIFICATION_REQUIRED"));
    await assert.rejects(startDeposit(c, { userId: ANNA, amount: 499, requestKey: requestKey(), returnUrl: ret }), isCode("AMOUNT_INVALID"));
  });
});

describe("withdrawals", () => {
  it("a successful payout leaves available and pending at the right amounts", async () => {
    const { c } = ctx("SUCCESS");
    const before = await balancesFor(t.db, ANNA);
    const r = await requestWithdrawal(c, { userId: ANNA, amount: 1_500, requestKey: requestKey() });
    assert.equal(r.status, "PAID");
    const b = await balancesFor(t.db, ANNA);
    assert.deepEqual([b.available, b.pendingWithdrawal], [before.available - 1_500, 0]);
  });

  it("an unknown outcome stays pending, is replayed with the same key and finalises once (AT-21/AT-22 for payouts)", async () => {
    const { c, deliver, sim } = ctx("UNKNOWN_THEN_SUCCESS");
    const before = await balancesFor(t.db, ANNA);
    const r = await requestWithdrawal(c, { userId: ANNA, amount: 2_000, requestKey: requestKey() });
    assert.equal(r.status, "SUBMITTED", "timeout is not failure");
    let b = await balancesFor(t.db, ANNA);
    assert.deepEqual([b.available, b.pendingWithdrawal], [before.available - 2_000, 2_000], "money is neither paid nor released");
    // The late webhook arrives before we know its reference: kept, not lost.
    await fastForward();
    assert.equal((await deliver()).at(-1), "QUEUED");
    // Polling replays the payout with the same idempotency key, links and finalises it.
    await pollOpenOperations(c, { olderThanSeconds: 0 });
    b = await balancesFor(t.db, ANNA);
    assert.deepEqual([b.available, b.pendingWithdrawal], [before.available - 2_000, 0]);
    assert.equal(await entries(`withdrawal:${r.withdrawalId}:paid`), 1);
    const payouts = (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM psp_sim.operations WHERE idempotency_key = ${`withdrawal:${r.withdrawalId}`}`)).rows[0]!.n;
    assert.equal(payouts, 1, "no second payout with a new key");
    const inbox = (await t.db.execute<{ s: string }>(sql`SELECT processing_status s FROM inbox_events WHERE payload->>'reference' = (SELECT provider_reference FROM settlement_operations WHERE idempotency_key = ${`withdrawal:${r.withdrawalId}`})`)).rows;
    assert.deepEqual(inbox.map((x) => x.s), ["PROCESSED"]);
    void sim;
  });

  it("a failed payout returns the money to available", async () => {
    const { c } = ctx("FAIL");
    const before = await balancesFor(t.db, ANNA);
    const r = await requestWithdrawal(c, { userId: ANNA, amount: 1_000, requestKey: requestKey() });
    assert.equal(r.status, "FAILED");
    assert.deepEqual(await balancesFor(t.db, ANNA), before);
  });

  it("never more than available; same request key gives the same withdrawal", async () => {
    const { c } = ctx("SUCCESS");
    const avail = (await balancesFor(t.db, ANNA)).available;
    await assert.rejects(requestWithdrawal(c, { userId: ANNA, amount: avail + 1, requestKey: requestKey() }), isCode("INSUFFICIENT_AVAILABLE_FUNDS"));
    const k = requestKey();
    const a = await requestWithdrawal(c, { userId: ANNA, amount: 100, requestKey: k });
    const b = await requestWithdrawal(c, { userId: ANNA, amount: 100, requestKey: k });
    assert.equal(a.withdrawalId, b.withdrawalId);
    assert.equal((await balancesFor(t.db, ANNA)).available, avail - 100);
  });

  it("two simultaneous withdrawals cannot together exceed the available balance", async () => {
    const { c } = ctx("SUCCESS");
    const avail = (await balancesFor(t.db, ANNA)).available;
    const amount = Math.floor(avail * 0.6);
    const rs = await Promise.allSettled([1, 2].map(() => requestWithdrawal(c, { userId: ANNA, amount, requestKey: requestKey() })));
    assert.equal(rs.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await balancesFor(t.db, ANNA)).available, avail - amount);
  });
});

describe("reconciliation", () => {
  it("after all flows the ledger and the provider agree and all invariants hold", async () => {
    const { sim } = ctx();
    const r = await runReconciliation(t.db, sim, "demo");
    assert.equal(r.outcome, "MATCHED", JSON.stringify(await listBreaks(t.db, { open: true })));
    assert.deepEqual(await ledgerInvariants(t.db), { unbalancedEntries: 0, projectionMismatches: 0, negativeCustomerBalances: 0, reservedNotMatchingHolds: 0 });
  });

  it("money at the provider that the ledger does not know becomes a break, blocks payouts, and needs two people", async () => {
    const { c, sim } = ctx("SUCCESS");
    await t.db.execute(sql`
      INSERT INTO psp_sim.operations(idempotency_key, reference, kind, account_ref, amount_cents, status, scenario, resolved_at)
      VALUES ('stray-1', 'sim_stray_1', 'DEPOSIT', 'user:unknown', 4200, 'SUCCEEDED', 'TEST', now())`);
    const r = await runReconciliation(t.db, sim, "demo");
    assert.equal(r.outcome, "BREAKS_FOUND");
    const open = await listBreaks(t.db, { open: true });
    assert.deepEqual(open.map((b) => b.kind).sort(), ["AMOUNT", "MISSING_IN_LEDGER"]);
    assert.ok(open.every((b) => b.severity === "MATERIAL"));
    assert.equal((await runReconciliation(t.db, sim, "demo")).opened, 0, "a rerun opens nothing twice");

    await assert.rejects(requestWithdrawal(c, { userId: ANNA, amount: 100, requestKey: requestKey() }), isCode("RECONCILIATION_HOLD"));

    const beheer = (await loadIdentity(t.db, id("beheer"), "demo"))!;
    const approver = (await loadIdentity(t.db, id("approver"), "demo"))!;
    const target = open.find((b) => b.kind === "MISSING_IN_LEDGER")!;
    await proposeBreakResolution(t.db, beheer, { breakId: target.id, note: "Testboeking bij betaalpartner, geen klantgeld" });
    await assert.rejects(approveBreakResolution(t.db, beheer, { breakId: target.id, reason: "zelf" }), isCode("ACTION_NOT_ALLOWED"));
    await approveBreakResolution(t.db, approver, { breakId: target.id, reason: "Gecontroleerd met afschrift" });
    const after = await listBreaks(t.db, { open: true });
    assert.deepEqual(after.map((b) => b.kind), ["AMOUNT"]);
  });
});

describe("abandoned checkouts", () => {
  it("a checkout nobody pays expires at the provider and no longer counts as open", async () => {
    const { c } = ctx();
    const d = await startDeposit(c, { userId: ANNA, amount: 1_200, requestKey: requestKey(), returnUrl: ret });
    await t.db.execute(sql`UPDATE psp_sim.operations SET created_at = now() - interval '2 hours' WHERE reference = ${await reference(d.depositId)}`);
    await pollOpenOperations(c, { olderThanSeconds: 0 });
    assert.equal(await depositStatus(d.depositId), "FAILED");
    const reason = (await t.db.execute<{ r: string }>(sql`SELECT failure_reason r FROM deposits WHERE id = ${d.depositId}`)).rows[0]!.r;
    assert.equal(reason, "Betaling verlopen");
  });
});
