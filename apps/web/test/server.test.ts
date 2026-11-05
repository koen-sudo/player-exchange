import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDemoWorld } from "@px/demo";
import { buildOrderPreview } from "../src/server/order-preview.ts";
import { marketHref, parseMarketParams } from "../src/lib/market-params.ts";

const w = buildDemoWorld();
const anna = w.users.find((u) => u.login === "anna")!;
const bram = w.users.find((u) => u.login === "bram")!;
const noah = w.players.find((p) => p.displayName === "Noah Vermeer")!;
const lucas = w.players.find((p) => p.displayName === "Lucas Moreau")!;
const profileOnly = w.players.find((p) => p.marketStatus === "PROFILE_ONLY")!;
const now = new Date("2026-11-05T17:00:00Z");
let n = 0;
const id = () => `preview-${++n}`;

const buy = (over: Record<string, unknown> = {}) =>
  buildOrderPreview(w, anna.id, { side: "BUY", playerId: noah.id, quantity: 1, limitPriceMinor: "620", timeInForce: "ONE_DAY", ...over }, now, id);

describe("order preview (UX-06/07, docs/06)", () => {
  it("buy 1 × €6,20: server computes €6,20 maximum reserve, 60 s validity, 24 h expiry", () => {
    const r = buy();
    assert.ok(r.ok);
    assert.equal(r.preview.side, "BUY");
    if (r.preview.side !== "BUY") return;
    assert.equal(r.preview.maxReserveMinor, "620");
    assert.equal(r.preview.bestAskMinor, "620");
    assert.equal(r.preview.validUntil, "2026-11-05T17:01:00.000Z");
    assert.equal(r.preview.expiresAtIfAcceptedNow, "2026-11-06T17:00:00.000Z");
  });

  it("rejects decimals, out-of-range prices and other durations", () => {
    assert.deepEqual(buy({ limitPriceMinor: "6.20" }), { ok: false, code: "PRICE_INVALID", details: { raw: "6.20" } });
    assert.equal((buy({ limitPriceMinor: "19" }) as { code: string }).code, "PRICE_INVALID");
    assert.equal((buy({ timeInForce: "TWO_DAYS" }) as { code: string }).code, "TIME_IN_FORCE_INVALID");
    assert.equal((buy({ quantity: 0 }) as { code: string }).code, "QUANTITY_INVALID");
  });

  it("needs a session, verification and an open market", () => {
    assert.equal((buildOrderPreview(w, null, { side: "BUY", playerId: noah.id, quantity: 1, limitPriceMinor: "620", timeInForce: "ONE_DAY" }, now, id) as { code: string }).code, "AUTH_REQUIRED");
    assert.equal((buildOrderPreview(w, bram.id, { side: "BUY", playerId: noah.id, quantity: 1, limitPriceMinor: "620", timeInForce: "ONE_DAY" }, now, id) as { code: string }).code, "VERIFICATION_REQUIRED");
    assert.equal((buy({ playerId: profileOnly.id }) as { code: string }).code, "MARKET_NOT_OPEN");
  });

  it("insufficient available funds", () => {
    assert.equal((buy({ quantity: 20, limitPriceMinor: "700" }) as { code: string }).code, "INSUFFICIENT_AVAILABLE_FUNDS");
  });

  it("position limit counts holdings and open buys (Noah: 80 in circulation → limit 8)", () => {
    // Anna holds 3 and has an open buy for 2 → 5 exposure; 3 more is fine, 4 is not.
    assert.ok(buy({ quantity: 3, limitPriceMinor: "300" }).ok);
    assert.equal((buy({ quantity: 4, limitPriceMinor: "300" }) as { code: string }).code, "POSITION_LIMIT_EXCEEDED");
  });

  it("sell 1 × €6,00: gross €6,00, commission €0,30, net €5,70 with oldest card", () => {
    const r = buildOrderPreview(w, anna.id, { side: "SELL", playerId: noah.id, quantity: 1, limitPriceMinor: "630", timeInForce: "SEVEN_DAYS" }, now, id);
    // €6,30 sell is above Anna's own €6,20 bid, so no self-cross.
    assert.ok(r.ok);
    const s = buildOrderPreview(w, anna.id, { side: "SELL", playerId: lucas.id, quantity: 1, limitPriceMinor: "600", timeInForce: "SEVEN_DAYS" }, now, id);
    assert.ok(s.ok);
    if (!s.ok || s.preview.side !== "SELL") return;
    assert.deepEqual([s.preview.grossAtLimitMinor, s.preview.commissionMinor, s.preview.netAtLimitMinor], ["600", "30", "570"]);
    assert.equal(s.preview.cards.length, 1);
    assert.equal(s.preview.cards[0]!.serial, 7, "the reserved card #8 is not offered again");
  });

  it("a sell that would cross the user's own bid is rejected (BR-17)", () => {
    const r = buildOrderPreview(w, anna.id, { side: "SELL", playerId: noah.id, quantity: 1, limitPriceMinor: "600", timeInForce: "ONE_DAY" }, now, id);
    assert.deepEqual(r.ok ? null : r.code, "SELF_TRADE_REJECTED");
  });

  it("cannot sell more free cards than held, nor a reserved card (AT-13)", () => {
    const tooMany = buildOrderPreview(w, anna.id, { side: "SELL", playerId: lucas.id, quantity: 2, limitPriceMinor: "600", timeInForce: "ONE_DAY" }, now, id);
    assert.equal(tooMany.ok ? null : tooMany.code, "CARD_UNAVAILABLE");
    const reservedCard = w.holdings[anna.id]!.find((c) => c.reservedForSale)!;
    const r = buildOrderPreview(w, anna.id, { side: "SELL", playerId: lucas.id, quantity: 1, limitPriceMinor: "600", timeInForce: "ONE_DAY", cardIds: [reservedCard.cardId] }, now, id);
    assert.equal(r.ok ? null : r.code, "CARD_UNAVAILABLE");
  });

  it("cannot sell someone else's card (AT-09)", () => {
    const r = buildOrderPreview(w, anna.id, { side: "SELL", playerId: lucas.id, quantity: 1, limitPriceMinor: "600", timeInForce: "ONE_DAY", cardIds: ["not-mine"] }, now, id);
    assert.equal(r.ok ? null : r.code, "CARD_UNAVAILABLE");
  });
});

