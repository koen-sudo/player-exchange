import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { buildDemoWorld } from "@px/demo";
import { decodeCursor, getCatalogPlayer, listCatalogPlayers, listCompetitions, listTeams } from "../src/catalog-read.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const w = buildDemoWorld();

describe("public catalogue reads", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ seeded: true });
  });
  afterAll(async () => t.drop());

  it("lists the six competitions with coverage (AT-01)", async () => {
    const comps = await listCompetitions(t.db);
    assert.deepEqual(comps.map((c) => c.name).sort(), ["Bundesliga", "Eredivisie", "LaLiga", "Ligue 1", "Premier League", "Pro League"]);
    assert.ok(comps.every((c) => c.coverage.teams === 4 && c.coverage.players === 40));
  });

  it("lists teams per competition", async () => {
    const ere = (await listCompetitions(t.db)).find((c) => c.name === "Eredivisie")!;
    const teams = await listTeams(t.db, ere.id);
    assert.deepEqual(teams.map((x) => x.name).sort(), ["Noordwijk", "Polder FC", "Rivieren SC", "Velden FC"]);
  });

  it("pages through all 240 players with a stable cursor and no duplicates (PRD-02)", async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof listCatalogPlayers>> = await listCatalogPlayers(t.db, { limit: 50, cursor });
      for (const p of page.items) {
        assert.equal(seen.has(p.id), false);
        seen.add(p.id);
      }
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    assert.equal(seen.size, 240);
    assert.equal(pages, 5);
  });

  it("filters by competition, role, market status and age; search ignores accents", async () => {
    const ere = (await listCompetitions(t.db)).find((c) => c.name === "Eredivisie")!;
    const inEre = await listCatalogPlayers(t.db, { competitionId: ere.id, limit: 100 });
    assert.equal(inEre.items.length, 40);
    const tradable = await listCatalogPlayers(t.db, { marketStatus: "TRADABLE", limit: 100 });
    assert.equal(tradable.nextCursor !== null, true);
    assert.ok(tradable.items.every((p) => p.marketStatus === "OPEN"));
    const atletico = await listCatalogPlayers(t.db, { q: "atletico sierra", limit: 100 });
    assert.equal(atletico.items.length, 10);
    const minors = await listCatalogPlayers(t.db, { maxAge: 17, limit: 100 });
    assert.equal(minors.items.length, 1);
    assert.ok(minors.items[0]!.age! < 18);
  });

  it("returns published reference values only (AT-29)", async () => {
    const noah = w.players.find((p) => p.displayName === "Noah Vermeer")!;
    const p = (await getCatalogPlayer(t.db, noah.id))!;
    assert.equal(p.reference!.amountMinor, "600");
    assert.equal(p.reference!.isDemoModel, true);
    // A newer draft with another value stays invisible.
    const run = (await t.db.execute<{ id: string }>(sql`
      insert into valuation_runs(model_version_id, scope, data_version, information_as_of, status)
      select model_version_id, 'all', 'draft-test', now(), 'DRAFT' from valuation_runs limit 1 returning id`)).rows[0]!.id;
    await t.db.execute(sql`insert into player_reference_values(player_id, run_id, amount_cents, confidence) values (${noah.id}, ${run}, 9999, 'LOW')`);
    assert.equal((await getCatalogPlayer(t.db, noah.id))!.reference!.amountMinor, "600");
  });

  it("exposes no birth dates and no user data (privacy)", async () => {
    const page = await listCatalogPlayers(t.db, { limit: 100 });
    const json = JSON.stringify(page);
    for (const forbidden of ["birth", "auth_subject", "authSubject", "email", "owner", "user"]) {
      assert.equal(json.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
    }
  });

  it("rejects malformed ids and cursors without errors", async () => {
    assert.equal(await getCatalogPlayer(t.db, "not-a-uuid"), null);
    assert.equal(decodeCursor("%%%"), null);
    const page = await listCatalogPlayers(t.db, { cursor: "garbage", limit: 5 });
    assert.equal(page.items.length, 5);
  });
});
