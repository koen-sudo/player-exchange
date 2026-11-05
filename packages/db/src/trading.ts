/**
 * Orders, matching and settlement (fase 5, BR-14..BR-21, docs/07).
 *
 * Flow:
 *   preview (server computes everything, reserves nothing, valid 60 s)
 *   → place (checked again under locks; money or cards reserved; priority)
 *   → match (one card at a time; at most one external settlement per market)
 *   → settle at the payment provider (outside a transaction, stable key)
 *   → finalise once: card, money, commission, order quantities together.
 *
 * Lock order (CLAUDE.md): market → wallets (sorted) → orders (sorted) → cards.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  applySettledFill,
  assertNoSelfCross,
  assertValidLimitPrice,
  assertValidQuantity,
  assertWithinPositionLimit,
  cents,
  DomainError,
  findNextMatch,
  isTimeInForce,
  sellPreview,
  TIME_IN_FORCE_HOURS,
  type RestingOrder,
  type TimeInForce,
} from "@px/domain";
import type { ProviderOutcome } from "@px/integrations";
import type { Db, Executor } from "./client.ts";
import { consumeHold, createHold, releaseHold, restoreConsumed } from "./holds.ts";
import { writeAudit, type AppMode } from "./identity.ts";
import { pgArray, transferOwnership } from "./inventory.ts";
import { balancesFor, book, postings } from "./ledger.ts";
import { applyOperationOutcome, assertAllowed, type PaymentsCtx } from "./payments.ts";

export const PREVIEW_TTL_SECONDS = 60;
const OPEN_EXECUTION = sql`('MATCHED','SUBMISSION_PENDING','PROVIDER_PENDING','MANUAL_REVIEW')`;

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------
export type PreviewRequest = {
  side?: unknown;
  playerId?: unknown;
  quantity?: unknown;
  limitPriceMinor?: unknown; // integer-cent string, e.g. "620"
  timeInForce?: unknown;
  cardIds?: unknown; // explicit selection for SELL, or "AUTO_OLDEST"
};

type PreviewBase = {
  previewId: string;
  validUntil: string;
  playerId: string;
  quantity: number;
  limitPriceMinor: string;
  timeInForce: TimeInForce;
  expiresAtIfAcceptedNow: string;
  marketStatus: string;
};
export type BuyPreview = PreviewBase & { side: "BUY"; maxReserveMinor: string; bestAskMinor: string | null; partialFillNote: string };
export type SellPreview = PreviewBase & {
  side: "SELL";
  cards: { cardId: string; serial: number; edition: string }[];
  grossAtLimitMinor: string;
  commissionMinor: string;
  netAtLimitMinor: string;
  commissionRule: string;
  bestBidMinor: string | null;
  roundingNote: string;
};
export type OrderPreview = BuyPreview | SellPreview;

type PreviewPayload = { side: "BUY" | "SELL"; playerId: string; quantity: number; limit: number; tif: TimeInForce; cardIds: string[] };

function parseCents(raw: unknown): number {
  if (typeof raw !== "string" || !/^(0|[1-9]\d{0,8})$/.test(raw)) throw new DomainError("PRICE_INVALID", { raw });
  return Number(raw);
}

function parseQuantity(raw: unknown): number {
  const n = typeof raw === "string" && /^\d{1,3}$/.test(raw) ? Number(raw) : raw;
  if (typeof n !== "number") throw new DomainError("QUANTITY_INVALID", { raw });
  assertValidQuantity(n);
  return n;
}

type MarketRow = { id: string; player_id: string; status: string; next_order_sequence: string };

async function marketForPlayer(db: Executor, playerId: string, lock = false): Promise<MarketRow | undefined> {
  if (typeof playerId !== "string" || !/^[0-9a-f-]{36}$/.test(playerId)) return undefined;
  return (await db.execute<MarketRow>(sql`
    SELECT id, player_id, status::text AS status, next_order_sequence FROM player_markets WHERE player_id = ${playerId} ${lock ? sql`FOR UPDATE` : sql``}`)).rows[0];
}

async function lockMarketById(tx: Executor, marketId: string): Promise<MarketRow> {
  return (await tx.execute<MarketRow>(sql`SELECT id, player_id, status::text AS status, next_order_sequence FROM player_markets WHERE id = ${marketId} FOR UPDATE`)).rows[0]!;
}

/** Cards of this player the user owns and has not reserved, oldest acquisition first (UX-07). */
async function freeCards(db: Executor, userId: string, playerId: string) {
  return (await db.execute<{ card_id: string; serial: number; season_key: string; acquired_at: string }>(sql`
    SELECT c.id AS card_id, c.serial_number AS serial, e.season_key,
           coalesce((SELECT max(oe.occurred_at) FROM ownership_events oe WHERE oe.card_id = c.id AND oe.new_owner_id = ${userId}), c.created_at)::text AS acquired_at
      FROM cards c JOIN editions e ON e.id = c.edition_id
     WHERE e.player_id = ${playerId} AND c.owner_user_id = ${userId} AND c.status = 'OWNED'
       AND NOT EXISTS (SELECT 1 FROM order_cards oc WHERE oc.card_id = c.id AND oc.active)
     ORDER BY 4, c.serial_number`)).rows;
}

