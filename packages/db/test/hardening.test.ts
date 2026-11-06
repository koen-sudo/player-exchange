import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { DomainError, RATE_LIMITS } from "@px/domain";
import { buildDemoWorld } from "@px/demo";
import { decideApproval } from "../src/approvals.ts";
import { loadIdentity } from "../src/identity.ts";
import { hitRateLimit, pruneRateLimits } from "../src/rate-limit.ts";
import { book, ledgerInvariants, postings } from "../src/ledger.ts";
import { randomUUID } from "node:crypto";
import { assertProductionGates, executeGateFulfilment, requestGateFulfilment, revokeGate, unmetGates } from "../src/operations.ts";
import { exportUserData } from "../src/data-export.ts";
import { applyRetention } from "../src/retention.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const w = buildDemoWorld();
const loginId = (login: string) => w.users.find((u) => u.login === login)!.id;
const isCode = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;

let t: TestDb;
type Id = NonNullable<Awaited<ReturnType<typeof loadIdentity>>>;
let superadmin: Id;
let approver: Id;
beforeAll(async () => {
  t = await createTestDb({ seeded: true });
  await t.db.execute(sql`INSERT INTO user_roles(user_id, role_key) VALUES (${loginId("beheer")}, 'SUPERADMIN')`);
  superadmin = (await loadIdentity(t.db, loginId("beheer"), "sandbox"))!;
  approver = (await loadIdentity(t.db, loginId("approver"), "sandbox"))!;
}, 60_000);
afterAll(async () => t.drop());

describe("rate limiting (docs/10)", () => {
  it("allows exactly the limit per user and window, also under concurrency", async () => {
    const { limit } = RATE_LIMITS["withdrawal.request"];
    const results = await Promise.allSettled(Array.from({ length: limit + 3 }, () => hitRateLimit(t.db, "withdrawal.request", "user-a")));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, limit);
    assert.ok(results.filter((r) => r.status === "rejected").every((r) => isCode("RATE_LIMITED")((r as PromiseRejectedResult).reason)));
    // Another user and another action have their own buckets.
    await hitRateLimit(t.db, "withdrawal.request", "user-b");
    await hitRateLimit(t.db, "deposit.start", "user-a");
  });

  it("old windows are pruned", async () => {
    await t.db.execute(sql`UPDATE rate_limit_hits SET window_start = window_start - interval '2 days' WHERE bucket LIKE '%user-b'`);
    assert.equal(await pruneRateLimits(t.db), 1);
  });
});

describe("production gates (docs/10)", () => {
  it("cannot be set directly in the database, not even with a made-up approval", async () => {
    await assert.rejects(t.db.execute(sql`UPDATE feature_gates SET satisfied = true, evidence_ref = 'x', approval_id = NULL WHERE key = 'SECURITY'`));
    await assert.rejects(t.db.execute(sql`DELETE FROM feature_gates WHERE key = 'SECURITY'`));
  });

  it("production refuses to start while any gate is open", async () => {
    await assert.rejects(assertProductionGates(t.db, "production"), /SECURITY/);
    await assertProductionGates(t.db, "sandbox");
  });

  it("a gate is fulfilled only with a second person's approval for exactly that evidence, and can be revoked", async () => {
    await assert.rejects(requestGateFulfilment(t.db, superadmin, "demo", { gate: "SECURITY", evidenceRef: "Pentestrapport v1", reason: "Rapport ontvangen" }), isCode("ACTION_NOT_ALLOWED"));
    await assert.rejects(requestGateFulfilment(t.db, approver, "sandbox", { gate: "SECURITY", evidenceRef: "Pentestrapport v1", reason: "Rapport ontvangen" }), isCode("ACTION_NOT_ALLOWED"));
    const id = await requestGateFulfilment(t.db, superadmin, "sandbox", { gate: "SECURITY", evidenceRef: "Pentestrapport v1, 6-11-2026", reason: "Alle hoge bevindingen opgelost" });
    const payload = { gate: "SECURITY", evidenceRef: "Pentestrapport v1, 6-11-2026" };
    await assert.rejects(executeGateFulfilment(t.db, superadmin, "sandbox", { approvalId: id, payload }), isCode("ACTION_NOT_ALLOWED"));
    await assert.rejects(decideApproval(t.db, superadmin, { approvalId: id, decision: "APPROVE", reason: "zelf goedkeuren" }), isCode("ACTION_NOT_ALLOWED"));
    await decideApproval(t.db, approver, { approvalId: id, decision: "APPROVE", reason: "Rapport gelezen" });
    await executeGateFulfilment(t.db, superadmin, "sandbox", { approvalId: id, payload });
    assert.ok(!(await unmetGates(t.db)).includes("SECURITY"));
    await assert.rejects(executeGateFulfilment(t.db, superadmin, "sandbox", { approvalId: id, payload }), isCode("ACTION_NOT_ALLOWED"));

    await revokeGate(t.db, superadmin, { gate: "SECURITY", reason: "Nieuwe kritieke bevinding" });
    assert.ok((await unmetGates(t.db)).includes("SECURITY"));
    const audit = await t.db.execute<{ action: string }>(sql`SELECT action FROM audit_events WHERE entity_type = 'feature_gate' ORDER BY occurred_at`);
    assert.deepEqual(audit.rows.map((r) => r.action), ["GATE_FULFILLED", "GATE_REVOKED"]);
  });
});

