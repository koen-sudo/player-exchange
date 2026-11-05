import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { computeDemoReference, validateRunOutputs, type MatchInput, type ValuationInput } from "../src/index.ts";

const asOf = new Date("2026-11-09T06:00:00Z");
const day = (d: number) => new Date(asOf.getTime() - d * 86_400_000);
const match = (daysAgo: number, minutes: number | null, goals: number | null = 0, assists: number | null = 0): MatchInput =>
  ({ kickoffAt: day(daysAgo), knownAt: day(daysAgo - 0.1), minutes, goals, assists });
const base = (over: Partial<ValuationInput> = {}): ValuationInput => ({
  playerId: "p", role: "STRIKER", careerStatus: "ACTIVE",
  externalValues: [{ amountCents: 1_440_000_000, asOf: day(30), knownAt: day(30) }],
  matches: [match(3, 90, 1, 0), match(10, 90, 0, 1), match(17, 90), match(24, 90), match(31, 90)],
  previousCents: 600, ...over,
});

describe("demo valuation model (docs/08)", () => {
  it("is reproducible: same input, same output", () => {
    assert.deepEqual(computeDemoReference(base(), asOf), computeDemoReference(base(), asOf));
  });

  it("€14,4M external value → structural €6,00; full minutes and 2 goal involvements raise it", () => {
    const r = computeDemoReference(base(), asOf);
    assert.equal(r.kind, "VALUE");
    if (r.kind !== "VALUE") return;
    assert.equal(r.components.structuralCents, 600);
    // minutes term 0.1 × (1 − 0.7) = 0.03; involvement 0.07 × 0.4 = 0.028 → ×1.058
    assert.equal(r.amount, 635);
    assert.equal(r.confidence, "MEDIUM", "the demo model never claims HIGH confidence");
  });

  it("uses no future information: later matches and values known later are ignored", () => {
    const future = base({
      externalValues: [...base().externalValues, { amountCents: 9_000_000_000, asOf: day(1), knownAt: new Date(asOf.getTime() + 3_600_000) }],
      matches: [...base().matches, { kickoffAt: new Date(asOf.getTime() + 86_400_000), knownAt: new Date(asOf.getTime() + 90_000_000), minutes: 0, goals: 0, assists: 0 }],
    });
    assert.deepEqual(computeDemoReference(future, asOf), computeDemoReference(base(), asOf));
  });

  it("a missing statistic is unknown, not zero", () => {
    const missing = computeDemoReference(base({ matches: base().matches.map((m) => ({ ...m, goals: null, assists: null })) }), asOf);
    const zero = computeDemoReference(base({ matches: base().matches.map((m) => ({ ...m, goals: 0, assists: 0 })) }), asOf);
    assert.ok(missing.kind === "VALUE" && zero.kind === "VALUE");
    if (missing.kind !== "VALUE" || zero.kind !== "VALUE") return;
    assert.ok(missing.warnings.some((w) => w.includes("ontbrekend telt niet als nul")));
    assert.equal(missing.confidence, "LOW");
    assert.equal(missing.amount, zero.amount, "no involvement term either way, but the unknown case is flagged and less certain");
  });

  it("role profiles: a keeper's goals do not count", () => {
    const k = computeDemoReference(base({ role: "GOALKEEPER" }), asOf);
    assert.ok(k.kind === "VALUE" && k.amount === 618, "only the minutes term");
  });

  it("no external value → no new reference; retired → last value stays as historical (BR-22)", () => {
    assert.equal(computeDemoReference(base({ externalValues: [] }), asOf).kind, "NO_VALUE");
    const retired = computeDemoReference(base({ careerStatus: "RETIRED" }), asOf);
    assert.deepEqual([retired.kind, retired.kind === "HISTORICAL" ? retired.amount : null], ["HISTORICAL", 600]);
  });

  it("form is capped and large changes are flagged for review", () => {
    const hot = computeDemoReference(base({ matches: Array.from({ length: 5 }, (_, i) => match(3 + 7 * i, 90, 3, 2)), previousCents: 400 }), asOf);
    assert.ok(hot.kind === "VALUE" && hot.components.form === 0.15 && hot.amount === 690);
    assert.ok(hot.kind === "VALUE" && hot.warnings.some((w) => w.startsWith("Grote wijziging")));
    assert.deepEqual(validateRunOutputs([{ amountCents: 690, warnings: hot.kind === "VALUE" ? hot.warnings : [] }]), { ok: true, errors: [], flaggedLargeChanges: 1 });
    assert.equal(validateRunOutputs([]).ok, false);
    assert.equal(validateRunOutputs([{ amountCents: 5, warnings: [] }]).ok, false);
  });
});
