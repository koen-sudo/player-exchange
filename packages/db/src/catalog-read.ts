/**
 * Public catalogue reads (docs/06 "Publieke en catalogus-endpoints").
 *
 * - Cursor pagination on (display_name, id): stable under inserts.
 * - Only published reference values (public_reference_values view, AT-29).
 * - No personal data beyond what a public profile needs: age, not birth date;
 *   nothing about users. Real identities are only shown after release of the
 *   player-identity gate (O-10); demo profiles are fictional.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Executor } from "./client.ts";

export type CatalogFilter = {
  q?: string;
  competitionId?: string;
  teamId?: string;
  role?: string;
  minAge?: number;
  maxAge?: number;
  marketStatus?: string;
  limit?: number;
  cursor?: string | null;
};

export type CatalogPlayer = {
  id: string;
  name: string;
  age: number | null;
  nationality: string | null;
  role: string | null;
  team: { id: string; name: string } | null;
  competition: { id: string; name: string; countryCode: string } | null;
  marketStatus: string;
  dataQuality: string;
  careerStatus: string;
  isFictional: boolean;
  reference: { amountMinor: string; publishedAt: string; modelVersion: string; isDemoModel: boolean; isHistorical: boolean } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(name: string, id: string): string {
  return Buffer.from(JSON.stringify([name, id]), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): [string, string] | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "string" && UUID.test(v[1])) return [v[0], v[1]];
  } catch {
    /* fall through */
  }
  return null;
}

const BASE = sql`
  WITH cur AS (
    SELECT DISTINCT ON (m.player_id) m.player_id, m.team_id
      FROM player_team_memberships m
     WHERE m.valid_to IS NULL
     ORDER BY m.player_id, (m.membership_type = 'FIRST_TEAM') DESC, m.valid_from DESC
  ), role AS (
    SELECT DISTINCT ON (r.player_id) r.player_id, r.role
      FROM player_roles r WHERE r.valid_to IS NULL
     ORDER BY r.player_id, r.weight DESC, r.valid_from DESC
  ), comp AS (
    SELECT DISTINCT ON (tcm.team_id) tcm.team_id, c.id, c.name, c.country_code
      FROM team_competition_memberships tcm JOIN competitions c ON c.id = tcm.competition_id
     WHERE tcm.valid_to IS NULL
     ORDER BY tcm.team_id, tcm.valid_from DESC
  )
  SELECT p.id, p.display_name, p.nationality, p.career_status, p.data_quality, p.is_fictional,
         CASE WHEN p.birth_date IS NULL THEN NULL
              ELSE date_part('year', age((now() AT TIME ZONE 'Europe/Amsterdam')::date, p.birth_date))::int END AS age,
         role.role, t.id AS team_id, t.name AS team_name,
         comp.id AS competition_id, comp.name AS competition_name, comp.country_code,
         coalesce(pm.status::text, 'PROFILE_ONLY') AS market_status,
         prv.amount_cents, prv.published_at, prv.model_version, prv.is_demo, prv.is_historical
    FROM players p
    LEFT JOIN cur ON cur.player_id = p.id
    LEFT JOIN teams t ON t.id = cur.team_id
    LEFT JOIN comp ON comp.team_id = t.id
    LEFT JOIN role ON role.player_id = p.id
    LEFT JOIN player_markets pm ON pm.player_id = p.id
    LEFT JOIN public_reference_values prv ON prv.player_id = p.id`;

type Row = {
  id: string; display_name: string; nationality: string | null; career_status: string; data_quality: string; is_fictional: boolean;
  age: number | null; role: string | null; team_id: string | null; team_name: string | null;
  competition_id: string | null; competition_name: string | null; country_code: string | null; market_status: string;
  amount_cents: string | null; published_at: Date | string | null; model_version: string | null; is_demo: boolean | null; is_historical: boolean | null;
};

function toPlayer(r: Row): CatalogPlayer {
  return {
    id: r.id,
    name: r.display_name,
    age: r.age,
    nationality: r.nationality,
    role: r.role,
    team: r.team_id ? { id: r.team_id, name: r.team_name! } : null,
    competition: r.competition_id ? { id: r.competition_id, name: r.competition_name!, countryCode: r.country_code! } : null,
    marketStatus: r.market_status,
    dataQuality: r.data_quality,
    careerStatus: r.career_status,
    isFictional: r.is_fictional,
    reference: r.amount_cents === null ? null : {
      amountMinor: String(r.amount_cents),
      publishedAt: new Date(r.published_at!).toISOString(),
      modelVersion: r.model_version!,
      isDemoModel: !!r.is_demo,
      isHistorical: !!r.is_historical,
    },
  };
}

