/**
 * Valuation (docs/08). The production formula is not validated yet; this is
 * an explicitly marked DEMO model ("demo-v1") so the pipeline, review and
 * publication can be built and tested. It is not the research candidate
 * R = c × [...] and must never be presented as a validated price.
 *
 * demo-v1, per player, using only information known at the information date:
 *   structural S = c × sqrt(M / M0)          (M = latest external transfer value)
 *   form       u = clamp(minutesTerm + involvementTerm, −cap, +cap)
 *   reference    = round(S × (1 + u)) in whole cents, at least the minimum price
 * - Matches after the information date and values that became known later are ignored.
 * - A missing statistic is unknown, never zero (no involvement term then).
 * - Role profiles decide which features count (a keeper's goals do not).
 */
import type { Cents } from "./money.ts";
import { cents } from "./money.ts";

export const DEMO_MODEL_KEY = "demo-v1";

export type ValuationRole = "GOALKEEPER" | "CENTRE_BACK" | "FULL_BACK" | "DEFENSIVE_MIDFIELDER" | "CENTRAL_MIDFIELDER" | "WINGER" | "STRIKER";

export type DemoModelParams = {
  readonly cCents: number; // euro mapping of the structural part
  readonly m0Cents: number; // reference transfer value
  readonly formCap: number; // max |u|
  readonly minutesWeight: number; // per unit of minutes share above/below the target
  readonly minutesTarget: number; // expected share of minutes
  readonly involvementWeight: Record<ValuationRole, number>; // per goal or assist per match
  readonly matchesWindow: number;
  readonly minPriceCents: number;
  readonly maxExternalAgeDays: number;
};

export const DEMO_MODEL_PARAMS: DemoModelParams = {
  cCents: 500,
  m0Cents: 1_000_000_000,
  formCap: 0.15,
  minutesWeight: 0.1,
  minutesTarget: 0.7,
  involvementWeight: { GOALKEEPER: 0, CENTRE_BACK: 0.02, FULL_BACK: 0.03, DEFENSIVE_MIDFIELDER: 0.03, CENTRAL_MIDFIELDER: 0.05, WINGER: 0.06, STRIKER: 0.07 },
  matchesWindow: 5,
  minPriceCents: 20,
  maxExternalAgeDays: 365,
};

export type MatchInput = { kickoffAt: Date; minutes: number | null; goals: number | null; assists: number | null; knownAt: Date };
export type ExternalValueInput = { amountCents: number; asOf: Date; knownAt: Date };

export type ValuationInput = {
  playerId: string;
  role: ValuationRole | null;
  careerStatus: "ACTIVE" | "RETIRED" | "DECEASED" | "UNKNOWN";
  externalValues: readonly ExternalValueInput[];
  matches: readonly MatchInput[];
  previousCents: number | null;
};

export type Explanation = { title: string; detail: string };

export type ValuationOutput =
  | {
      readonly kind: "VALUE";
      readonly amount: Cents;
      readonly confidence: "HIGH" | "MEDIUM" | "LOW";
      readonly explanations: Explanation[];
      readonly warnings: string[];
      readonly components: { structuralCents: number; form: number; externalAsOf: string; matchesUsed: number; minutesShare: number | null };
    }
  /** Retired: the last value stays, marked historical (BR-22). */
  | { readonly kind: "HISTORICAL"; readonly amount: Cents; readonly warnings: string[] }
  /** Not enough input: nothing is published; the previous value stays visible with its own date. */
  | { readonly kind: "NO_VALUE"; readonly warnings: string[] };

