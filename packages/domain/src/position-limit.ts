/**
 * Position limit per player (BR-18). Configurable policy.
 *
 * limit = min(cap, max(floor, floor(percent × cumulativeIssued)))
 * V1 defaults: cap 50, floor 3, 10%.
 *
 * `cumulativeIssued` = cards of this player definitively delivered over all
 * seasons ("In omloop", UX-02). Interpretation R-03 in docs/12-decisions.md.
 *
 * Exposure counts current holdings plus everything that could still be
 * acquired: open buy orders, executions in settlement, and reserved drop
 * subscriptions. Sell orders do not reduce exposure until finally settled.
 */
import { DomainError, invariant } from "./errors.ts";

export type PositionLimitPolicy = {
  readonly cap: number;
  readonly floor: number;
  readonly percentBps: number; // 1000 = 10%
};

export const DEFAULT_POSITION_LIMIT_POLICY: PositionLimitPolicy = {
  cap: 50,
  floor: 3,
  percentBps: 1_000,
};

export function positionLimit(cumulativeIssued: number, policy: PositionLimitPolicy = DEFAULT_POSITION_LIMIT_POLICY): number {
  invariant(Number.isSafeInteger(cumulativeIssued) && cumulativeIssued >= 0, "cumulativeIssued must be >= 0");
  const pct = Math.floor((cumulativeIssued * policy.percentBps) / 10_000);
  return Math.min(policy.cap, Math.max(policy.floor, pct));
}

export type Exposure = {
  readonly held: number;
  readonly openBuyQuantity: number;
  readonly buyPendingSettlement: number;
  readonly reservedSubscriptions: number;
};

export function exposureTotal(e: Exposure): number {
  return e.held + e.openBuyQuantity + e.buyPendingSettlement + e.reservedSubscriptions;
}

/**
 * Throws POSITION_LIMIT_EXCEEDED when an additional potential acquisition of
 * `additional` cards would exceed the limit. Users above a later, lower limit
 * may still sell; only new acquisitions are blocked.
 */
export function assertWithinPositionLimit(
  exposure: Exposure,
  additional: number,
  cumulativeIssued: number,
  policy: PositionLimitPolicy = DEFAULT_POSITION_LIMIT_POLICY,
): void {
  const limit = positionLimit(cumulativeIssued, policy);
  const after = exposureTotal(exposure) + additional;
  if (after > limit) {
    throw new DomainError("POSITION_LIMIT_EXCEEDED", { limit, after });
  }
}
