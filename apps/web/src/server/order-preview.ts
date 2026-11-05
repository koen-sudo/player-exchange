/**
 * Server-side order preview (docs/06 "Orderpreview", UX-06, UX-07, WF-02).
 *
 * The client never decides totals, fees or card selection: the server
 * recomputes everything from the request and current state. A preview
 * reserves nothing and is valid for 60 seconds.
 */
import {
  assertNoSelfCross,
  assertValidLimitPrice,
  assertValidQuantity,
  assertWithinPositionLimit,
  cents,
  computeExpiresAt,
  DomainError,
  isTimeInForce,
  mul,
  sellPreview,
  type Cents,
  type TimeInForce,
} from "@px/domain";
import type { DemoWorld } from "@px/demo";

export const PREVIEW_TTL_MS = 60_000;

export type PreviewRequest = {
  side: unknown;
  playerId: unknown;
  quantity: unknown;
  limitPriceMinor: unknown; // integer-cent string, e.g. "620"
  timeInForce: unknown;
  cardIds?: unknown; // explicit selection for SELL, or "AUTO_OLDEST"
};

export type BuyPreview = {
  side: "BUY";
  previewId: string;
  validUntil: string;
  playerId: string;
  quantity: number;
  limitPriceMinor: string;
  timeInForce: TimeInForce;
  expiresAtIfAcceptedNow: string;
  maxReserveMinor: string;
  bestAskMinor: string | null;
  partialFillNote: string;
  marketStatus: string;
};

export type SellPreview = {
  side: "SELL";
  previewId: string;
  validUntil: string;
  playerId: string;
  quantity: number;
  limitPriceMinor: string;
  timeInForce: TimeInForce;
  expiresAtIfAcceptedNow: string;
  cards: { cardId: string; serial: number; edition: string }[];
  grossAtLimitMinor: string;
  commissionMinor: string;
  netAtLimitMinor: string;
  commissionRule: string;
  bestBidMinor: string | null;
  roundingNote: string;
  marketStatus: string;
};

export type PreviewResult = { ok: true; preview: BuyPreview | SellPreview } | { ok: false; code: DomainError["code"]; details?: Record<string, unknown> };

function parseCents(raw: unknown): Cents {
  if (typeof raw !== "string" || !/^(0|[1-9]\d{0,8})$/.test(raw)) throw new DomainError("PRICE_INVALID", { raw });
  return cents(Number(raw));
}

function parseQuantity(raw: unknown): number {
  const n = typeof raw === "string" && /^\d{1,3}$/.test(raw) ? Number(raw) : raw;
  if (typeof n !== "number") throw new DomainError("QUANTITY_INVALID", { raw });
  assertValidQuantity(n);
  return n;
}