/** Everything that counts towards the position limit for this player (BR-18). */
async function exposureFor(db: Executor, userId: string, playerId: string) {
  const r = (await db.execute<{ held: number; open_buys: number; pending_buys: number; subs: number; issued: number }>(sql`
    SELECT
      (SELECT count(*) FROM cards c JOIN editions e ON e.id = c.edition_id WHERE e.player_id = ${playerId} AND c.owner_user_id = ${userId} AND c.status = 'OWNED')::int AS held,
      (SELECT coalesce(sum(o.qty_open), 0) FROM orders o JOIN player_markets pm ON pm.id = o.player_market_id WHERE pm.player_id = ${playerId} AND o.user_id = ${userId} AND o.side = 'BUY' AND o.state = 'ACTIVE')::int AS open_buys,
      (SELECT coalesce(sum(o.qty_pending), 0) FROM orders o JOIN player_markets pm ON pm.id = o.player_market_id WHERE pm.player_id = ${playerId} AND o.user_id = ${userId} AND o.side = 'BUY')::int AS pending_buys,
      (SELECT coalesce(sum(s.quantity), 0) FROM subscriptions s JOIN drops d ON d.id = s.drop_id JOIN editions e ON e.id = d.edition_id
        WHERE e.player_id = ${playerId} AND s.user_id = ${userId} AND s.status IN ('RESERVATION_PENDING','CONFIRMED'))::int AS subs,
      (SELECT count(*) FROM cards c JOIN editions e ON e.id = c.edition_id WHERE e.player_id = ${playerId} AND c.status = 'OWNED')::int AS issued`)).rows[0]!;
  return r;
}

async function ownRestingOrders(db: Executor, userId: string, marketId: string) {
  return (await db.execute<{ id: string; side: "BUY" | "SELL"; limit_price_cents: string; priority_sequence: string; qty_open: number }>(sql`
    SELECT id, side::text AS side, limit_price_cents, priority_sequence, qty_open FROM orders
     WHERE player_market_id = ${marketId} AND user_id = ${userId} AND state = 'ACTIVE' AND qty_open > 0 AND expires_at > now()`)).rows;
}

async function bestPrices(db: Executor, marketId: string) {
  const r = (await db.execute<{ bid: string | null; ask: string | null }>(sql`
    SELECT (SELECT max(limit_price_cents) FROM orders WHERE player_market_id = ${marketId} AND side = 'BUY' AND state = 'ACTIVE' AND qty_open > 0 AND expires_at > now()) AS bid,
           (SELECT min(limit_price_cents) FROM orders WHERE player_market_id = ${marketId} AND side = 'SELL' AND state = 'ACTIVE' AND qty_open > 0 AND expires_at > now()) AS ask`)).rows[0]!;
  return { bid: r.bid, ask: r.ask };
}

/**
 * Checks shared by preview and placement. With `tx` and a locked market this
 * is the authoritative check; without, it is the advisory preview.
 */
async function checkOrder(db: Executor, mode: AppMode, userId: string, p: PreviewPayload, market: MarketRow): Promise<{ cards: { card_id: string; serial: number; season_key: string }[] }> {
  await assertAllowed(db, userId, "TRADE", mode);
  if (market.status !== "OPEN") throw new DomainError("MARKET_NOT_OPEN");
  assertValidQuantity(p.quantity);
  assertValidLimitPrice(cents(p.limit));
  const own = await ownRestingOrders(db, userId, market.id);
  assertNoSelfCross(
    own.map((o) => ({ orderId: o.id, ownerKey: userId, side: o.side, limitPrice: cents(Number(o.limit_price_cents)), sequence: Number(o.priority_sequence), openQuantity: o.qty_open })),
    { orderId: "new", ownerKey: userId, side: p.side, limitPrice: cents(p.limit), openQuantity: p.quantity },
  );
  if (p.side === "BUY") {
    const required = p.quantity * p.limit;
    const available = (await balancesFor(db, userId)).available;
    if (required > available) throw new DomainError("INSUFFICIENT_AVAILABLE_FUNDS", { required, available });
    const e = await exposureFor(db, userId, market.player_id);
    assertWithinPositionLimit({ held: e.held, openBuyQuantity: e.open_buys, buyPendingSettlement: e.pending_buys, reservedSubscriptions: e.subs }, p.quantity, e.issued);
    return { cards: [] };
  }
  const free = await freeCards(db, userId, market.player_id);
  let selected = free.slice(0, p.quantity);
  if (p.cardIds.length) {
    if (p.cardIds.length !== p.quantity || new Set(p.cardIds).size !== p.cardIds.length) throw new DomainError("QUANTITY_INVALID", { reason: "cardIds must match quantity" });
    selected = p.cardIds.map((id) => {
      const c = free.find((x) => x.card_id === id);
      if (!c) throw new DomainError("CARD_UNAVAILABLE", { cardId: id });
      return c;
    });
  }
  if (selected.length < p.quantity) throw new DomainError("CARD_UNAVAILABLE", { free: free.length, quantity: p.quantity });
  return { cards: selected };
}