describe("market URL state (UX-01)", () => {
  it("round-trips filters and drops unknown values", () => {
    const f = parseMarketParams({ q: "noah", rol: "WINGER", status: "TRADABLE", sort: "reference", richting: "desc", pagina: "2", evil: "x", competitie: "not-a-uuid" });
    assert.deepEqual(f, { q: "noah", role: "WINGER", status: "TRADABLE", sort: "reference", dir: "desc", page: 2 });
    assert.equal(marketHref(f, { page: 1 }), "/markt?q=noah&rol=WINGER&status=TRADABLE&sort=reference&richting=desc");
    assert.equal(marketHref({}, {}), "/markt");
  });
});

import { euroInputToMinor } from "../src/lib/format.ts";

describe("euro input (UX-06 numeric keyboard)", () => {
  it("accepts Dutch and dot notation, rejects ambiguity", () => {
    assert.equal(euroInputToMinor("6,20"), "620");
    assert.equal(euroInputToMinor("6,2"), "620");
    assert.equal(euroInputToMinor("€ 6"), "600");
    assert.equal(euroInputToMinor("0,05"), "5");
    assert.equal(euroInputToMinor("6.20"), "620");
    assert.equal(euroInputToMinor("6,205"), null);
    assert.equal(euroInputToMinor("1.000,00"), null);
    assert.equal(euroInputToMinor(""), null);
  });
});