describe("ledger under concurrency (fase 9 load test finding)", () => {
  it("many postings on the same platform account at once do not deadlock", async () => {
    const users = Array.from({ length: 40 }, () => randomUUID());
    for (const id of users) await t.db.execute(sql`INSERT INTO users(id, auth_subject, is_test_account) VALUES (${id}, ${`test:conc:${id}`}, true)`);
    const results = await Promise.allSettled(users.map((id) => t.db.transaction((tx) => book(tx, "demo", "test", postings.openingBalance(id, 1000, "conc")))));
    assert.deepEqual(results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.cause?.message ?? (r as PromiseRejectedResult).reason)), []);
    assert.deepEqual(await ledgerInvariants(t.db), { unbalancedEntries: 0, projectionMismatches: 0, negativeCustomerBalances: 0, reservedNotMatchingHolds: 0 });
  });
});

describe("own data export (privacy)", () => {
  it("contains the person's data and never another person's id", async () => {
    const anna = loginId("anna");
    const data = await exportUserData(t.db, anna);
    assert.equal(data.profile?.display_name, "Anna de Vries");
    assert.ok(data.cards.length > 0 && data.orders.length > 0 && data.balances.length > 0 && data.deposits.length > 0);
    const json = JSON.stringify(data);
    const others = (await t.db.execute<{ id: string }>(sql`SELECT id FROM users WHERE id <> ${anna}`)).rows.map((r) => r.id);
    assert.deepEqual(others.filter((id) => json.includes(id)), []);
  });
});

describe("retention (R-24)", () => {
  it("removes raw import pages after their term, never those of a run that can still resume", async () => {
    const done = (await t.db.execute<{ id: string }>(sql`INSERT INTO import_runs(provider, scope, status) VALUES ('fixture', 'retentie-a', 'COMPLETED') RETURNING id`)).rows[0]!.id;
    const paused = (await t.db.execute<{ id: string }>(sql`INSERT INTO import_runs(provider, scope, status) VALUES ('fixture', 'retentie-b', 'PAUSED') RETURNING id`)).rows[0]!.id;
    for (const [run, days] of [[done, -1], [done, 30], [paused, -1]] as const) {
      await t.db.execute(sql`INSERT INTO import_snapshots(run_id, step_key, page_no, source_version, payload, retain_until)
        VALUES (${run}, ${`stap-${days}`}, 1, 'v1', '{}', now() + make_interval(days => ${days}))`);
    }
    const r = await applyRetention(t.db);
    assert.equal(r.importSnapshots, 1);
    const left = (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM import_snapshots WHERE run_id IN (${done}, ${paused})`)).rows[0]!.n;
    assert.equal(left, 2);
  });
});
