import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { and, eq, isNull, sql } from "drizzle-orm";
import { buildDemoWorld, createFixtureProvider, ProviderUnavailableError, v2Changes } from "@px/demo";
import { claimNextRun, queueCatalogImport, retryRun, runCatalogImport } from "../src/catalog-import.ts";
import { importIssues, importRunSteps, importRuns, importSnapshots, playerMarkets, playerTeamMemberships, players, providerPlayerMappings } from "../src/schema.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const world = buildDemoWorld();
const NOW = () => new Date("2026-11-05T17:00:00Z");

async function importOnce(t: TestDb, scenario: Parameters<typeof createFixtureProvider>[0] = {}) {
  const { runId } = await queueCatalogImport(t.db, "fixture", null);
  const stats = await runCatalogImport(t.db, runId, createFixtureProvider(scenario, world), { now: NOW });
  return { runId, stats };
}

const count = async (t: TestDb, q: ReturnType<typeof sql>) => Number((await t.db.execute<{ n: string }>(q)).rows[0]!.n);

describe("catalogue import into an empty database", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => t.drop());

  it("imports all six competitions, 24 teams and 240 players (AT-01, PRD-02)", async () => {
    const { stats } = await importOnce(t);
    assert.equal(stats.competitions, 6);
    assert.equal(stats.teams, 24);
    assert.equal(stats.playersCreated, 240);
    assert.equal(await count(t, sql`select count(*) n from competitions`), 6);
    assert.equal(await count(t, sql`select count(*) n from players`), 240);
    assert.equal(await count(t, sql`select count(*) n from player_team_memberships where valid_to is null`), 240);
  });

  it("every imported profile gets a market that is PROFILE_ONLY: import never admits to issuance", async () => {
    assert.equal(await count(t, sql`select count(*) n from player_markets where status = 'PROFILE_ONLY'`), 240);
    assert.equal(await count(t, sql`select count(*) n from players where primary_admission <> 'INELIGIBLE'`), 0);
  });

  it("stores raw pages as snapshots with a retention date", async () => {
    const snaps = await t.db.select().from(importSnapshots).limit(5);
    assert.ok(snaps.length > 0);
    assert.ok(snaps.every((s) => s.retainUntil.getTime() > NOW().getTime()));
  });

  it("a full re-import creates no duplicates and changes nothing (AT-02)", async () => {
    const { stats } = await importOnce(t);
    assert.deepEqual(
      [stats.playersCreated, stats.playersUpdated, stats.membershipsOpened, stats.membershipsClosed, stats.issues],
      [0, 0, 0, 0, 0],
    );
    assert.equal(stats.playersUnchanged, 240);
    assert.equal(await count(t, sql`select count(*) n from players`), 240);
  });

  it("v2: transfer keeps the player id, closes the old club and opens the new one (AT-03)", async () => {
    const c = v2Changes(world);
    const map = await t.db.query.providerPlayerMappings.findFirst({ where: eq(providerPlayerMappings.externalId, c.transfer.player.id) });
    const before = await t.db.query.playerMarkets.findFirst({ where: eq(playerMarkets.playerId, map!.playerId) });
    const { stats } = await importOnce(t, { version: "v2" });
    assert.equal(stats.playersCreated, 1, "only the newcomer is new");
    const mapAfter = await t.db.query.providerPlayerMappings.findFirst({ where: eq(providerPlayerMappings.externalId, c.transfer.player.id) });
    assert.equal(mapAfter!.playerId, map!.playerId);
    const after = await t.db.query.playerMarkets.findFirst({ where: eq(playerMarkets.playerId, map!.playerId) });
    assert.equal(after!.id, before!.id, "same market");
    const open = await t.db.execute<{ team: string; comp: string }>(sql`
      select t.name team, c.name comp from player_team_memberships m
        join teams t on t.id = m.team_id
        join team_competition_memberships tcm on tcm.team_id = t.id and tcm.valid_to is null
        join competitions c on c.id = tcm.competition_id
       where m.player_id = ${map!.playerId} and m.valid_to is null`);
    assert.deepEqual(open.rows, [{ team: c.transfer.toTeam.name, comp: "Premier League" }]);
    assert.equal(await count(t, sql`select count(*) n from player_team_memberships where player_id = ${map!.playerId} and valid_to is not null`), 1);
  });

  it("v2: a player missing from a complete squad keeps his profile; only the membership closes", async () => {
    const c = v2Changes(world);
    const map = await t.db.query.providerPlayerMappings.findFirst({ where: eq(providerPlayerMappings.externalId, c.leaver.player.id) });
    const p = await t.db.query.players.findFirst({ where: eq(players.id, map!.playerId) });
    assert.ok(p, "player still exists");
    const open = await t.db.select().from(playerTeamMemberships).where(and(eq(playerTeamMemberships.playerId, map!.playerId), isNull(playerTeamMemberships.validTo)));
    assert.equal(open.length, 0);
  });

  it("v2: a corrected name updates the same player and bumps its version", async () => {
    const c = v2Changes(world);
    const map = await t.db.query.providerPlayerMappings.findFirst({ where: eq(providerPlayerMappings.externalId, c.renamed.player.id) });
    const p = await t.db.query.players.findFirst({ where: eq(players.id, map!.playerId) });
    assert.equal(p!.displayName, c.renamed.newName);
    assert.ok(p!.version > 1);
  });

  it("v2: a promoted youth player is created as profile only, without admission", async () => {
    const map = await t.db.query.providerPlayerMappings.findFirst({ where: eq(providerPlayerMappings.externalId, "fx-new-0001") });
    const p = await t.db.query.players.findFirst({ where: eq(players.id, map!.playerId) });
    assert.equal(p!.primaryAdmission, "INELIGIBLE");
    const m = await t.db.query.playerTeamMemberships.findFirst({ where: eq(playerTeamMemberships.playerId, map!.playerId) });
    assert.equal(m!.membershipType, "YOUTH");
  });

  it("re-running v2 is idempotent", async () => {
    const { stats } = await importOnce(t, { version: "v2" });
    assert.deepEqual([stats.playersCreated, stats.playersUpdated, stats.membershipsOpened, stats.membershipsClosed], [0, 0, 0, 0]);
    assert.equal(await count(t, sql`select count(*) n from players`), 241);
  });
});

