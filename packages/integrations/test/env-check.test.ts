import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { ConfigError, isDemoLoginAllowed, loadConfig } from "../src/env-check.ts";
import { blockedFlows, type PaymentCapability } from "../src/contracts.ts";

const demoEnv = {
  APP_MODE: "demo",
  DATABASE_URL: "postgres://px:px@localhost:5432/px_demo",
  AUTH_SECRET: "change-me-in-local-env",
  DEMO_LOGIN_ENABLED: "true",
  PAYMENT_PROVIDER: "demo",
  IDENTITY_PROVIDER: "demo",
  FOOTBALL_DATA_PROVIDER: "fixture",
  NOTIFICATION_PROVIDER: "demo",
  PAYMENT_WEBHOOK_SECRET: "demo-webhook-secret-change-me",
  DROP_SEED_KEY: "d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0",
};

describe("mode guard (AT-35)", () => {
  it("demo mode with demo login is valid", () => {
    const cfg = loadConfig(demoEnv);
    assert.equal(isDemoLoginAllowed(cfg), true);
  });

  it("production configuration that enables demo login fails at startup", () => {
    assert.throws(
      () => loadConfig({ ...demoEnv, APP_MODE: "production", AUTH_SECRET: "x".repeat(40), PAYMENT_PROVIDER: "acme", IDENTITY_PROVIDER: "acme", FOOTBALL_DATA_PROVIDER: "acme", NOTIFICATION_PROVIDER: "acme" }),
      (e: unknown) => e instanceof ConfigError && e.problems.some((p) => p.includes("demo-login")),
    );
  });

  it("production refuses demo adapters", () => {
    assert.throws(
      () => loadConfig({ ...demoEnv, APP_MODE: "production", DEMO_LOGIN_ENABLED: "false", AUTH_SECRET: "x".repeat(40) }),
      (e: unknown) => e instanceof ConfigError && e.problems.filter((p) => p.includes("demo-adapter")).length === 4,
    );
  });

  it("sandbox refuses demo login and the payment simulator", () => {
    assert.throws(() => loadConfig({ ...demoEnv, APP_MODE: "sandbox" }), ConfigError);
  });

  it("demo login stays off when disabled, even in demo", () => {
    assert.equal(isDemoLoginAllowed(loadConfig({ ...demoEnv, DEMO_LOGIN_ENABLED: "false" })), false);
  });

  it("production refuses the demo webhook secret", () => {
    assert.throws(
      () => loadConfig({ ...demoEnv, APP_MODE: "production", DEMO_LOGIN_ENABLED: "false", AUTH_SECRET: "x".repeat(40), PAYMENT_PROVIDER: "acme", IDENTITY_PROVIDER: "acme", FOOTBALL_DATA_PROVIDER: "acme", NOTIFICATION_PROVIDER: "acme" }),
      (e: unknown) => e instanceof ConfigError && e.problems.some((p) => p.includes("PAYMENT_WEBHOOK_SECRET")),
    );
  });

  it("unknown mode is refused", () => {
    assert.throws(() => loadConfig({ ...demoEnv, APP_MODE: "prod" }), ConfigError);
  });
});

describe("capability report", () => {
  it("flows with missing capabilities are reported as blocked", () => {
    const supported = new Set<PaymentCapability>(["DEPOSIT", "QUERY_STATUS", "HOLD_FUNDS", "RELEASE_HOLD"]);
    const blocked = blockedFlows({ adapter: "acme", environment: "sandbox", supported });
    assert.deepEqual(blocked.map((b) => b.flow).sort(), ["reconciliation", "secondarySettlement", "withdrawal"]);
  });
});
