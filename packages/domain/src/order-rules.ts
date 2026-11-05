/**
 * Limit price, quantity and time-in-force rules (BR-14, BR-19, addendum V1.1).
 * All limits are configurable policy; defaults are the V1 proposals.
 */
import { DomainError } from "./errors.ts";
import type { Cents } from "./money.ts";

export type PriceRules = {
  readonly minLimitCents: number;
  readonly maxLimitCents: number;
  readonly tickCents: number;
};

export const DEFAULT_PRICE_RULES: PriceRules = {
  minLimitCents: 20, // €0,20
  maxLimitCents: 1_000_000, // €10.000
  tickCents: 1, // €0,01
};

export function assertValidLimitPrice(price: Cents, rules: PriceRules = DEFAULT_PRICE_RULES): void {
  if (
    !Number.isSafeInteger(price) ||
    price < rules.minLimitCents ||
    price > rules.maxLimitCents ||
    price % rules.tickCents !== 0
  ) {
    throw new DomainError("PRICE_INVALID", { price, ...rules });
  }
}

export function assertValidQuantity(quantity: number, max = 500): void {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > max) {
    throw new DomainError("QUANTITY_INVALID", { quantity });
  }
}

/** Exactly three fixed choices (addendum V1.1, AT-37). */
export const TIME_IN_FORCE_HOURS = {
  ONE_DAY: 24,
  SEVEN_DAYS: 168,
  THIRTY_DAYS: 720,
} as const;

export type TimeInForce = keyof typeof TIME_IN_FORCE_HOURS;

export const TIME_IN_FORCE_LABELS_NL: Record<TimeInForce, string> = {
  ONE_DAY: "1 dag",
  SEVEN_DAYS: "7 dagen",
  THIRTY_DAYS: "30 dagen",
};

export function isTimeInForce(value: unknown): value is TimeInForce {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TIME_IN_FORCE_HOURS, value);
}

/**
 * expiresAt = server acceptance + 24/168/720 elapsed hours, stored in UTC.
 * Elapsed hours, not calendar days: a DST change does not shift the duration.
 */
export function computeExpiresAt(acceptedAt: Date, tif: unknown): Date {
  if (!isTimeInForce(tif)) {
    throw new DomainError("TIME_IN_FORCE_INVALID", { tif });
  }
  return new Date(acceptedAt.getTime() + TIME_IN_FORCE_HOURS[tif] * 3_600_000);
}
