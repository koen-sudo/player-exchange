import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { allocate, DomainError, verifySeed } from "@px/domain";
import { buildDemoWorld } from "@px/demo";
import { decideApproval } from "../src/approvals.ts";
import { loadIdentity } from "../src/identity.ts";
import { inventoryInvariants } from "../src/inventory.ts";
import { balancesFor, book, ledgerInvariants, postings } from "../src/ledger.ts";
import { createPaymentSimulator, type SimScenario } from "../src/payment-simulator.ts";
import { pollOpenOperations } from "../src/payments.ts";
import { runReconciliation } from "../src/reconciliation.ts";
import { tradingInvariants } from "../src/trading.ts";
import {
  applyDropPriceChange, cancelSubscription, closeAndAllocate, demoShiftSchedule, issuanceInvariants, parseSeedKey,
  proposeDrop, publishDrop, requestDropPriceChange, subscribe, type IssuanceCtx,
} from "../src/drops.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const w = buildDemoWorld();
const loginId = (login: string) => w.users.find((u) => u.login === login)!.id;
const isCode = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;
const SEED_KEY = parseSeedKey("ab".repeat(32));
const PLAYER = "7e570000-0000-4000-8000-0000000000d1";
const RETIRED = "7e570000-0000-4000-8000-0000000000d2";

let t: TestDb;
let beheer: Awaited<ReturnType<typeof loadIdentity>> & object;
let approver: Awaited<ReturnType<typeof loadIdentity>> & object;

beforeAll(async () => {
  t = await createTestDb({ seeded: true });
  for (const [id, career] of [[PLAYER, "ACTIVE"], [RETIRED, "RETIRED"]] as const) {
    await t.db.execute(sql`INSERT INTO players(id, display_name, is_fictional, career_status, primary_admission) VALUES (${id}, ${`Uitgiftespeler ${career}`}, true, ${career}, 'APPROVED')`);
    await t.db.execute(sql`INSERT INTO player_markets(player_id, status) VALUES (${id}, 'PRELAUNCH')`);
    const ed = (await t.db.execute<{ id: string }>(sql`INSERT INTO editions(player_id, season_key) VALUES (${id}, '2026-2027') RETURNING id`)).rows[0]!.id;
    await t.db.execute(sql`INSERT INTO issuance_programs(edition_id, version, planned_total, status, published_at, is_opening_balance) VALUES (${ed}, 1, 50, 'PUBLISHED', now(), true)`);
  }
  beheer = (await loadIdentity(t.db, loginId("beheer"), "demo"))!;
  approver = (await loadIdentity(t.db, loginId("approver"), "demo"))!;
}, 60_000);
afterAll(async () => t.drop());

async function trader(name: string, euros: number): Promise<string> {
  const id = randomUUID();
  await t.db.execute(sql`INSERT INTO users(id, auth_subject, is_test_account) VALUES (${id}, ${`test:${name}:${id}`}, true)`);
  await t.db.execute(sql`INSERT INTO user_profiles(user_id, display_name, residence_country, verification_status, age_confirmed) VALUES (${id}, ${name}, 'NL', 'VERIFIED', true)`);
  await t.db.execute(sql`INSERT INTO terms_acceptances(user_id, document_key, document_version) SELECT ${id}, document_key, document_version FROM terms_documents WHERE is_current`);
  if (euros) {
    // Money that the (simulated) provider also holds, so reconciliation agrees.
    await t.db.transaction((tx) => book(tx, "demo", "test", postings.openingBalance(id, euros * 100, "test")));
    await t.db.execute(sql`INSERT INTO psp_sim.operations(idempotency_key, reference, kind, account_ref, amount_cents, status, scenario, resolved_at)
      VALUES (${`opening-${id}`}, ${`sim-opening-${id}`}, 'DEPOSIT', ${`user:${id}`}, ${euros * 100}, 'SUCCEEDED', 'TEST', now())`);
    await t.db.execute(sql`INSERT INTO settlement_operations(type, idempotency_key, provider, provider_reference, amount_cents, status, financially_processed_at, user_id)
      VALUES ('DEPOSIT', ${`opening-${id}`}, 'demo', ${`sim-opening-${id}`}, ${euros * 100}, 'SUCCEEDED', now(), ${id})`);
  }
  return id;
}