const euro = (c: number) => `€${(c / 100).toFixed(2).replace(".", ",")}`;
const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 1000) / 10).toString().replace(".", ",")}%`;

export function computeDemoReference(input: ValuationInput, asOf: Date, p: DemoModelParams = DEMO_MODEL_PARAMS): ValuationOutput {
  if (input.careerStatus === "RETIRED" || input.careerStatus === "DECEASED") {
    return input.previousCents === null
      ? { kind: "NO_VALUE", warnings: ["Gestopte speler zonder eerdere referentie"] }
      : { kind: "HISTORICAL", amount: cents(input.previousCents), warnings: ["Gestopte speler: laatste referentie blijft als historisch zichtbaar"] };
  }
  // No future information: only what was known at the information date.
  const ext = input.externalValues
    .filter((e) => e.knownAt <= asOf && e.asOf <= asOf)
    .sort((a, b) => b.asOf.getTime() - a.asOf.getTime())[0];
  if (!ext) return { kind: "NO_VALUE", warnings: ["Geen externe transferwaarde bekend op de peildatum"] };
  const warnings: string[] = [];
  const ageDays = (asOf.getTime() - ext.asOf.getTime()) / 86_400_000;
  if (ageDays > p.maxExternalAgeDays) warnings.push(`Externe transferwaarde is ${Math.floor(ageDays)} dagen oud`);

  const structural = p.cCents * Math.sqrt(ext.amountCents / p.m0Cents);
  const matches = input.matches
    .filter((m) => m.kickoffAt <= asOf && m.knownAt <= asOf)
    .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime())
    .slice(0, p.matchesWindow);
  const withMinutes = matches.filter((m) => m.minutes !== null);
  const minutesShare = withMinutes.length ? withMinutes.reduce((n, m) => n + m.minutes!, 0) / (90 * withMinutes.length) : null;
  const withInvolvement = matches.filter((m) => m.goals !== null && m.assists !== null);
  const involvementPerMatch = withInvolvement.length ? withInvolvement.reduce((n, m) => n + m.goals! + m.assists!, 0) / withInvolvement.length : null;
  const roleWeight = input.role ? p.involvementWeight[input.role] : 0;
  if (!input.role) warnings.push("Rol onbekend: geen rolgebonden prestaties meegenomen");
  if (matches.length === 0) warnings.push("Geen recente wedstrijden bekend: alleen het structurele deel");
  if (withInvolvement.length < withMinutes.length) warnings.push("Niet alle wedstrijden hebben doelpunt- en assistgegevens; ontbrekend telt niet als nul");

  const minutesTerm = minutesShare === null ? 0 : p.minutesWeight * (minutesShare - p.minutesTarget);
  const involvementTerm = involvementPerMatch === null ? 0 : roleWeight * involvementPerMatch;
  const form = Math.max(-p.formCap, Math.min(p.formCap, minutesTerm + involvementTerm));
  const amount = Math.max(p.minPriceCents, Math.round(structural * (1 + form)));

  const explanations: Explanation[] = [];
  explanations.push({ title: "Externe transferwaarde", detail: `Structureel deel op basis van een externe transferwaarde (peildatum ${ext.asOf.toISOString().slice(0, 10)}).` });
  if (minutesShare !== null) {
    explanations.push(minutesShare >= p.minutesTarget
      ? { title: "Veel speelminuten", detail: `Gemiddeld ${Math.round(minutesShare * 90)} minuten in de laatste ${withMinutes.length} wedstrijden.` }
      : { title: "Minder speeltijd", detail: `Gemiddeld ${Math.round(minutesShare * 90)} minuten in de laatste ${withMinutes.length} wedstrijden.` });
  }
  if (involvementPerMatch !== null && roleWeight > 0 && involvementPerMatch > 0) {
    explanations.push({ title: "Betrokken bij doelpunten", detail: `${withInvolvement.reduce((n, m) => n + m.goals!, 0)} doelpunten en ${withInvolvement.reduce((n, m) => n + m.assists!, 0)} assists in ${withInvolvement.length} wedstrijden.` });
  }
  if (input.previousCents !== null && input.previousCents > 0) {
    const change = (amount - input.previousCents) / input.previousCents;
    if (Math.abs(change) >= 0.25) warnings.push(`Grote wijziging ten opzichte van de vorige referentie: ${euro(input.previousCents)} → ${euro(amount)} (${pct(change)})`);
  }
  const confidence: "HIGH" | "MEDIUM" | "LOW" =
    matches.length >= 3 && withInvolvement.length === matches.length && ageDays <= 180 ? "MEDIUM" // demo model: never HIGH
      : matches.length >= 1 ? "LOW" : "LOW";
  return {
    kind: "VALUE",
    amount: cents(amount),
    confidence,
    explanations,
    warnings,
    components: { structuralCents: Math.round(structural), form: Math.round(form * 10_000) / 10_000, externalAsOf: ext.asOf.toISOString().slice(0, 10), matchesUsed: matches.length, minutesShare: minutesShare === null ? null : Math.round(minutesShare * 1000) / 1000 },
  };
}

/** Automatic run checks before review (VALIDATED or FAILED). */
export function validateRunOutputs(rows: readonly { amountCents: number; warnings: readonly string[] }[], opts: { maxPriceCents?: number } = {}) {
  const max = opts.maxPriceCents ?? 1_000_000;
  const errors: string[] = [];
  if (rows.length === 0) errors.push("De run bevat geen enkele waarde");
  const outOfRange = rows.filter((r) => !Number.isSafeInteger(r.amountCents) || r.amountCents < 20 || r.amountCents > max).length;
  if (outOfRange) errors.push(`${outOfRange} waardes buiten de prijsgrenzen`);
  const flagged = rows.filter((r) => r.warnings.some((w) => w.startsWith("Grote wijziging"))).length;
  return { ok: errors.length === 0, errors, flaggedLargeChanges: flagged };
}
