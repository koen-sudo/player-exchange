/**
 * Primary issuance: drops, subscriptions, allocation and delivery (fase 6,
 * BR-09..BR-12, UX-04/05, AT-24..AT-27, AT-30).
 *
 * Life of a drop:
 *   DRAFT ─(four-eyes)→ PUBLISHED ─(opens_at)→ OPEN ─(closes_at)→ CLOSED
 *   → SETTLING (snapshot, ranking, allocations) → COMPLETED
 *
 * - Cards are created within the published programme when the drop is
 *   published; they wait as IN_DROP until delivered (or become UNSOLD).
 * - The random seed is generated at publication and stored encrypted; only
 *   its SHA-256 commitment is visible before opening. It is revealed after
 *   the drawing so anyone can verify the ranking.
 * - A subscription counts only when its reservation is confirmed before
 *   closing (BR-10). Holds and ledger postings share one transaction.
 * - The snapshot (participants + ranking) is written once; a retry reuses it.
 * - Waitlist: only a definitive settlement failure frees a card for the next
 *   candidate; an uncertain outcome keeps the card held (AT-26, AT-27).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  allocate,
  assertValidLimitPrice,
  assertWithinPositionLimit,
  cents,
  decideAction,
  DomainError,
  generateSeed,
  nextWaitlistCandidate,
  seasonKeyFor,
  seedCommitment,
} from "@px/domain";
import type { ProviderOutcome } from "@px/integrations";
import type { Db, Executor } from "./client.ts";
import { consumeApproval, requestApproval } from "./approvals.ts";
import { consumeHold, createHold, releaseHold, restoreConsumed } from "./holds.ts";
import { admissionFacts, requirePermission, writeAudit, type AppMode, type Identity } from "./identity.ts";
import { ensureEdition, mintCards, pgArray, transferOwnership } from "./inventory.ts";
import { book, postings } from "./ledger.ts";
import { applyOperationOutcome, assertAllowed, type PaymentsCtx } from "./payments.ts";

type Actor = Pick<Identity, "id" | "permissions">;
export type IssuanceCtx = PaymentsCtx & { seedKey: Buffer };
const LIVE_ALLOCATION = sql`('ALLOCATED','SETTLEMENT_PENDING','DELIVERED','MANUAL_REVIEW')`;
export const WAITLIST_HOURS = 24;

// ---------------------------------------------------------------------------
// Seed protection (standard AES-256-GCM, key from configuration)
// ---------------------------------------------------------------------------
export function parseSeedKey(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("DROP_SEED_KEY moet 64 hexadecimale tekens (256 bit) zijn");
  return Buffer.from(hex, "hex");
}

function encryptSeed(key: Buffer, seed: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(seed), c.final()]);
  return { ct, iv, tag: c.getAuthTag() };
}

function decryptSeed(key: Buffer, ct: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

async function protectSeed(tx: Executor, key: Buffer, dropId: string) {
  const seed = generateSeed();
  const e = encryptSeed(key, seed);
  await tx.execute(sql`
    UPDATE drops SET seed_commitment = ${seedCommitment(seed)}, seed_ciphertext = ${e.ct}, seed_iv = ${e.iv}, seed_tag = ${e.tag}
     WHERE id = ${dropId} AND seed_commitment IS NULL`);
}

// ---------------------------------------------------------------------------
// Admin: propose, publish, change price
// ---------------------------------------------------------------------------
type DropRow = {
  id: string; edition_id: string; player_id: string; price_cents: string; quantity: number; max_per_user: number; status: string;
  opens_at: string; closes_at: string; seed_commitment: string | null; seed_ciphertext: Buffer | null; seed_iv: Buffer | null; seed_tag: Buffer | null;
  allocated_at: string | null; waitlist_until: string | null; is_open_now: boolean; is_closed_now: boolean;
};

async function lockDrop(tx: Executor, dropId: string, mode: "update" | "share" = "update"): Promise<DropRow | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(dropId)) return undefined;
  return (await tx.execute<DropRow>(sql`
    SELECT d.id, d.edition_id, e.player_id, d.price_cents, d.quantity, d.max_per_user, d.status::text AS status, d.opens_at::text, d.closes_at::text,
           d.seed_commitment, d.seed_ciphertext, d.seed_iv, d.seed_tag, d.allocated_at::text, d.waitlist_until::text,
           now() >= d.opens_at AS is_open_now, now() >= d.closes_at AS is_closed_now
      FROM drops d JOIN editions e ON e.id = d.edition_id WHERE d.id = ${dropId}
      ${mode === "update" ? sql`FOR UPDATE OF d` : sql`FOR SHARE OF d`}`)).rows[0];
}

const dropPayload = (d: { id: string; player_id: string; price_cents: string | number; quantity: number; opens_at: string; closes_at: string }) => ({
  dropId: d.id, playerId: d.player_id, priceCents: Number(d.price_cents), quantity: d.quantity,
  opensAt: new Date(d.opens_at).toISOString(), closesAt: new Date(d.closes_at).toISOString(),
});

/** Remaining cards the published programme still allows for this edition. */
async function programmeRoom(tx: Executor, editionId: string): Promise<number> {
  const r = (await tx.execute<{ planned: number | null; hi: number }>(sql`
    SELECT (SELECT planned_total FROM issuance_programs WHERE edition_id = ${editionId} AND status = 'PUBLISHED') AS planned,
           (SELECT coalesce(max(serial_number), 0) FROM cards WHERE edition_id = ${editionId})::int AS hi`)).rows[0]!;
  return r.planned === null ? -1 : r.planned - r.hi;
}