export async function createOrderPreview(db: Db, mode: AppMode, userId: string, req: PreviewRequest, now = new Date()): Promise<OrderPreview> {
  const side = req.side;
  if (side !== "BUY" && side !== "SELL") throw new DomainError("ACTION_NOT_ALLOWED", { side });
  await assertAllowed(db, userId, "TRADE", mode);
  const market = await marketForPlayer(db, String(req.playerId ?? ""));
  if (!market || market.status !== "OPEN") throw new DomainError("MARKET_NOT_OPEN");
  const quantity = parseQuantity(req.quantity);
  const limit = parseCents(req.limitPriceMinor);
  assertValidLimitPrice(cents(limit));
  if (!isTimeInForce(req.timeInForce)) throw new DomainError("TIME_IN_FORCE_INVALID", { tif: req.timeInForce });
  let cardIds: string[] = [];
  if (Array.isArray(req.cardIds)) cardIds = (req.cardIds as unknown[]).map(String);
  else if (req.cardIds !== undefined && req.cardIds !== "AUTO_OLDEST") throw new DomainError("CARD_UNAVAILABLE", { cardIds: req.cardIds });

  const payload: PreviewPayload = { side, playerId: market.player_id, quantity, limit, tif: req.timeInForce, cardIds };
  const { cards } = await checkOrder(db, mode, userId, payload, market);
  if (side === "SELL") payload.cardIds = cards.map((c) => c.card_id); // the server's selection is what will be reserved
  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_SECONDS * 1000);
  const id = (await db.execute<{ id: string }>(sql`
    INSERT INTO order_previews(user_id, player_market_id, side, payload, created_at, expires_at)
    VALUES (${userId}, ${market.id}, ${side}, ${JSON.stringify(payload)}::jsonb, ${now.toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz) RETURNING id`)).rows[0]!.id;

  const best = await bestPrices(db, market.id);
  const base: PreviewBase = {
    previewId: id,
    validUntil: expiresAt.toISOString(),
    playerId: market.player_id,
    quantity,
    limitPriceMinor: String(limit),
    timeInForce: payload.tif,
    expiresAtIfAcceptedNow: new Date(now.getTime() + TIME_IN_FORCE_HOURS[payload.tif] * 3_600_000).toISOString(),
    marketStatus: market.status,
  };
  if (side === "BUY") {
    return {
      ...base, side: "BUY", maxReserveMinor: String(quantity * limit), bestAskMinor: best.ask,
      partialFillNote: "Je order kan in delen worden uitgevoerd. Iedere kaart wordt gekocht tegen de prijs van de bestaande verkooporder, nooit boven je limiet. Het verschil met je limiet komt na afwikkeling terug in je beschikbare saldo.",
    };
  }
  const p = sellPreview(quantity, cents(limit));
  return {
    ...base, side: "SELL",
    cards: cards.map((c) => ({ cardId: c.card_id, serial: c.serial, edition: c.season_key })),
    grossAtLimitMinor: String(p.gross), commissionMinor: String(p.commission), netAtLimitMinor: String(p.net),
    commissionRule: "5% verkoperscommissie, cumulatief per verkooporder, half omhoog afgerond op hele centen",
    bestBidMinor: best.bid,
    roundingNote: "Bij gedeeltelijke uitvoering kan de commissie per deel een cent afwijken door afronding; over de hele order blijft het 5%. Uitvoering tegen een hoger bestaand bod levert meer op.",
  };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------
export type PlaceResult = { orderId: string; status: string; executions: { executionId: string; status: string; priceCents: number }[] };

export async function placeOrder(ctx: PaymentsCtx, userId: string, input: { previewId: string; requestKey: string }): Promise<PlaceResult> {
  const endpoint = "POST /orders";
  const placed = await ctx.db.transaction(async (tx) => {
    const ins = await tx.execute(sql`
      INSERT INTO idempotency_requests(actor_id, endpoint, key, request_hash) VALUES (${userId}, ${endpoint}, ${input.requestKey}, ${input.previewId})
      ON CONFLICT DO NOTHING RETURNING key`);
    if (!ins.rows.length) {
      const prior = (await tx.execute<{ request_hash: string; response_body: { orderId?: string } | null }>(sql`
        SELECT request_hash, response_body FROM idempotency_requests WHERE actor_id = ${userId} AND endpoint = ${endpoint} AND key = ${input.requestKey}`)).rows[0]!;
      if (prior.request_hash !== input.previewId) throw new DomainError("IDEMPOTENCY_CONFLICT");
      return { orderId: prior.response_body!.orderId!, marketId: null as string | null };
    }
    if (!/^[0-9a-f-]{36}$/.test(input.previewId)) throw new DomainError("PREVIEW_EXPIRED");
    const pv = (await tx.execute<{ user_id: string; player_market_id: string; payload: PreviewPayload; expired: boolean; consumed_at: string | null }>(sql`
      SELECT user_id, player_market_id, payload, expires_at <= now() AS expired, consumed_at FROM order_previews WHERE id = ${input.previewId} FOR UPDATE`)).rows[0];
    if (!pv || pv.user_id !== userId || pv.consumed_at || pv.expired) throw new DomainError("PREVIEW_EXPIRED");
    const p = pv.payload;

    // Lock order: market first.
    const market = await lockMarketById(tx, pv.player_market_id);
    const { cards } = await checkOrder(tx, ctx.mode, userId, p, market);
    const seq = Number(market.next_order_sequence);
    const orderId = randomUUID();
    await tx.execute(sql`
      INSERT INTO orders(id, player_market_id, user_id, side, limit_price_cents, time_in_force, state, priority_sequence, qty_original, qty_open, accepted_at, expires_at)
      VALUES (${orderId}, ${market.id}, ${userId}, ${p.side}, ${p.limit}, ${p.tif}, 'ACTIVE', ${seq}, ${p.quantity}, ${p.quantity}, now(), now() + make_interval(hours => ${TIME_IN_FORCE_HOURS[p.tif]}))`);
    await tx.execute(sql`UPDATE player_markets SET next_order_sequence = ${seq + 1} WHERE id = ${market.id}`);
    if (p.side === "BUY") {
      await createHold(tx, ctx.mode, { userId, purpose: "BUY_ORDER", orderId, amount: p.quantity * p.limit });
    } else {
      const ids = cards.map((c) => c.card_id).sort();
      await tx.execute(sql`SELECT id FROM cards WHERE id = ANY(${pgArray(ids)}::uuid[]) ORDER BY id FOR UPDATE`);
      const busy = await tx.execute(sql`SELECT 1 FROM order_cards WHERE active AND card_id = ANY(${pgArray(ids)}::uuid[])`);
      if (busy.rows.length) throw new DomainError("CARD_UNAVAILABLE");
      await tx.execute(sql`INSERT INTO order_cards(order_id, card_id) SELECT ${orderId}, unnest(${pgArray(ids)}::uuid[])`);
    }
    await tx.execute(sql`UPDATE order_previews SET consumed_at = now(), order_id = ${orderId} WHERE id = ${input.previewId}`);
    await writeAudit(tx, { actorId: userId, actorKind: "USER", action: "ORDER_PLACED", entityType: "order", entityId: orderId, related: { side: p.side, quantity: p.quantity, limit: p.limit, tif: p.tif } });
    await tx.execute(sql`
      UPDATE idempotency_requests SET response_status = 200, response_body = ${JSON.stringify({ orderId })}::jsonb
       WHERE actor_id = ${userId} AND endpoint = ${endpoint} AND key = ${input.requestKey}`);
    return { orderId, marketId: market.id };
  });
  const executions = placed.marketId ? await runMarket(ctx, placed.marketId) : [];
  return { orderId: placed.orderId, status: await orderStatus(ctx.db, placed.orderId), executions };
}