describe("partial feeds and data-quality problems", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await importOnce(t);
  });
  afterAll(async () => t.drop());

  it("a partial squad never removes anyone (AT-04)", async () => {
    const team = world.teams[5]!;
    const openBefore = await count(t, sql`select count(*) n from player_team_memberships m join provider_team_mappings p on p.team_id = m.team_id where p.external_id = ${team.id} and m.valid_to is null`);
    const { runId } = await importOnce(t, { partialTeams: [team.id] });
    const openAfter = await count(t, sql`select count(*) n from player_team_memberships m join provider_team_mappings p on p.team_id = m.team_id where p.external_id = ${team.id} and m.valid_to is null`);
    assert.equal(openBefore, 10);
    assert.equal(openAfter, 10);
    const step = await t.db.select().from(importRunSteps).where(and(eq(importRunSteps.runId, runId), eq(importRunSteps.stepKey, `squad:${team.id}`)));
    assert.equal(step[0]!.isCompleteSnapshot, false);
  });

  it("a player listed twice is quarantined as DUPLICATE, not created twice", async () => {
    const { stats } = await importOnce(t, { duplicateInTeam: world.teams[2]!.id });
    assert.equal(stats.playersCreated, 0);
    const issues = await t.db.select().from(importIssues).where(eq(importIssues.kind, "DUPLICATE"));
    assert.equal(issues.length, 1);
  });

  it("the same person under a new external id is quarantined, not merged or duplicated (BR-01)", async () => {
    const before = await count(t, sql`select count(*) n from players`);
    const { stats } = await importOnce(t, { conflictingPlayer: true });
    assert.equal(stats.playersCreated, 0);
    assert.equal(await count(t, sql`select count(*) n from players`), before);
    const issues = await t.db.select().from(importIssues).where(eq(importIssues.kind, "CONFLICTING_MATCH"));
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.externalId, "fx-conflict-0001");
  });

  it("an open issue is recorded once even when the feed repeats it", async () => {
    await importOnce(t, { conflictingPlayer: true });
    assert.equal((await t.db.select().from(importIssues).where(eq(importIssues.kind, "CONFLICTING_MATCH"))).length, 1);
  });
});

