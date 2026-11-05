/**
 * Inventory and ownership (fase 3; BR-02, BR-03, BR-04, BR-05, BR-16, BR-22).
 *
 * Lock order (docs/04 Concurrency): edition → orders → cards sorted by id.
 * The database enforces the cap, unique serials, one active sale reservation
 * per card and ownership-with-event; this module adds the business checks
 * and returns domain errors instead of database errors.
 */
import { sql } from "drizzle-orm";
import { assertValidSerial, DomainError, EDITION_HARD_CAP, nextSerials, parseSeasonKey } from "@px/domain";
import type { Db, Executor } from "./client.ts";
import { consumeApproval, invalidateApprovals, requestApproval } from "./approvals.ts";
import { requirePermission, writeAudit, type Identity } from "./identity.ts";

type Actor = Pick<Identity, "id" | "permissions">;

/** A JS array as one PostgreSQL array parameter (Drizzle would otherwise expand it into a list). */
export function pgArray(values: readonly (string | number)[]): string {
  return `{${values.map((v) => `"${String(v).replace(/["\\]/g, "\\$&")}"`).join(",")}}`;
}

// ---------------------------------------------------------------------------
// Editions and programmes
// ---------------------------------------------------------------------------
export async function ensureEdition(tx: Executor, playerId: string, seasonKey: string): Promise<string> {
  parseSeasonKey(seasonKey);
  await tx.execute(sql`INSERT INTO editions(player_id, season_key) VALUES (${playerId}, ${seasonKey}) ON CONFLICT (player_id, season_key) DO NOTHING`);
  const res = await tx.execute<{ id: string }>(sql`SELECT id FROM editions WHERE player_id = ${playerId} AND season_key = ${seasonKey}`);
  return res.rows[0]!.id;
}

type PlayerGate = { career_status: string; primary_admission: string; birth_date: string | null; is_fictional: boolean; identity_rights_released: boolean };

/** Checks before a player may get a (new) primary issuance programme. */
async function assertPrimaryIssuanceAllowed(tx: Executor, playerId: string): Promise<void> {
  const p = (await tx.execute<PlayerGate>(sql`
    SELECT career_status, primary_admission, birth_date, is_fictional, identity_rights_released FROM players WHERE id = ${playerId}`)).rows[0];
  if (!p) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "unknown player" });
  if (p.career_status !== "ACTIVE") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Speler is niet actief; geen nieuwe primaire uitgifte (BR-22)." });
  if (p.primary_admission !== "APPROVED") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Speler is niet toegelaten tot primaire uitgifte." });
  if (!p.is_fictional && !p.identity_rights_released) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Rechten op de spelersidentiteit zijn niet vrijgegeven (O-10)." });
}

export type ProgrammeRow = {
  id: string; edition_id: string; version: number; planned_total: number; status: string;
  change_reason: string | null; approval_id: string | null; published_at: string | null; player_id: string; season_key: string;
};

async function getProgramme(tx: Executor, id: string, lock = false): Promise<ProgrammeRow | undefined> {
  const res = await tx.execute<ProgrammeRow>(sql`
    SELECT ip.id, ip.edition_id, ip.version, ip.planned_total, ip.status::text AS status, ip.change_reason, ip.approval_id, ip.published_at,
           e.player_id, e.season_key
      FROM issuance_programs ip JOIN editions e ON e.id = ip.edition_id
     WHERE ip.id = ${id} ${lock ? sql`FOR UPDATE OF ip` : sql``}`);
  return res.rows[0];
}