async function orderStatus(db: Executor, orderId: string): Promise<string> {
  const o = (await db.execute<{ qty_original: number; qty_open: number; qty_pending: number; qty_filled: number; qty_cancelled: number; qty_expired: number }>(sql`
    SELECT qty_original, qty_open, qty_pending, qty_filled, qty_cancelled, qty_expired FROM orders WHERE id = ${orderId}`)).rows[0]!;
  if (o.qty_open > 0) return o.qty_filled > 0 || o.qty_pending > 0 ? "PARTIALLY_FILLED" : "OPEN";
  if (o.qty_pending > 0) return "IN_SETTLEMENT";
  if (o.qty_filled === o.qty_original) return "FILLED";
  if (o.qty_filled > 0) return "PARTIALLY_FILLED";
  return o.qty_expired > 0 && o.qty_cancelled === 0 ? "EXPIRED" : "CANCELLED";
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------
async function lockWallets(tx: Executor, userIds: string[]) {
  await tx.execute(sql`SELECT id FROM ledger_accounts WHERE owner_user_id = ANY(${pgArray([...new Set(userIds)])}::uuid[]) ORDER BY id FOR UPDATE`);
}

/**
 * One match in this market, or null. Holds the market lock; refuses while a
 * predecessor settlement is unresolved (BR-21, A-10).
 */
export async function matchOnce(tx: Executor, mode: AppMode, marketId: string, providerName = "demo"): Promise<{ executionId: string } | null> {
  const market = await lockMarketById(tx, marketId);
  if (market.status !== "OPEN") return null;
  const inflight = await tx.execute(sql`SELECT 1 FROM executions WHERE player_market_id = ${marketId} AND status IN ${OPEN_EXECUTION}`);
  if (inflight.rows.length) return null;
  const rows = (await tx.execute<{ id: string; user_id: string; side: "BUY" | "SELL"; limit_price_cents: string; priority_sequence: string; qty_open: number; card_ids: string[] | null }>(sql`
    SELECT o.id, o.user_id, o.side::text AS side, o.limit_price_cents, o.priority_sequence, o.qty_open,
           CASE WHEN o.side = 'SELL' THEN (SELECT array_agg(oc.card_id ORDER BY c.serial_number) FROM order_cards oc JOIN cards c ON c.id = oc.card_id WHERE oc.order_id = o.id AND oc.active) END AS card_ids
      FROM orders o
     WHERE o.player_market_id = ${marketId} AND o.state = 'ACTIVE' AND o.qty_open > 0 AND o.expires_at > now()`)).rows;
  const bookRows: RestingOrder[] = rows.map((r) => ({
    orderId: r.id, ownerKey: r.user_id, side: r.side, limitPrice: cents(Number(r.limit_price_cents)), sequence: Number(r.priority_sequence),
    openQuantity: r.qty_open, openCardIds: r.card_ids ?? undefined,
  }));
  const next = findNextMatch(bookRows);
  if (!next) return null;
  const buy = rows.find((r) => r.id === next.buyOrderId)!;
  const sell = rows.find((r) => r.id === next.sellOrderId)!;
  const limit = Number(buy.limit_price_cents);

  await lockWallets(tx, [buy.user_id, sell.user_id]);
  const orders = (await tx.execute<{ id: string; qty_open: number; settled_gross_cents: string; booked_commission_cents: string; commission_bps: number }>(sql`
    SELECT id, qty_open, settled_gross_cents, booked_commission_cents, commission_bps FROM orders WHERE id IN (${buy.id}, ${sell.id}) ORDER BY id FOR UPDATE`)).rows;
  if (orders.some((o) => o.qty_open < 1)) return null;
  const sellRow = orders.find((o) => o.id === sell.id)!;
  // The fee of this fill under the cumulative rule (BR-20). Fills of one sell
  // order settle one at a time per market, so the accumulator cannot move in between.
  const fill = applySettledFill({ settledGross: cents(Number(sellRow.settled_gross_cents)), bookedCommission: cents(Number(sellRow.booked_commission_cents)) }, next.price, sellRow.commission_bps);

  const executionId = randomUUID();
  await tx.execute(sql`
    INSERT INTO executions(id, player_market_id, buy_order_id, sell_order_id, card_id, buyer_user_id, seller_user_id, price_cents, buyer_limit_cents, fee_cents, status)
    VALUES (${executionId}, ${marketId}, ${buy.id}, ${sell.id}, ${next.cardId}, ${buy.user_id}, ${sell.user_id}, ${next.price}, ${limit}, ${fill.commission}, 'MATCHED')`);
  await tx.execute(sql`UPDATE orders SET qty_open = qty_open - 1, qty_pending = qty_pending + 1, version = version + 1 WHERE id IN (${buy.id}, ${sell.id})`);
  const hold = (await tx.execute<{ id: string }>(sql`SELECT id FROM cash_holds WHERE order_id = ${buy.id}`)).rows[0];
  if (!hold) throw new DomainError("INVARIANT_VIOLATION", { detail: `buy order ${buy.id} without hold` });
  await consumeHold(tx, hold.id, limit);
  await book(tx, mode, "trading", postings.executionPending(buy.user_id, executionId, limit));
  await tx.execute(sql`
    INSERT INTO settlement_operations(type, idempotency_key, execution_id, provider, amount_cents, status, user_id)
    VALUES ('SECONDARY_SETTLEMENT', ${`settlement:${executionId}`}, ${executionId}, ${providerName}, ${next.price}, 'CREATED', ${buy.user_id})`);
  return { executionId };
}

/** Submit (or replay with the same key) the settlement of one execution. */
export async function submitSettlement(ctx: PaymentsCtx, executionId: string): Promise<string> {
  const row = (await ctx.db.execute<{ op_id: string; key: string; op_status: string; processed: boolean; status: string; buyer: string; seller: string; price: string; fee: string; hold_id: string | null }>(sql`
    SELECT o.id AS op_id, o.idempotency_key AS key, o.status::text AS op_status, o.financially_processed_at IS NOT NULL AS processed,
           x.status::text AS status, x.buyer_user_id AS buyer, x.seller_user_id AS seller, x.price_cents AS price, x.fee_cents AS fee,
           (SELECT h.id FROM cash_holds h WHERE h.order_id = x.buy_order_id) AS hold_id
      FROM executions x JOIN settlement_operations o ON o.execution_id = x.id AND o.type = 'SECONDARY_SETTLEMENT'
     WHERE x.id = ${executionId}`)).rows[0];
  if (!row) throw new DomainError("INVARIANT_VIOLATION", { detail: "unknown execution" });
  if (row.processed) return row.status;
  await ctx.db.execute(sql`UPDATE executions SET status = 'SUBMISSION_PENDING', version = version + 1 WHERE id = ${executionId} AND status = 'MATCHED'`);
  let outcome: ProviderOutcome;
  try {
    outcome = await ctx.provider.settleSale({
      idempotencyKey: row.key,
      buyerHoldReference: `hold:${row.hold_id}`,
      buyerAccountRef: `user:${row.buyer}`,
      sellerAccountRef: `user:${row.seller}`,
      gross: Number(row.price),
      sellerNet: Number(row.price) - Number(row.fee),
      platformFee: Number(row.fee),
    });
  } catch (e) {
    // Unknown is pending, never failure (AT-21): no card moves, no money is released.
    await ctx.db.execute(sql`UPDATE settlement_operations SET status = 'UNKNOWN', attempts = attempts + 1, last_error = ${String(e)}, updated_at = now() WHERE id = ${row.op_id} AND financially_processed_at IS NULL`);
    return "SUBMISSION_PENDING";
  }
  await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE settlement_operations SET status = 'SUBMITTED', attempts = attempts + 1, updated_at = now(), provider_reference = coalesce(provider_reference, ${outcome.providerReference})
       WHERE id = ${row.op_id} AND financially_processed_at IS NULL AND status IN ('CREATED','UNKNOWN')`);
    await tx.execute(sql`UPDATE executions SET status = 'PROVIDER_PENDING', version = version + 1 WHERE id = ${executionId} AND status IN ('MATCHED','SUBMISSION_PENDING')`);
    await applyOperationOutcome(tx, ctx.mode, row.op_id, outcome);
  });
  return (await ctx.db.execute<{ status: string }>(sql`SELECT status::text AS status FROM executions WHERE id = ${executionId}`)).rows[0]!.status;
}

/**
 * Apply the provider's outcome of a secondary settlement. Called with the
 * operation row locked, exactly once per final outcome.
 */
export async function applySettlementOutcome(tx: Executor, mode: AppMode, op: { id: string; execution_id: string }, outcome: ProviderOutcome): Promise<"FINALISED" | "PENDING" | "UNCHANGED"> {
  const x = (await tx.execute<{ id: string; player_market_id: string; buy_order_id: string; sell_order_id: string; card_id: string; buyer_user_id: string; seller_user_id: string; price_cents: string; buyer_limit_cents: string; fee_cents: string; status: string }>(sql`
    SELECT id, player_market_id, buy_order_id, sell_order_id, card_id, buyer_user_id, seller_user_id, price_cents, buyer_limit_cents, fee_cents, status::text AS status
      FROM executions WHERE id = ${op.execution_id}`)).rows[0]!;
  if (outcome.status === "PENDING") {
    await tx.execute(sql`UPDATE executions SET status = 'PROVIDER_PENDING', version = version + 1 WHERE id = ${x.id} AND status IN ('MATCHED','SUBMISSION_PENDING')`);
    await tx.execute(sql`UPDATE settlement_operations SET status = 'PENDING', updated_at = now() WHERE id = ${op.id}`);
    return "PENDING";
  }
  if (outcome.status === "UNKNOWN") return "UNCHANGED";

  const price = Number(x.price_cents);
  const limit = Number(x.buyer_limit_cents);
  const fee = Number(x.fee_cents);
  // Lock order: market → wallets → orders → card.
  await lockMarketById(tx, x.player_market_id);
  await lockWallets(tx, [x.buyer_user_id, x.seller_user_id]);
  await tx.execute(sql`SELECT id FROM orders WHERE id IN (${x.buy_order_id}, ${x.sell_order_id}) ORDER BY id FOR UPDATE`);
  const holdId = (await tx.execute<{ id: string }>(sql`SELECT id FROM cash_holds WHERE order_id = ${x.buy_order_id}`)).rows[0]!.id;

  if (outcome.status === "SUCCEEDED") {
    await book(tx, mode, "trading", postings.executionSettled({ buyerId: x.buyer_user_id, sellerId: x.seller_user_id, executionId: x.id, limit, price, fee }));
    await transferOwnership(tx, { cardId: x.card_id, toUserId: x.buyer_user_id, costBasisCents: price, cause: "SECONDARY_SETTLEMENT", executionId: x.id });
    await tx.execute(sql`UPDATE orders SET qty_pending = qty_pending - 1, qty_filled = qty_filled + 1, version = version + 1 WHERE id = ${x.buy_order_id}`);
    await tx.execute(sql`
      UPDATE orders SET qty_pending = qty_pending - 1, qty_filled = qty_filled + 1,
             settled_gross_cents = settled_gross_cents + ${price}, booked_commission_cents = booked_commission_cents + ${fee}, version = version + 1
       WHERE id = ${x.sell_order_id}`);
    await tx.execute(sql`UPDATE executions SET status = 'SETTLED', settled_at = now(), version = version + 1 WHERE id = ${x.id}`);
    await closeIfDone(tx, [x.buy_order_id, x.sell_order_id]);
    await finaliseOp(tx, op.id, "SUCCEEDED", null);
    await notifyTrade(tx, x.buyer_user_id, "TRADE_BOUGHT", x.id, { executionId: x.id, priceCents: price });
    await notifyTrade(tx, x.seller_user_id, "TRADE_SOLD", x.id, { executionId: x.id, priceCents: price, feeCents: fee });
    await writeAudit(tx, { actorId: null, actorKind: "PROVIDER", action: "EXECUTION_SETTLED", entityType: "execution", entityId: x.id, related: { price, fee } });
    return "FINALISED";
  }

  // Definitive failure (AT-23): no card moves, no commission, money back to the reservation.
  await book(tx, mode, "trading", postings.executionFailed(x.buyer_user_id, x.id, limit));
  await restoreConsumed(tx, holdId, limit);
  for (const orderId of [x.buy_order_id, x.sell_order_id]) {
    const o = (await tx.execute<{ live: boolean; expired: boolean; side: string }>(sql`
      SELECT state = 'ACTIVE' AND qty_cancelled = 0 AND qty_expired = 0 AND expires_at > now() AS live, expires_at <= now() AS expired, side::text AS side
        FROM orders WHERE id = ${orderId}`)).rows[0]!;
    if (o.live) {
      // The order is still live: the card (or money) returns to its open part with its original priority.
      await tx.execute(sql`UPDATE orders SET qty_pending = qty_pending - 1, qty_open = qty_open + 1, version = version + 1 WHERE id = ${orderId}`);
    } else {
      await tx.execute(sql`
        UPDATE orders SET qty_pending = qty_pending - 1,
               qty_expired = qty_expired + ${o.expired ? 1 : 0}, qty_cancelled = qty_cancelled + ${o.expired ? 0 : 1}, version = version + 1
         WHERE id = ${orderId}`);
      if (o.side === "BUY") await releaseHold(tx, mode, holdId, limit, `fail:${x.id}`);
      else await tx.execute(sql`UPDATE order_cards SET active = false, released_at = now() WHERE order_id = ${orderId} AND card_id = ${x.card_id} AND active`);
    }
  }
  await tx.execute(sql`UPDATE executions SET status = 'FAILED', version = version + 1 WHERE id = ${x.id}`);
  await closeIfDone(tx, [x.buy_order_id, x.sell_order_id]);
  await finaliseOp(tx, op.id, "FAILED", outcome.reason);
  await writeAudit(tx, { actorId: null, actorKind: "PROVIDER", action: "EXECUTION_FAILED", reason: outcome.reason, entityType: "execution", entityId: x.id });
  return "FINALISED";
}

async function finaliseOp(tx: Executor, opId: string, status: "SUCCEEDED" | "FAILED", error: string | null) {
  await tx.execute(sql`
    UPDATE settlement_operations SET status = ${status}, financially_processed_at = now(), outcome_known_at = now(), last_error = ${error}, updated_at = now(), version = version + 1
     WHERE id = ${opId}`);
}

async function closeIfDone(tx: Executor, orderIds: string[]) {
  await tx.execute(sql`
    UPDATE orders SET state = 'CLOSED', closed_at = now(), version = version + 1
     WHERE id = ANY(${pgArray(orderIds)}::uuid[]) AND state = 'ACTIVE' AND qty_open = 0 AND qty_pending = 0`);
}

async function notifyTrade(tx: Executor, userId: string, template: string, executionId: string, payload: Record<string, unknown>) {
  await tx.execute(sql`
    INSERT INTO notification_outbox(user_id, template, channel, dedupe_key, payload)
    VALUES (${userId}, ${template}, 'IN_APP', ${`${template}:${executionId}`}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (dedupe_key) DO NOTHING`);
}

/** Match and settle in this market until nothing crosses or a settlement is still open. */
export async function runMarket(ctx: PaymentsCtx, marketId: string, maxSteps = 25): Promise<PlaceResult["executions"]> {
  const done: PlaceResult["executions"] = [];
  for (let i = 0; i < maxSteps; i++) {
    const m = await ctx.db.transaction((tx) => matchOnce(tx, ctx.mode, marketId, ctx.providerName));
    if (!m) break;
    const status = await submitSettlement(ctx, m.executionId);
    const price = (await ctx.db.execute<{ p: string }>(sql`SELECT price_cents p FROM executions WHERE id = ${m.executionId}`)).rows[0]!.p;
    done.push({ executionId: m.executionId, status, priceCents: Number(price) });
    // Stop after a failure too: the worker tries again in its next cycle, so a
    // failing pair cannot spin here.
    if (status !== "SETTLED") break;
  }
  return done;
}

/** Continue a market after a settlement outcome came in (webhook or poll). */
export async function continueAfterOperation(ctx: PaymentsCtx, opId: string): Promise<void> {
  const r = (await ctx.db.execute<{ market: string }>(sql`
    SELECT x.player_market_id AS market FROM settlement_operations o JOIN executions x ON x.id = o.execution_id WHERE o.id = ${opId} AND o.type = 'SECONDARY_SETTLEMENT'`)).rows[0];
  if (r) await runMarket(ctx, r.market);
}

// ---------------------------------------------------------------------------
// Cancel and expire
// ---------------------------------------------------------------------------
async function closeRemainder(tx: Executor, mode: AppMode, orderId: string, kind: "cancel" | "expire"): Promise<number> {
  const o = (await tx.execute<{ id: string; side: string; user_id: string; limit_price_cents: string; qty_open: number; state: string; expired: boolean }>(sql`
    SELECT id, side::text AS side, user_id, limit_price_cents, qty_open, state::text AS state, expires_at <= now() AS expired FROM orders WHERE id = ${orderId} FOR UPDATE`)).rows[0]!;
  if (o.state !== "ACTIVE" || o.qty_open === 0) return 0;
  if (kind === "expire" && !o.expired) return 0;
  const open = o.qty_open;
  // Only the free remainder; the part in settlement stays (AT-19).
  await tx.execute(sql`
    UPDATE orders SET qty_open = 0,
           qty_cancelled = qty_cancelled + ${kind === "cancel" ? open : 0}, qty_expired = qty_expired + ${kind === "expire" ? open : 0}, version = version + 1
     WHERE id = ${orderId}`);
  if (o.side === "BUY") {
    const hold = (await tx.execute<{ id: string }>(sql`SELECT id FROM cash_holds WHERE order_id = ${orderId}`)).rows[0]!;
    await releaseHold(tx, mode, hold.id, open * Number(o.limit_price_cents), `${kind}:${orderId}`);
  } else {
    await tx.execute(sql`
      UPDATE order_cards SET active = false, released_at = now()
       WHERE order_id = ${orderId} AND active
         AND card_id NOT IN (SELECT card_id FROM executions WHERE sell_order_id = ${orderId} AND status IN ${OPEN_EXECUTION})`);
  }
  await closeIfDone(tx, [orderId]);
  return open;
}

export async function cancelOrder(ctx: PaymentsCtx, userId: string, orderId: string): Promise<{ cancelled: number; status: string }> {
  await assertAllowed(ctx.db, userId, "CANCEL_ORDER", ctx.mode);
  if (!/^[0-9a-f-]{36}$/.test(orderId)) throw new DomainError("ACTION_NOT_ALLOWED");
  const o = (await ctx.db.execute<{ user_id: string; player_market_id: string }>(sql`SELECT user_id, player_market_id FROM orders WHERE id = ${orderId}`)).rows[0];
  if (!o || o.user_id !== userId) throw new DomainError("ACTION_NOT_ALLOWED");
  const cancelled = await ctx.db.transaction(async (tx) => {
    await lockMarketById(tx, o.player_market_id);
    await lockWallets(tx, [userId]);
    const n = await closeRemainder(tx, ctx.mode, orderId, "cancel");
    if (n === 0) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Deze order heeft geen vrij restant meer om te annuleren." });
    await writeAudit(tx, { actorId: userId, actorKind: "USER", action: "ORDER_CANCELLED", entityType: "order", entityId: orderId, related: { quantity: n } });
    return n;
  });
  return { cancelled, status: await orderStatus(ctx.db, orderId) };
}

/** Worker job: expire free remainders whose time is up (BR-14, AT-20). */
export async function expireOrders(ctx: PaymentsCtx, limit = 200): Promise<number> {
  const due = (await ctx.db.execute<{ id: string; player_market_id: string; user_id: string }>(sql`
    SELECT id, player_market_id, user_id FROM orders WHERE state = 'ACTIVE' AND qty_open > 0 AND expires_at <= now() ORDER BY expires_at LIMIT ${limit}`)).rows;
  let n = 0;
  for (const o of due) {
    n += await ctx.db.transaction(async (tx) => {
      await lockMarketById(tx, o.player_market_id);
      await lockWallets(tx, [o.user_id]);
      const k = await closeRemainder(tx, ctx.mode, o.id, "expire");
      if (k) await writeAudit(tx, { actorId: null, actorKind: "SYSTEM", action: "ORDER_EXPIRED", entityType: "order", entityId: o.id, related: { quantity: k } });
      return k;
    });
  }
  return n;
}

/** Worker job: markets whose book crosses and that have no settlement in flight. */
export async function marketsToMatch(db: Executor): Promise<string[]> {
  return (await db.execute<{ id: string }>(sql`
    SELECT pm.id FROM player_markets pm
     WHERE pm.status = 'OPEN'
       AND NOT EXISTS (SELECT 1 FROM executions x WHERE x.player_market_id = pm.id AND x.status IN ${OPEN_EXECUTION})
       AND (SELECT max(limit_price_cents) FROM orders WHERE player_market_id = pm.id AND side = 'BUY' AND state = 'ACTIVE' AND qty_open > 0 AND expires_at > now())
        >= (SELECT min(limit_price_cents) FROM orders WHERE player_market_id = pm.id AND side = 'SELL' AND state = 'ACTIVE' AND qty_open > 0 AND expires_at > now())`)).rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export type BookLevelRow = { player_id: string; side: "BUY" | "SELL"; price: string; quantity: number };

/** Aggregated open orders per player and price; never identities (BR-17). */
export async function orderBookLevels(db: Executor, playerId?: string): Promise<BookLevelRow[]> {
  const filter = playerId ? sql`AND pm.player_id = ${playerId}` : sql``;
  return (await db.execute<BookLevelRow>(sql`
    SELECT pm.player_id, o.side::text AS side, o.limit_price_cents AS price, sum(o.qty_open)::int AS quantity
      FROM orders o JOIN player_markets pm ON pm.id = o.player_market_id
     WHERE o.state = 'ACTIVE' AND o.qty_open > 0 AND o.expires_at > now() AND pm.status = 'OPEN' ${filter}
     GROUP BY pm.player_id, o.side, o.limit_price_cents
     ORDER BY pm.player_id, o.side, CASE WHEN o.side = 'BUY' THEN -o.limit_price_cents ELSE o.limit_price_cents END`)).rows;
}

export async function lastTrades(db: Executor): Promise<Map<string, { price: number; at: Date }>> {
  const r = await db.execute<{ player_id: string; price_cents: string; settled_at: string }>(sql`
    SELECT DISTINCT ON (pm.player_id) pm.player_id, x.price_cents, x.settled_at::text
      FROM executions x JOIN player_markets pm ON pm.id = x.player_market_id
     WHERE x.status = 'SETTLED' ORDER BY pm.player_id, x.settled_at DESC`);
  return new Map(r.rows.map((x) => [x.player_id, { price: Number(x.price_cents), at: new Date(x.settled_at) }]));
}

export type UserTradeRow = {
  id: string; player_id: string; kind: "BUY" | "SELL" | "OPENING" | "PRIMARY"; price_cents: string | null; fee_cents: string | null;
  status: string; at: string; serial: number;
};

/**
 * The user's card movements: executions as buyer or seller (also while in
 * settlement), plus opening-balance deliveries from before the platform.
 */
export async function tradesForUser(db: Executor, userId: string, limit = 100): Promise<UserTradeRow[]> {
  return (await db.execute<UserTradeRow>(sql`
    SELECT * FROM (
      SELECT x.id, pm.player_id, CASE WHEN x.buyer_user_id = ${userId} THEN 'BUY' ELSE 'SELL' END AS kind,
             x.price_cents::text, CASE WHEN x.seller_user_id = ${userId} THEN x.fee_cents::text END AS fee_cents,
             x.status::text AS status, coalesce(x.settled_at, x.matched_at)::text AS at, c.serial_number AS serial
        FROM executions x JOIN player_markets pm ON pm.id = x.player_market_id JOIN cards c ON c.id = x.card_id
       WHERE (x.buyer_user_id = ${userId} OR x.seller_user_id = ${userId})
      UNION ALL
      SELECT e.id, ed.player_id, CASE WHEN e.cause = 'OPENING_BALANCE' THEN 'OPENING' ELSE 'PRIMARY' END,
             e.cost_basis_cents::text, NULL, 'SETTLED', e.occurred_at::text, c.serial_number
        FROM ownership_events e JOIN cards c ON c.id = e.card_id JOIN editions ed ON ed.id = c.edition_id
       WHERE e.new_owner_id = ${userId} AND e.cause IN ('OPENING_BALANCE','PRIMARY_DELIVERY')
    ) t ORDER BY at DESC LIMIT ${limit}`)).rows;
}

/** Structural trading invariants (docs/09). All counts must be zero. */
export async function tradingInvariants(db: Executor) {
  const r = (await db.execute<{ qty: number; inflight: number; settled_owner: number; holds: number; cards: number }>(sql`
    SELECT
      (SELECT count(*) FROM orders WHERE qty_open + qty_pending + qty_filled + qty_cancelled + qty_expired <> qty_original)::int AS qty,
      (SELECT count(*) FROM (SELECT player_market_id FROM executions WHERE status IN ${OPEN_EXECUTION} GROUP BY 1 HAVING count(*) > 1) x)::int AS inflight,
      (SELECT count(*) FROM executions x JOIN cards c ON c.id = x.card_id
        WHERE x.status = 'SETTLED' AND NOT EXISTS (SELECT 1 FROM ownership_events e WHERE e.execution_id = x.id AND e.new_owner_id = x.buyer_user_id))::int AS settled_owner,
      (SELECT count(*) FROM orders o JOIN cash_holds h ON h.order_id = o.id
        WHERE o.side = 'BUY' AND h.confirmed_amount_cents - h.consumed_amount_cents - h.released_amount_cents <> o.qty_open * o.limit_price_cents)::int AS holds,
      (SELECT count(*) FROM orders o
        WHERE o.side = 'SELL' AND o.state = 'ACTIVE'
          AND (SELECT count(*) FROM order_cards oc WHERE oc.order_id = o.id AND oc.active) <> o.qty_open + o.qty_pending)::int AS cards`)).rows[0]!;
  return { quantitiesNotAddingUp: r.qty, marketsWithTwoSettlements: r.inflight, settledWithoutDelivery: r.settled_owner, buyHoldsNotMatchingOpen: r.holds, sellCardsNotMatchingOrder: r.cards };
}

/** Admin: recent executions with status, no customer contact details. */
export async function listExecutions(db: Executor, limit = 50) {
  return (await db.execute<{ id: string; player_name: string; status: string; price_cents: string; fee_cents: string | null; buyer: string | null; seller: string | null; matched_at: string; settled_at: string | null; op_status: string | null; attempts: number | null }>(sql`
    SELECT x.id, p.display_name AS player_name, x.status::text AS status, x.price_cents, x.fee_cents,
           bu.display_name AS buyer, se.display_name AS seller, x.matched_at::text, x.settled_at::text, o.status::text AS op_status, o.attempts
      FROM executions x
      JOIN player_markets pm ON pm.id = x.player_market_id JOIN players p ON p.id = pm.player_id
      LEFT JOIN user_profiles bu ON bu.user_id = x.buyer_user_id LEFT JOIN user_profiles se ON se.user_id = x.seller_user_id
      LEFT JOIN settlement_operations o ON o.execution_id = x.id AND o.type = 'SECONDARY_SETTLEMENT'
     ORDER BY (x.status IN ('SETTLED','FAILED')), x.matched_at DESC LIMIT ${limit}`)).rows;
}

export async function tradingStats(db: Executor) {
  return (await db.execute<{ open_orders: number; open_buy_cards: number; open_sell_cards: number; settled_24h: number; volume_24h: string; fees_24h: string }>(sql`
    SELECT (SELECT count(*) FROM orders WHERE state = 'ACTIVE' AND qty_open > 0)::int AS open_orders,
           (SELECT coalesce(sum(qty_open), 0) FROM orders WHERE state = 'ACTIVE' AND side = 'BUY')::int AS open_buy_cards,
           (SELECT coalesce(sum(qty_open), 0) FROM orders WHERE state = 'ACTIVE' AND side = 'SELL')::int AS open_sell_cards,
           (SELECT count(*) FROM executions WHERE status = 'SETTLED' AND settled_at > now() - interval '24 hours')::int AS settled_24h,
           (SELECT coalesce(sum(price_cents), 0) FROM executions WHERE status = 'SETTLED' AND settled_at > now() - interval '24 hours')::text AS volume_24h,
           (SELECT coalesce(sum(fee_cents), 0) FROM executions WHERE status = 'SETTLED' AND settled_at > now() - interval '24 hours')::text AS fees_24h`)).rows[0]!;
}
