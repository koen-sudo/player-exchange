import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import { buildDemoWorld, COLLECTOR_ID } from "@px/demo";
import { decideApproval } from "../src/approvals.ts";
import { loadIdentity } from "../src/identity.ts";
import {
  createDraftProgramme,
  ensureEdition,
  holdingsFor,
  inventoryInvariants,
  mintCards,
  publishProgramme,
  requestProgrammePublication,
  reserveCardsForSale,
  supplyFor,
  transferOwnership,
  updateDraftProgramme,
} from "../src/inventory.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const w = buildDemoWorld();
const uid = (login: string) => w.users.find((u) => u.login === login)!.id;
const pid = (name: string) => w.players.find((p) => p.displayName === name)!.id;
const isCode = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb({ seeded: true });
});
afterAll(async () => t.drop());

const who = async (login: string) => (await loadIdentity(t.db, uid(login), "demo"))!;

async function publishWithApproval(playerId: string, season: string, planned: number, reason = "Seizoensprogramma voorbereid") {
  const sanne = await who("beheer");
  const joris = await who("approver");
  const programmeId = await createDraftProgramme(t.db, sanne, { playerId, seasonKey: season, plannedTotal: planned, reason });
  const approvalId = await requestProgrammePublication(t.db, sanne, { programmeId, reason: "Graag publiceren" });
  await decideApproval(t.db, joris, { approvalId, decision: "APPROVE", reason: "Gecontroleerd en akkoord" });
  await publishProgramme(t.db, sanne, { programmeId, approvalId });
  return { programmeId, approvalId };
}