export async function createDraftProgramme(
  db: Db,
  actor: Actor,
  input: { playerId: string; seasonKey: string; plannedTotal: number; reason: string },
): Promise<string> {
  requirePermission(actor, "issuance.prepare");
  if (!Number.isInteger(input.plannedTotal) || input.plannedTotal < 1 || input.plannedTotal > EDITION_HARD_CAP) {
    throw new DomainError("EDITION_CAP_EXCEEDED", { plannedTotal: input.plannedTotal });
  }
  const reason = input.reason.trim();
  if (reason.length < 5) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Geef een reden van minimaal 5 tekens." });
  return db.transaction(async (tx) => {
    await assertPrimaryIssuanceAllowed(tx, input.playerId);
    const editionId = await ensureEdition(tx, input.playerId, input.seasonKey);
    await tx.execute(sql`SELECT id FROM editions WHERE id = ${editionId} FOR UPDATE`);
    const open = await tx.execute(sql`SELECT 1 FROM issuance_programs WHERE edition_id = ${editionId} AND status IN ('DRAFT','APPROVED')`);
    if (open.rows.length) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Deze editie heeft al een openstaand concept." });
    const published = (await tx.execute<{ planned_total: number; highest: number }>(sql`
      SELECT ip.planned_total, coalesce((SELECT max(serial_number) FROM cards c WHERE c.edition_id = ip.edition_id), 0)::int AS highest
        FROM issuance_programs ip WHERE ip.edition_id = ${editionId} AND ip.status = 'PUBLISHED'`)).rows[0];
    if (published && input.plannedTotal > published.planned_total) {
      // BR-04: no (hidden) increase of a published programme.
      throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Een gepubliceerd programma kan niet worden verhoogd (BR-04)." });
    }
    if (published && input.plannedTotal < published.highest) {
      throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Het programma kan niet lager zijn dan het aantal al gemaakte kaarten." });
    }
    const v = await tx.execute<{ next: number }>(sql`SELECT coalesce(max(version), 0) + 1 AS next FROM issuance_programs WHERE edition_id = ${editionId}`);
    const res = await tx.execute<{ id: string }>(sql`
      INSERT INTO issuance_programs(edition_id, version, planned_total, status, change_reason, created_by)
      VALUES (${editionId}, ${v.rows[0]!.next}, ${input.plannedTotal}, 'DRAFT', ${reason}, ${actor.id}) RETURNING id`);
    await writeAudit(tx, { actorId: actor.id, actorKind: "ADMIN", action: "PROGRAMME_DRAFTED", reason, entityType: "issuance_program", entityId: res.rows[0]!.id, related: { playerId: input.playerId, seasonKey: input.seasonKey, plannedTotal: input.plannedTotal } });
    return res.rows[0]!.id;
  });
}

/** Change a draft. Any open approval for it becomes invalid (AT-34). */
export async function updateDraftProgramme(db: Db, actor: Actor, input: { programmeId: string; plannedTotal: number; reason: string }): Promise<void> {
  requirePermission(actor, "issuance.prepare");
  await db.transaction(async (tx) => {
    const p = await getProgramme(tx, input.programmeId, true);
    if (!p || p.status !== "DRAFT") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Alleen een concept kan worden gewijzigd." });
    await tx.execute(sql`UPDATE issuance_programs SET planned_total = ${input.plannedTotal}, change_reason = ${input.reason.trim()} WHERE id = ${p.id}`);
    await invalidateApprovals(tx, "PUBLISH_PROGRAMME", "programmeId", p.id);
    await writeAudit(tx, { actorId: actor.id, actorKind: "ADMIN", action: "PROGRAMME_DRAFT_CHANGED", reason: input.reason, entityType: "issuance_program", entityId: p.id, related: { plannedTotal: input.plannedTotal } });
  });
}

const publishPayload = (p: ProgrammeRow) => ({ programmeId: p.id, editionId: p.edition_id, playerId: p.player_id, seasonKey: p.season_key, version: p.version, plannedTotal: p.planned_total });

export async function requestProgrammePublication(db: Db, actor: Actor, input: { programmeId: string; reason: string }): Promise<string> {
  const p = await getProgramme(db, input.programmeId);
  if (!p || p.status !== "DRAFT") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Alleen een concept kan ter publicatie worden aangeboden." });
  return requestApproval(db, actor, { action: "PUBLISH_PROGRAMME", payload: publishPayload(p), reason: input.reason });
}