export async function proposeDrop(db: Db, actor: Actor, input: { playerId: string; priceCents: number; quantity: number; opensAt: Date; closesAt: Date; reason: string }): Promise<{ dropId: string; approvalId: string }> {
  requirePermission(actor, "issuance.prepare");
  assertValidLimitPrice(cents(input.priceCents));
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 500) throw new DomainError("QUANTITY_INVALID");
  if (!(input.opensAt < input.closesAt)) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "De sluiting moet na de opening liggen." });
  if (input.opensAt.getTime() <= Date.now()) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "De opening moet in de toekomst liggen." });
  return db.transaction(async (tx) => {
    const p = (await tx.execute<{ career_status: string; primary_admission: string; market_status: string | null }>(sql`
      SELECT p.career_status::text, p.primary_admission::text, pm.status::text AS market_status
        FROM players p LEFT JOIN player_markets pm ON pm.player_id = p.id WHERE p.id = ${input.playerId}`)).rows[0];
    if (!p) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Onbekende speler." });
    // AT-30: no new primary issuance for a retired player; admission must be approved.
    if (p.career_status !== "ACTIVE") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Deze speler is niet (meer) actief; er komt geen nieuwe uitgifte." });
    if (p.primary_admission !== "APPROVED") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Deze speler is niet toegelaten tot primaire uitgifte." });
    if (p.market_status === "CLOSED") throw new DomainError("MARKET_NOT_OPEN");
    const editionId = await ensureEdition(tx, input.playerId, seasonKeyFor(input.opensAt));
    const room = await programmeRoom(tx, editionId);
    if (room < 0) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Er is geen gepubliceerd uitgifteprogramma voor dit seizoen." });
    const reserved = (await tx.execute<{ n: number }>(sql`SELECT coalesce(sum(quantity), 0)::int n FROM drops WHERE edition_id = ${editionId} AND status = 'DRAFT'`)).rows[0]!.n;
    if (input.quantity > room - reserved) throw new DomainError("EDITION_CAP_EXCEEDED", { userMessage: `Het programma laat nog ${Math.max(0, room - reserved)} kaarten toe.` });
    const d = (await tx.execute<{ id: string; opens_at: string; closes_at: string }>(sql`
      INSERT INTO drops(edition_id, round, price_cents, quantity, max_per_user, publishes_at, opens_at, closes_at, status, created_by)
      VALUES (${editionId}, 1, ${input.priceCents}, ${input.quantity}, 1, now(), ${input.opensAt.toISOString()}::timestamptz, ${input.closesAt.toISOString()}::timestamptz, 'DRAFT', ${actor.id})
      RETURNING id, opens_at::text, closes_at::text`)).rows[0]!;
    const approvalId = await requestApproval(tx, actor, {
      action: "PUBLISH_DROP",
      payload: dropPayload({ id: d.id, player_id: input.playerId, price_cents: input.priceCents, quantity: input.quantity, opens_at: d.opens_at, closes_at: d.closes_at }),
      reason: input.reason,
    });
    return { dropId: d.id, approvalId };
  });
}

/** Publish with a matching, approved request: cards are created and the seed commitment is fixed. */
export async function publishDrop(ctx: IssuanceCtx, actor: Actor, input: { dropId: string; approvalId: string }): Promise<void> {
  requirePermission(actor, "issuance.prepare");
  await ctx.db.transaction(async (tx) => {
    const d = await lockDrop(tx, input.dropId);
    if (!d || d.status !== "DRAFT") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Deze uitgifte is geen concept meer." });
    if (d.is_open_now) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Het openingsmoment is al verstreken; maak een nieuwe uitgifte." });
    await consumeApproval(tx, actor.id, input.approvalId, "PUBLISH_DROP", dropPayload(d));
    const cards = await mintCards(tx, d.edition_id, d.quantity);
    await tx.execute(sql`UPDATE cards SET status = 'IN_DROP' WHERE id = ANY(${pgArray(cards.map((c) => c.id))}::uuid[])`);
    await tx.execute(sql`INSERT INTO drop_cards(drop_id, card_id) SELECT ${d.id}, unnest(${pgArray(cards.map((c) => c.id))}::uuid[])`);
    await protectSeed(tx, ctx.seedKey, d.id);
    await tx.execute(sql`UPDATE drops SET status = 'PUBLISHED', published_at = now(), publishes_at = now(), approval_id = ${input.approvalId}, version = version + 1 WHERE id = ${d.id}`);
    await writeAudit(tx, { actorId: actor.id, actorKind: "ADMIN", action: "DROP_PUBLISHED", reason: `Gepubliceerd met goedkeuring ${input.approvalId}`, entityType: "drop", entityId: d.id, related: { ...dropPayload(d), approvalId: input.approvalId } });
  });
}

/** V-01a: the price may change in either direction until opening, always with a second person's approval. */
export async function requestDropPriceChange(db: Db, actor: Actor, input: { dropId: string; newPriceCents: number; reason: string }): Promise<string> {
  requirePermission(actor, "issuance.prepare");
  assertValidLimitPrice(cents(input.newPriceCents));
  const d = (await db.execute<{ status: string; price_cents: string; started: boolean }>(sql`SELECT status::text, price_cents, now() >= opens_at AS started FROM drops WHERE id = ${input.dropId}`)).rows[0];
  if (!d || d.status !== "PUBLISHED" || d.started) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "De prijs kan alleen tussen publicatie en opening wijzigen." });
  if (Number(d.price_cents) === input.newPriceCents) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Dit is al de huidige prijs." });
  return requestApproval(db, actor, { action: "CHANGE_DROP_PRICE", payload: { dropId: input.dropId, oldPriceCents: Number(d.price_cents), newPriceCents: input.newPriceCents }, reason: input.reason });
}

export async function applyDropPriceChange(db: Db, actor: Actor, input: { dropId: string; approvalId: string; newPriceCents: number }): Promise<void> {
  requirePermission(actor, "issuance.prepare");
  await db.transaction(async (tx) => {
    const d = await lockDrop(tx, input.dropId);
    if (!d || d.status !== "PUBLISHED" || d.is_open_now) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "De prijs kan alleen tussen publicatie en opening wijzigen." });
    // The approval names the old price: if the price moved meanwhile, it no longer matches (AT-34).
    await consumeApproval(tx, actor.id, input.approvalId, "CHANGE_DROP_PRICE", { dropId: d.id, oldPriceCents: Number(d.price_cents), newPriceCents: input.newPriceCents });
    await tx.execute(sql`UPDATE drops SET price_cents = ${input.newPriceCents}, version = version + 1 WHERE id = ${d.id}`);
    await tx.execute(sql`
      INSERT INTO drop_price_changes(drop_id, old_price_cents, new_price_cents, approval_id, changed_by)
      VALUES (${d.id}, ${d.price_cents}, ${input.newPriceCents}, ${input.approvalId}, ${actor.id})`);
    await writeAudit(tx, { actorId: actor.id, actorKind: "ADMIN", action: "DROP_PRICE_CHANGED", reason: `Prijswijziging met goedkeuring ${input.approvalId}`, entityType: "drop", entityId: d.id, related: { from: Number(d.price_cents), to: input.newPriceCents, approvalId: input.approvalId } });
  });
}

