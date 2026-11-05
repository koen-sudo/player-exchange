import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import { buildDemoWorld } from "@px/demo";
import { addRestriction, endRestriction, ensureUserForSubject, findUserIdByAuthSubject, loadIdentity } from "../src/identity.ts";
import { auditEvents } from "../src/schema.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const w = buildDemoWorld();
const id = (login: string) => w.users.find((u) => u.login === login)!.id;

describe("identity on the seeded database", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ seeded: true });
  });
  afterAll(async () => t.drop());

  it("resolves demo accounts by auth subject", async () => {
    assert.equal(await findUserIdByAuthSubject(t.db, "demo:anna"), id("anna"));
    assert.equal(await findUserIdByAuthSubject(t.db, "demo:nobody"), null);
  });

  it("Anna is admitted to every money action; Bram needs verification", async () => {
    const anna = (await loadIdentity(t.db, id("anna"), "demo"))!;
    assert.ok(Object.values(anna.actions).every((a) => a.allowed));
    const bram = (await loadIdentity(t.db, id("bram"), "demo"))!;
    assert.equal(bram.actions.TRADE.allowed ? "OK" : bram.actions.TRADE.code, "VERIFICATION_REQUIRED");
    assert.ok(bram.actions.CANCEL_ORDER.allowed);
  });

  it("in production mode money actions stay blocked while gates are open (PRD-15)", async () => {
    const anna = (await loadIdentity(t.db, id("anna"), "production"))!;
    assert.equal(anna.actions.TRADE.allowed, false);
  });

  it("permissions come from roles; a trader has none, the admin has catalogue rights", async () => {
    const anna = (await loadIdentity(t.db, id("anna"), "demo"))!;
    assert.equal(anna.permissions.size, 0);
    const sanne = (await loadIdentity(t.db, id("beheer"), "demo"))!;
    assert.ok(sanne.permissions.has("admin.access"));
    assert.ok(sanne.permissions.has("catalog.import"));
    assert.ok(sanne.permissions.has("users.restrict"));
    const joris = (await loadIdentity(t.db, id("approver"), "demo"))!;
    assert.ok(joris.permissions.has("approvals.decide"));
    assert.equal(joris.permissions.has("users.restrict"), false);
  });

  it("a trading stop blocks trading but not cancelling or withdrawing, and is audited (BR-07, AT-33)", async () => {
    const sanne = (await loadIdentity(t.db, id("beheer"), "demo"))!;
    const rid = await addRestriction(t.db, sanne, { userId: id("anna"), type: "TRADING_STOP", reason: "Onderzoek naar ongebruikelijk handelspatroon" });
    const anna = (await loadIdentity(t.db, id("anna"), "demo"))!;
    assert.equal(anna.actions.TRADE.allowed, false);
    assert.ok(anna.actions.CANCEL_ORDER.allowed);
    assert.ok(anna.actions.WITHDRAW.allowed);
    const audit = await t.db.select().from(auditEvents).where(eq(auditEvents.action, "USER_RESTRICTION_ADDED"));
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.actorId, sanne.id);
    assert.equal(audit[0]!.entityId, id("anna"));
    assert.ok(audit[0]!.reason);

    await endRestriction(t.db, sanne, { restrictionId: rid, reason: "Onderzoek afgerond, geen bevindingen" });
    await new Promise((r) => setTimeout(r, 1100));
    const after = (await loadIdentity(t.db, id("anna"), "demo"))!;
    assert.ok(after.actions.TRADE.allowed);
  });

  it("only users with the permission can restrict, and nobody can restrict themselves", async () => {
    const anna = (await loadIdentity(t.db, id("anna"), "demo"))!;
    await assert.rejects(addRestriction(t.db, anna, { userId: id("bram"), type: "FULL_STOP", reason: "zomaar iets" }), (e: unknown) => e instanceof DomainError && e.code === "ACTION_NOT_ALLOWED");
    const sanne = (await loadIdentity(t.db, id("beheer"), "demo"))!;
    await assert.rejects(addRestriction(t.db, sanne, { userId: sanne.id, type: "FULL_STOP", reason: "eigen account" }), DomainError);
    await assert.rejects(addRestriction(t.db, sanne, { userId: id("bram"), type: "FULL_STOP", reason: "" }), DomainError);
  });

  it("first OIDC login creates exactly one user and profile; a second login reuses it", async () => {
    const a = await ensureUserForSubject(t.db, "https://idp.example|abc", "Nieuwe Gebruiker");
    const b = await ensureUserForSubject(t.db, "https://idp.example|abc", "Nieuwe Gebruiker");
    assert.equal(a, b);
    const n = await t.db.execute<{ n: string }>(sql`select count(*) n from users where auth_subject = 'https://idp.example|abc'`);
    assert.equal(Number(n.rows[0]!.n), 1);
    const fresh = (await loadIdentity(t.db, a, "demo"))!;
    assert.equal(fresh.actions.TRADE.allowed, false, "new users start unverified");
  });
});

import { requestCatalogImport } from "../src/admin-actions.ts";

describe("admin catalogue actions", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb({ seeded: true });
  });
  afterAll(async () => t.drop());

  it("a catalogue manager can queue an import, which is audited once", async () => {
    const sanne = (await loadIdentity(t.db, id("beheer"), "demo"))!;
    const a = await requestCatalogImport(t.db, sanne, "fixture", "Nieuwe selecties na transferperiode");
    const b = await requestCatalogImport(t.db, sanne, "fixture", "Nog een keer");
    assert.equal(b.runId, a.runId);
    const audit = await t.db.select().from(auditEvents).where(eq(auditEvents.action, "CATALOG_IMPORT_QUEUED"));
    assert.equal(audit.length, 1);
  });

  it("a trader or approver cannot start an import", async () => {
    const anna = (await loadIdentity(t.db, id("anna"), "demo"))!;
    const joris = (await loadIdentity(t.db, id("approver"), "demo"))!;
    await assert.rejects(requestCatalogImport(t.db, anna, "fixture", "x"), DomainError);
    await assert.rejects(requestCatalogImport(t.db, joris, "fixture", "x"), DomainError);
  });
});
