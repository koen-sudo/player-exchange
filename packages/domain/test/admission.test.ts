import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { decideAction, decideAll, type AdmissionFacts } from "../src/admission.ts";

const ok: AdmissionFacts = {
  accountStatus: "ACTIVE",
  identityVerified: true,
  ageConfirmed: true,
  residenceCountry: "NL",
  admittedCountries: new Set(["NL"]),
  missingTerms: [],
  activeRestrictions: [],
  mode: "demo",
  productionGatesSatisfied: false,
};

const code = (d: ReturnType<typeof decideAction>) => (d.allowed ? "OK" : d.code);

describe("admission (BR-07)", () => {
  it("a verified Dutch adult with accepted terms may do everything", () => {
    assert.ok(Object.values(decideAll(ok)).every((d) => d.allowed));
  });

  it("verification is required for every money action, but cancelling stays possible", () => {
    const f = { ...ok, identityVerified: false };
    for (const a of ["TRADE", "SUBSCRIBE", "DEPOSIT", "WITHDRAW"] as const) assert.equal(code(decideAction(a, f)), "VERIFICATION_REQUIRED", a);
    assert.equal(code(decideAction("CANCEL_ORDER", f)), "OK");
  });

  it("age must be confirmed", () => {
    assert.equal(code(decideAction("TRADE", { ...ok, ageConfirmed: false })), "VERIFICATION_REQUIRED");
  });

  it("a non-admitted country blocks acquiring, not withdrawing", () => {
    const f = { ...ok, residenceCountry: "BE" };
    assert.equal(code(decideAction("TRADE", f)), "COUNTRY_NOT_SUPPORTED");
    assert.equal(code(decideAction("DEPOSIT", f)), "COUNTRY_NOT_SUPPORTED");
    assert.equal(code(decideAction("WITHDRAW", f)), "OK");
  });

  it("a trading stop still allows cancelling and withdrawing (BR-07 example)", () => {
    const f = { ...ok, activeRestrictions: ["TRADING_STOP"] as const };
    assert.equal(code(decideAction("TRADE", f)), "ACTION_NOT_ALLOWED");
    assert.equal(code(decideAction("CANCEL_ORDER", f)), "OK");
    assert.equal(code(decideAction("WITHDRAW", f)), "OK");
    assert.equal(code(decideAction("SUBSCRIBE", f)), "OK");
  });

  it("a full stop blocks all money actions except cancelling", () => {
    const d = decideAll({ ...ok, activeRestrictions: ["FULL_STOP"] });
    assert.deepEqual(Object.entries(d).filter(([, v]) => v.allowed).map(([k]) => k), ["CANCEL_ORDER"]);
  });

  it("missing current terms block acquiring", () => {
    assert.equal(code(decideAction("SUBSCRIBE", { ...ok, missingTerms: ["card_terms"] })), "ACTION_NOT_ALLOWED");
    assert.equal(code(decideAction("WITHDRAW", { ...ok, missingTerms: ["card_terms"] })), "OK");
  });

  it("production blocks money actions while gates are open (PRD-15)", () => {
    const f = { ...ok, mode: "production" as const };
    assert.equal(code(decideAction("TRADE", f)), "ACTION_NOT_ALLOWED");
    assert.equal(code(decideAction("TRADE", { ...f, productionGatesSatisfied: true })), "OK");
  });

  it("suspended accounts may only withdraw and cancel; closed accounts nothing", () => {
    const s = decideAll({ ...ok, accountStatus: "SUSPENDED" });
    assert.deepEqual(Object.entries(s).filter(([, v]) => v.allowed).map(([k]) => k).sort(), ["CANCEL_ORDER", "WITHDRAW"]);
    assert.ok(Object.values(decideAll({ ...ok, accountStatus: "CLOSED" })).every((v) => !v.allowed));
  });
});
