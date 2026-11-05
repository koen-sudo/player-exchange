import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import { buildDemoWorld } from "@px/demo";
import { balancesFor, book, ledgerInvariants, postings } from "../src/ledger.ts";
import { inventoryInvariants } from "../src/inventory.ts";
import { createPaymentSimulator, type SimScenario } from "../src/payment-simulator.ts";
import { handlePaymentWebhook, pollOpenOperations, type PaymentsCtx } from "../src/payments.ts";
import { runReconciliation } from "../src/reconciliation.ts";
import { cancelOrder, createOrderPreview, expireOrders, placeOrder, tradingInvariants, type OrderPreview } from "../src/trading.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const w = buildDemoWorld();
const userId = (login: string) => w.users.find((u) => u.login === login)!.id;
const ANNA = userId("anna");
const BRAM = userId("bram");
const noah = w.players.find((p) => p.displayName === "Noah Vermeer")!;
const lucas = w.players.find((p) => p.displayName === "Lucas Moreau")!;
const profileOnly = w.players.find((p) => p.marketStatus === "PROFILE_ONLY")!;
const pgError = (re: RegExp) => (e: unknown) => re.test(String((e as { cause?: { message?: string } }).cause?.message ?? e));
const isCode = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;

let t: TestDb;
const TEST_PLAYER = "7e570000-0000-4000-8000-000000000001";
let marketId = "";
let edition = "";

beforeAll(async () => {
  t = await createTestDb({ seeded: true });
  // A quiet test market with 100 delivered cards (position limit 10).
  await t.db.execute(sql`INSERT INTO players(id, display_name, is_fictional) VALUES (${TEST_PLAYER}, 'Testspeler Handel', true)`);
  marketId = (await t.db.execute<{ id: string }>(sql`INSERT INTO player_markets(player_id, status) VALUES (${TEST_PLAYER}, 'OPEN') RETURNING id`)).rows[0]!.id;
  edition = (await t.db.execute<{ id: string }>(sql`INSERT INTO editions(player_id, season_key) VALUES (${TEST_PLAYER}, '2026-2027') RETURNING id`)).rows[0]!.id;
  await t.db.execute(sql`INSERT INTO issuance_programs(edition_id, version, planned_total, status, published_at, is_opening_balance) VALUES (${edition}, 1, 100, 'PUBLISHED', now(), true)`);
}, 60_000);
afterAll(async () => t.drop());