// ---------------------------------------------------------------------------
// Schedule: commitments, opening
// ---------------------------------------------------------------------------
/** Published drops (e.g. from the demo seed) get their seed commitment before opening. */
export async function ensureCommitments(ctx: IssuanceCtx): Promise<number> {
  const due = (await ctx.db.execute<{ id: string }>(sql`SELECT id FROM drops WHERE status = 'PUBLISHED' AND seed_commitment IS NULL`)).rows;
  for (const d of due) await ctx.db.transaction((tx) => protectSeed(tx, ctx.seedKey, d.id));
  return due.length;
}

/** Open drops whose time has come; the price is fixed at that moment. */
export async function openDueDrops(ctx: IssuanceCtx): Promise<number> {
  const r = await ctx.db.execute(sql`
    UPDATE drops SET status = 'OPEN', price_fixed_at = now(), version = version + 1
     WHERE status = 'PUBLISHED' AND opens_at <= now() AND closes_at > now() AND seed_commitment IS NOT NULL
     RETURNING id`);
  for (const row of r.rows as { id: string }[]) {
    await writeAudit(ctx.db, { actorId: null, actorKind: "SYSTEM", action: "DROP_OPENED", entityType: "drop", entityId: row.id });
  }
  return r.rows.length;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------
export async function subscribe(ctx: IssuanceCtx, userId: string, input: { dropId: string; requestKey: string }): Promise<{ subscriptionId: string; status: string }> {
  await assertAllowed(ctx.db, userId, "SUBSCRIBE", ctx.mode);
  const endpoint = "POST /subscriptions";
  const id = await ctx.db.transaction(async (tx) => {
    const ins = await tx.execute(sql`
      INSERT INTO idempotency_requests(actor_id, endpoint, key, request_hash) VALUES (${userId}, ${endpoint}, ${input.requestKey}, ${input.dropId})
      ON CONFLICT DO NOTHING RETURNING key`);
    if (!ins.rows.length) {
      const prior = (await tx.execute<{ request_hash: string; response_body: { subscriptionId?: string } | null }>(sql`
        SELECT request_hash, response_body FROM idempotency_requests WHERE actor_id = ${userId} AND endpoint = ${endpoint} AND key = ${input.requestKey}`)).rows[0]!;
      if (prior.request_hash !== input.dropId) throw new DomainError("IDEMPOTENCY_CONFLICT");
      return prior.response_body!.subscriptionId!;
    }
    // Share lock: many may subscribe at once; closing waits until they are done.
    const d = await lockDrop(tx, input.dropId, "share");
    if (!d || d.status !== "OPEN" || d.is_closed_now) throw new DomainError("DROP_NOT_OPEN");
    const existing = (await tx.execute<{ status: string }>(sql`SELECT status::text FROM subscriptions WHERE drop_id = ${d.id} AND user_id = ${userId}`)).rows[0];
    if (existing) {
      throw new DomainError("SUBSCRIPTION_EXISTS", existing.status === "CANCELLED" ? { userMessage: "Je hebt je voor deze uitgifte al eens ingeschreven en weer afgemeld. Opnieuw inschrijven kan niet." } : {});
    }
    // Position limit counts this reservation too (BR-18).
    const e = (await tx.execute<{ held: number; open_buys: number; pending_buys: number; subs: number; issued: number }>(sql`
      SELECT
        (SELECT count(*) FROM cards c WHERE c.player_id = ${d.player_id} AND c.owner_user_id = ${userId} AND c.status = 'OWNED')::int AS held,
        (SELECT coalesce(sum(o.qty_open), 0) FROM orders o JOIN player_markets pm ON pm.id = o.player_market_id WHERE pm.player_id = ${d.player_id} AND o.user_id = ${userId} AND o.side = 'BUY' AND o.state = 'ACTIVE')::int AS open_buys,
        (SELECT coalesce(sum(o.qty_pending), 0) FROM orders o JOIN player_markets pm ON pm.id = o.player_market_id WHERE pm.player_id = ${d.player_id} AND o.user_id = ${userId} AND o.side = 'BUY')::int AS pending_buys,
        (SELECT coalesce(sum(s.quantity), 0) FROM subscriptions s JOIN drops dd ON dd.id = s.drop_id JOIN editions ee ON ee.id = dd.edition_id
          WHERE ee.player_id = ${d.player_id} AND s.user_id = ${userId} AND s.status IN ('RESERVATION_PENDING','CONFIRMED','WAITLISTED','ALLOCATED')
            AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.subscription_id = s.id AND a.status = 'DELIVERED'))::int AS subs,
        (SELECT count(*) FROM cards c WHERE c.player_id = ${d.player_id} AND c.status = 'OWNED')::int AS issued`)).rows[0]!;
    assertWithinPositionLimit({ held: e.held, openBuyQuantity: e.open_buys, buyPendingSettlement: e.pending_buys, reservedSubscriptions: e.subs }, 1, e.issued);
    const price = Number(d.price_cents);
    const sub = (await tx.execute<{ id: string }>(sql`
      INSERT INTO subscriptions(drop_id, user_id, quantity, status, price_cents) VALUES (${d.id}, ${userId}, 1, 'RESERVATION_PENDING', ${price}) RETURNING id`)).rows[0]!;
    const holdId = await createHold(tx, ctx.mode, { userId, purpose: "SUBSCRIPTION", subscriptionId: sub.id, amount: price });
    // Confirmed only while still open (BR-10); the share lock keeps closing out.
    const ok = await tx.execute(sql`
      UPDATE subscriptions SET hold_id = ${holdId}, status = 'CONFIRMED', confirmed_at = now(), version = version + 1
       WHERE id = ${sub.id} AND now() < ${d.closes_at}::timestamptz RETURNING id`);
    if (!ok.rows.length) throw new DomainError("DROP_NOT_OPEN");
    await writeAudit(tx, { actorId: userId, actorKind: "USER", action: "SUBSCRIBED", entityType: "subscription", entityId: sub.id, related: { dropId: d.id, price } });
    await tx.execute(sql`
      UPDATE idempotency_requests SET response_status = 200, response_body = ${JSON.stringify({ subscriptionId: sub.id })}::jsonb
       WHERE actor_id = ${userId} AND endpoint = ${endpoint} AND key = ${input.requestKey}`);
    return sub.id;
  });
  return { subscriptionId: id, status: (await ctx.db.execute<{ s: string }>(sql`SELECT status::text s FROM subscriptions WHERE id = ${id}`)).rows[0]!.s };
}

/** Withdraw a subscription before closing; the reservation is released. */
export async function cancelSubscription(ctx: IssuanceCtx, userId: string, subscriptionId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(subscriptionId)) throw new DomainError("ACTION_NOT_ALLOWED");
  const s = (await ctx.db.execute<{ drop_id: string; user_id: string }>(sql`SELECT drop_id, user_id FROM subscriptions WHERE id = ${subscriptionId}`)).rows[0];
  if (!s || s.user_id !== userId) throw new DomainError("ACTION_NOT_ALLOWED");
  await ctx.db.transaction(async (tx) => {
    const d = await lockDrop(tx, s.drop_id, "share");
    if (!d || d.status !== "OPEN" || d.is_closed_now) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Afmelden kan alleen zolang de inschrijving open is." });
    const sub = (await tx.execute<{ status: string; hold_id: string | null; price_cents: string }>(sql`SELECT status::text, hold_id, price_cents FROM subscriptions WHERE id = ${subscriptionId} FOR UPDATE`)).rows[0]!;
    if (sub.status !== "CONFIRMED") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Deze inschrijving kan niet meer worden afgemeld." });
    if (sub.hold_id) await releaseHold(tx, ctx.mode, sub.hold_id, Number(sub.price_cents), `unsubscribe:${subscriptionId}`);
    await tx.execute(sql`UPDATE subscriptions SET status = 'CANCELLED', cancelled_at = now(), outcome_at = now(), version = version + 1 WHERE id = ${subscriptionId}`);
    await writeAudit(tx, { actorId: userId, actorKind: "USER", action: "SUBSCRIPTION_CANCELLED", entityType: "subscription", entityId: subscriptionId });
  });
}