export async function publishProgramme(db: Db, actor: Actor, input: { programmeId: string; approvalId: string }): Promise<void> {
  requirePermission(actor, "issuance.prepare");
  await db.transaction(async (tx) => {
    const p0 = await getProgramme(tx, input.programmeId);
    if (!p0) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "unknown programme" });
    await tx.execute(sql`SELECT id FROM editions WHERE id = ${p0.edition_id} FOR UPDATE`);
    const p = (await getProgramme(tx, input.programmeId, true))!;
    if (p.status !== "DRAFT") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Dit programma is geen concept meer." });
    await assertPrimaryIssuanceAllowed(tx, p.player_id);
    await consumeApproval(tx, actor.id, input.approvalId, "PUBLISH_PROGRAMME", publishPayload(p));
    await tx.execute(sql`UPDATE issuance_programs SET status = 'SUPERSEDED' WHERE edition_id = ${p.edition_id} AND status = 'PUBLISHED'`);
    await tx.execute(sql`UPDATE issuance_programs SET status = 'PUBLISHED', published_at = now(), approval_id = ${input.approvalId} WHERE id = ${p.id}`);
    await writeAudit(tx, {
      actorId: actor.id, actorKind: "ADMIN", action: "PROGRAMME_PUBLISHED", reason: p.change_reason,
      entityType: "issuance_program", entityId: p.id, related: { ...publishPayload(p), approvalId: input.approvalId },
    });
  });
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------
/** Create the next `count` serials of an edition as platform inventory. */
export async function mintCards(tx: Executor, editionId: string, count: number): Promise<{ id: string; serial: number }[]> {
  const ed = (await tx.execute<{ player_id: string }>(sql`SELECT player_id FROM editions WHERE id = ${editionId} FOR UPDATE`)).rows[0];
  if (!ed) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "unknown edition" });
  const prog = (await tx.execute<{ planned_total: number }>(sql`SELECT planned_total FROM issuance_programs WHERE edition_id = ${editionId} AND status = 'PUBLISHED'`)).rows[0];
  if (!prog) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "no published programme" });
  const hi = (await tx.execute<{ hi: number }>(sql`SELECT coalesce(max(serial_number), 0)::int AS hi FROM cards WHERE edition_id = ${editionId}`)).rows[0]!.hi;
  const serials = nextSerials(hi, count, prog.planned_total);
  serials.forEach(assertValidSerial);
  const res = await tx.execute<{ id: string; serial: number }>(sql`
    INSERT INTO cards(edition_id, player_id, serial_number, status)
    SELECT ${editionId}, ${ed.player_id}, s, 'PLATFORM_INVENTORY' FROM unnest(${pgArray(serials)}::int[]) AS s
    RETURNING id, serial_number AS serial`);
  return res.rows.sort((a, b) => a.serial - b.serial);
}

/**
 * Reserve specific owned cards for a sell order (BR-16). Locks the cards in id
 * order; each card can be in only one active reservation (also a DB index).
 */
export async function reserveCardsForSale(tx: Executor, input: { userId: string; orderId: string; cardIds: string[] }): Promise<void> {
  const ids = [...new Set(input.cardIds)].sort();
  if (ids.length !== input.cardIds.length || ids.length === 0) throw new DomainError("QUANTITY_INVALID");
  const cards = (await tx.execute<{ id: string; owner_user_id: string | null; status: string }>(sql`
    SELECT id, owner_user_id, status::text AS status FROM cards WHERE id = ANY(${pgArray(ids)}::uuid[]) ORDER BY id FOR UPDATE`)).rows;
  if (cards.length !== ids.length) throw new DomainError("CARD_UNAVAILABLE");
  for (const c of cards) {
    if (c.status !== "OWNED" || c.owner_user_id !== input.userId) throw new DomainError("CARD_UNAVAILABLE", { cardId: c.id });
  }
  const busy = await tx.execute<{ card_id: string }>(sql`SELECT card_id FROM order_cards WHERE active AND card_id = ANY(${pgArray(ids)}::uuid[])`);
  if (busy.rows.length) throw new DomainError("CARD_UNAVAILABLE", { cardId: busy.rows[0]!.card_id });
  await tx.execute(sql`INSERT INTO order_cards(order_id, card_id) SELECT ${input.orderId}, unnest(${pgArray(ids)}::uuid[])`);
}