/** Settlement answers in order; after the list runs out: SUCCESS. */
function ctx(settle: SimScenario[] = []): IssuanceCtx {
  const queue = [...settle];
  const sim = createPaymentSimulator(t.db, { secret: "s", delaySeconds: 30, scenarioFor: (kind) => (kind === "SETTLE" ? queue.shift() ?? "SUCCESS" : "SUCCESS") });
  return { db: t.db, provider: sim, providerName: "demo", mode: "demo", seedKey: SEED_KEY };
}

const inDays = (d: number, h = 0) => new Date(Date.now() + d * 86_400_000 + h * 3_600_000);

async function publishedDrop(c: IssuanceCtx, quantity: number, priceCents = 500): Promise<string> {
  const { dropId, approvalId } = await proposeDrop(t.db, beheer, { playerId: PLAYER, priceCents, quantity, opensAt: inDays(5), closesAt: inDays(5, 12), reason: "Uitgifte voor de test" });
  await decideApproval(t.db, approver, { approvalId, decision: "APPROVE", reason: "Gecontroleerd" });
  await publishDrop(c, beheer, { dropId, approvalId });
  return dropId;
}
const drop = async (id: string) => (await t.db.execute<{ status: string; price_cents: string; seed_commitment: string | null; seed_revealed: string | null; price_fixed_at: string | null }>(sql`
  SELECT status::text, price_cents, seed_commitment, seed_revealed, price_fixed_at FROM drops WHERE id = ${id}`)).rows[0]!;
