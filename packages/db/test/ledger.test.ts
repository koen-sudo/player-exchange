import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { DomainError, applySettledFill, EMPTY_ACCUMULATOR as EMPTY_ACCOUNTING, cents } from "@px/domain";
import { balancesFor, book, ledgerInvariants, postings } from "../src/ledger.ts";
import { consumeHold, createHold, releaseHold } from "../src/holds.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

let t: TestDb;
const users: Record<string, string> = {};
beforeAll(async () => {
  t = await createTestDb();
  for (const name of ["koper", "verkoper", "ander", "chargeback"]) {
    const r = await t.db.execute<{ id: string }>(sql`insert into users(auth_subject) values (${`test:${name}`}) returning id`);
    users[name] = r.rows[0]!.id;
  }
});
afterAll(async () => t.drop());

const deposit = (userId: string, id: string, amount: number) => t.db.transaction((tx) => book(tx, "demo", "test", postings.depositConfirmed(userId, id, amount, false)));
const order = async (userId: string) => (await t.db.execute<{ id: string }>(sql`
  insert into orders(player_market_id, user_id, side, limit_price_cents, time_in_force, qty_original, qty_open)
  values ((select id from player_markets limit 1), ${userId}, 'BUY', 620, 'ONE_DAY', 2, 2) returning id`)).rows[0]!.id;
const isCode = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;

describe("exact money example through the ledger (docs/09)", () => {
  it("€100 → hold €12,40 → one card at €6,00 → cancel the rest → €94,00; seller €5,70; fee €0,30", async () => {
    // A player market for the order rows.
    await t.db.execute(sql`insert into players(id, display_name) values ('11111111-1111-4111-8111-111111111111', 'Testspeler')`);
    await t.db.execute(sql`insert into player_markets(player_id, status) values ('11111111-1111-4111-8111-111111111111', 'OPEN')`);
    const { koper, verkoper } = users as { koper: string; verkoper: string };
    await deposit(koper, "dep-koper-1", 10_000);
    const orderId = await order(koper);
    const holdId = await t.db.transaction((tx) => createHold(tx, "demo", { userId: koper, purpose: "BUY_ORDER", orderId, amount: 1_240 }));
    assert.deepEqual([(await balancesFor(t.db, koper)).available, (await balancesFor(t.db, koper)).reserved], [8_760, 1_240]);

    // Match one card against a resting ask of €6,00: the reserved limit (€6,20) goes into settlement.
    await t.db.transaction(async (tx) => {
      await consumeHold(tx, holdId, 620);
      await book(tx, "demo", "test", postings.executionPending(koper, "exec-1", 620));
    });
    let b = await balancesFor(t.db, koper);
    assert.deepEqual([b.available, b.reserved, b.inSettlement], [8_760, 620, 620]);

    // Final settlement: seller commission 5% cumulative per order (BR-20).
    const fill = applySettledFill(EMPTY_ACCOUNTING, cents(600));
    await t.db.transaction((tx) => book(tx, "demo", "test", postings.executionSettled({ buyerId: koper, sellerId: verkoper, executionId: "exec-1", limit: 620, price: 600, fee: fill.commission })));
    b = await balancesFor(t.db, koper);
    assert.deepEqual([b.available, b.reserved, b.inSettlement], [8_780, 620, 0], "price improvement €0,20 released");
    assert.equal((await balancesFor(t.db, verkoper)).available, 570);
    const fee = (await t.db.execute<{ b: string }>(sql`select balance_cents b from ledger_accounts where type = 'PLATFORM_FEE_CLEARING'`)).rows[0]!.b;
    assert.equal(Number(fee), 30);

    // Cancel the second card: only the open remainder is released.
    await t.db.transaction((tx) => releaseHold(tx, "demo", holdId, 620, "cancel"));
    b = await balancesFor(t.db, koper);
    assert.deepEqual([b.available, b.reserved], [9_400, 0]);
  });

  it("the same business event never books twice (retries, duplicate messages)", async () => {
    const before = await balancesFor(t.db, users.koper!);
    const again = await deposit(users.koper!, "dep-koper-1", 10_000);
    assert.equal(again, false);
    assert.deepEqual(await balancesFor(t.db, users.koper!), before);
  });

  it("a hold beyond the available balance is refused (AT-12)", async () => {
    const orderId = await order(users.koper!);
    await assert.rejects(t.db.transaction((tx) => createHold(tx, "demo", { userId: users.koper!, purpose: "BUY_ORDER", orderId, amount: 1_000_000 })), isCode("INSUFFICIENT_AVAILABLE_FUNDS"));
  });

  it("two simultaneous holds cannot together exceed the available balance", async () => {
    await deposit(users.ander!, "dep-ander-1", 10_000);
    const [o1, o2] = [await order(users.ander!), await order(users.ander!)];
    const results = await Promise.allSettled([o1, o2].map((orderId) => t.db.transaction((tx) => createHold(tx, "demo", { userId: users.ander!, purpose: "BUY_ORDER", orderId, amount: 6_000 }))));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.ok(results.some((r) => r.status === "rejected" && isCode("INSUFFICIENT_AVAILABLE_FUNDS")(r.reason)));
    const b = await balancesFor(t.db, users.ander!);
    assert.deepEqual([b.available, b.reserved], [4_000, 6_000]);
  });

  it("a withdrawal and a buy order cannot use the same money (AT-31)", async () => {
    const u = users.ander!;
    await t.db.transaction((tx) => book(tx, "demo", "test", postings.withdrawalHeld(u, "wd-ander-1", 3_500)));
    const orderId = await order(u);
    await assert.rejects(t.db.transaction((tx) => createHold(tx, "demo", { userId: u, purpose: "BUY_ORDER", orderId, amount: 1_000 })), isCode("INSUFFICIENT_AVAILABLE_FUNDS"));
  });

  it("a chargeback takes what is available and records the rest as this customer's receivable (AT-32)", async () => {
    const u = users.chargeback!;
    const otherBefore = await balancesFor(t.db, users.ander!);
    await deposit(u, "dep-cb-1", 5_000);
    const orderId = await order(u);
    await t.db.transaction((tx) => createHold(tx, "demo", { userId: u, purpose: "BUY_ORDER", orderId, amount: 3_000 }));
    const avail = (await balancesFor(t.db, u)).available;
    await t.db.transaction((tx) => book(tx, "demo", "test", postings.chargeback(u, "dep-cb-1", 5_000, avail)));
    const b = await balancesFor(t.db, u);
    assert.deepEqual([b.available, b.reserved, b.receivable], [0, 3_000, 3_000]);
    assert.deepEqual(await balancesFor(t.db, users.ander!), otherBefore, "other customers untouched");
  });

  it("all structural money invariants hold", async () => {
    assert.deepEqual(await ledgerInvariants(t.db), { unbalancedEntries: 0, projectionMismatches: 0, negativeCustomerBalances: 0, reservedNotMatchingHolds: 0 });
  });
});
