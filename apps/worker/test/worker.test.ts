import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { JOBS, startWorker } from "../src/main.ts";

describe("worker skeleton", () => {
  it("refuses to start with a production config that enables demo login (AT-35)", () => {
    assert.throws(() =>
      startWorker({ APP_MODE: "production", DEMO_LOGIN_ENABLED: "true", DATABASE_URL: "x", AUTH_SECRET: "y".repeat(40), PAYMENT_PROVIDER: "a", IDENTITY_PROVIDER: "a", FOOTBALL_DATA_PROVIDER: "a", NOTIFICATION_PROVIDER: "a" }),
    );
  });
  it("starts in demo mode and stops cleanly", () => {
    const w = startWorker({ APP_MODE: "demo", DEMO_LOGIN_ENABLED: "true", DATABASE_URL: "x", AUTH_SECRET: "y", PAYMENT_PROVIDER: "demo", IDENTITY_PROVIDER: "demo", FOOTBALL_DATA_PROVIDER: "fixture", NOTIFICATION_PROVIDER: "demo" });
    assert.equal(w.config.mode, "demo");
    w.stop();
  });
  it("registers every planned background job once", () => {
    assert.equal(new Set(JOBS.map((j) => j.name)).size, JOBS.length);
    assert.ok(JOBS.some((j) => j.name === "valuation.weekly-run"));
    assert.ok(JOBS.some((j) => j.name === "reconciliation.daily"));
  });
});