export async function releaseCards(tx: Executor, orderId: string, cardIds?: string[]): Promise<number> {
  const filter = cardIds ? sql`AND card_id = ANY(${pgArray(cardIds)}::uuid[])` : sql``;
  const res = await tx.execute(sql`UPDATE order_cards SET active = false, released_at = now() WHERE order_id = ${orderId} AND active ${filter}`);
  return res.rowCount ?? 0;
}

export type OwnershipCause = "PRIMARY_DELIVERY" | "SECONDARY_SETTLEMENT" | "INCIDENT_CORRECTION" | "OPENING_BALANCE";

/**
 * The only way a card changes owner: event and card update in one
 * transaction (the database refuses an owner change without an event).
 * The new owner's cost basis is the price paid for this specific card.
 */
export async function transferOwnership(tx: Executor, input: {
  cardId: string; toUserId: string; costBasisCents: number; cause: OwnershipCause;
  executionId?: string; allocationId?: string; reference?: string;
}): Promise<void> {
  if (!Number.isSafeInteger(input.costBasisCents) || input.costBasisCents < 0) throw new DomainError("INVARIANT_VIOLATION", { detail: "cost basis" });
  const card = (await tx.execute<{ owner_user_id: string | null; status: string }>(sql`
    SELECT owner_user_id, status::text AS status FROM cards WHERE id = ${input.cardId} FOR UPDATE`)).rows[0];
  if (!card) throw new DomainError("CARD_UNAVAILABLE");
  if (card.owner_user_id === input.toUserId) throw new DomainError("INVARIANT_VIOLATION", { detail: "already owner" });
  await tx.execute(sql`
    INSERT INTO ownership_events(card_id, previous_owner_id, new_owner_id, cause, execution_id, allocation_id, reference, cost_basis_cents)
    VALUES (${input.cardId}, ${card.owner_user_id}, ${input.toUserId}, ${input.cause}, ${input.executionId ?? null}, ${input.allocationId ?? null}, ${input.reference ?? null}, ${input.costBasisCents})`);
  await tx.execute(sql`
    UPDATE cards SET owner_user_id = ${input.toUserId}, status = 'OWNED', cost_basis_cents = ${input.costBasisCents}, version = version + 1
     WHERE id = ${input.cardId}`);
  // A reservation never survives a change of owner.
  await tx.execute(sql`UPDATE order_cards SET active = false, released_at = now() WHERE card_id = ${input.cardId} AND active`);
}

// ---------------------------------------------------------------------------
// Reads: portfolio and supply
// ---------------------------------------------------------------------------
export type HoldingRow = {
  card_id: string; player_id: string; serial: number; season_key: string; cost_basis_cents: string; acquired_at: string; reserved_for_sale: boolean;
};

/** The user's actual card holdings (UX-03): specific cards, cost and reservation. */
export async function holdingsFor(db: Executor, userId: string): Promise<HoldingRow[]> {
  const res = await db.execute<HoldingRow>(sql`
    SELECT c.id AS card_id, c.player_id, c.serial_number AS serial, e.season_key, c.cost_basis_cents,
           (SELECT max(occurred_at) FROM ownership_events oe WHERE oe.card_id = c.id AND oe.new_owner_id = ${userId}) AS acquired_at,
           EXISTS (SELECT 1 FROM order_cards oc WHERE oc.card_id = c.id AND oc.active) AS reserved_for_sale
      FROM cards c JOIN editions e ON e.id = c.edition_id
     WHERE c.owner_user_id = ${userId} AND c.status = 'OWNED'
     ORDER BY c.player_id, acquired_at, c.serial_number`);
  return res.rows;
}

export type SupplyRow = { player_id: string; in_circulation: number; sold_this_season: number; planned_this_season: number };

