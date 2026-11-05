/**
 * Order quantity buckets (data model "orders").
 * original = open + pending + filled + cancelled + expired, always.
 *
 * Users may only cancel the free, unmatched remainder (UX-08, BR-16).
 * The part in settlement is never released by a cancel (AT-19), and an
 * expired or cancelled remainder never comes back after a retry (AT-20).
 */
import { invariant } from "./errors.ts";

export type OrderQuantities = {
  readonly original: number;
  readonly open: number;
  readonly pending: number;
  readonly filled: number;
  readonly cancelled: number;
  readonly expired: number;
};

export function newOrderQuantities(original: number): OrderQuantities {
  return check({ original, open: original, pending: 0, filled: 0, cancelled: 0, expired: 0 });
}

export function check(q: OrderQuantities): OrderQuantities {
  for (const [k, v] of Object.entries(q)) {
    invariant(Number.isSafeInteger(v) && v >= 0, `order quantity ${k} must be a non-negative integer`);
  }
  invariant(
    q.open + q.pending + q.filled + q.cancelled + q.expired === q.original,
    "order quantities do not add up to original",
  );
  return q;
}

/** A match moves one card from open to pending. */
export function matchOne(q: OrderQuantities): OrderQuantities {
  invariant(q.open >= 1, "nothing open to match");
  return check({ ...q, open: q.open - 1, pending: q.pending + 1 });
}

/** Final settlement success: pending -> filled. */
export function settleOne(q: OrderQuantities): OrderQuantities {
  invariant(q.pending >= 1, "nothing pending to settle");
  return check({ ...q, pending: q.pending - 1, filled: q.filled + 1 });
}

export type FailedFillOutcome = "RESTORE_OPEN" | "CANCEL";

/**
 * Final settlement failure. The card returns to open only if the order is
 * still live; for a cancelled/expired/no-longer-admitted order it is
 * cancelled instead (docs/07 "Definitieve mislukking").
 */
export function failOne(q: OrderQuantities, outcome: FailedFillOutcome): OrderQuantities {
  invariant(q.pending >= 1, "nothing pending to fail");
  return outcome === "RESTORE_OPEN"
    ? check({ ...q, pending: q.pending - 1, open: q.open + 1 })
    : check({ ...q, pending: q.pending - 1, cancelled: q.cancelled + 1 });
}

/** Cancel only the free remainder. */
export function cancelRemainder(q: OrderQuantities): OrderQuantities {
  return check({ ...q, open: 0, cancelled: q.cancelled + q.open });
}

/** Expire only the free remainder. */
export function expireRemainder(q: OrderQuantities): OrderQuantities {
  return check({ ...q, open: 0, expired: q.expired + q.open });
}

export type OrderStatus =
  | "OPEN"
  | "PARTIALLY_FILLED"
  | "IN_SETTLEMENT"
  | "FILLED"
  | "CANCELLED"
  | "EXPIRED";

/** Derived display status (UX-08). */
export function deriveStatus(q: OrderQuantities): OrderStatus {
  if (q.open > 0) return q.filled > 0 || q.pending > 0 ? "PARTIALLY_FILLED" : "OPEN";
  if (q.pending > 0) return "IN_SETTLEMENT";
  if (q.filled === q.original) return "FILLED";
  if (q.filled > 0) return "PARTIALLY_FILLED";
  return q.expired > 0 && q.cancelled === 0 ? "EXPIRED" : "CANCELLED";
}

export const ORDER_STATUS_LABELS_NL: Record<OrderStatus, string> = {
  OPEN: "Open",
  PARTIALLY_FILLED: "Deels uitgevoerd",
  IN_SETTLEMENT: "In afwikkeling",
  FILLED: "Uitgevoerd",
  CANCELLED: "Geannuleerd",
  EXPIRED: "Verlopen",
};