// ---------------------------------------------------------------------------
// Closing and allocation
// ---------------------------------------------------------------------------
async function releaseSubscription(tx: Executor, mode: AppMode, subId: string, status: "NOT_ALLOCATED" | "INVALID_LATE", key: string) {
  const s = (await tx.execute<{ hold_id: string | null }>(sql`SELECT hold_id FROM subscriptions WHERE id = ${subId}`)).rows[0]!;
  if (s.hold_id) {
    const open = (await tx.execute<{ open: string }>(sql`
      SELECT confirmed_amount_cents - consumed_amount_cents - released_amount_cents AS open FROM cash_holds WHERE id = ${s.hold_id}`)).rows[0]!;
    if (Number(open.open) > 0) await releaseHold(tx, mode, s.hold_id, Number(open.open), key);
  }
  await tx.execute(sql`UPDATE subscriptions SET status = ${status}, outcome_at = now(), version = version + 1 WHERE id = ${subId}`);
  await tx.execute(sql`
    INSERT INTO notification_outbox(user_id, template, channel, dedupe_key, payload)
    SELECT user_id, ${status === "INVALID_LATE" ? "SUBSCRIPTION_LATE" : "SUBSCRIPTION_NOT_ALLOCATED"}, 'IN_APP', ${`subscription:${subId}:outcome`}, jsonb_build_object('dropId', drop_id)
      FROM subscriptions WHERE id = ${subId}
    ON CONFLICT (dedupe_key) DO NOTHING`);
}

async function startAllocation(tx: Executor, mode: AppMode, providerName: string, input: { dropId: string; subscriptionId: string; userId: string; holdId: string; cardId: string; rank: number; price: number; promotedFrom?: string }) {
  const a = (await tx.execute<{ id: string }>(sql`
    INSERT INTO allocations(drop_id, rank, subscription_id, card_id, status, algorithm_version, price_cents, promoted_from)
    VALUES (${input.dropId}, ${input.rank}, ${input.subscriptionId}, ${input.cardId}, 'ALLOCATED', 'alloc-v1', ${input.price}, ${input.promotedFrom ?? null})
    RETURNING id`)).rows[0]!;
  await tx.execute(sql`UPDATE subscriptions SET status = 'ALLOCATED', version = version + 1 WHERE id = ${input.subscriptionId}`);
  await tx.execute(sql`UPDATE cards SET status = 'ALLOCATED_PENDING', version = version + 1 WHERE id = ${input.cardId}`);
  await consumeHold(tx, input.holdId, input.price);
  await book(tx, mode, "issuance", postings.allocationPending(input.userId, a.id, input.price));
  await tx.execute(sql`
    INSERT INTO settlement_operations(type, idempotency_key, allocation_id, provider, amount_cents, status, user_id)
    VALUES ('PRIMARY_SETTLEMENT', ${`allocation:${a.id}`}, ${a.id}, ${providerName}, ${input.price}, 'CREATED', ${input.userId})`);
  return a.id;
}

/**
 * Close a due drop and draw the allocation. Idempotent: a retry finds the
 * existing snapshot and does nothing new (AT-24).
 */