/** A verified, admitted trader with money and (optionally) cards of the test player. */
async function trader(name: string, euros: number, cards = 0): Promise<string> {
  const id = randomUUID();
  await t.db.execute(sql`INSERT INTO users(id, auth_subject, is_test_account) VALUES (${id}, ${`test:${name}:${id}`}, true)`);
  await t.db.execute(sql`INSERT INTO user_profiles(user_id, display_name, residence_country, verification_status, age_confirmed) VALUES (${id}, ${name}, 'NL', 'VERIFIED', true)`);
  await t.db.execute(sql`INSERT INTO terms_acceptances(user_id, document_key, document_version) SELECT ${id}, document_key, document_version FROM terms_documents WHERE is_current`);
  if (euros) await t.db.transaction((tx) => book(tx, "demo", "test", postings.openingBalance(id, euros * 100, "test")));
  if (cards) {
    const from = (await t.db.execute<{ n: number }>(sql`SELECT coalesce(max(serial_number), 0)::int n FROM cards WHERE edition_id = ${edition}`)).rows[0]!.n;
    await t.db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO cards(edition_id, player_id, serial_number, status, owner_user_id, cost_basis_cents)
      SELECT ${edition}, ${TEST_PLAYER}, g, 'OWNED', ${id}, 300 FROM generate_series(${from + 1}::int, ${from + cards}::int) g`);
    await tx.execute(sql`
      INSERT INTO ownership_events(card_id, new_owner_id, cause, reference, cost_basis_cents)
      SELECT id, owner_user_id, 'OPENING_BALANCE', 'test', 300 FROM cards WHERE edition_id = ${edition} AND owner_user_id = ${id}`);
    });
  }
  return id;
}

function ctx(settle: SimScenario = "SUCCESS") {
  const sim = createPaymentSimulator(t.db, { secret: "s", delaySeconds: 30, scenarioFor: (kind) => (kind === "SETTLE" ? settle : "SUCCESS") });
  const c: PaymentsCtx = { db: t.db, provider: sim, providerName: "demo", mode: "demo" };
  return { c, sim, deliver: () => sim.deliverDue(async (headers, rawBody) => void (await handlePaymentWebhook(c, { headers, rawBody }))) };
}

async function order(c: PaymentsCtx, user: string, side: "BUY" | "SELL", quantity: number, priceCents: number, playerId = TEST_PLAYER) {
  const p = await createOrderPreview(t.db, "demo", user, { side, playerId, quantity, limitPriceMinor: String(priceCents), timeInForce: "SEVEN_DAYS" });
  return placeOrder(c, user, { previewId: p.previewId, requestKey: randomUUID() });
}
const orderRow = async (id: string) => (await t.db.execute<{ qty_open: number; qty_pending: number; qty_filled: number; qty_cancelled: number; qty_expired: number; state: string; booked_commission_cents: string }>(sql`
  SELECT qty_open, qty_pending, qty_filled, qty_cancelled, qty_expired, state::text, booked_commission_cents FROM orders WHERE id = ${id}`)).rows[0]!;
const holdOpen = async (orderId: string) => Number((await t.db.execute<{ n: string }>(sql`
  SELECT confirmed_amount_cents - consumed_amount_cents - released_amount_cents AS n FROM cash_holds WHERE order_id = ${orderId}`)).rows[0]!.n);
const owner = async (executionId: string) => (await t.db.execute<{ o: string }>(sql`SELECT c.owner_user_id o FROM executions x JOIN cards c ON c.id = x.card_id WHERE x.id = ${executionId}`)).rows[0]!.o;
const fee = async () => Number((await t.db.execute<{ b: string }>(sql`SELECT balance_cents b FROM ledger_accounts WHERE type = 'PLATFORM_FEE_CLEARING'`)).rows[0]!.b);
/** Cancel everything still resting in the test market, so each scenario starts clean. */
async function clearBook() {
  const c = ctx().c;
  const rows = (await t.db.execute<{ id: string; user_id: string }>(sql`SELECT id, user_id FROM orders WHERE player_market_id = ${marketId} AND state = 'ACTIVE' AND qty_open > 0`)).rows;
  for (const r of rows) await cancelOrder(c, r.user_id, r.id);
}
const fastForward = () => t.db.execute(sql`
  WITH a AS (UPDATE psp_sim.operations SET resolve_after = now() - interval '1 second' WHERE resolve_after > now() RETURNING 1)
  UPDATE psp_sim.events SET deliver_after = now() - interval '1 second' WHERE delivered_at IS NULL`);

describe("order preview on the database (UX-06/07, docs/06)", () => {
  const preview = (req: Record<string, unknown>, user = ANNA) =>
    createOrderPreview(t.db, "demo", user, { side: "BUY", playerId: noah.id, quantity: 1, limitPriceMinor: "620", timeInForce: "ONE_DAY", ...req }, new Date("2026-11-05T17:00:00Z"));

  it("buy 1 × €6,20: €6,20 maximum reserve, 60 s validity, 24 h expiry, best ask from the book", async () => {
    const p = (await preview({})) as Extract<OrderPreview, { side: "BUY" }>;
    assert.equal(p.maxReserveMinor, "620");
    assert.equal(p.bestAskMinor, "630", "the seeded €6,20 level would cross Anna's own bid and is not in the book");
    assert.equal(p.validUntil, "2026-11-05T17:01:00.000Z");
    assert.equal(p.expiresAtIfAcceptedNow, "2026-11-06T17:00:00.000Z");
  });

  it("rejects decimals, out-of-range prices, other durations, closed markets and unverified users", async () => {
    await assert.rejects(preview({ limitPriceMinor: "6.20" }), isCode("PRICE_INVALID"));
    await assert.rejects(preview({ limitPriceMinor: "19" }), isCode("PRICE_INVALID"));
    await assert.rejects(preview({ timeInForce: "TWO_DAYS" }), isCode("TIME_IN_FORCE_INVALID"));
    await assert.rejects(preview({ quantity: 0 }), isCode("QUANTITY_INVALID"));
    await assert.rejects(preview({ playerId: profileOnly.id }), isCode("MARKET_NOT_OPEN"));
    await assert.rejects(preview({}, BRAM), isCode("VERIFICATION_REQUIRED"));
  });

  it("funds and the position limit (Noah: 80 delivered → limit 8; Anna holds 3 and bids for 2)", async () => {
    await assert.rejects(preview({ quantity: 20, limitPriceMinor: "700" }), isCode("INSUFFICIENT_AVAILABLE_FUNDS"));
    await preview({ quantity: 3, limitPriceMinor: "300" });
    await assert.rejects(preview({ quantity: 4, limitPriceMinor: "300" }), isCode("POSITION_LIMIT_EXCEEDED"));
  });

  it("sell: server picks the oldest free card, computes commission, refuses reserved and foreign cards and self-crossing", async () => {
    const s = (await preview({ side: "SELL", playerId: lucas.id, limitPriceMinor: "600" })) as Extract<OrderPreview, { side: "SELL" }>;
    assert.deepEqual([s.grossAtLimitMinor, s.commissionMinor, s.netAtLimitMinor], ["600", "30", "570"]);
    assert.equal(s.cards[0]!.serial, 7, "the reserved card #8 is not offered again");
    await assert.rejects(preview({ side: "SELL", playerId: lucas.id, quantity: 2, limitPriceMinor: "600" }), isCode("CARD_UNAVAILABLE"));
    await assert.rejects(preview({ side: "SELL", playerId: lucas.id, limitPriceMinor: "600", cardIds: [randomUUID()] }), isCode("CARD_UNAVAILABLE"));
    await assert.rejects(preview({ side: "SELL", playerId: noah.id, limitPriceMinor: "600" }), isCode("SELF_TRADE_REJECTED"));
  });

  it("a preview places at most one order, and only while it is valid", async () => {
    const { c } = ctx();
    const p = await createOrderPreview(t.db, "demo", ANNA, { side: "BUY", playerId: noah.id, quantity: 1, limitPriceMinor: "300", timeInForce: "ONE_DAY" });
    const k = randomUUID();
    const a = await placeOrder(c, ANNA, { previewId: p.previewId, requestKey: k });
    const b = await placeOrder(c, ANNA, { previewId: p.previewId, requestKey: k });
    assert.equal(a.orderId, b.orderId, "same request key → same order");
    await assert.rejects(placeOrder(c, ANNA, { previewId: p.previewId, requestKey: randomUUID() }), isCode("PREVIEW_EXPIRED"));
    const old = await createOrderPreview(t.db, "demo", ANNA, { side: "BUY", playerId: noah.id, quantity: 1, limitPriceMinor: "300", timeInForce: "ONE_DAY" }, new Date(Date.now() - 120_000));
    await assert.rejects(placeOrder(c, ANNA, { previewId: old.previewId, requestKey: randomUUID() }), isCode("PREVIEW_EXPIRED"));
    await cancelOrder(c, ANNA, a.orderId);
  });
});

describe("matching (BR-15, AT-14..AT-17)", () => {
  it("cheapest ask first, equal prices by server order, at the resting order's price; the difference returns to the buyer", async () => {
    const { c } = ctx();
    const [s1, s2, buyer] = [await trader("s1", 0, 10), await trader("s2", 0, 10), await trader("koper", 100)];
    const a1 = await order(c, s1, "SELL", 1, 480);
    const a2 = await order(c, s2, "SELL", 1, 480);
    const a3 = await order(c, s1, "SELL", 1, 450);
    const before = await balancesFor(t.db, buyer);
    const r = await order(c, buyer, "BUY", 2, 500);
    assert.deepEqual(r.executions.map((x) => [x.status, x.priceCents]), [["SETTLED", 450], ["SETTLED", 480]]);
    const sells = (await t.db.execute<{ sell_order_id: string }>(sql`SELECT sell_order_id FROM executions WHERE buy_order_id = ${r.orderId} ORDER BY matched_at`)).rows.map((x) => x.sell_order_id);
    assert.deepEqual(sells, [a3.orderId, a1.orderId], "€4,50 first, then the older of the two €4,80 asks");
    assert.equal((await orderRow(a2.orderId)).qty_open, 1);
    const after = await balancesFor(t.db, buyer);
    assert.deepEqual([after.available, after.reserved, after.inSettlement], [before.available - 930, 0, 0], "paid €9,30 of the €10,00 reserved");
    assert.equal(r.status, "FILLED");
    await clearBook();
  });

  it("an order never matches its owner's own order; a crossing new order is rejected, the old one stays (AT-17)", async () => {
    const { c } = ctx();
    const s = await trader("zelf", 50, 5);
    const ask = await order(c, s, "SELL", 1, 400);
    await assert.rejects(order(c, s, "BUY", 1, 450), isCode("SELF_TRADE_REJECTED"));
    assert.equal((await orderRow(ask.orderId)).qty_open, 1);
    await clearBook();
  });

  it("a partial fill keeps exactly the rest reserved (AT-18)", async () => {
    const { c } = ctx();
    const [s, b] = [await trader("s-part", 0, 5), await trader("b-part", 100)];
    await order(c, s, "SELL", 1, 300);
    const r = await order(c, b, "BUY", 3, 400);
    const o = await orderRow(r.orderId);
    assert.deepEqual([o.qty_open, o.qty_filled], [2, 1]);
    assert.equal(await holdOpen(r.orderId), 800);
    const bal = await balancesFor(t.db, b);
    assert.deepEqual([bal.available, bal.reserved], [10_000 - 300 - 800, 800]);
    assert.equal(r.status, "PARTIALLY_FILLED");
    await clearBook();
  });

  it("commission is cumulative per sell order: €0,50 + €0,50 → €0,03 + €0,02 (BR-20)", async () => {
    const { c } = ctx();
    const [s, b] = [await trader("s-fee", 0, 5), await trader("b-fee", 20)];
    const feeBefore = await fee();
    const sell = await order(c, s, "SELL", 2, 50);
    await order(c, b, "BUY", 1, 50);
    await order(c, b, "BUY", 1, 50);
    const fees = (await t.db.execute<{ fee_cents: string }>(sql`SELECT fee_cents FROM executions WHERE sell_order_id = ${sell.orderId} ORDER BY matched_at`)).rows.map((x) => Number(x.fee_cents));
    assert.deepEqual(fees, [3, 2]);
    assert.equal((await orderRow(sell.orderId)).booked_commission_cents, "5");
    assert.equal((await balancesFor(t.db, s)).available, 95);
    assert.equal(await fee(), feeBefore + 5);
    await clearBook();
  });

  it("two buyers for the last card: exactly one gets it", async () => {
    const { c } = ctx();
    const s = await trader("s-last", 0, 1);
    const [b1, b2] = [await trader("b1-last", 50), await trader("b2-last", 50)];
    await order(c, s, "SELL", 1, 400);
    const [p1, p2] = await Promise.all([b1, b2].map((b) => createOrderPreview(t.db, "demo", b, { side: "BUY", playerId: TEST_PLAYER, quantity: 1, limitPriceMinor: "400", timeInForce: "ONE_DAY" })));
    const results = await Promise.all([[b1, p1!], [b2, p2!]].map(([b, p]) => placeOrder(c, b as string, { previewId: (p as OrderPreview).previewId, requestKey: randomUUID() })));
    const filled = results.filter((r) => r.status === "FILLED");
    assert.equal(filled.length, 1);
    assert.equal(results.filter((r) => r.status === "OPEN").length, 1);
    const execs = (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM executions x JOIN orders o ON o.id = x.sell_order_id WHERE o.user_id = ${s}`)).rows[0]!.n;
    assert.equal(execs, 1);
    await clearBook();
  });
});