export function buildOrderPreview(
  w: DemoWorld,
  userId: string | null,
  req: PreviewRequest,
  now: Date,
  newId: () => string,
): PreviewResult {
  try {
    if (!userId) throw new DomainError("AUTH_REQUIRED");
    const user = w.users.find((u) => u.id === userId);
    if (!user) throw new DomainError("AUTH_REQUIRED");
    if (!user.verified) throw new DomainError("VERIFICATION_REQUIRED");
    if (user.residenceCountry !== "NL") throw new DomainError("COUNTRY_NOT_SUPPORTED");

    const side = req.side;
    if (side !== "BUY" && side !== "SELL") throw new DomainError("ACTION_NOT_ALLOWED", { side });
    const player = w.players.find((p) => p.id === req.playerId);
    if (!player || player.marketStatus !== "OPEN") throw new DomainError("MARKET_NOT_OPEN");

    const quantity = parseQuantity(req.quantity);
    const limit = parseCents(req.limitPriceMinor);
    assertValidLimitPrice(limit);
    if (!isTimeInForce(req.timeInForce)) throw new DomainError("TIME_IN_FORCE_INVALID", { tif: req.timeInForce });
    const tif = req.timeInForce;
    const expiresAt = computeExpiresAt(now, tif);

    // Self-cross check against the user's own open orders in this market (BR-17).
    const ownBook = w.orders
      .filter((o) => o.playerId === player.id && o.userId === userId && o.qty.open > 0)
      .map((o, i) => ({ orderId: o.id, ownerKey: o.userId, side: o.side, limitPrice: o.limitPriceCents, sequence: i + 1, openQuantity: o.qty.open }));
    assertNoSelfCross(ownBook, { orderId: "preview", ownerKey: userId, side, limitPrice: limit, openQuantity: quantity });

    const base = {
      previewId: newId(),
      validUntil: new Date(now.getTime() + PREVIEW_TTL_MS).toISOString(),
      playerId: player.id,
      quantity,
      limitPriceMinor: String(limit),
      timeInForce: tif,
      expiresAtIfAcceptedNow: expiresAt.toISOString(),
      marketStatus: player.marketStatus,
    };

    if (side === "BUY") {
      const balance = w.balances[userId];
      const reserve = mul(limit, quantity);
      if (!balance || reserve > balance.available) {
        throw new DomainError("INSUFFICIENT_AVAILABLE_FUNDS", { required: reserve, available: balance?.available ?? 0 });
      }
      const held = (w.holdings[userId] ?? []).filter((c) => c.playerId === player.id).length;
      const openBuys = w.orders
        .filter((o) => o.userId === userId && o.playerId === player.id && o.side === "BUY")
        .reduce((n, o) => n + o.qty.open, 0);
      const pendingBuys = w.orders
        .filter((o) => o.userId === userId && o.playerId === player.id && o.side === "BUY")
        .reduce((n, o) => n + o.qty.pending, 0);
      const reservedSubs = w.subscriptions.filter((s) => s.userId === userId && s.status === "CONFIRMED" && w.drops.find((d) => d.id === s.dropId)?.playerId === player.id).length;
      assertWithinPositionLimit(
        { held, openBuyQuantity: openBuys, buyPendingSettlement: pendingBuys, reservedSubscriptions: reservedSubs },
        quantity,
        player.supply.inCirculation,
      );
      const preview: BuyPreview = {
        ...base,
        side: "BUY",
        maxReserveMinor: String(reserve),
        bestAskMinor: player.asks[0] ? String(player.asks[0].price) : null,
        partialFillNote:
          "Je order kan in delen worden uitgevoerd. Iedere kaart wordt gekocht tegen de prijs van de bestaande verkooporder, nooit boven je limiet. Het verschil met je limiet komt na afwikkeling terug in je beschikbare saldo.",
      };
      return { ok: true, preview };
    }

    // SELL: concrete cards (UX-07). Explicit ids must be the user's free cards;
    // otherwise the oldest free acquisition lots are selected.
    const free = (w.holdings[userId] ?? [])
      .filter((c) => c.playerId === player.id && !c.reservedForSale)
      .sort((a, b) => a.acquiredAt.getTime() - b.acquiredAt.getTime() || a.serial - b.serial);
    let selected = free.slice(0, quantity);
    if (Array.isArray(req.cardIds)) {
      const ids = req.cardIds as unknown[];
      if (ids.length !== quantity || new Set(ids).size !== ids.length) throw new DomainError("QUANTITY_INVALID", { reason: "cardIds must match quantity" });
      selected = ids.map((id) => {
        const c = free.find((x) => x.cardId === id);
        if (!c) throw new DomainError("CARD_UNAVAILABLE", { cardId: id });
        return c;
      });
    } else if (req.cardIds !== undefined && req.cardIds !== "AUTO_OLDEST") {
      throw new DomainError("CARD_UNAVAILABLE", { cardIds: req.cardIds });
    }
    if (selected.length < quantity) throw new DomainError("CARD_UNAVAILABLE", { free: free.length, quantity });

    const p = sellPreview(quantity, limit);
    const preview: SellPreview = {
      ...base,
      side: "SELL",
      cards: selected.map((c) => ({ cardId: c.cardId, serial: c.serial, edition: c.edition })),
      grossAtLimitMinor: String(p.gross),
      commissionMinor: String(p.commission),
      netAtLimitMinor: String(p.net),
      commissionRule: "5% verkoperscommissie, cumulatief per verkooporder, half omhoog afgerond op hele centen",
      bestBidMinor: player.bids[0] ? String(player.bids[0].price) : null,
      roundingNote:
        "Bij gedeeltelijke uitvoering kan de commissie per deel een cent afwijken door afronding; over de hele order blijft het 5%. Uitvoering tegen een hoger bestaand bod levert meer op.",
    };
    return { ok: true, preview };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, code: e.code, details: e.details };
    throw e;
  }
}