/** Supply per player (UX-02): delivered cards over all seasons, this season, and the published plan. */
export async function supplyFor(db: Executor, seasonKey: string, playerIds?: string[]): Promise<Map<string, SupplyRow>> {
  const filter = playerIds ? sql`WHERE p.id = ANY(${pgArray(playerIds)}::uuid[])` : sql``;
  const res = await db.execute<SupplyRow>(sql`
    SELECT p.id AS player_id,
           (SELECT count(*) FROM cards c WHERE c.player_id = p.id AND c.status = 'OWNED')::int AS in_circulation,
           (SELECT count(*) FROM cards c JOIN editions e ON e.id = c.edition_id
             WHERE c.player_id = p.id AND c.status = 'OWNED' AND e.season_key = ${seasonKey})::int AS sold_this_season,
           coalesce((SELECT ip.planned_total FROM issuance_programs ip JOIN editions e ON e.id = ip.edition_id
             WHERE e.player_id = p.id AND e.season_key = ${seasonKey} AND ip.status = 'PUBLISHED'), 0)::int AS planned_this_season
      FROM players p ${filter}`);
  return new Map(res.rows.map((r) => [r.player_id, r]));
}

/** Structural invariants (docs/09) for tests and reconciliation. */
export async function inventoryInvariants(db: Executor) {
  const r = (await db.execute<{ mismatches: number; over_programme: number; over_cap: number; multi_reserved: number; unowned_reserved: number }>(sql`
    SELECT
      (SELECT count(*) FROM card_ownership_mismatches)::int AS mismatches,
      (SELECT count(*) FROM cards c JOIN issuance_programs ip ON ip.edition_id = c.edition_id AND ip.status = 'PUBLISHED' WHERE c.serial_number > ip.planned_total)::int AS over_programme,
      (SELECT count(*) FROM (SELECT edition_id FROM cards GROUP BY edition_id HAVING count(*) > 500) x)::int AS over_cap,
      (SELECT count(*) FROM (SELECT card_id FROM order_cards WHERE active GROUP BY card_id HAVING count(*) > 1) x)::int AS multi_reserved,
      (SELECT count(*) FROM order_cards oc JOIN orders o ON o.id = oc.order_id JOIN cards c ON c.id = oc.card_id
        WHERE oc.active AND c.owner_user_id IS DISTINCT FROM o.user_id)::int AS unowned_reserved`)).rows[0]!;
  return { ownershipMismatches: r.mismatches, cardsOverProgramme: r.over_programme, editionsOverCap: r.over_cap, cardsMultiReserved: r.multi_reserved, reservedNotOwned: r.unowned_reserved };
}

/** Admin overview of a player's editions, programme versions and approvals. */
export async function programmeOverview(db: Executor, playerId: string) {
  const res = await db.execute<{
    edition_id: string; season_key: string; programme_id: string | null; version: number | null; planned_total: number | null;
    status: string | null; change_reason: string | null; published_at: string | null;
    approval_id: string | null; approval_status: string | null; cards_total: number; cards_owned: number; cards_platform: number;
  }>(sql`
    SELECT e.id AS edition_id, e.season_key, ip.id AS programme_id, ip.version, ip.planned_total, ip.status::text AS status,
           ip.change_reason, ip.published_at,
           (SELECT a.id FROM admin_approvals a WHERE a.action_type = 'PUBLISH_PROGRAMME' AND a.payload ->> 'programmeId' = ip.id::text ORDER BY a.created_at DESC LIMIT 1) AS approval_id,
           (SELECT a.status FROM admin_approvals a WHERE a.action_type = 'PUBLISH_PROGRAMME' AND a.payload ->> 'programmeId' = ip.id::text ORDER BY a.created_at DESC LIMIT 1) AS approval_status,
           (SELECT count(*) FROM cards c WHERE c.edition_id = e.id)::int AS cards_total,
           (SELECT count(*) FROM cards c WHERE c.edition_id = e.id AND c.status = 'OWNED')::int AS cards_owned,
           (SELECT count(*) FROM cards c WHERE c.edition_id = e.id AND c.status = 'PLATFORM_INVENTORY')::int AS cards_platform
      FROM editions e LEFT JOIN issuance_programs ip ON ip.edition_id = e.id
     WHERE e.player_id = ${playerId}
     ORDER BY e.season_key DESC, ip.version DESC`);
  return res.rows;
}
