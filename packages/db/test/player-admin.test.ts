import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import { buildDemoWorld, createFixtureProvider } from "@px/demo";
import { loadIdentity } from "../src/identity.ts";
import { queueCatalogImport, runCatalogImport } from "../src/catalog-import.ts";
import { listPlayersForAdmission, resolveImportIssue, setMarketStatus, setPrimaryAdmission } from "../src/player-admin.ts";
import { auditEvents, importIssues } from "../src/schema.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const w = buildDemoWorld();
const uid = (login: string) => w.users.find((u) => u.login === login)!.id;
const isCode = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;
const msg = (e: unknown) => (e instanceof DomainError ? e.userMessage : String(e));

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb({ seeded: true });
});
afterAll(async () => t.drop());
const who = async (login: string) => (await loadIdentity(t.db, uid(login), "demo"))!;

describe("player admission (docs/01, BR-22, O-10)", () => {
  it("an adult, active, fictional player with data can be admitted; the change is audited", async () => {
    const sanne = await who("beheer");
    const p = w.players.find((x) => x.marketStatus === "PROFILE_ONLY" && x.age >= 18 && x.dataQuality !== "MISSING" && x.careerStatus === "ACTIVE")!;
    await setPrimaryAdmission(t.db, sanne, { playerId: p.id, admission: "APPROVED", reason: "Klaar voor eerste uitgifte" });
    const row = (await t.db.execute<{ a: string }>(sql`select primary_admission::text a from players where id = ${p.id}`)).rows[0]!;
    assert.equal(row.a, "APPROVED");
    const audit = await t.db.select().from(auditEvents).where(eq(auditEvents.action, "PLAYER_ADMISSION_CHANGED"));
    assert.equal(audit.length, 1);
  });

  it("minors, retired players and players without data are refused, with the reason", async () => {
    const sanne = await who("beheer");
    const cases: [string, RegExp][] = [
      [w.players.find((x) => x.age < 18)!.id, /minderjarig/],
      [w.players.find((x) => x.careerStatus === "RETIRED")!.id, /niet actief/],
      [w.players.find((x) => x.dataQuality === "MISSING" && x.age >= 18)!.id, /Onvoldoende spelersdata/],
    ];
    for (const [playerId, re] of cases) {
      await assert.rejects(setPrimaryAdmission(t.db, sanne, { playerId, admission: "APPROVED", reason: "Proberen toe te laten" }), (e) => isCode("ACTION_NOT_ALLOWED")(e) && re.test(msg(e)));
    }
  });

  it("a real (non-fictional) identity needs the identity-rights gate (O-10, AT-39)", async () => {
    const sanne = await who("beheer");
    const p = w.players.find((x) => x.marketStatus === "PROFILE_ONLY" && x.age >= 18 && x.dataQuality !== "MISSING" && x.careerStatus === "ACTIVE" && x.id !== w.players[0]!.id)!;
    await t.db.execute(sql`update players set is_fictional = false where id = ${p.id}`);
    await assert.rejects(setPrimaryAdmission(t.db, sanne, { playerId: p.id, admission: "APPROVED", reason: "Echte speler" }), (e) => /O-10/.test(msg(e)));
    await t.db.execute(sql`update players set identity_rights_released = true where id = ${p.id}`);
    await setPrimaryAdmission(t.db, sanne, { playerId: p.id, admission: "APPROVED", reason: "Rechten vrijgegeven" });
  });

  it("a trader or approver cannot change admission", async () => {
    for (const login of ["anna", "approver"]) {
      await assert.rejects(setPrimaryAdmission(t.db, await who(login), { playerId: w.players[0]!.id, admission: "PAUSED", reason: "Even pauzeren" }), isCode("ACTION_NOT_ALLOWED"));
    }
  });
});

describe("market status (BR-06, BR-22)", () => {
  it("a market cannot open without admission or cards in circulation", async () => {
    const sanne = await who("beheer");
    const p = (await t.db.execute<{ id: string }>(sql`
      select p.id from players p join player_markets pm on pm.player_id = p.id
       where pm.status = 'PROFILE_ONLY' and p.primary_admission <> 'APPROVED' limit 1`)).rows[0]!;
    await assert.rejects(setMarketStatus(t.db, sanne, { playerId: p.id, status: "OPEN", reason: "Openen voor handel" }), (e) => /eerst toe/.test(msg(e)));
  });

  it("a retired player's market with cards stays open for collectible trading; it can be paused for a legal block", async () => {
    const sanne = await who("beheer");
    const retired = w.players.find((x) => x.careerStatus === "RETIRED")!;
    await setMarketStatus(t.db, sanne, { playerId: retired.id, status: "OPEN", reason: "Collectible blijft verhandelbaar" });
    await setMarketStatus(t.db, sanne, { playerId: retired.id, status: "PAUSED", reason: "Juridische blokkade in onderzoek" });
    await assert.rejects(setMarketStatus(t.db, sanne, { playerId: retired.id, status: "PROFILE_ONLY", reason: "Terug naar profiel" }), (e) => /kaarten in omloop/.test(msg(e)));
  });
});

describe("quarantine handling (BR-01)", () => {
  it("an identity conflict can be linked to the candidate; the next import updates that player instead of quarantining", async () => {
    const sanne = await who("beheer");
    const { runId } = await queueCatalogImport(t.db, "fixture", null);
    await runCatalogImport(t.db, runId, createFixtureProvider({ conflictingPlayer: true }));
    const issue = (await t.db.select().from(importIssues).where(eq(importIssues.kind, "CONFLICTING_MATCH")))[0]!;
    const candidate = (issue.detail.candidates as string[])[0]!;
    await assert.rejects(resolveImportIssue(t.db, sanne, { issueId: issue.id, resolution: { kind: "LINK", playerId: w.players[50]!.id }, reason: "Verkeerde speler" }), (e) => /kandidaten/.test(msg(e)));
    await resolveImportIssue(t.db, sanne, { issueId: issue.id, resolution: { kind: "LINK", playerId: candidate }, reason: "Zelfde persoon, nieuw bron-ID" });
    const before = Number((await t.db.execute<{ n: string }>(sql`select count(*) n from players`)).rows[0]!.n);
    const { runId: r2 } = await queueCatalogImport(t.db, "fixture", null);
    const stats = await runCatalogImport(t.db, r2, createFixtureProvider({ conflictingPlayer: true }));
    assert.equal(stats.issues, 0);
    assert.equal(Number((await t.db.execute<{ n: string }>(sql`select count(*) n from players`)).rows[0]!.n), before);
    const open = await t.db.execute(sql`select 1 from import_issues where resolution = 'OPEN' and kind = 'CONFLICTING_MATCH'`);
    assert.equal(open.rows.length, 0);
  });

  it("only users with the permission can resolve issues", async () => {
    const anna = await who("anna");
    await assert.rejects(resolveImportIssue(t.db, anna, { issueId: "00000000-0000-0000-0000-000000000000", resolution: { kind: "IGNORE" }, reason: "weg ermee" }), isCode("ACTION_NOT_ALLOWED"));
  });

  it("the admission list shows why a player cannot be admitted", async () => {
    const list = await listPlayersForAdmission(t.db, { limit: 200 });
    const minor = list.find((p) => p.age !== null && p.age < 18)!;
    assert.match(minor.blocker!, /minderjarig/);
  });
});
