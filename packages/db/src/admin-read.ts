/**
 * Read models for the admin area (docs/02 UX-11). Callers must check the
 * matching permission first; these functions do not authorise.
 */
import { desc, sql } from "drizzle-orm";
import type { Executor } from "./client.ts";
import { auditEvents, importRuns } from "./schema.ts";

export async function listImportRuns(db: Executor, limit = 10) {
  return db.select().from(importRuns).orderBy(desc(importRuns.createdAt)).limit(limit);
}

export async function listOpenImportIssues(db: Executor, limit = 50) {
  const res = await db.execute<{ id: string; kind: string; external_id: string | null; detail: Record<string, unknown>; created_at: string }>(sql`
    SELECT id, kind, external_id, detail, created_at FROM import_issues WHERE resolution = 'OPEN' ORDER BY created_at DESC LIMIT ${limit}`);
  return res.rows;
}

export async function catalogCoverage(db: Executor) {
  const res = await db.execute<{ competition: string; teams: string; players: string; open_markets: string; missing_data: string }>(sql`
    SELECT c.name AS competition,
           count(DISTINCT tcm.team_id) AS teams,
           count(DISTINCT m.player_id) AS players,
           count(DISTINCT m.player_id) FILTER (WHERE pm.status = 'OPEN') AS open_markets,
           count(DISTINCT m.player_id) FILTER (WHERE p.data_quality = 'MISSING') AS missing_data
      FROM competitions c
      LEFT JOIN team_competition_memberships tcm ON tcm.competition_id = c.id AND tcm.valid_to IS NULL
      LEFT JOIN player_team_memberships m ON m.team_id = tcm.team_id AND m.valid_to IS NULL
      LEFT JOIN players p ON p.id = m.player_id
      LEFT JOIN player_markets pm ON pm.player_id = m.player_id
     GROUP BY c.name ORDER BY c.name`);
  const totals = await db.execute<{ players: string; without_team: string }>(sql`
    SELECT count(*) AS players,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM player_team_memberships m WHERE m.player_id = p.id AND m.valid_to IS NULL)) AS without_team
      FROM players p`);
  return {
    perCompetition: res.rows.map((r) => ({ competition: r.competition, teams: Number(r.teams), players: Number(r.players), openMarkets: Number(r.open_markets), missingData: Number(r.missing_data) })),
    players: Number(totals.rows[0]!.players),
    withoutTeam: Number(totals.rows[0]!.without_team),
  };
}

export async function listUsersForAdmin(db: Executor) {
  const res = await db.execute<{
    id: string; display_name: string | null; status: string; verification_status: string | null; residence_country: string | null;
    is_test_account: boolean; roles: string[] | null; restrictions: { id: string; type: string; reason: string; starts_at: string; ends_at: string | null }[] | null;
  }>(sql`
    SELECT u.id, up.display_name, u.status, up.verification_status, up.residence_country, u.is_test_account,
           (SELECT array_agg(ur.role_key ORDER BY ur.role_key) FROM user_roles ur WHERE ur.user_id = u.id) AS roles,
           (SELECT json_agg(json_build_object('id', r.id, 'type', r.type, 'reason', r.reason, 'starts_at', r.starts_at, 'ends_at', r.ends_at) ORDER BY r.starts_at DESC)
              FROM user_restrictions r WHERE r.user_id = u.id AND (r.ends_at IS NULL OR r.ends_at > now())) AS restrictions
      FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id
     ORDER BY up.display_name NULLS LAST, u.id`);
  return res.rows.map((r) => ({
    id: r.id,
    displayName: r.display_name ?? "(geen naam)",
    status: r.status,
    verification: r.verification_status ?? "NOT_STARTED",
    residenceCountry: r.residence_country,
    isTestAccount: r.is_test_account,
    roles: r.roles ?? [],
    restrictions: r.restrictions ?? [],
  }));
}

export async function listAuditEvents(db: Executor, limit = 100) {
  const res = await db.execute<{ id: string; actor_name: string | null; actor_kind: string; action: string; reason: string | null; entity_type: string; entity_id: string; related: Record<string, unknown>; occurred_at: string }>(sql`
    SELECT a.id, up.display_name AS actor_name, a.actor_kind, a.action, a.reason, a.entity_type, a.entity_id, a.related, a.occurred_at
      FROM ${auditEvents} a LEFT JOIN user_profiles up ON up.user_id = a.actor_id
     ORDER BY a.occurred_at DESC LIMIT ${limit}`);
  return res.rows;
}

export async function listOpenIssuesWithCandidates(db: Executor, limit = 50) {
  const res = await db.execute<{ id: string; kind: string; external_id: string | null; detail: Record<string, unknown>; created_at: string; candidates: { id: string; name: string; birth_date: string | null; team: string | null }[] | null }>(sql`
    SELECT i.id, i.kind, i.external_id, i.detail, i.created_at,
           (SELECT json_agg(json_build_object('id', p.id, 'name', p.display_name, 'birth_date', p.birth_date,
                    'team', (SELECT t.name FROM player_team_memberships m JOIN teams t ON t.id = m.team_id WHERE m.player_id = p.id AND m.valid_to IS NULL LIMIT 1)))
              FROM players p WHERE p.id::text IN (SELECT jsonb_array_elements_text(coalesce(i.detail -> 'candidates', '[]'::jsonb)))) AS candidates
      FROM import_issues i WHERE i.resolution = 'OPEN' ORDER BY i.created_at DESC LIMIT ${limit}`);
  return res.rows;
}