const subs = async (dropId: string) => (await t.db.execute<{ id: string; user_id: string; status: string }>(sql`SELECT id, user_id, status::text FROM subscriptions WHERE drop_id = ${dropId} ORDER BY created_at`)).rows;
const owned = async (userId: string) => (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM cards WHERE player_id = ${PLAYER} AND owner_user_id = ${userId}`)).rows[0]!.n;

describe("publishing a drop (BR-09, four-eyes, AT-30)", () => {
  it("a retired player gets no new primary issuance (AT-30)", async () => {
    await assert.rejects(proposeDrop(t.db, beheer, { playerId: RETIRED, priceCents: 500, quantity: 3, opensAt: inDays(5), closesAt: inDays(5, 12), reason: "Niet toegestaan" }), isCode("ACTION_NOT_ALLOWED"));
  });

  it("publishing needs a second person; then cards exist within the programme and only the seed commitment is visible", async () => {
    const c = ctx();
    const { dropId, approvalId } = await proposeDrop(t.db, beheer, { playerId: PLAYER, priceCents: 500, quantity: 3, opensAt: inDays(5), closesAt: inDays(5, 12), reason: "Uitgifte voor de test" });
    await assert.rejects(publishDrop(c, beheer, { dropId, approvalId }), isCode("ACTION_NOT_ALLOWED"));
    await assert.rejects(decideApproval(t.db, beheer, { approvalId, decision: "APPROVE", reason: "zelf goedkeuren" }), isCode("ACTION_NOT_ALLOWED"));
    await decideApproval(t.db, approver, { approvalId, decision: "APPROVE", reason: "Gecontroleerd" });
    await publishDrop(c, beheer, { dropId, approvalId });
    const d = await drop(dropId);
    assert.equal(d.status, "PUBLISHED");
    assert.match(d.seed_commitment ?? "", /^[0-9a-f]{64}$/);
    assert.equal(d.seed_revealed, null);
    const cards = (await t.db.execute<{ status: string }>(sql`SELECT c.status::text FROM drop_cards dc JOIN cards c ON c.id = dc.card_id WHERE dc.drop_id = ${dropId}`)).rows;
    assert.deepEqual(cards.map((x) => x.status), ["IN_DROP", "IN_DROP", "IN_DROP"]);
    await assert.rejects(proposeDrop(t.db, beheer, { playerId: PLAYER, priceCents: 500, quantity: 48, opensAt: inDays(6), closesAt: inDays(6, 12), reason: "Te veel kaarten" }), isCode("EDITION_CAP_EXCEEDED"));
  });

  it("the price may change in both directions until opening, each time with approval (V-01a); a stale approval is refused (AT-34)", async () => {
    const c = ctx();
    const id = await publishedDrop(c, 1, 500);
    const up = await requestDropPriceChange(t.db, beheer, { dropId: id, newPriceCents: 650, reason: "Nieuwe referentie" });
    const down = await requestDropPriceChange(t.db, beheer, { dropId: id, newPriceCents: 450, reason: "Andere variant" });
    await decideApproval(t.db, approver, { approvalId: up, decision: "APPROVE", reason: "Akkoord" });
    await decideApproval(t.db, approver, { approvalId: down, decision: "APPROVE", reason: "Akkoord" });
    await applyDropPriceChange(t.db, beheer, { dropId: id, approvalId: up, newPriceCents: 650 });
    assert.equal((await drop(id)).price_cents, "650");
    // `down` was approved against €5,00; the price is now €6,50.
    await assert.rejects(applyDropPriceChange(t.db, beheer, { dropId: id, approvalId: down, newPriceCents: 450 }), isCode("ACTION_NOT_ALLOWED"));
    const down2 = await requestDropPriceChange(t.db, beheer, { dropId: id, newPriceCents: 450, reason: "Toch lager" });
    await decideApproval(t.db, approver, { approvalId: down2, decision: "APPROVE", reason: "Akkoord" });
    await applyDropPriceChange(t.db, beheer, { dropId: id, approvalId: down2, newPriceCents: 450 });
    assert.equal((await drop(id)).price_cents, "450");
    await demoShiftSchedule(c, beheer, { dropId: id, action: "OPEN_NOW" });
    assert.ok((await drop(id)).price_fixed_at);
    await assert.rejects(requestDropPriceChange(t.db, beheer, { dropId: id, newPriceCents: 500, reason: "Na opening" }), isCode("ACTION_NOT_ALLOWED"));
    await assert.rejects(t.db.execute(sql`UPDATE drops SET price_cents = 500 WHERE id = ${id}`));
  });
});

describe("subscribing and allocation (BR-10, BR-11, AT-24, AT-25)", () => {
  let dropId = "";
  const people: string[] = [];

  it("subscribing reserves the price, once per person, only while open", async () => {
    const c = ctx();
    dropId = await publishedDrop(c, 3, 500);
    for (let i = 0; i < 5; i++) people.push(await trader(`inschrijver-${i}`, 20));
    await assert.rejects(subscribe(c, people[0]!, { dropId, requestKey: randomUUID() }), isCode("DROP_NOT_OPEN"));
    await demoShiftSchedule(c, beheer, { dropId, action: "OPEN_NOW" });
    for (const p of people) await subscribe(c, p, { dropId, requestKey: randomUUID() });
    const b = await balancesFor(t.db, people[0]!);
    assert.deepEqual([b.available, b.reserved], [1_500, 500]);
    await assert.rejects(subscribe(c, people[0]!, { dropId, requestKey: randomUUID() }), isCode("SUBSCRIPTION_EXISTS"));
    const poor = await trader("arm", 2);
    await assert.rejects(subscribe(c, poor, { dropId, requestKey: randomUUID() }), isCode("INSUFFICIENT_AVAILABLE_FUNDS"));
    await assert.rejects(subscribe(c, loginId("bram"), { dropId, requestKey: randomUUID() }), isCode("VERIFICATION_REQUIRED"));
    // One person withdraws before closing: the reservation is released.
    const mine = (await subs(dropId)).find((s) => s.user_id === people[4])!;
    await cancelSubscription(c, people[4]!, mine.id);
    assert.deepEqual([(await balancesFor(t.db, people[4]!)).available, (await balancesFor(t.db, people[4]!)).reserved], [2_000, 0]);
  });

  it("a reservation that is not confirmed in time does not take part (AT-25)", async () => {
    const late = await trader("te-laat", 20);
    await t.db.execute(sql`INSERT INTO subscriptions(drop_id, user_id, quantity, status, price_cents) VALUES (${dropId}, ${late}, 1, 'RESERVATION_PENDING', 500)`);
  });

  it("closing draws a verifiable ranking; winners receive cards, the rest is waitlisted then released", async () => {
    const c = ctx();
    const revenueBefore = Number((await t.db.execute<{ b: string }>(sql`SELECT balance_cents b FROM ledger_accounts WHERE type = 'PRIMARY_REVENUE_CLEARING'`)).rows[0]?.b ?? 0);
    await demoShiftSchedule(c, beheer, { dropId, action: "CLOSE_NOW" });
    const d = await drop(dropId);
    assert.equal(d.status, "COMPLETED");
    const all = await subs(dropId);
    assert.equal(all.find((s) => s.status === "INVALID_LATE") !== undefined, true, "late reservation refused");
    const winners = people.slice(0, 4);
    const delivered = await Promise.all(winners.map(owned));
    assert.equal(delivered.reduce((a, b) => a + b, 0), 3, "3 cards for 4 valid participants");
    for (const p of people.slice(0, 4)) {
      const b = await balancesFor(t.db, p);
      assert.equal(b.reserved, 0, "nothing stays reserved after completion");
      assert.equal(b.available, (await owned(p)) ? 1_500 : 2_000);
    }
    const revenueAfter = Number((await t.db.execute<{ b: string }>(sql`SELECT balance_cents b FROM ledger_accounts WHERE type = 'PRIMARY_REVENUE_CLEARING'`)).rows[0]!.b);
    assert.equal(revenueAfter - revenueBefore, 1_500);

    // Anyone can check the draw: the revealed seed matches the commitment and reproduces the ranking (AT-24).
    const seed = Buffer.from(d.seed_revealed!, "hex");
    assert.ok(verifySeed(seed, d.seed_commitment!));
    const snap = (await t.db.execute<{ participant_ids: string[]; ranking: string[]; result_digest: string; available_cards: number }>(sql`
      SELECT participant_ids, ranking, result_digest, available_cards FROM allocation_snapshots WHERE drop_id = ${dropId}`)).rows[0]!;
    const again = allocate({ seed, commitment: d.seed_commitment!, dropId, frozenSubscriptionIds: snap.participant_ids, availableCards: snap.available_cards });
    assert.deepEqual(again.ranking, snap.ranking);
    assert.equal(again.resultDigest, snap.result_digest);
    const winnersBySub = (await t.db.execute<{ subscription_id: string }>(sql`SELECT subscription_id FROM allocations WHERE drop_id = ${dropId} ORDER BY rank`)).rows.map((r) => r.subscription_id);
    assert.deepEqual(winnersBySub, again.winners);

    // A retry changes nothing.
    assert.equal(await closeAndAllocate(c, dropId), null);
    assert.equal((await t.db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM allocations WHERE drop_id = ${dropId}`)).rows[0]!.n, 3);
  });
});

