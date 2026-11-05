/**
 * Seller commission (BR-20).
 *
 * - Nominal rate 500 basis points (5%), configurable.
 * - Calculated cumulatively per sell order on finally settled gross volume.
 * - Each execution books: newCumulativeRounded - previouslyBooked.
 * - Rounding: half up to whole euro cents.
 *
 * Splitting a sell order into several fills therefore never changes the total
 * commission of that order. A new, separate order starts its own accumulation.
 */
import { cents, sub, type Cents } from "./money.ts";
import { invariant } from "./errors.ts";

export const DEFAULT_SELLER_COMMISSION_BPS = 500;

/** Rounded commission on a cumulative gross amount, half up on cents. */
export function commissionOnGross(grossCents: Cents, bps: number = DEFAULT_SELLER_COMMISSION_BPS): Cents {
  invariant(grossCents >= 0, "gross must be non-negative");
  invariant(Number.isInteger(bps) && bps >= 0 && bps <= 10_000, "bps out of range");
  // gross * bps / 10_000, half up. All integers, so no float rounding involved.
  const numerator = grossCents * bps;
  invariant(Number.isSafeInteger(numerator), "commission numerator overflow");
  return cents(Math.floor((numerator + 5_000) / 10_000));
}

export type CommissionAccumulator = {
  readonly settledGross: Cents;
  readonly bookedCommission: Cents;
};

export const EMPTY_ACCUMULATOR: CommissionAccumulator = {
  settledGross: cents(0),
  bookedCommission: cents(0),
};

export type FillCommission = {
  readonly gross: Cents;
  readonly commission: Cents;
  readonly net: Cents;
  readonly next: CommissionAccumulator;
};

/** Apply one finally settled fill of a sell order. */
export function applySettledFill(
  acc: CommissionAccumulator,
  fillGross: Cents,
  bps: number = DEFAULT_SELLER_COMMISSION_BPS,
): FillCommission {
  invariant(fillGross > 0, "fill gross must be positive");
  const settledGross = cents(acc.settledGross + fillGross);
  const cumulative = commissionOnGross(settledGross, bps);
  const commission = sub(cumulative, acc.bookedCommission);
  invariant(commission >= 0, "incremental commission cannot be negative");
  return {
    gross: fillGross,
    commission,
    net: sub(fillGross, commission),
    next: { settledGross, bookedCommission: cumulative },
  };
}

/**
 * Preview for the sell-order check window (UX-07): gross, commission and net
 * at full execution against the limit. Partial execution may differ by a
 * cent because of rounding; the UI must say so.
 */
export function sellPreview(quantity: number, limitPriceCents: Cents, bps: number = DEFAULT_SELLER_COMMISSION_BPS) {
  const gross = cents(quantity * limitPriceCents);
  const commission = commissionOnGross(gross, bps);
  return { gross, commission, net: sub(gross, commission) };
}
