import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { effectivePermissions, RATE_LIMITS, usedSecondFactor } from "../src/index.ts";

describe("MFA for administrators (docs/10)", () => {
  it("reads the provider's amr statement and nothing else", () => {
    assert.equal(usedSecondFactor(["pwd", "otp"]), true);
    assert.equal(usedSecondFactor(["mfa"]), true);
    assert.equal(usedSecondFactor(["pwd"]), false);
    assert.equal(usedSecondFactor("mfa"), false, "a string is not an amr list");
    assert.equal(usedSecondFactor(undefined), false);
  });

  it("admin permissions are off without MFA outside the demo", () => {
    const admin = new Set(["admin.access", "finance.correct"]);
    assert.deepEqual(effectivePermissions("production", admin, false), { permissions: new Set(), mfaRequired: true });
    assert.deepEqual(effectivePermissions("sandbox", admin, false).mfaRequired, true);
    assert.deepEqual(effectivePermissions("production", admin, true).permissions, admin);
    assert.deepEqual(effectivePermissions("demo", admin, false).permissions, admin);
    assert.equal(effectivePermissions("production", new Set(), false).mfaRequired, false, "customers need no MFA here");
  });
});

describe("rate limits", () => {
  it("cover every sensitive money and order action with a positive limit", () => {
    for (const k of ["order.preview", "order.place", "order.cancel", "drop.subscribe", "deposit.start", "withdrawal.request"] as const) {
      assert.ok(RATE_LIMITS[k].limit > 0 && RATE_LIMITS[k].windowSeconds > 0, k);
    }
  });
});