describe("settlement recovery (BR-21, AT-19..AT-23)", () => {
  it("a timeout moves no card and releases no money; the replay finalises once (AT-21, AT-22)", async () => {
    const { c, deliver } = ctx("UNKNOWN_THEN_SUCCESS");
    const [s, b] = [await trader("s-to", 0, 2), await trader("b-to", 50)];
    await order(c, s, "SELL", 1, 400);
    const r = await order(c, b, "BUY", 1, 400);
    const x = r.executions[0]!;
    assert.equal(x.status, "SUBMISSION_PENDING");
    assert.equal(await owner(x.executionId), s, "card still with the seller");
    let bb = await balancesFor(t.db, b);
    assert.deepEqual([bb.available, bb.reserved, bb.inSettlement], [4_600, 0, 400]);
    assert.equal((await balancesFor(t.db, s)).available, 0, "seller not paid yet");
    // While it is open, the market waits: a second crossing pair does not match.
    await order(c, s, "SELL", 1, 400);
    const r2 = await order(c, await trader("b2-to", 50), "BUY", 1, 400);
    assert.equal(r2.executions.length, 0);

    await fastForward();
    await deliver(); // arrives before its reference is known: kept
    await pollOpenOperations(c, { olderThanSeconds: 0 }); // replay with the same key → settled, then the next match
    assert.equal(await owner(x.executionId), b);
    bb = await balancesFor(t.db, b);
    assert.deepEqual([bb.available, bb.inSettlement], [4_600, 0]);
    assert.equal((await balancesFor(t.db, s)).available >= 380, true, "seller paid €4,00 − €0,20 commission");
    const n = (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM journal_entries WHERE business_event_id = ${`execution:${x.executionId}:settled`}`)).rows[0]!.n;
    assert.equal(n, 1);
    await fastForward();
    await deliver();
    await pollOpenOperations(c, { olderThanSeconds: 0 });
    assert.equal((await t.db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM journal_entries WHERE business_event_id = ${`execution:${x.executionId}:settled`}`)).rows[0]!.n, 1, "late duplicates change nothing");
    await clearBook();
  });

  it("cancelling during settlement releases only the free part (AT-19)", async () => {
    const { c, deliver } = ctx("DELAYED");
    const [s, b] = [await trader("s-cx", 0, 1), await trader("b-cx", 50)];
    await order(c, s, "SELL", 1, 400);
    const r = await order(c, b, "BUY", 3, 400);
    assert.equal(r.executions[0]!.status, "PROVIDER_PENDING");
    const out = await cancelOrder(c, b, r.orderId);
    assert.equal(out.cancelled, 2);
    const o = await orderRow(r.orderId);
    assert.deepEqual([o.qty_open, o.qty_pending, o.qty_cancelled, o.state], [0, 1, 2, "ACTIVE"]);
    const bb = await balancesFor(t.db, b);
    assert.deepEqual([bb.available, bb.reserved, bb.inSettlement], [4_600, 0, 400]);
    await assert.rejects(cancelOrder(c, b, r.orderId), isCode("ACTION_NOT_ALLOWED"));
    await fastForward();
    await deliver();
    assert.deepEqual([(await orderRow(r.orderId)).state, (await orderRow(r.orderId)).qty_filled], ["CLOSED", 1]);
    await clearBook();
  });

  it("a definitive failure moves no card and books no commission; the live orders get their part back (AT-23)", async () => {
    const { c } = ctx("FAIL");
    const [s, b] = [await trader("s-fail", 0, 1), await trader("b-fail", 50)];
    const sell = await order(c, s, "SELL", 1, 400);
    const feeBefore = await fee();
    const r = await order(c, b, "BUY", 1, 400);
    assert.equal(r.executions[0]!.status, "FAILED");
    assert.equal(await owner(r.executions[0]!.executionId), s);
    assert.equal(await fee(), feeBefore);
    assert.deepEqual([(await orderRow(r.orderId)).qty_open, (await orderRow(sell.orderId)).qty_open], [1, 1]);
    assert.equal(await holdOpen(r.orderId), 400);
    const bb = await balancesFor(t.db, b);
    assert.deepEqual([bb.available, bb.reserved, bb.inSettlement], [4_600, 400, 0]);
    await clearBook();
  });

  it("expiry closes only the free remainder, releases it once and never revives (AT-20)", async () => {
    const { c } = ctx();
    const b = await trader("b-exp", 50);
    const r = await order(c, b, "BUY", 2, 300);
    await t.db.execute(sql`UPDATE orders SET accepted_at = accepted_at - interval '8 days', expires_at = expires_at - interval '8 days' WHERE id = ${r.orderId}`);
    assert.equal(await expireOrders(c), 2);
    assert.equal(await expireOrders(c), 0);
    const o = await orderRow(r.orderId);
    assert.deepEqual([o.qty_open, o.qty_expired, o.state], [0, 2, "CLOSED"]);
    assert.equal((await balancesFor(t.db, b)).available, 5_000);
  });
});