export async function closeAndAllocate(ctx: IssuanceCtx, dropId: string): Promise<{ winners: number; waitlist: number } | null> {
  const result = await ctx.db.transaction(async (tx) => {
    const d = await lockDrop(tx, dropId);
    if (!d) return null;
    if (d.status === "OPEN" && d.is_closed_now) {
      await tx.execute(sql`UPDATE drops SET status = 'CLOSED', version = version + 1 WHERE id = ${d.id}`);
      d.status = "CLOSED";
    }
    if (d.status !== "CLOSED") return null;
    const snap = (await tx.execute(sql`SELECT 1 FROM allocation_snapshots WHERE drop_id = ${d.id}`)).rows[0];
    if (snap) return null;

    // A reservation confirmed too late (or never) does not take part (BR-10, AT-25).
    const late = (await tx.execute<{ id: string }>(sql`
      SELECT id FROM subscriptions WHERE drop_id = ${d.id} AND (status = 'RESERVATION_PENDING' OR (status = 'CONFIRMED' AND confirmed_at >= ${d.closes_at}::timestamptz))`)).rows;
    for (const s of late) await releaseSubscription(tx, ctx.mode, s.id, "INVALID_LATE", `late:${s.id}`);

    // Freeze: timely confirmed subscriptions of users who are still admitted.
    const subs = (await tx.execute<{ id: string; user_id: string }>(sql`
      SELECT id, user_id FROM subscriptions WHERE drop_id = ${d.id} AND status = 'CONFIRMED' ORDER BY id`)).rows;
    const frozen: string[] = [];
    for (const s of subs) {
      const facts = await admissionFacts(tx, s.user_id, ctx.mode);
      if (facts && decideAction("SUBSCRIBE", facts).allowed) frozen.push(s.id);
      else await releaseSubscription(tx, ctx.mode, s.id, "NOT_ALLOCATED", `not-admitted:${s.id}`);
    }
    const cards = (await tx.execute<{ id: string }>(sql`
      SELECT c.id FROM drop_cards dc JOIN cards c ON c.id = dc.card_id WHERE dc.drop_id = ${d.id} AND c.status = 'IN_DROP' ORDER BY c.serial_number`)).rows;
    const seed = decryptSeed(ctx.seedKey, d.seed_ciphertext!, d.seed_iv!, d.seed_tag!);
    const r = allocate({ seed, commitment: d.seed_commitment!, dropId: d.id, frozenSubscriptionIds: frozen, availableCards: cards.length });
    await tx.execute(sql`
      INSERT INTO allocation_snapshots(drop_id, algorithm_version, seed_commitment, participants_digest, participant_ids, available_cards, result_digest, ranking)
      VALUES (${d.id}, ${r.algorithmVersion}, ${r.seedCommitment}, ${r.participantsDigest}, ${pgArray(frozen)}::uuid[], ${cards.length}, ${r.resultDigest}, ${pgArray(r.ranking)}::uuid[])`);
    const price = Number(d.price_cents);
    for (const [i, subId] of r.winners.entries()) {
      const s = (await tx.execute<{ user_id: string; hold_id: string }>(sql`SELECT user_id, hold_id FROM subscriptions WHERE id = ${subId}`)).rows[0]!;
      await startAllocation(tx, ctx.mode, ctx.providerName, { dropId: d.id, subscriptionId: subId, userId: s.user_id, holdId: s.hold_id, cardId: cards[i]!.id, rank: i + 1, price });
    }
    if (r.waitlist.length) await tx.execute(sql`UPDATE subscriptions SET status = 'WAITLISTED', version = version + 1 WHERE id = ANY(${pgArray(r.waitlist)}::uuid[])`);
    // Fewer participants than cards: the rest stays platform stock (BR-23).
    const unsold = cards.slice(r.winners.length).map((c) => c.id);
    if (unsold.length) await tx.execute(sql`UPDATE cards SET status = 'UNSOLD', version = version + 1 WHERE id = ANY(${pgArray(unsold)}::uuid[])`);
    await tx.execute(sql`
      UPDATE drops SET status = 'SETTLING', allocated_at = now(), waitlist_until = now() + make_interval(hours => ${WAITLIST_HOURS}),
             seed_revealed = ${seed.toString("hex")}, version = version + 1
       WHERE id = ${d.id}`);
    await writeAudit(tx, { actorId: null, actorKind: "SYSTEM", action: "DROP_ALLOCATED", entityType: "drop", entityId: d.id, related: { participants: frozen.length, winners: r.winners.length, waitlist: r.waitlist.length, resultDigest: r.resultDigest } });
    return { winners: r.winners.length, waitlist: r.waitlist.length };
  });
  await continueDrop(ctx, dropId);
  return result;
}

