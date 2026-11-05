/**
 * User admission for money actions (BR-07, PRD-15).
 *
 * The server re-checks this on every order, subscription and withdrawal.
 * Restrictions apply per capability: a trading stop still allows cancelling
 * orders and withdrawing money (BR-07 example).
 */
import type { ErrorCode } from "./errors.ts";

export const USER_ACTIONS = ["TRADE", "SUBSCRIBE", "DEPOSIT", "WITHDRAW", "CANCEL_ORDER"] as const;
export type UserAction = (typeof USER_ACTIONS)[number];

export type RestrictionKind = "TRADING_STOP" | "DEPOSIT_STOP" | "WITHDRAWAL_STOP" | "SUBSCRIPTION_STOP" | "FULL_STOP";

export type AdmissionFacts = {
  accountStatus: "ACTIVE" | "SUSPENDED" | "CLOSED";
  identityVerified: boolean;
  ageConfirmed: boolean;
  residenceCountry: string | null;
  admittedCountries: ReadonlySet<string>;
  missingTerms: readonly string[]; // current documents not yet accepted
  activeRestrictions: readonly RestrictionKind[];
  mode: "demo" | "sandbox" | "production";
  productionGatesSatisfied: boolean;
};

export type ActionDecision = { allowed: true } | { allowed: false; code: ErrorCode; reason: string };

const deny = (code: ErrorCode, reason: string): ActionDecision => ({ allowed: false, code, reason });

const BLOCKED_BY: Record<RestrictionKind, readonly UserAction[]> = {
  TRADING_STOP: ["TRADE"],
  SUBSCRIPTION_STOP: ["SUBSCRIBE"],
  DEPOSIT_STOP: ["DEPOSIT"],
  WITHDRAWAL_STOP: ["WITHDRAW"],
  FULL_STOP: ["TRADE", "SUBSCRIBE", "DEPOSIT", "WITHDRAW"],
};

/** Actions that move money into the platform or create new exposure. */
const ACQUIRING: ReadonlySet<UserAction> = new Set(["TRADE", "SUBSCRIBE", "DEPOSIT"]);

export function decideAction(action: UserAction, f: AdmissionFacts): ActionDecision {
  // Cancelling the free remainder of an own order only ever reduces exposure.
  if (action === "CANCEL_ORDER") {
    return f.accountStatus === "CLOSED" ? deny("ACTION_NOT_ALLOWED", "Account gesloten.") : { allowed: true };
  }
  if (f.accountStatus === "CLOSED") return deny("ACTION_NOT_ALLOWED", "Account gesloten.");
  if (f.accountStatus === "SUSPENDED" && action !== "WITHDRAW") return deny("ACTION_NOT_ALLOWED", "Account tijdelijk opgeschort.");

  if (f.mode === "production" && !f.productionGatesSatisfied) {
    return deny("ACTION_NOT_ALLOWED", "Geldhandelingen zijn nog niet vrijgegeven.");
  }
  if (!f.identityVerified || !f.ageConfirmed) return deny("VERIFICATION_REQUIRED", "Rond eerst je verificatie af.");

  for (const r of f.activeRestrictions) {
    if (BLOCKED_BY[r].includes(action)) return deny("ACTION_NOT_ALLOWED", "Deze handeling is voor je account tijdelijk beperkt.");
  }

  if (ACQUIRING.has(action)) {
    if (!f.residenceCountry || !f.admittedCountries.has(f.residenceCountry)) {
      return deny("COUNTRY_NOT_SUPPORTED", "Handelen is in je woonland nog niet beschikbaar.");
    }
    if (f.missingTerms.length > 0) return deny("ACTION_NOT_ALLOWED", "Accepteer eerst de actuele voorwaarden.");
  }
  return { allowed: true };
}

export function decideAll(f: AdmissionFacts): Record<UserAction, ActionDecision> {
  return Object.fromEntries(USER_ACTIONS.map((a) => [a, decideAction(a, f)])) as Record<UserAction, ActionDecision>;
}
