/**
 * Customer cash buckets and the buy/sell money flow (BR-16, docs/07, docs/09).
 *
 * Pure value logic. The ledger (fase 4) books the same movements as balanced
 * double-entry journal lines; this module defines the expected outcome and is
 * used by tests and previews.
 */
import { DomainError, invariant } from "./errors.ts";
import { add, cents, mul, sub, type Cents } from "./money.ts";

export type CashBalance = {
  readonly available: Cents;
  readonly reserved: Cents;
  readonly pendingIncoming: Cents;
};

export function balance(available: number, reserved = 0, pendingIncoming = 0): CashBalance {
  return { available: cents(available), reserved: cents(reserved), pendingIncoming: cents(pendingIncoming) };
}

function checkBalance(b: CashBalance): CashBalance {
  invariant(b.available >= 0, "available balance cannot go negative through user actions");
  invariant(b.reserved >= 0, "reserved balance cannot go negative");
  invariant(b.pendingIncoming >= 0, "pending incoming cannot go negative");
  return b;
}

/** Buy order: quantity × limit is reserved before the order participates. */
export function holdForBuyOrder(b: CashBalance, quantity: number, limitPrice: Cents): CashBalance {
  const amount = mul(limitPrice, quantity);
  if (amount > b.available) {
    throw new DomainError("INSUFFICIENT_AVAILABLE_FUNDS", { required: amount, available: b.available });
  }
  return checkBalance({ ...b, available: sub(b.available, amount), reserved: add(b.reserved, amount) });
}

/**
 * Buyer side of a finally settled execution of one card: the reserved limit
 * leaves the reserve, the execution price is paid, and the price improvement
 * returns to available.
 */
export function settleBuyFill(b: CashBalance, limitPrice: Cents, executionPrice: Cents): { balance: CashBalance; paid: Cents; released: Cents } {
  invariant(executionPrice <= limitPrice, "execution above buyer limit");
  invariant(b.reserved >= limitPrice, "reserve does not cover the fill");
  const released = sub(limitPrice, executionPrice);
  return {
    balance: checkBalance({ ...b, reserved: sub(b.reserved, limitPrice), available: add(b.available, released) }),
    paid: executionPrice,
    released,
  };
}

/** Cancel the free remainder of a buy order: only that part is released. */
export function releaseBuyRemainder(b: CashBalance, openQuantity: number, limitPrice: Cents): CashBalance {
  const amount = mul(limitPrice, openQuantity);
  invariant(b.reserved >= amount, "reserve does not cover the remainder");
  return checkBalance({ ...b, reserved: sub(b.reserved, amount), available: add(b.available, amount) });
}

/** Seller side of a finally settled fill: net proceeds become available. */
export function settleSellFill(b: CashBalance, net: Cents): CashBalance {
  invariant(net >= 0, "net proceeds cannot be negative");
  return checkBalance({ ...b, available: add(b.available, net) });
}

/** Withdrawal intent: the amount is held so it cannot also fund a buy (AT-31). */
export function holdForWithdrawal(b: CashBalance, amount: Cents): CashBalance {
  if (amount <= 0 || amount > b.available) {
    throw new DomainError("INSUFFICIENT_AVAILABLE_FUNDS", { required: amount, available: b.available });
  }
  return checkBalance({ ...b, available: sub(b.available, amount), reserved: add(b.reserved, amount) });
}