// ---------------------------------------------------------------------------
// Settlement of allocations
// ---------------------------------------------------------------------------
export async function submitAllocation(ctx: PaymentsCtx, allocationId: string): Promise<string> {
  const row = (await ctx.db.execute<{ op_id: string; key: string; processed: boolean; status: string; user_id: string; hold_id: string; price: string }>(sql`
    SELECT o.id AS op_id, o.idempotency_key AS key, o.financially_processed_at IS NOT NULL AS processed, a.status::text AS status,
           s.user_id, s.hold_id, a.price_cents AS price
      FROM allocations a JOIN subscriptions s ON s.id = a.subscription_id
      JOIN settlement_operations o ON o.allocation_id = a.id AND o.type = 'PRIMARY_SETTLEMENT'
     WHERE a.id = ${allocationId}`)).rows[0];
  if (!row) throw new DomainError("INVARIANT_VIOLATION", { detail: "unknown allocation" });
  if (row.processed) return row.status;
  await ctx.db.execute(sql`UPDATE allocations SET status = 'SETTLEMENT_PENDING' WHERE id = ${allocationId} AND status = 'ALLOCATED'`);
  let outcome: ProviderOutcome;
  try {
    outcome = await ctx.provider.settleSale({
      idempotencyKey: row.key, buyerHoldReference: `hold:${row.hold_id}`, buyerAccountRef: `user:${row.user_id}`,
      sellerAccountRef: "platform:primary", gross: Number(row.price), sellerNet: Number(row.price), platformFee: 0,
    });
  } catch (e) {
    // Unknown: the card stays held for this winner (AT-26).
    await ctx.db.execute(sql`UPDATE settlement_operations SET status = 'UNKNOWN', attempts = attempts + 1, last_error = ${String(e)}, updated_at = now() WHERE id = ${row.op_id} AND financially_processed_at IS NULL`);
    return "SETTLEMENT_PENDING";
  }
  await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE settlement_operations SET status = 'SUBMITTED', attempts = attempts + 1, updated_at = now(), provider_reference = coalesce(provider_reference, ${outcome.providerReference})
       WHERE id = ${row.op_id} AND financially_processed_at IS NULL AND status IN ('CREATED','UNKNOWN')`);
    await applyOperationOutcome(tx, ctx.mode, row.op_id, outcome);
  });
  return (await ctx.db.execute<{ s: string }>(sql`SELECT status::text s FROM allocations WHERE id = ${allocationId}`)).rows[0]!.s;
}

/** Apply the provider's outcome of a primary settlement (operation row locked by the caller). */
export async function applyAllocationOutcome(tx: Executor, mode: AppMode, op: { id: string; allocation_id: string }, outcome: ProviderOutcome): Promise<"FINALISED" | "PENDING" | "UNCHANGED"> {
  if (outcome.status === "UNKNOWN") return "UNCHANGED";
  if (outcome.status === "PENDING") {
    await tx.execute(sql`UPDATE settlement_operations SET status = 'PENDING', updated_at = now() WHERE id = ${op.id}`);
    await tx.execute(sql`UPDATE allocations SET status = 'SETTLEMENT_PENDING' WHERE id = ${op.allocation_id} AND status = 'ALLOCATED'`);
    return "PENDING";
  }
  const a = (await tx.execute<{ id: string; drop_id: string; card_id: string; price_cents: string; subscription_id: string; user_id: string; hold_id: string }>(sql`
    SELECT a.id, a.drop_id, a.card_id, a.price_cents, a.subscription_id, s.user_id, s.hold_id
      FROM allocations a JOIN subscriptions s ON s.id = a.subscription_id WHERE a.id = ${op.allocation_id} FOR UPDATE OF a`)).rows[0]!;
  const price = Number(a.price_cents);
  await tx.execute(sql`SELECT id FROM ledger_accounts WHERE owner_user_id = ${a.user_id} ORDER BY id FOR UPDATE`);
  const finalise = (status: "SUCCEEDED" | "FAILED", err: string | null) => tx.execute(sql`
    UPDATE settlement_operations SET status = ${status}, financially_processed_at = now(), outcome_known_at = now(), last_error = ${err}, updated_at = now(), version = version + 1
     WHERE id = ${op.id}`);
  if (outcome.status === "SUCCEEDED") {
    await book(tx, mode, "issuance", postings.allocationSettled(a.user_id, a.id, price));
    await transferOwnership(tx, { cardId: a.card_id, toUserId: a.user_id, costBasisCents: price, cause: "PRIMARY_DELIVERY", allocationId: a.id });
    await tx.execute(sql`UPDATE allocations SET status = 'DELIVERED', settled_at = now() WHERE id = ${a.id}`);
    await tx.execute(sql`UPDATE subscriptions SET outcome_at = now(), version = version + 1 WHERE id = ${a.subscription_id}`);
    await finalise("SUCCEEDED", null);
    await tx.execute(sql`
      INSERT INTO notification_outbox(user_id, template, channel, dedupe_key, payload)
      VALUES (${a.user_id}, 'CARD_DELIVERED', 'IN_APP', ${`delivered:${a.id}`}, ${JSON.stringify({ allocationId: a.id, dropId: a.drop_id, priceCents: price })}::jsonb)
      ON CONFLICT (dedupe_key) DO NOTHING`);
    await writeAudit(tx, { actorId: null, actorKind: "PROVIDER", action: "ALLOCATION_DELIVERED", entityType: "allocation", entityId: a.id, related: { price } });
    return "FINALISED";
  }
  // Definitive failure: money back, card free for the waitlist (AT-27).
  await book(tx, mode, "issuance", postings.allocationFailed(a.user_id, a.id, price));
  await restoreConsumed(tx, a.hold_id, price);
  await releaseHold(tx, mode, a.hold_id, price, `alloc-fail:${a.id}`);
  await tx.execute(sql`UPDATE allocations SET status = 'FAILED' WHERE id = ${a.id}`);
  await tx.execute(sql`UPDATE cards SET status = 'IN_DROP', version = version + 1 WHERE id = ${a.card_id} AND owner_user_id IS NULL`);
  await tx.execute(sql`UPDATE subscriptions SET status = 'NOT_ALLOCATED', outcome_at = now(), version = version + 1 WHERE id = ${a.subscription_id}`);
  await finalise("FAILED", outcome.reason);
  await writeAudit(tx, { actorId: null, actorKind: "PROVIDER", action: "ALLOCATION_FAILED", reason: outcome.reason, entityType: "allocation", entityId: a.id });
  return "FINALISED";
}

/**
 * After allocation or an outcome: submit what is waiting, promote from the
 * waitlist where a card became free, and complete the drop when all is final.
 */
export async function continueDrop(ctx: PaymentsCtx, dropId: string): Promise<void> {
  for (let round = 0; round < 10; round++) {
    const waiting = (await ctx.db.execute<{ id: string }>(sql`
      SELECT a.id FROM allocations a JOIN settlement_operations o ON o.allocation_id = a.id
       WHERE a.drop_id = ${dropId} AND o.financially_processed_at IS NULL AND o.status IN ('CREATED','UNKNOWN') ORDER BY a.rank`)).rows;
    for (const w of waiting) await submitAllocation(ctx, w.id);
    const promoted = await promoteFromWaitlist(ctx, dropId);
    if (!promoted) break;
  }
  await completeIfDone(ctx, dropId);
}

async function promoteFromWaitlist(ctx: PaymentsCtx, dropId: string): Promise<number> {
  return ctx.db.transaction(async (tx) => {
    const d = (await tx.execute<{ status: string; allocated_at: string; ranking: string[] | string; price_cents: string }>(sql`
      SELECT d.status::text, d.allocated_at::text, s.ranking, d.price_cents FROM drops d JOIN allocation_snapshots s ON s.drop_id = d.id WHERE d.id = ${dropId} FOR UPDATE OF d`)).rows[0];
    if (!d || d.status !== "SETTLING") return 0;
    const ranking = Array.isArray(d.ranking) ? d.ranking : String(d.ranking).replace(/[{}]/g, "").split(",").filter(Boolean);
    // Cards whose allocation failed definitively and that have no live allocation now.
    const free = (await tx.execute<{ card_id: string; failed_id: string }>(sql`
      SELECT DISTINCT ON (a.card_id) a.card_id, a.id AS failed_id FROM allocations a
       WHERE a.drop_id = ${dropId} AND a.status = 'FAILED'
         AND NOT EXISTS (SELECT 1 FROM allocations b WHERE b.card_id = a.card_id AND b.status IN ${LIVE_ALLOCATION})
         AND EXISTS (SELECT 1 FROM cards c WHERE c.id = a.card_id AND c.status = 'IN_DROP')
       ORDER BY a.card_id, a.allocated_at DESC`)).rows;
    if (!free.length) return 0;
    const tried = new Set((await tx.execute<{ subscription_id: string }>(sql`SELECT subscription_id FROM allocations WHERE drop_id = ${dropId}`)).rows.map((r) => r.subscription_id));
    const waitlisted = (await tx.execute<{ id: string; user_id: string; hold_id: string }>(sql`
      SELECT id, user_id, hold_id FROM subscriptions WHERE drop_id = ${dropId} AND status = 'WAITLISTED'`)).rows;
    const admitted = new Map<string, boolean>();
    for (const s of waitlisted) {
      const f = await admissionFacts(tx, s.user_id, ctx.mode);
      admitted.set(s.id, !!f && decideAction("SUBSCRIBE", f).allowed);
    }
    let n = 0;
    for (const f of free) {
      const pick = nextWaitlistCandidate({
        holderSettlement: "FAILED", waitlist: ranking.filter((id) => waitlisted.some((w) => w.id === id)), alreadyTried: tried,
        isStillAdmitted: (id) => admitted.get(id) ?? false, firstAllocatedAt: new Date(d.allocated_at), now: new Date(), windowHours: WAITLIST_HOURS,
      });
      if (pick === "HOLD") continue;
      if (pick === "UNSOLD") {
        await tx.execute(sql`UPDATE cards SET status = 'UNSOLD', version = version + 1 WHERE id = ${f.card_id}`);
        continue;
      }
      const s = waitlisted.find((w) => w.id === pick)!;
      await startAllocation(tx, ctx.mode, ctx.providerName, { dropId, subscriptionId: s.id, userId: s.user_id, holdId: s.hold_id, cardId: f.card_id, rank: ranking.indexOf(s.id) + 1, price: Number(d.price_cents), promotedFrom: f.failed_id });
      tried.add(s.id);
      n++;
    }
    return n;
  });
}

async function completeIfDone(ctx: PaymentsCtx, dropId: string): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const d = (await tx.execute<{ status: string }>(sql`SELECT status::text FROM drops WHERE id = ${dropId} FOR UPDATE`)).rows[0];
    if (!d || d.status !== "SETTLING") return;
    const open = (await tx.execute(sql`SELECT 1 FROM allocations WHERE drop_id = ${dropId} AND status IN ('ALLOCATED','SETTLEMENT_PENDING','MANUAL_REVIEW')`)).rows.length;
    const freeCards = (await tx.execute(sql`SELECT 1 FROM drop_cards dc JOIN cards c ON c.id = dc.card_id WHERE dc.drop_id = ${dropId} AND c.status = 'IN_DROP'`)).rows.length;
    if (open || freeCards) return;
    const waitlisted = (await tx.execute<{ id: string }>(sql`SELECT id FROM subscriptions WHERE drop_id = ${dropId} AND status = 'WAITLISTED'`)).rows;
    for (const s of waitlisted) await releaseSubscription(tx, ctx.mode, s.id, "NOT_ALLOCATED", `waitlist-end:${s.id}`);
    await tx.execute(sql`UPDATE drops SET status = 'COMPLETED', completed_at = now(), version = version + 1 WHERE id = ${dropId}`);
    await writeAudit(tx, { actorId: null, actorKind: "SYSTEM", action: "DROP_COMPLETED", entityType: "drop", entityId: dropId });
  });
}

/** Continue the drop of an allocation operation (after a webhook or poll). */
export async function continueAfterAllocationOperation(ctx: PaymentsCtx, opId: string): Promise<void> {
  const r = (await ctx.db.execute<{ drop_id: string }>(sql`
    SELECT a.drop_id FROM settlement_operations o JOIN allocations a ON a.id = o.allocation_id WHERE o.id = ${opId}`)).rows[0];
  if (r) await continueDrop(ctx, r.drop_id);
}

/** Worker job: commitments, opening, closing + allocation, and recovery of settling drops. */
export async function dropsCycle(ctx: IssuanceCtx): Promise<{ committed: number; opened: number; allocated: number }> {
  const committed = await ensureCommitments(ctx);
  const opened = await openDueDrops(ctx);
  const due = (await ctx.db.execute<{ id: string; status: string }>(sql`
    SELECT id, status::text FROM drops WHERE (status = 'OPEN' AND closes_at <= now()) OR status IN ('CLOSED','SETTLING')`)).rows;
  let allocated = 0;
  for (const d of due) {
    if (d.status === "SETTLING") await continueDrop(ctx, d.id);
    else if (await closeAndAllocate(ctx, d.id)) allocated++;
  }
  return { committed, opened, allocated };
}

/** Demo only: move the schedule so testers do not wait until Tuesday. Refused outside demo mode. */
export async function demoShiftSchedule(ctx: IssuanceCtx, actor: Actor, input: { dropId: string; action: "OPEN_NOW" | "CLOSE_NOW" }): Promise<void> {
  if (ctx.mode !== "demo") throw new DomainError("ACTION_NOT_ALLOWED");
  requirePermission(actor, "issuance.prepare");
  if (input.action === "OPEN_NOW") {
    const r = await ctx.db.execute(sql`
      UPDATE drops SET opens_at = now() - interval '1 second', publishes_at = least(publishes_at, now() - interval '1 second'), closes_at = greatest(closes_at, now() + interval '1 hour')
       WHERE id = ${input.dropId} AND status = 'PUBLISHED' RETURNING id`);
    if (!r.rows.length) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Alleen een gepubliceerde uitgifte kan worden geopend." });
    await ensureCommitments(ctx);
    await openDueDrops(ctx);
  } else {
    const r = await ctx.db.execute(sql`UPDATE drops SET closes_at = now() WHERE id = ${input.dropId} AND status = 'OPEN' RETURNING id`);
    if (!r.rows.length) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Alleen een open uitgifte kan worden gesloten." });
    await closeAndAllocate(ctx, input.dropId);
  }
  await writeAudit(ctx.db, { actorId: actor.id, actorKind: "ADMIN", action: `DEMO_DROP_${input.action}`, reason: "Demo: planning verschoven", entityType: "drop", entityId: input.dropId });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export type DropListRow = {
  id: string; player_id: string; season_key: string; price_cents: string; quantity: number; max_per_user: number; status: string;
  publishes_at: string; opens_at: string; closes_at: string; seed_commitment: string | null; seed_revealed: string | null;
  participants: number | null; delivered: number; my_subscription_id: string | null; my_status: string | null; my_allocation: string | null;
  participants_digest: string | null; result_digest: string | null; price_changes: number;
};

export async function listDropsForUser(db: Executor, userId: string | null): Promise<DropListRow[]> {
  return (await db.execute<DropListRow>(sql`
    SELECT d.id, e.player_id, e.season_key, d.price_cents, d.quantity, d.max_per_user, d.status::text AS status,
           d.publishes_at::text, d.opens_at::text, d.closes_at::text, d.seed_commitment, d.seed_revealed,
           (SELECT cardinality(s.participant_ids) FROM allocation_snapshots s WHERE s.drop_id = d.id) AS participants,
           (SELECT count(*) FROM allocations a WHERE a.drop_id = d.id AND a.status = 'DELIVERED')::int AS delivered,
           ms.id AS my_subscription_id, ms.status::text AS my_status,
           (SELECT a.status::text FROM allocations a WHERE a.subscription_id = ms.id ORDER BY a.allocated_at DESC LIMIT 1) AS my_allocation,
           sn.participants_digest, sn.result_digest,
           (SELECT count(*) FROM drop_price_changes pc WHERE pc.drop_id = d.id)::int AS price_changes
      FROM drops d JOIN editions e ON e.id = d.edition_id
      LEFT JOIN subscriptions ms ON ms.drop_id = d.id AND ms.user_id = ${userId}
      LEFT JOIN allocation_snapshots sn ON sn.drop_id = d.id
     WHERE d.status <> 'DRAFT'
     ORDER BY d.opens_at`)).rows;
}

export async function listDropsForAdmin(db: Executor) {
  return (await db.execute<{ id: string; player_id: string; player_name: string; season_key: string; price_cents: string; quantity: number; status: string; opens_at: string; closes_at: string;
    approval_id: string | null; open_approval_id: string | null; open_approval_status: string | null; subscriptions: number; delivered: number; failed: number; pending: number; unsold: number; price_change_approval: string | null; price_change_payload: { newPriceCents?: number } | null }>(sql`
    SELECT d.id, e.player_id, p.display_name AS player_name, e.season_key, d.price_cents, d.quantity, d.status::text AS status, d.opens_at::text, d.closes_at::text, d.approval_id,
           (SELECT ap.id FROM admin_approvals ap WHERE ap.action_type = 'PUBLISH_DROP' AND ap.payload->>'dropId' = d.id::text ORDER BY ap.created_at DESC LIMIT 1) AS open_approval_id,
           (SELECT ap.status::text FROM admin_approvals ap WHERE ap.action_type = 'PUBLISH_DROP' AND ap.payload->>'dropId' = d.id::text ORDER BY ap.created_at DESC LIMIT 1) AS open_approval_status,
           (SELECT count(*) FROM subscriptions s WHERE s.drop_id = d.id AND s.status <> 'CANCELLED')::int AS subscriptions,
           (SELECT count(*) FROM allocations a WHERE a.drop_id = d.id AND a.status = 'DELIVERED')::int AS delivered,
           (SELECT count(*) FROM allocations a WHERE a.drop_id = d.id AND a.status = 'FAILED')::int AS failed,
           (SELECT count(*) FROM allocations a WHERE a.drop_id = d.id AND a.status IN ('ALLOCATED','SETTLEMENT_PENDING'))::int AS pending,
           (SELECT count(*) FROM drop_cards dc JOIN cards c ON c.id = dc.card_id WHERE dc.drop_id = d.id AND c.status = 'UNSOLD')::int AS unsold,
           (SELECT ap.id FROM admin_approvals ap WHERE ap.action_type = 'CHANGE_DROP_PRICE' AND ap.payload->>'dropId' = d.id::text AND ap.status = 'APPROVED' ORDER BY ap.created_at DESC LIMIT 1) AS price_change_approval,
           (SELECT ap.payload FROM admin_approvals ap WHERE ap.action_type = 'CHANGE_DROP_PRICE' AND ap.payload->>'dropId' = d.id::text AND ap.status = 'APPROVED' ORDER BY ap.created_at DESC LIMIT 1) AS price_change_payload
      FROM drops d JOIN editions e ON e.id = d.edition_id JOIN players p ON p.id = e.player_id
     ORDER BY (d.status IN ('COMPLETED','CANCELLED')), d.opens_at DESC LIMIT 100`)).rows;
}

/** Players that may get a new drop: admitted, active, with a published programme and room left. */
export async function dropCandidates(db: Executor, seasonKey: string) {
  return (await db.execute<{ id: string; display_name: string; reference_cents: string | null; room: number }>(sql`
    SELECT p.id, p.display_name, r.amount_cents AS reference_cents,
           (ip.planned_total - coalesce((SELECT max(c.serial_number) FROM cards c WHERE c.edition_id = e.id), 0))::int AS room
      FROM players p JOIN editions e ON e.player_id = p.id AND e.season_key = ${seasonKey}
      JOIN issuance_programs ip ON ip.edition_id = e.id AND ip.status = 'PUBLISHED'
      LEFT JOIN public_reference_values r ON r.player_id = p.id
     WHERE p.career_status = 'ACTIVE' AND p.primary_admission = 'APPROVED'
     ORDER BY p.display_name LIMIT 300`)).rows.filter((r) => r.room > 0);
}

/** Structural issuance invariants. All counts must be zero. */
export async function issuanceInvariants(db: Executor) {
  const r = (await db.execute<{ two_live: number; delivered_no_owner: number; over_qty: number; holds: number }>(sql`
    SELECT
      (SELECT count(*) FROM (SELECT card_id FROM allocations WHERE status IN ${LIVE_ALLOCATION} GROUP BY card_id HAVING count(*) > 1) x)::int AS two_live,
      (SELECT count(*) FROM allocations a JOIN subscriptions s ON s.id = a.subscription_id JOIN cards c ON c.id = a.card_id
        WHERE a.status = 'DELIVERED' AND c.owner_user_id IS DISTINCT FROM s.user_id
          AND NOT EXISTS (SELECT 1 FROM ownership_events e WHERE e.card_id = c.id AND e.previous_owner_id = s.user_id))::int AS delivered_no_owner,
      (SELECT count(*) FROM drops d WHERE (SELECT count(*) FROM allocations a WHERE a.drop_id = d.id AND a.status = 'DELIVERED') > d.quantity)::int AS over_qty,
      (SELECT count(*) FROM subscriptions s JOIN cash_holds h ON h.id = s.hold_id
        WHERE s.status IN ('NOT_ALLOCATED','CANCELLED','INVALID_LATE') AND h.confirmed_amount_cents - h.consumed_amount_cents - h.released_amount_cents <> 0)::int AS holds`)).rows[0]!;
  return { cardsWithTwoLiveAllocations: r.two_live, deliveredNotOwned: r.delivered_no_owner, dropsOverQuantity: r.over_qty, releasedSubscriptionsStillHeld: r.holds };
}