describe("programme publication with two-person approval (docs/10)", () => {
  it("draft → request → approval by someone else → publish", async () => {
    const { programmeId, approvalId } = await publishWithApproval(pid("Noah Vermeer"), "2027-2028", 300);
    const row = (await t.db.execute<{ status: string; approval_id: string }>(sql`select status::text status, approval_id from issuance_programs where id = ${programmeId}`)).rows[0]!;
    assert.deepEqual(row, { status: "PUBLISHED", approval_id: approvalId });
    const appr = (await t.db.execute<{ status: string }>(sql`select status from admin_approvals where id = ${approvalId}`)).rows[0]!;
    assert.equal(appr.status, "EXECUTED");
  });

  it("the requester cannot approve their own request, and a trader cannot request", async () => {
    const sanne = await who("beheer");
    const programmeId = await createDraftProgramme(t.db, sanne, { playerId: pid("Lucas Moreau"), seasonKey: "2027-2028", plannedTotal: 200, reason: "Volgend seizoen" });
    const approvalId = await requestProgrammePublication(t.db, sanne, { programmeId, reason: "Graag publiceren" });
    await assert.rejects(decideApproval(t.db, sanne, { approvalId, decision: "APPROVE", reason: "zelf akkoord" }), isCode("ACTION_NOT_ALLOWED"));
    await assert.rejects(publishProgramme(t.db, sanne, { programmeId, approvalId }), isCode("ACTION_NOT_ALLOWED"), "not approved yet");
    const anna = await who("anna");
    await assert.rejects(requestProgrammePublication(t.db, anna, { programmeId, reason: "ik wil dit" }), isCode("ACTION_NOT_ALLOWED"));
  });

  it("an approval is used once only", async () => {
    const sanne = await who("beheer");
    const { approvalId } = await publishWithApproval(pid("Mateo Ruiz"), "2027-2028", 250);
    const programmeId = await createDraftProgramme(t.db, sanne, { playerId: pid("Mateo Ruiz"), seasonKey: "2027-2028", plannedTotal: 200, reason: "Kleiner programma na blessure" });
    await assert.rejects(publishProgramme(t.db, sanne, { programmeId, approvalId }), isCode("ACTION_NOT_ALLOWED"));
  });

  it("changing a draft after approval invalidates the approval (AT-34)", async () => {
    const sanne = await who("beheer");
    const joris = await who("approver");
    const programmeId = await createDraftProgramme(t.db, sanne, { playerId: pid("Elias Weber"), seasonKey: "2027-2028", plannedTotal: 200, reason: "Seizoensprogramma" });
    const approvalId = await requestProgrammePublication(t.db, sanne, { programmeId, reason: "Graag publiceren" });
    await decideApproval(t.db, joris, { approvalId, decision: "APPROVE", reason: "Akkoord met 200" });
    await updateDraftProgramme(t.db, sanne, { programmeId, plannedTotal: 220, reason: "Toch iets meer" });
    await assert.rejects(publishProgramme(t.db, sanne, { programmeId, approvalId }), isCode("ACTION_NOT_ALLOWED"));
    const appr = (await t.db.execute<{ status: string }>(sql`select status from admin_approvals where id = ${approvalId}`)).rows[0]!;
    assert.equal(appr.status, "INVALIDATED");
  });

  it("an amended programme supersedes the old one; an increase is refused (BR-04)", async () => {
    const sanne = await who("beheer");
    const noah = pid("Noah Vermeer");
    await publishWithApproval(noah, "2027-2028", 250, "Kleiner programma: speler langdurig geblesseerd");
    const versions = (await t.db.execute<{ version: number; status: string; planned_total: number }>(sql`
      select ip.version, ip.status::text status, ip.planned_total from issuance_programs ip join editions e on e.id = ip.edition_id
       where e.player_id = ${noah} and e.season_key = '2027-2028' order by version`)).rows;
    assert.deepEqual(versions, [{ version: 1, status: "SUPERSEDED", planned_total: 300 }, { version: 2, status: "PUBLISHED", planned_total: 250 }]);
    await assert.rejects(createDraftProgramme(t.db, sanne, { playerId: noah, seasonKey: "2027-2028", plannedTotal: 260, reason: "Meer vraag" }), isCode("ACTION_NOT_ALLOWED"));
  });

  it("no new primary programme for retired, unapproved or minor players (BR-22, docs/01)", async () => {
    const sanne = await who("beheer");
    const retired = w.players.find((p) => p.careerStatus === "RETIRED")!.id;
    const minor = w.players.find((p) => p.age < 18)!.id;
    const profileOnly = w.players.find((p) => p.marketStatus === "PROFILE_ONLY" && p.age >= 18)!.id;
    for (const playerId of [retired, minor, profileOnly]) {
      await assert.rejects(createDraftProgramme(t.db, sanne, { playerId, seasonKey: "2027-2028", plannedTotal: 100, reason: "Proberen" }), isCode("ACTION_NOT_ALLOWED"));
    }
  });
});

