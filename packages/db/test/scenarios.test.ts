/**
 * The three end-to-end scenarios of docs/09, as one chain each on the server
 * functions behind the routes (no browser). Every money step goes through the
 * payment simulator and its signed webhooks; nothing is booked by hand.
 * Verification is the demo identity adapter's effect (O-06 not chosen yet).
 */
import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import { buildDemoWorld } from "@px/demo";
import { decideApproval } from "../src/approvals.ts";
import { ensureUserForSubject, loadIdentity } from "../src/identity.ts";
import { inventoryInvariants } from "../src/inventory.ts";
import { balancesFor, ledgerInvariants } from "../src/ledger.ts";
import { createPaymentSimulator, type SimScenario } from "../src/payment-simulator.ts";
import { assertAllowed, handlePaymentWebhook, pollOpenOperations, requestWithdrawal, startDeposit, type PaymentsCtx } from "../src/payments.ts";
import { runReconciliation } from "../src/reconciliation.ts";
import { cancelOrder, createOrderPreview, placeOrder, tradingInvariants } from "../src/trading.ts";
import { demoShiftSchedule, issuanceInvariants, parseSeedKey, proposeDrop, publishDrop, subscribe, type IssuanceCtx } from "../src/drops.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const w = buildDemoWorld();
const loginId = (login: string) => w.users.find((u) => u.login === login)!.id;
const isCode = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;
const PLAYER = "5ce0a000-0000-4000-8000-000000000001";

let t: TestDb;
let beheer: NonNullable<Awaited<ReturnType<typeof loadIdentity>>>;
let approver: NonNullable<Awaited<ReturnType<typeof loadIdentity>>>;

beforeAll(async () => {
  t = await createTestDb({ seeded: true });
  await t.db.execute(sql`INSERT INTO players(id, display_name, is_fictional, primary_admission) VALUES (${PLAYER}, 'Scenariospeler', true, 'APPROVED')`);
  await t.db.execute(sql`INSERT INTO player_markets(player_id, status) VALUES (${PLAYER}, 'PRELAUNCH')`);
  const ed = (await t.db.execute<{ id: string }>(sql`INSERT INTO editions(player_id, season_key) VALUES (${PLAYER}, '2026-2027') RETURNING id`)).rows[0]!.id;
  await t.db.execute(sql`INSERT INTO issuance_programs(edition_id, version, planned_total, status, published_at, is_opening_balance) VALUES (${ed}, 1, 20, 'PUBLISHED', now(), true)`);
  beheer = (await loadIdentity(t.db, loginId("beheer"), "demo"))!;
  approver = (await loadIdentity(t.db, loginId("approver"), "demo"))!;
}, 60_000);
afterAll(async () => t.drop());

/** A fresh simulator object each time, like a restarted process: all state is in the database. */
function ctx(scenarioFor: (kind: string) => SimScenario = () => "SUCCESS"): IssuanceCtx & { sim: ReturnType<typeof createPaymentSimulator> } {
  const sim = createPaymentSimulator(t.db, { secret: "scenario-secret", delaySeconds: 30, scenarioFor });
  return { db: t.db, provider: sim, providerName: "demo", mode: "demo", seedKey: parseSeedKey("cd".repeat(32)), sim };
}
const deliverWebhooks = (c: ReturnType<typeof ctx>, late = false) =>
  c.sim.deliverDue(async (headers, rawBody) => {
    const r = await handlePaymentWebhook(c as PaymentsCtx, { headers, rawBody });
    if (r.http >= 300 && r.http !== 202) throw new Error(`webhook ${r.http}`);
  }, late ? new Date(Date.now() + 3_600_000) : undefined);

/** Registration (first OIDC login), then the identity provider's positive result. */
async function registerAndVerify(name: string): Promise<string> {
  const id = await ensureUserForSubject(t.db, `https://idp.example|${name}`, name);
  await assert.rejects(assertAllowed(t.db, id, "DEPOSIT", "demo"), (e: unknown) => e instanceof DomainError);
  await t.db.execute(sql`UPDATE user_profiles SET verification_status = 'VERIFIED', age_confirmed = true, residence_country = 'NL' WHERE user_id = ${id}`);
  await t.db.execute(sql`INSERT INTO terms_acceptances(user_id, document_key, document_version) SELECT ${id}, document_key, document_version FROM terms_documents WHERE is_current`);
  return id;
}

/** Deposit through the checkout and the provider's webhook. */
async function deposit(userId: string, amount: number) {
  const c = ctx();
  const r = await startDeposit(c, { userId, amount, requestKey: randomUUID(), returnUrl: (d) => `/betalingen/terug?storting=${d}` });
  const ref = new URL(r.redirectUrl!, "http://x").searchParams.get("ref")!;
  assert.equal((await balancesFor(t.db, userId)).available, 0, "the return page alone confirms nothing");
  await c.sim.decideDeposit(ref, "SUCCESS");
  await deliverWebhooks(c);
}