describe("waitlist (BR-12, AT-26, AT-27)", () => {
  it("a definitive payment failure gives the card to the next candidate on the fixed waitlist (AT-27)", async () => {
    const c = ctx(["FAIL"]);
    const id = await publishedDrop(c, 1, 300);
    const ps = [await trader("w1", 10), await trader("w2", 10), await trader("w3", 10)];
    await demoShiftSchedule(c, beheer, { dropId: id, action: "OPEN_NOW" });
    for (const p of ps) await subscribe(c, p, { dropId: id, requestKey: randomUUID() });
    await demoShiftSchedule(c, beheer, { dropId: id, action: "CLOSE_NOW" });
    const allocs = (await t.db.execute<{ status: string; rank: number; promoted_from: string | null }>(sql`SELECT status::text, rank, promoted_from FROM allocations WHERE drop_id = ${id} ORDER BY allocated_at`)).rows;
    assert.deepEqual(allocs.map((a) => a.status), ["FAILED", "DELIVERED"]);
    assert.ok(allocs[1]!.promoted_from, "second allocation is a promotion");
    assert.ok(allocs[1]!.rank > allocs[0]!.rank, "the next rank, not a new draw");
    const total = (await Promise.all(ps.map(owned))).reduce((a, b) => a + b, 0);
    assert.equal(total, 1);
    assert.equal((await drop(id)).status, "COMPLETED");
    for (const p of ps) assert.equal((await balancesFor(t.db, p)).reserved, 0);
  });

  it("an uncertain outcome holds the card: no second buyer; the late success delivers once (AT-26)", async () => {
    const c = ctx(["UNKNOWN_THEN_SUCCESS"]);
    const id = await publishedDrop(c, 1, 300);
    const ps = [await trader("u1", 10), await trader("u2", 10)];
    await demoShiftSchedule(c, beheer, { dropId: id, action: "OPEN_NOW" });
    for (const p of ps) await subscribe(c, p, { dropId: id, requestKey: randomUUID() });
    await demoShiftSchedule(c, beheer, { dropId: id, action: "CLOSE_NOW" });
    let allocs = (await t.db.execute<{ status: string }>(sql`SELECT status::text FROM allocations WHERE drop_id = ${id}`)).rows;
    assert.deepEqual(allocs.map((a) => a.status), ["SETTLEMENT_PENDING"]);
    assert.equal((await drop(id)).status, "SETTLING");
    assert.ok((await subs(id)).some((s) => s.status === "WAITLISTED"), "the waitlist waits");
    await t.db.execute(sql`UPDATE psp_sim.operations SET resolve_after = now() WHERE resolve_after > now()`);
    await pollOpenOperations(c, { olderThanSeconds: 0 });
    allocs = (await t.db.execute<{ status: string }>(sql`SELECT status::text FROM allocations WHERE drop_id = ${id}`)).rows;
    assert.deepEqual(allocs.map((a) => a.status), ["DELIVERED"]);
    assert.equal((await drop(id)).status, "COMPLETED");
    assert.equal((await Promise.all(ps.map(owned))).reduce((a, b) => a + b, 0), 1);
  });
});

describe("invariants after all drop scenarios", () => {
  it("issuance, trading, ledger and inventory invariants hold, and the provider agrees", async () => {
    assert.deepEqual(await issuanceInvariants(t.db), { cardsWithTwoLiveAllocations: 0, deliveredNotOwned: 0, dropsOverQuantity: 0, releasedSubscriptionsStillHeld: 0 });
    assert.deepEqual(await ledgerInvariants(t.db), { unbalancedEntries: 0, projectionMismatches: 0, negativeCustomerBalances: 0, reservedNotMatchingHolds: 0 });
    const tr = await tradingInvariants(t.db);
    assert.ok(Object.values(tr).every((v) => v === 0), JSON.stringify(tr));
    const inv = await inventoryInvariants(t.db);
    assert.ok(Object.values(inv).every((v) => v === 0), JSON.stringify(inv));
    const r = await runReconciliation(t.db, ctx().provider, "demo");
    const breaks = (await t.db.execute(sql`SELECT kind, detail FROM reconciliation_breaks WHERE status <> 'RESOLVED'`)).rows;
    assert.equal(r.outcome, "MATCHED", JSON.stringify(breaks));
  });
});
