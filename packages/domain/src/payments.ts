/**
 * Deposit and withdrawal rules (fase 4).
 *
 * The limits are operational settings (BR-19 "configureerbare operationele
 * limieten voor totaalbedragen"). The values below are a demo assumption
 * (A-14) until the product owner and the payment partner fix them.
 */
import { DomainError } from "./errors.ts";
import { cents, formatEuro, type Cents } from "./money.ts";

export type PaymentLimits = {
  depositMin: Cents;
  depositMax: Cents;
  withdrawalMin: Cents;
  withdrawalMax: Cents;
  /** Unfinished deposits a user may have at the same time. */
  maxOpenDeposits: number;
};

export const DEFAULT_PAYMENT_LIMITS: PaymentLimits = {
  depositMin: cents(500),
  depositMax: cents(250_000),
  withdrawalMin: cents(100),
  withdrawalMax: cents(500_000),
  maxOpenDeposits: 3,
};

/**
 * Parse a euro amount typed by a person: "25", "25,5", "25,50", "€ 1.250,00".
 * Dutch notation: comma for cents, dot for thousands. At most two decimals.
 */
export function parseEuroInput(raw: string): Cents {
  const s = raw.replace(/€|\s/g, "");
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s);
  if (!m) throw new DomainError("AMOUNT_INVALID", { raw });
  const whole = Number(m[1]!.replace(/\./g, ""));
  const frac = Number((m[2] ?? "0").padEnd(2, "0"));
  const value = whole * 100 + frac;
  if (!Number.isSafeInteger(value)) throw new DomainError("AMOUNT_INVALID", { raw });
  return cents(value);
}

const euro = (c: number) => formatEuro(cents(c));

export function validateDepositAmount(amount: Cents, limits: PaymentLimits = DEFAULT_PAYMENT_LIMITS): void {
  if (!Number.isSafeInteger(amount) || amount < limits.depositMin || amount > limits.depositMax) {
    throw new DomainError("AMOUNT_INVALID", { userMessage: `Kies een bedrag tussen ${euro(limits.depositMin)} en ${euro(limits.depositMax)}.` });
  }
}

export function validateWithdrawalAmount(amount: Cents, available: Cents, limits: PaymentLimits = DEFAULT_PAYMENT_LIMITS): void {
  if (!Number.isSafeInteger(amount) || amount < limits.withdrawalMin || amount > limits.withdrawalMax) {
    throw new DomainError("AMOUNT_INVALID", { userMessage: `Kies een bedrag tussen ${euro(limits.withdrawalMin)} en ${euro(limits.withdrawalMax)}.` });
  }
  if (amount > available) throw new DomainError("INSUFFICIENT_AVAILABLE_FUNDS");
}
