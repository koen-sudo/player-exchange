import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { JOBS, startWorker } from "../src/main.ts";

describe("worker skeleton", () => {
  it("refuses to start with a production config that enables demo login (AT-35)", () => {
    assert.throws(() =>
      startWorker({ APP_MODE: "production", DEMO_LOGIN_ENABLED: "true", DATABASE_URL: "x", AUTH_SECRET: "y".repeat(40), PAYMENT_PROVIDER: "a", IDENTITY_PROVIDER: "a", FOOTBALL_DATA_PROVIDER: "a", NOTIFICATION_PROVIDER: "a", PAYMENT_WEBHOOK_SECRET: "z".repeat(40) }),
    );
  });
  it("starts in demo mode and stops cleanly", () => {
    const w = startWorker({ APP_MODE: "demo", DEMO_LOGIN_ENABLED: "true", DATABASE_URL: "x", AUTH_SECRET: "y", PAYMENT_PROVIDER: "demo", IDENTITY_PROVIDER: "demo", FOOTBALL_DATA_PROVIDER: "fixture", NOTIFICATION_PROVIDER: "demo", PAYMENT_WEBHOOK_SECRET: "demo-secret" }, { pollMs: 0 });
    assert.equal(w.config.mode, "demo");
    w.stop();
  });
  it("registers every planned background job once", () => {
    assert.equal(new Set(JOBS.map((j) => j.name)).size, JOBS.length);
    assert.ok(JOBS.some((j) => j.name === "valuation.weekly-run"));
    assert.ok(JOBS.some((j) => j.name === "reconciliation.daily"));
  });
});

import { afterAll, beforeAll } from "vitest";
import { createFixtureProvider } from "@px/demo";
import { queueCatalogImport } from "@px/db";
import { createTestDb, type TestDb } from "../../../packages/db/test/helpers.ts";
import { catalogSyncOnce } from "../src/main.ts";

describe("worker catalog sync (database as queue)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => t.drop());

  it("picks up a queued import, completes it, then idles", async () => {
    const { runId } = await queueCatalogImport(t.db, "fixture", null);
    assert.equal(await catalogSyncOnce(t.db, createFixtureProvider()), runId);
    const row = await t.pool.query<{ status: string; n: string }>(
      "select (select status from import_runs where id = $1) status, (select count(*) from players) n", [runId],
    );
    assert.equal(row.rows[0]!.status, "COMPLETED");
    assert.equal(Number(row.rows[0]!.n), 240);
    assert.equal(await catalogSyncOnce(t.db, createFixtureProvider()), null);
  });

  it("a provider outage marks the run FAILED without crashing the worker", async () => {
    const { runId } = await queueCatalogImport(t.db, "fixture", null);
    assert.equal(await catalogSyncOnce(t.db, createFixtureProvider({ failAfterCalls: 3 })), runId);
    const row = await t.pool.query<{ status: string }>("select status from import_runs where id = $1", [runId]);
    assert.equal(row.rows[0]!.status, "FAILED");
  });
});