async function order(c: PaymentsCtx, user: string, side: "BUY" | "SELL", quantity: number, price: number) {
  const p = await createOrderPreview(t.db, "demo", user, { side, playerId: PLAYER, quantity, limitPriceMinor: String(price), timeInForce: "SEVEN_DAYS" });
  return placeOrder(c, user, { previewId: p.previewId, requestKey: randomUUID() });
}
const cardsOf = async (u: string) => (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM cards WHERE player_id = ${PLAYER} AND owner_user_id = ${u}`)).rows[0]!.n;

describe("Scenario A: register → verify → deposit → subscribe → delivery → sell → second buyer → settlement → withdrawal", () => {
  it("runs the whole customer chain with exact amounts", async () => {
    const alice = await registerAndVerify("Alice Scenario");
    await deposit(alice, 5_000);
    assert.equal((await balancesFor(t.db, alice)).available, 5_000);

    // Primary issuance: four eyes, open, subscribe, close with drawing and delivery.
    const c = ctx();
    const { dropId, approvalId } = await proposeDrop(t.db, beheer, { playerId: PLAYER, priceCents: 750, quantity: 1, opensAt: new Date(Date.now() + 5 * 86_400_000), closesAt: new Date(Date.now() + 5.5 * 86_400_000), reason: "Scenario A" });
    await decideApproval(t.db, approver, { approvalId, decision: "APPROVE", reason: "Scenario gecontroleerd" });
    await publishDrop(c, beheer, { dropId, approvalId });
    await demoShiftSchedule(c, beheer, { dropId, action: "OPEN_NOW" });
    await subscribe(c, alice, { dropId, requestKey: randomUUID() });
    assert.deepEqual([(await balancesFor(t.db, alice)).available, (await balancesFor(t.db, alice)).reserved], [4_250, 750]);
    await demoShiftSchedule(c, beheer, { dropId, action: "CLOSE_NOW" });
    await deliverWebhooks(c);
    assert.equal(await cardsOf(alice), 1, "card delivered");
    assert.deepEqual([(await balancesFor(t.db, alice)).available, (await balancesFor(t.db, alice)).reserved], [4_250, 0]);

    // Secondary market: Alice sells, a second verified buyer buys; settlement through the provider.
    await t.db.execute(sql`UPDATE player_markets SET status = 'OPEN' WHERE player_id = ${PLAYER}`);
    const bob = await registerAndVerify("Bob Scenario");
    await deposit(bob, 2_000);
    await order(c, alice, "SELL", 1, 900);
    const r = await order(c, bob, "BUY", 1, 900);
    assert.deepEqual(r.executions.map((x) => x.status), ["SETTLED"]);
    await deliverWebhooks(c);
    assert.deepEqual([await cardsOf(alice), await cardsOf(bob)], [0, 1]);
    assert.equal((await balancesFor(t.db, alice)).available, 4_250 + 900 - 45, "€9,00 minus 5% commission");
    assert.equal((await balancesFor(t.db, bob)).available, 2_000 - 900);

    // Withdrawal of everything to the account of the first deposit (R-66).
    const wd = await requestWithdrawal(c, { userId: alice, amount: 5_105, requestKey: randomUUID() });
    assert.equal(wd.status, "PAID");
    await deliverWebhooks(c);
    assert.deepEqual(await balancesFor(t.db, alice), { available: 0, reserved: 0, pendingIncoming: 0, inSettlement: 0, pendingWithdrawal: 0, receivable: 0 });
  });
});

describe("Scenario B: buy order for two cards → partial fill → cancel the rest", () => {
  it("leaves the right portfolio and balance", async () => {
    const c = ctx();
    const seller = await registerAndVerify("Verkoper B");
    const buyer = await registerAndVerify("Koper B");
    await deposit(buyer, 3_000);
    // Give the seller one card through a drop, like any customer gets one.
    await deposit(seller, 1_000);
    const { dropId, approvalId } = await proposeDrop(t.db, beheer, { playerId: PLAYER, priceCents: 500, quantity: 1, opensAt: new Date(Date.now() + 6 * 86_400_000), closesAt: new Date(Date.now() + 6.5 * 86_400_000), reason: "Scenario B" });
    await decideApproval(t.db, approver, { approvalId, decision: "APPROVE", reason: "Scenario gecontroleerd" });
    await publishDrop(c, beheer, { dropId, approvalId });
    await demoShiftSchedule(c, beheer, { dropId, action: "OPEN_NOW" });
    await subscribe(c, seller, { dropId, requestKey: randomUUID() });
    await demoShiftSchedule(c, beheer, { dropId, action: "CLOSE_NOW" });
    await deliverWebhooks(c);
    assert.equal(await cardsOf(seller), 1);

    const buy = await order(c, buyer, "BUY", 2, 1_000);
    assert.equal((await balancesFor(t.db, buyer)).reserved, 2_000);
    const sell = await order(c, seller, "SELL", 1, 950);
    assert.deepEqual(sell.executions.map((x) => [x.status, x.priceCents]), [["SETTLED", 1_000]], "at the resting buy order's price");
    await deliverWebhooks(c);
    let b = await balancesFor(t.db, buyer);
    assert.deepEqual([b.available, b.reserved], [1_000, 1_000], "the open card stays reserved");

    const cancelled = await cancelOrder(c, buyer, buy.orderId);
    assert.equal(cancelled.cancelled, 1);
    b = await balancesFor(t.db, buyer);
    assert.deepEqual([b.available, b.reserved], [2_000, 0]);
    assert.equal(await cardsOf(buyer), 1);
    assert.equal((await balancesFor(t.db, seller)).available, 500 + 1_000 - 50);
    const o = (await t.db.execute<{ qty_filled: number; qty_cancelled: number; qty_open: number }>(sql`SELECT qty_filled, qty_cancelled, qty_open FROM orders WHERE id = ${buy.orderId}`)).rows[0]!;
    assert.deepEqual([o.qty_filled, o.qty_cancelled, o.qty_open], [1, 1, 0]);
  });
});

describe("Scenario C: provider timeout → worker restart → late webhook → one correct settlement", () => {
  it("settles exactly once", async () => {
    const seller = await registerAndVerify("Verkoper C");
    const buyer = await registerAndVerify("Koper C");
    await deposit(buyer, 2_000);
    // The seller buys a card first (from scenario B's buyer would be simpler, but each scenario stands alone).
    await deposit(seller, 1_000);
    const c0 = ctx();
    const { dropId, approvalId } = await proposeDrop(t.db, beheer, { playerId: PLAYER, priceCents: 500, quantity: 1, opensAt: new Date(Date.now() + 7 * 86_400_000), closesAt: new Date(Date.now() + 7.5 * 86_400_000), reason: "Scenario C" });
    await decideApproval(t.db, approver, { approvalId, decision: "APPROVE", reason: "Scenario gecontroleerd" });
    await publishDrop(c0, beheer, { dropId, approvalId });
    await demoShiftSchedule(c0, beheer, { dropId, action: "OPEN_NOW" });
    await subscribe(c0, seller, { dropId, requestKey: randomUUID() });
    await demoShiftSchedule(c0, beheer, { dropId, action: "CLOSE_NOW" });
    await deliverWebhooks(c0);

    // The provider takes the settlement but the answer times out.
    const timingOut = ctx((kind) => (kind === "SETTLE" ? "UNKNOWN_THEN_SUCCESS" : "SUCCESS"));
    await order(timingOut, seller, "SELL", 1, 800);
    const r = await order(timingOut, buyer, "BUY", 1, 800);
    const x = r.executions[0]!;
    assert.equal(x.status, "SUBMISSION_PENDING", "unknown is pending, not failed");
    assert.equal(await cardsOf(buyer), 0, "no card moves on an unknown outcome");
    assert.equal((await balancesFor(t.db, buyer)).inSettlement, 800);

    // "Worker restart": the old process is gone; a new one only has the database.
    const restarted = ctx();
    await t.db.execute(sql`UPDATE settlement_operations SET updated_at = now() - interval '1 minute' WHERE execution_id = ${x.executionId}`);
    await pollOpenOperations(restarted, { olderThanSeconds: 0 });
    assert.equal(await cardsOf(buyer), 1);
    // The provider's webhook arrives late, twice over: nothing changes.
    await deliverWebhooks(restarted, true);
    await deliverWebhooks(restarted, true);
    await pollOpenOperations(restarted, { olderThanSeconds: 0 });

    const settledEntries = (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM journal_entries WHERE business_event_id = ${`execution:${x.executionId}:settled`}`)).rows[0]!.n;
    assert.equal(settledEntries, 1, "one settlement in the ledger");
    assert.equal((await balancesFor(t.db, seller)).available, 500 + 800 - 40);
    assert.deepEqual([(await balancesFor(t.db, buyer)).available, (await balancesFor(t.db, buyer)).inSettlement], [1_200, 0]);
    assert.equal((await t.db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM ownership_events e JOIN executions x ON x.card_id = e.card_id WHERE x.id = ${x.executionId} AND e.cause = 'SECONDARY_SETTLEMENT'`)).rows[0]!.n, 1, "the card moved once");
  });
});

describe("after all scenarios", () => {
  it("every invariant holds and the provider agrees with the ledger", async () => {
    const zero = (o: Record<string, number>) => Object.values(o).every((v) => v === 0);
    assert.ok(zero(await ledgerInvariants(t.db)));
    assert.ok(zero(await tradingInvariants(t.db)));
    assert.ok(zero(await inventoryInvariants(t.db)));
    assert.ok(zero(await issuanceInvariants(t.db)));
    const r = await runReconciliation(t.db, ctx().provider, "demo");
    assert.equal(r.outcome, "MATCHED", JSON.stringify(r));
    await assert.rejects(order(ctx(), loginId("bram"), "BUY", 1, 500), isCode("VERIFICATION_REQUIRED"));
  });
});
