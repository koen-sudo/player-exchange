/**
 * Money in V1 is EUR only and always integer euro cents (BR-19).
 * No binary floating point arithmetic on amounts.
 */
import { DomainError, invariant } from "./errors.ts";

/** Integer number of euro cents. Branded to avoid mixing with counts. */
export type Cents = number & { readonly __brand: "Cents" };

export function cents(value: number): Cents {
  invariant(Number.isSafeInteger(value), `cents must be a safe integer, got ${value}`);
  return value as Cents;
}

/** Parse the API wire format: an integer-cent string such as "620". */
export function parseCentsString(raw: string): Cents {
  if (!/^-?(0|[1-9]\d*)$/.test(raw)) {
    throw new DomainError("PRICE_INVALID", { raw });
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) {
    throw new DomainError("PRICE_INVALID", { raw });
  }
  return n as Cents;
}

export function toCentsString(value: Cents): string {
  return String(value);
}

export function add(a: Cents, b: Cents): Cents {
  return cents(a + b);
}

export function sub(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

export function mul(a: Cents, quantity: number): Cents {
  invariant(Number.isSafeInteger(quantity), "quantity must be an integer");
  return cents(a * quantity);
}

export function sum(values: readonly Cents[]): Cents {
  return values.reduce<Cents>((acc, v) => add(acc, v), cents(0));
}

const NL_EUR = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format for display, e.g. 620 -> "€ 6,20" (nl-NL).
 * A missing amount is never rendered as €0,00 (docs/02-ux.md): pass null and
 * get "Niet beschikbaar".
 */
export function formatEuro(value: Cents | null | undefined): string {
  if (value === null || value === undefined) return "Niet beschikbaar";
  // Integer division into euros and cents keeps formatting exact.
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const euros = Math.trunc(abs / 100);
  const rest = abs % 100;
  return NL_EUR.format(sign * (euros + rest / 100));
}

/** Signed change for display: "+€ 0,40" / "−€ 0,40". */
export function formatEuroChange(value: Cents | null | undefined): string {
  if (value === null || value === undefined) return "Niet beschikbaar";
  if (value === 0) return formatEuro(value);
  const body = formatEuro(cents(Math.abs(value)));
  return value > 0 ? `+${body}` : `−${body}`;
}
