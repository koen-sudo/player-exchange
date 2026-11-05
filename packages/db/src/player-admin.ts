/**
 * Player admission, market status and quarantine handling (fase 3;
 * docs/01 "Catalogus versus handelsmarkt", BR-01, BR-06, BR-22, O-10).
 */
import { sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import type { Db } from "./client.ts";
import { requirePermission, writeAudit, type Identity } from "./identity.ts";

type Actor = Pick<Identity, "id" | "permissions">;
export type PrimaryAdmission = "INELIGIBLE" | "REVIEW" | "APPROVED" | "PAUSED";
export type MarketStatus = "PROFILE_ONLY" | "PRELAUNCH" | "OPEN" | "PAUSED" | "CLOSED";

const ADMISSIONS: readonly PrimaryAdmission[] = ["INELIGIBLE", "REVIEW", "APPROVED", "PAUSED"];
const MARKET: readonly MarketStatus[] = ["PROFILE_ONLY", "PRELAUNCH", "OPEN", "PAUSED", "CLOSED"];

type PlayerFacts = {
  id: string; career_status: string; data_quality: string; primary_admission: string; is_fictional: boolean;
  identity_rights_released: boolean; age: number | null; in_circulation: number; market_status: string;
};

async function facts(db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0], playerId: string, lock = false): Promise<PlayerFacts> {
  const r = (await db.execute<PlayerFacts>(sql`
    SELECT p.id, p.career_status::text, p.data_quality::text, p.primary_admission::text, p.is_fictional, p.identity_rights_released,
           CASE WHEN p.birth_date IS NULL THEN NULL ELSE date_part('year', age((now() AT TIME ZONE 'Europe/Amsterdam')::date, p.birth_date))::int END AS age,
           (SELECT count(*) FROM cards c WHERE c.player_id = p.id AND c.status = 'OWNED')::int AS in_circulation,
           coalesce(pm.status::text, 'PROFILE_ONLY') AS market_status
      FROM players p LEFT JOIN player_markets pm ON pm.player_id = p.id
     WHERE p.id = ${playerId} ${lock ? sql`FOR UPDATE OF p` : sql``}`)).rows[0];
  if (!r) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "unknown player" });
  return r;
}

/** Why a player cannot be admitted to primary issuance, or null. */
export function admissionBlocker(f: Pick<PlayerFacts, "career_status" | "data_quality" | "is_fictional" | "identity_rights_released" | "age">): string | null {
  if (f.career_status !== "ACTIVE") return "Speler is niet actief (gestopt of onbekend).";
  if (f.age === null) return "Leeftijd onbekend.";
  if (f.age < 18) return "Speler is minderjarig.";
  if (f.data_quality === "MISSING") return "Onvoldoende spelersdata.";
  if (!f.is_fictional && !f.identity_rights_released) return "Rechten op naam en persoonlijkheidskenmerken zijn niet vrijgegeven (O-10).";
  return null;
}

export async function setPrimaryAdmission(db: Db, actor: Actor, input: { playerId: string; admission: PrimaryAdmission; reason: string }) {
  requirePermission(actor, "players.admit");
  if (!ADMISSIONS.includes(input.admission)) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "admission" });
  const reason = input.reason.trim();
  if (reason.length < 5) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Geef een reden van minimaal 5 tekens." });
  await db.transaction(async (tx) => {
    const f = await facts(tx, input.playerId, true);
    if (input.admission === "APPROVED") {
      const blocker = admissionBlocker(f);
      if (blocker) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: blocker });
    }
    await tx.execute(sql`UPDATE players SET primary_admission = ${input.admission}, version = version + 1, updated_at = now() WHERE id = ${f.id}`);
    await writeAudit(tx, { actorId: actor.id, actorKind: "ADMIN", action: "PLAYER_ADMISSION_CHANGED", reason, entityType: "player", entityId: f.id, related: { from: f.primary_admission, to: input.admission } });
  });
}

/**
 * Market status. Opening (or pre-launch) needs either primary admission or
 * cards already in circulation (a retired player's cards stay tradeable as
 * collectibles, BR-22). A market with cards can be paused or closed, never
 * turned back into a bare profile. Pausing for a legal/safety block is
 * always possible (BR-06).
 */
export async function setMarketStatus(db: Db, actor: Actor, input: { playerId: string; status: MarketStatus; reason: string }) {
  requirePermission(actor, "players.admit");
  if (!MARKET.includes(input.status)) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "status" });
  const reason = input.reason.trim();
  if (reason.length < 5) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Geef een reden van minimaal 5 tekens." });
  await db.transaction(async (tx) => {
    const f = await facts(tx, input.playerId, true);
    if ((input.status === "OPEN" || input.status === "PRELAUNCH") && f.primary_admission !== "APPROVED" && f.in_circulation === 0) {
      throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Laat de speler eerst toe tot primaire uitgifte." });
    }
    if (input.status === "PROFILE_ONLY" && f.in_circulation > 0) {
      throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Er zijn al kaarten in omloop; pauzeer of sluit de markt." });
    }
    await tx.execute(sql`
      INSERT INTO player_markets(player_id, status, status_reason) VALUES (${f.id}, ${input.status}, ${reason})
      ON CONFLICT (player_id) DO UPDATE SET status = EXCLUDED.status, status_reason = EXCLUDED.status_reason, updated_at = now(), version = player_markets.version + 1`);
    await writeAudit(tx, { actorId: actor.id, actorKind: "ADMIN", action: "MARKET_STATUS_CHANGED", reason, entityType: "player", entityId: f.id, related: { from: f.market_status, to: input.status } });
  });
}

