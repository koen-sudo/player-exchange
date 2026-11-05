/**
 * Price-time priority matching for one player market (BR-15, BR-17, BR-21).
 *
 * - Best price first, then oldest accepted server sequence.
 * - Execution price = price of the order that was already resting (the older one).
 * - One execution = exactly one concrete card.
 * - Orders of the same user / known beneficial owner never match. A new order
 *   that would cross the owner's own resting opposite order is rejected,
 *   without silently cancelling existing orders.
 * - V1: at most one external settlement per market in flight. The matcher is
 *   asked for the next single match only; the caller holds the market lock
 *   and must not call it while a predecessor settlement is unresolved.
 *
 * This module is pure and in-memory. Persistence and locking live in the
 * settlement/trading services (fase 5).
 */
import { DomainError, invariant } from "./errors.ts";
import type { Cents } from "./money.ts";

export type Side = "BUY" | "SELL";

export type RestingOrder = {
  readonly orderId: string;
  readonly ownerKey: string; // user id or beneficial-owner group key
  readonly side: Side;
  readonly limitPrice: Cents;
  readonly sequence: number; // server acceptance order, strictly increasing per market
  readonly openQuantity: number;
  /** For SELL: concrete reserved card ids still open, oldest lot first. */
  readonly openCardIds?: readonly string[];
};

export type ProposedExecution = {
  readonly buyOrderId: string;
  readonly sellOrderId: string;
  readonly cardId: string;
  readonly price: Cents;
  readonly buyerKey: string;
  readonly sellerKey: string;
};

function crosses(bid: Cents, ask: Cents): boolean {
  return bid >= ask;
}

function better(side: Side, a: RestingOrder, b: RestingOrder): boolean {
  if (a.limitPrice !== b.limitPrice) {
    return side === "BUY" ? a.limitPrice > b.limitPrice : a.limitPrice < b.limitPrice;
  }
  return a.sequence < b.sequence;
}

function bestOf(orders: readonly RestingOrder[], side: Side): RestingOrder | undefined {
  let best: RestingOrder | undefined;
  for (const o of orders) {
    if (o.side !== side || o.openQuantity <= 0) continue;
    if (!best || better(side, o, best)) best = o;
  }
  return best;
}

/** Acceptance check for a new order (BR-17). */
export function assertNoSelfCross(book: readonly RestingOrder[], incoming: Omit<RestingOrder, "sequence">): void {
  const opposite: Side = incoming.side === "BUY" ? "SELL" : "BUY";
  for (const o of book) {
    if (o.ownerKey !== incoming.ownerKey || o.side !== opposite || o.openQuantity <= 0) continue;
    const bid = incoming.side === "BUY" ? incoming.limitPrice : o.limitPrice;
    const ask = incoming.side === "SELL" ? incoming.limitPrice : o.limitPrice;
    if (crosses(bid, ask)) {
      throw new DomainError("SELF_TRADE_REJECTED", { conflictingOrderId: o.orderId });
    }
  }
}

/**
 * Next single match in the book, or null. Because self-crossing orders are
 * rejected at acceptance, the best bid and best ask never share an owner; we
 * still guard against it.
 */
export function findNextMatch(book: readonly RestingOrder[]): ProposedExecution | null {
  const bid = bestOf(book, "BUY");
  const ask = bestOf(book, "SELL");
  if (!bid || !ask || !crosses(bid.limitPrice, ask.limitPrice)) return null;
  invariant(bid.ownerKey !== ask.ownerKey, "self-trade reached the matcher");
  const cardId = ask.openCardIds?.[0];
  invariant(cardId, "sell order without an open reserved card");
  const resting = bid.sequence < ask.sequence ? bid : ask;
  return {
    buyOrderId: bid.orderId,
    sellOrderId: ask.orderId,
    cardId,
    price: resting.limitPrice,
    buyerKey: bid.ownerKey,
    sellerKey: ask.ownerKey,
  };
}

/** Public, aggregated order book view (no identities). */
export function aggregateBook(book: readonly RestingOrder[]): {
  bids: { price: Cents; quantity: number }[];
  asks: { price: Cents; quantity: number }[];
} {
  const agg = (side: Side) => {
    const m = new Map<number, number>();
    for (const o of book) if (o.side === side && o.openQuantity > 0) m.set(o.limitPrice, (m.get(o.limitPrice) ?? 0) + o.openQuantity);
    const rows = [...m.entries()].map(([price, quantity]) => ({ price: price as Cents, quantity }));
    return rows.sort((a, b) => (side === "BUY" ? b.price - a.price : a.price - b.price));
  };
  return { bids: agg("BUY"), asks: agg("SELL") };
}