describe("resumable imports", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => t.drop());

  it("an outage fails the run; a retry skips completed steps and finishes without duplicates", async () => {
    const { runId } = await queueCatalogImport(t.db, "fixture", null);
    const failing = createFixtureProvider({ failAfterCalls: 40 }, world);
    await assert.rejects(runCatalogImport(t.db, runId, failing, { now: NOW }), ProviderUnavailableError);
    const failed = await t.db.query.importRuns.findFirst({ where: eq(importRuns.id, runId) });
    assert.equal(failed!.status, "FAILED");
    const done = await count(t, sql`select count(*) n from import_run_steps where run_id = ${runId} and status = 'COMPLETED'`);
    assert.ok(done > 5, `some steps completed (${done})`);

    await retryRun(t.db, runId);
    const claimed = await claimNextRun(t.db);
    assert.equal(claimed, runId);
    const healthy = createFixtureProvider({}, world);
    await runCatalogImport(t.db, runId, healthy, { now: NOW });
    const full = createFixtureProvider({}, world);
    const fresh = await createTestDb();
    try {
      const { runId: r2 } = await queueCatalogImport(fresh.db, "fixture", null);
      await runCatalogImport(fresh.db, r2, full, { now: NOW });
    } finally {
      await fresh.drop();
    }
    assert.ok(healthy.calls < full.calls, `resume made fewer provider calls (${healthy.calls} < ${full.calls})`);
    assert.equal((await t.db.query.importRuns.findFirst({ where: eq(importRuns.id, runId) }))!.status, "COMPLETED");
    assert.equal(await count(t, sql`select count(*) n from players`), 240);
    assert.equal(await count(t, sql`select count(*) n from player_team_memberships where valid_to is null`), 240);
  });

  it("a run whose worker died (stale heartbeat) is picked up again", async () => {
    const { runId } = await queueCatalogImport(t.db, "fixture", null);
    await t.db.update(importRuns).set({ status: "RUNNING", heartbeatAt: new Date("2026-01-01T00:00:00Z") }).where(eq(importRuns.id, runId));
    assert.equal(await claimNextRun(t.db), runId);
    assert.equal(await claimNextRun(t.db), null, "a fresh heartbeat is not claimed twice");
  });

  it("only one active run per provider can be queued", async () => {
    const a = await queueCatalogImport(t.db, "fixture", null);
    const b = await queueCatalogImport(t.db, "fixture", null);
    assert.equal(b.runId, a.runId);
    assert.equal(b.alreadyActive, true);
  });
});

describe("import on the demo-seeded database", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ seeded: true });
  });
  afterAll(async () => t.drop());

  it("recognises every seeded player through the provider mapping", async () => {
    const { stats } = await importOnce(t);
    assert.equal(stats.playersCreated, 0);
    assert.equal(await count(t, sql`select count(*) n from players`), 240);
  });

  it("a transfer of a player with issued cards keeps cards, owners and market (AT-03)", async () => {
    const c = v2Changes(world);
    const pid = c.transfer.player.id; // seed uses the demo id as internal id
    const cardsBefore = await t.db.execute<{ id: string; owner_user_id: string }>(sql`select id, owner_user_id from cards where player_id = ${pid} order by id`);
    assert.ok(cardsBefore.rows.length > 0);
    await importOnce(t, { version: "v2" });
    const cardsAfter = await t.db.execute<{ id: string; owner_user_id: string }>(sql`select id, owner_user_id from cards where player_id = ${pid} order by id`);
    assert.deepEqual(cardsAfter.rows, cardsBefore.rows);
    const market = await t.db.query.playerMarkets.findFirst({ where: eq(playerMarkets.playerId, pid) });
    assert.equal(market!.status, "OPEN");
  });
});