// ---------------------------------------------------------------------------
// Quarantine
// ---------------------------------------------------------------------------
export type IssueResolution =
  | { kind: "LINK"; playerId: string } // the external id is this existing player
  | { kind: "CREATE_NEW" } // the external id is a different person
  | { kind: "IGNORE" }; // informational (e.g. a duplicate line in a feed)

export async function resolveImportIssue(db: Db, actor: Actor, input: { issueId: string; resolution: IssueResolution; reason: string }) {
  requirePermission(actor, "catalog.resolve_issue");
  const reason = input.reason.trim();
  if (reason.length < 5) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Geef een reden van minimaal 5 tekens." });
  await db.transaction(async (tx) => {
    const issue = (await tx.execute<{ id: string; kind: string; provider: string; external_id: string; detail: Record<string, unknown>; resolution: string }>(sql`
      SELECT id, kind, provider, external_id, detail, resolution FROM import_issues WHERE id = ${input.issueId} FOR UPDATE`)).rows[0];
    if (!issue || issue.resolution !== "OPEN") throw new DomainError("ACTION_NOT_ALLOWED", { detail: "issue not open" });
    let resolvedPlayer: string | null = null;
    const r = input.resolution;
    if (r.kind === "LINK" || r.kind === "CREATE_NEW") {
      if (issue.kind !== "CONFLICTING_MATCH") throw new DomainError("ACTION_NOT_ALLOWED", { detail: "only identity conflicts can be linked" });
      const mapped = await tx.execute(sql`SELECT 1 FROM provider_player_mappings WHERE provider = ${issue.provider} AND external_id = ${issue.external_id}`);
      if (mapped.rows.length) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "external id already mapped" });
      if (r.kind === "LINK") {
        const candidates = (issue.detail.candidates as string[] | undefined) ?? [];
        if (!candidates.includes(r.playerId)) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Deze speler hoort niet bij de kandidaten van dit probleem." });
        resolvedPlayer = r.playerId;
      } else {
        const name = String(issue.detail.name ?? issue.external_id);
        const created = await tx.execute<{ id: string }>(sql`INSERT INTO players(display_name, data_quality) VALUES (${name}, 'PARTIAL') RETURNING id`);
        resolvedPlayer = created.rows[0]!.id;
        await tx.execute(sql`INSERT INTO player_markets(player_id, status) VALUES (${resolvedPlayer}, 'PROFILE_ONLY')`);
      }
      await tx.execute(sql`INSERT INTO provider_player_mappings(provider, external_id, player_id) VALUES (${issue.provider}, ${issue.external_id}, ${resolvedPlayer})`);
    }
    await tx.execute(sql`
      UPDATE import_issues SET resolution = ${r.kind === "IGNORE" ? "IGNORED" : "RESOLVED"}, resolved_by = ${actor.id}, resolved_at = now(),
             resolution_note = ${reason}, resolved_player_id = ${resolvedPlayer}
       WHERE id = ${issue.id}`);
    await writeAudit(tx, { actorId: actor.id, actorKind: "ADMIN", action: `IMPORT_ISSUE_${r.kind}`, reason, entityType: "import_issue", entityId: issue.id, related: { externalId: issue.external_id, playerId: resolvedPlayer } });
  });
}

/** Players for the admission screen, filtered by name or status. */
export async function listPlayersForAdmission(db: Db, f: { q?: string; admission?: string; limit?: number } = {}) {
  const where = [sql`true`];
  if (f.q?.trim()) where.push(sql`px_search_key(p.display_name) LIKE px_search_key(${`%${f.q.trim().slice(0, 60)}%`})`);
  if (f.admission && (ADMISSIONS as readonly string[]).includes(f.admission)) where.push(sql`p.primary_admission::text = ${f.admission}`);
  const res = await db.execute<PlayerFacts & { display_name: string; team: string | null }>(sql`
    SELECT p.id, p.display_name, p.career_status::text, p.data_quality::text, p.primary_admission::text, p.is_fictional, p.identity_rights_released,
           CASE WHEN p.birth_date IS NULL THEN NULL ELSE date_part('year', age((now() AT TIME ZONE 'Europe/Amsterdam')::date, p.birth_date))::int END AS age,
           (SELECT count(*) FROM cards c WHERE c.player_id = p.id AND c.status = 'OWNED')::int AS in_circulation,
           coalesce(pm.status::text, 'PROFILE_ONLY') AS market_status,
           (SELECT t.name FROM player_team_memberships m JOIN teams t ON t.id = m.team_id WHERE m.player_id = p.id AND m.valid_to IS NULL ORDER BY (m.membership_type = 'FIRST_TEAM') DESC LIMIT 1) AS team
      FROM players p LEFT JOIN player_markets pm ON pm.player_id = p.id
     WHERE ${sql.join(where, sql` AND `)}
     ORDER BY p.display_name LIMIT ${Math.min(f.limit ?? 50, 200)}`);
  return res.rows.map((r) => ({ ...r, blocker: admissionBlocker(r) }));
}