export async function listCatalogPlayers(db: Executor, f: CatalogFilter = {}): Promise<{ items: CatalogPlayer[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(f.limit ?? 25, 1), 100);
  const where: SQL[] = [];
  if (f.q && f.q.trim()) {
    const term = `%${f.q.trim().slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(sql`(px_search_key(p.display_name) LIKE px_search_key(${term}) OR px_search_key(coalesce(t.name, '')) LIKE px_search_key(${term}))`);
  }
  if (f.competitionId && UUID.test(f.competitionId)) where.push(sql`comp.id = ${f.competitionId}::uuid`);
  if (f.teamId && UUID.test(f.teamId)) where.push(sql`t.id = ${f.teamId}::uuid`);
  if (f.role) where.push(sql`role.role = ${f.role}`);
  if (f.marketStatus === "TRADABLE") where.push(sql`pm.status = 'OPEN'`);
  else if (f.marketStatus) where.push(sql`pm.status::text = ${f.marketStatus}`);
  if (f.minAge !== undefined) where.push(sql`p.birth_date <= ((now() AT TIME ZONE 'Europe/Amsterdam')::date - make_interval(years => ${f.minAge}))`);
  if (f.maxAge !== undefined) where.push(sql`p.birth_date > ((now() AT TIME ZONE 'Europe/Amsterdam')::date - make_interval(years => ${f.maxAge + 1}))`);
  const cur = decodeCursor(f.cursor);
  if (cur) where.push(sql`(p.display_name, p.id) > (${cur[0]}, ${cur[1]}::uuid)`);

  const whereSql = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
  const res = await db.execute<Row>(sql`${BASE} ${whereSql} ORDER BY p.display_name, p.id LIMIT ${limit + 1}`);
  const rows = res.rows;
  const more = rows.length > limit;
  const items = rows.slice(0, limit).map(toPlayer);
  const last = items[items.length - 1];
  return { items, nextCursor: more && last ? encodeCursor(last.name, last.id) : null };
}

export async function getCatalogPlayer(db: Executor, id: string): Promise<CatalogPlayer | null> {
  if (!UUID.test(id)) return null;
  const res = await db.execute<Row>(sql`${BASE} WHERE p.id = ${id}::uuid`);
  return res.rows[0] ? toPlayer(res.rows[0]) : null;
}

export async function listCompetitions(db: Executor) {
  const res = await db.execute<{ id: string; name: string; country_code: string; teams: string; players: string }>(sql`
    SELECT c.id, c.name, c.country_code,
           count(DISTINCT tcm.team_id) AS teams,
           count(DISTINCT m.player_id) AS players
      FROM competitions c
      LEFT JOIN team_competition_memberships tcm ON tcm.competition_id = c.id AND tcm.valid_to IS NULL
      LEFT JOIN player_team_memberships m ON m.team_id = tcm.team_id AND m.valid_to IS NULL
     WHERE c.active
     GROUP BY c.id ORDER BY c.name`);
  return res.rows.map((r) => ({ id: r.id, name: r.name, countryCode: r.country_code, coverage: { teams: Number(r.teams), players: Number(r.players) } }));
}

export async function listTeams(db: Executor, competitionId?: string) {
  const filter = competitionId && UUID.test(competitionId) ? sql`AND tcm.competition_id = ${competitionId}::uuid` : sql``;
  const res = await db.execute<{ id: string; name: string; competition_id: string; players: string }>(sql`
    SELECT t.id, t.name, tcm.competition_id, count(m.player_id) AS players
      FROM teams t
      JOIN team_competition_memberships tcm ON tcm.team_id = t.id AND tcm.valid_to IS NULL ${filter}
      LEFT JOIN player_team_memberships m ON m.team_id = t.id AND m.valid_to IS NULL
     GROUP BY t.id, tcm.competition_id ORDER BY t.name`);
  return res.rows.map((r) => ({ id: r.id, name: r.name, competitionId: r.competition_id, players: Number(r.players) }));
}