describe("cards: cap and concurrency", () => {
  it("parallel minting never exceeds the published programme or duplicates a serial (AT-06, AT-07)", async () => {
    const player = pid("Lucas Moreau");
    await publishWithApproval(player, "2028-2029", 50, "Kleine editie voor gelijktijdigheidstest");
    const editionId = await ensureEdition(t.db, player, "2028-2029");
    const attempts = await Promise.allSettled(Array.from({ length: 15 }, () => t.db.transaction((tx) => mintCards(tx, editionId, 5))));
    const ok = attempts.filter((a) => a.status === "fulfilled");
    const refused = attempts.filter((a) => a.status === "rejected");
    assert.equal(ok.length, 10);
    assert.ok(refused.every((r) => r.status === "rejected" && isCode("EDITION_CAP_EXCEEDED")(r.reason)));
    const serials = (await t.db.execute<{ serial_number: number }>(sql`select serial_number from cards where edition_id = ${editionId} order by 1`)).rows.map((r) => r.serial_number);
    assert.deepEqual(serials, Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("the same card cannot be reserved by two sell orders at the same time (AT-13)", async () => {
    const anna = uid("anna");
    const holdings = await holdingsFor(t.db, anna);
    const free = holdings.find((h) => !h.reserved_for_sale)!;
    const mk = async () => (await t.db.execute<{ id: string }>(sql`
      insert into orders(player_market_id, user_id, side, limit_price_cents, time_in_force, qty_original, qty_open)
      select id, ${anna}, 'SELL', 700, 'ONE_DAY', 1, 1 from player_markets where player_id = ${free.player_id} returning id`)).rows[0]!.id;
    const [o1, o2] = [await mk(), await mk()];
    const results = await Promise.allSettled([o1, o2].map((orderId) => t.db.transaction((tx) => reserveCardsForSale(tx, { userId: anna, orderId, cardIds: [free.card_id] }))));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.ok(results.some((r) => r.status === "rejected" && isCode("CARD_UNAVAILABLE")(r.reason)));
    assert.equal((await inventoryInvariants(t.db)).cardsMultiReserved, 0);
  });

  it("a user cannot reserve someone else's card (AT-09)", async () => {
    const theirs = (await t.db.execute<{ id: string; player_id: string }>(sql`select id, player_id from cards where owner_user_id = ${COLLECTOR_ID} limit 1`)).rows[0]!;
    const order = (await t.db.execute<{ id: string }>(sql`
      insert into orders(player_market_id, user_id, side, limit_price_cents, time_in_force, qty_original, qty_open)
      select id, ${uid("anna")}, 'SELL', 700, 'ONE_DAY', 1, 1 from player_markets where player_id = ${theirs.player_id} returning id`)).rows[0]!;
    await assert.rejects(t.db.transaction((tx) => reserveCardsForSale(tx, { userId: uid("anna"), orderId: order.id, cardIds: [theirs.id] })), isCode("CARD_UNAVAILABLE"));
  });
});

describe("ownership and portfolio", () => {
  it("Anna's portfolio comes from her actual cards: 3 players, 6 cards, €30,60 cost, 1 reserved (UX-03)", async () => {
    const fresh = await createTestDb({ seeded: true });
    try {
      const h = await holdingsFor(fresh.db, uid("anna"));
      assert.equal(h.length, 6);
      assert.equal(new Set(h.map((x) => x.player_id)).size, 3);
      assert.equal(h.reduce((n, x) => n + Number(x.cost_basis_cents), 0), 3060);
      assert.equal(h.filter((x) => x.reserved_for_sale).length, 1);
    } finally {
      await fresh.drop();
    }
  });

  it("transferring a card records the event, sets the new cost basis and ends any reservation", async () => {
    const card = (await t.db.execute<{ id: string; player_id: string }>(sql`select id, player_id from cards where owner_user_id = ${COLLECTOR_ID} limit 1`)).rows[0]!;
    await t.db.transaction((tx) => transferOwnership(tx, { cardId: card.id, toUserId: uid("anna"), costBasisCents: 640, cause: "INCIDENT_CORRECTION", reference: "test-correctie" }));
    const ev = (await t.db.execute<{ previous_owner_id: string; new_owner_id: string; cost_basis_cents: string }>(sql`
      select previous_owner_id, new_owner_id, cost_basis_cents from ownership_events where card_id = ${card.id} order by occurred_at desc limit 1`)).rows[0]!;
    assert.deepEqual([ev.previous_owner_id, ev.new_owner_id, Number(ev.cost_basis_cents)], [COLLECTOR_ID, uid("anna"), 640]);
    const inv = await inventoryInvariants(t.db);
    assert.deepEqual(inv, { ownershipMismatches: 0, cardsOverProgramme: 0, editionsOverCap: 0, cardsMultiReserved: 0, reservedNotOwned: 0 });
  });

  it("supply per player: 80 in circulation, 80 this season, 200 planned for Noah", async () => {
    const fresh = await createTestDb({ seeded: true });
    try {
      const s = (await supplyFor(fresh.db, "2026-2027", [pid("Noah Vermeer")])).get(pid("Noah Vermeer"))!;
      assert.deepEqual([s.in_circulation, s.sold_this_season, s.planned_this_season], [80, 80, 200]);
    } finally {
      await fresh.drop();
    }
  });
});