describe("database guards on executions", () => {
  it("a failed execution never changes again; settling needs the delivery event", async () => {
    const failed = (await t.db.execute<{ id: string }>(sql`SELECT id FROM executions WHERE status = 'FAILED' LIMIT 1`)).rows[0]!.id;
    await assert.rejects(t.db.execute(sql`UPDATE executions SET status = 'SETTLED', settled_at = now() WHERE id = ${failed}`), pgError(/already FAILED/));
    const { c } = ctx("DELAYED");
    const [s, b] = [await trader("s-guard", 0, 1), await trader("b-guard", 50)];
    await order(c, s, "SELL", 1, 400);
    const r = await order(c, b, "BUY", 1, 400);
    const x = r.executions[0]!.executionId;
    await assert.rejects(t.db.execute(sql`UPDATE executions SET status = 'SETTLED', settled_at = now() WHERE id = ${x}`), pgError(/without delivering card/));
    await assert.rejects(t.db.execute(sql`UPDATE orders SET state = 'CLOSED' WHERE id = ${r.orderId}`), pgError(/orders_closed_is_empty/));
  });
});

describe("invariants after all scenarios", () => {
  it("trading, ledger and inventory invariants hold, and the provider agrees", async () => {
    assert.deepEqual(await tradingInvariants(t.db), { quantitiesNotAddingUp: 0, marketsWithTwoSettlements: 0, settledWithoutDelivery: 0, buyHoldsNotMatchingOpen: 0, sellCardsNotMatchingOrder: 0 });
    assert.deepEqual(await ledgerInvariants(t.db), { unbalancedEntries: 0, projectionMismatches: 0, negativeCustomerBalances: 0, reservedNotMatchingHolds: 0 });
    const inv = await inventoryInvariants(t.db);
    assert.ok(Object.values(inv).every((v) => v === 0), JSON.stringify(inv));
  });
});

void runReconciliation;
