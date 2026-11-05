import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { DomainError } from "../src/errors.ts";
import { cents } from "../src/money.ts";
import { aggregateBook, assertNoSelfCross, findNextMatch, type RestingOrder } from "../src/matching.ts";
import { allocate, generateSeed, nextWaitlistCandidate, seedCommitment } from "../src/allocation.ts";
import { realisedResult, summarizePortfolio } from "../src/portfolio.ts";

const sell = (id: string, owner: string, price: number, seq: number, cards: string[]): RestingOrder => ({
  orderId: id, ownerKey: owner, side: "SELL", limitPrice: cents(price), sequence: seq, openQuantity: cards.length, openCardIds: cards,
});
const buy = (id: string, owner: string, price: number, seq: number, qty = 1): RestingOrder => ({
  orderId: id, ownerKey: owner, side: "BUY", limitPrice: cents(price), sequence: seq, openQuantity: qty,
});

describe("matching (BR-15, BR-17)", () => {
  it("new buy matches the cheapest ask at the resting price (AT-14, AT-16)", () => {
    const book = [sell("s1", "A", 630, 1, ["c1"]), sell("s2", "B", 620, 2, ["c2"]), buy("b1", "C", 650, 3)];
    const m = findNextMatch(book);
    assert.deepEqual(m && [m.sellOrderId, m.cardId, m.price], ["s2", "c2", 620]);
  });
  it("new sell matches the highest bid at the resting bid price", () => {
    const book = [buy("b1", "A", 570, 1), buy("b2", "B", 590, 2), sell("s1", "C", 560, 3, ["c9"])];
    const m = findNextMatch(book);
    assert.deepEqual(m && [m.buyOrderId, m.price], ["b2", 590]);
  });
  it("equal prices use server sequence (AT-15)", () => {
    const book = [sell("late", "A", 600, 5, ["c1"]), sell("early", "B", 600, 2, ["c2"]), buy("b", "C", 600, 9)];
    assert.equal(findNextMatch(book)?.sellOrderId, "early");
  });
  it("no cross, no match; non-crossing own orders are allowed", () => {
    assert.equal(findNextMatch([buy("b", "A", 570, 1), sell("s", "A", 620, 2, ["c"])]), null);
  });
  it("a self-crossing new order is rejected without touching existing orders (AT-17)", () => {
    const book = [sell("s", "A", 600, 1, ["c"])];
    assert.throws(
      () => assertNoSelfCross(book, { orderId: "n", ownerKey: "A", side: "BUY", limitPrice: cents(610), openQuantity: 1 }),
      (e: unknown) => e instanceof DomainError && e.code === "SELF_TRADE_REJECTED",
    );
    assert.equal(book.length, 1);
    assert.doesNotThrow(() => assertNoSelfCross(book, { orderId: "n", ownerKey: "B", side: "BUY", limitPrice: cents(610), openQuantity: 1 }));
  });
  it("aggregated public book has no identities (wireframe 01 values)", () => {
    const book = [buy("1", "A", 570, 1, 2), buy("2", "B", 560, 2, 3), sell("3", "C", 620, 3, ["x"]), sell("4", "D", 630, 4, ["y", "z"])];
    assert.deepEqual(aggregateBook(book), {
      bids: [{ price: 570, quantity: 2 }, { price: 560, quantity: 3 }],
      asks: [{ price: 620, quantity: 1 }, { price: 630, quantity: 2 }],
    });
  });
});

describe("allocation (BR-11, BR-12)", () => {
  const seed = generateSeed();
  const commitment = seedCommitment(seed);
  const ids = Array.from({ length: 40 }, (_, i) => `sub-${String(i).padStart(3, "0")}`);

  it("a retry with the same snapshot gives identical winners (AT-24)", () => {
    const a = allocate({ seed, commitment, dropId: "drop-1", frozenSubscriptionIds: ids, availableCards: 5 });
    const b = allocate({ seed, commitment, dropId: "drop-1", frozenSubscriptionIds: [...ids].reverse(), availableCards: 5 });
    assert.deepEqual(a.winners, b.winners);
    assert.equal(a.resultDigest, b.resultDigest);
    assert.equal(a.winners.length, 5);
    assert.equal(a.waitlist.length, 35);
  });
  it("a different seed cannot be used against the registered commitment", () => {
    assert.throws(() => allocate({ seed: generateSeed(), commitment, dropId: "drop-1", frozenSubscriptionIds: ids, availableCards: 5 }));
  });
  it("undersubscribed drop: everybody wins", () => {
    const r = allocate({ seed, commitment, dropId: "drop-2", frozenSubscriptionIds: ids.slice(0, 3), availableCards: 5 });
    assert.equal(r.winners.length, 3);
    assert.equal(r.waitlist.length, 0);
  });
  it("pending payment keeps the card; definitive failure promotes next admitted (AT-26, AT-27)", () => {
    const base = { waitlist: ["w1", "w2"], alreadyTried: new Set<string>(), firstAllocatedAt: new Date("2026-11-10T21:00:00Z"), now: new Date("2026-11-11T08:00:00Z") };
    assert.equal(nextWaitlistCandidate({ ...base, holderSettlement: "PENDING", isStillAdmitted: () => true }), "HOLD");
    assert.equal(nextWaitlistCandidate({ ...base, holderSettlement: "UNKNOWN", isStillAdmitted: () => true }), "HOLD");
    assert.equal(nextWaitlistCandidate({ ...base, holderSettlement: "FAILED", isStillAdmitted: (id) => id !== "w1" }), "w2");
    assert.equal(nextWaitlistCandidate({ ...base, holderSettlement: "FAILED", now: new Date("2026-11-12T22:00:00Z"), isStillAdmitted: () => true }), "UNSOLD");
  });
});

describe("portfolio (UX-03, WF-01) with wireframe figures", () => {
  const card = (cardId: string, playerId: string, cost: number, reservedForSale = false) => ({ cardId, playerId, costCents: cents(cost), reservedForSale });
  const cards = [
    card("nv1", "NV", 580), card("nv2", "NV", 580), card("nv3", "NV", 580),
    card("lm1", "LM", 320), card("lm2", "LM", 320, true),
    card("mr1", "MR", 680),
  ];
  it("shows '3 spelers · 6 kaarten' and the wireframe totals", () => {
    const s = summarizePortfolio(cards, new Map([["NV", cents(600)], ["LM", cents(340)], ["MR", cents(820)]]));
    assert.equal(s.label, "3 spelers · 6 kaarten");
    assert.equal(s.totalCost, 3_060); // €30,60
    assert.equal(s.totalReference, 3_300); // €33,00
    const lm = s.positions.find((p) => p.playerId === "LM");
    assert.deepEqual(lm && [lm.availableForSale, lm.reserved], [1, 1]);
  });
  it("a player without published reference is excluded, never counted as €0", () => {
    const s = summarizePortfolio(cards, new Map([["NV", cents(600)]]));
    assert.equal(s.totalReference, 1_800);
    assert.equal(s.cardsWithoutReference, 3);
    assert.equal(s.positions.find((p) => p.playerId === "MR")?.totalReference, null);
  });
  it("realised result = proceeds − commission − cost of the sold card", () => {
    assert.equal(realisedResult(cents(600), cents(30), cents(580)), -10);
  });
});
