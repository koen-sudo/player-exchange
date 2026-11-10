/**
 * The market screen's list (UX-01) as one SQL query: filter, sort and page in
 * the database, so a request reads one page of players instead of the whole
 * catalogue (R-69). Same columns and rules as the demo read model
 * (`listMarket` in @px/demo): published reference only, change against the
 * previous published value, bid and ask only for open markets, nulls last.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Executor } from "./client.ts";

export type MarketPageFilter = {
  q?: string;
  competitionId?: string;
  teamId?: string;
  role?: string;
  minAge?: number;
  maxAge?: number;
  status?: string; // a market status, or TRADABLE (= OPEN)
  sort?: "name" | "reference" | "change" | "bid" | "ask" | "age";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type MarketPageRow = {
  player_id: string;
  display_name: string;
  team_name: string | null;
  competition_name: string | null;
  role: string | null;
  age: number | null;
  market_status: string;
  data_quality: string;
  career_status: string;
  reference_cents: string | null;
  change_cents: string | null;
  best_bid_cents: string | null;
  best_ask_cents: string | null;
  has_upcoming_drop: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fixed SQL per sort key: no user text reaches ORDER BY.
const SORT_SQL: Record<NonNullable<MarketPageFilter["sort"]>, { asc: SQL; desc: SQL }> = {
  name: { asc: sql`px_search_key(display_name) ASC, display_name ASC, player_id ASC`, desc: sql`px_search_key(display_name) DESC, display_name DESC, player_id DESC` },
  reference: { asc: sql`reference_cents ASC NULLS LAST`, desc: sql`reference_cents DESC NULLS LAST` },
  change: { asc: sql`change_cents ASC NULLS LAST`, desc: sql`change_cents DESC NULLS LAST` },
  bid: { asc: sql`best_bid_cents ASC NULLS LAST`, desc: sql`best_bid_cents DESC NULLS LAST` },
  ask: { asc: sql`best_ask_cents ASC NULLS LAST`, desc: sql`best_ask_cents DESC NULLS LAST` },
  age: { asc: sql`age ASC NULLS LAST`, desc: sql`age DESC NULLS LAST` },
};

export async function marketPage(db: Executor, f: MarketPageFilter = {}) {
  const where: SQL[] = [sql`true`];
  if (f.q && f.q.trim()) {
    const term = `%${f.q.trim().slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(sql`px_search_key(display_name || ' ' || coalesce(team_name, '') || ' ' || coalesce(competition_name, '')) LIKE px_search_key(${term})`);
  }
  if (f.competitionId && UUID.test(f.competitionId)) where.push(sql`competition_id = ${f.competitionId}::uuid`);
  if (f.teamId && UUID.test(f.teamId)) where.push(sql`team_id = ${f.teamId}::uuid`);
  if (f.role) where.push(sql`role = ${f.role}`);
  if (f.minAge !== undefined) where.push(sql`age >= ${f.minAge}`);
  if (f.maxAge !== undefined) where.push(sql`age <= ${f.maxAge}`);
  if (f.status) where.push(sql`market_status = ${f.status === "TRADABLE" ? "OPEN" : f.status}`);

  const sort = SORT_SQL[f.sort ?? "name"][f.dir === "desc" ? "desc" : "asc"];
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const requested = Math.max(f.page ?? 1, 1);

  const run = (page: number) => db.execute<MarketPageRow & { total: string }>(sql`
    WITH cur AS (
      SELECT DISTINCT ON (m.player_id) m.player_id, m.team_id FROM player_team_memberships m
       WHERE m.valid_to IS NULL ORDER BY m.player_id, (m.membership_type = 'FIRST_TEAM') DESC, m.valid_from DESC
    ), role AS (
      SELECT DISTINCT ON (r.player_id) r.player_id, r.role FROM player_roles r WHERE r.valid_to IS NULL
       ORDER BY r.player_id, r.weight DESC, r.valid_from DESC
    ), comp AS (
      SELECT DISTINCT ON (tcm.team_id) tcm.team_id, c.id, c.name
        FROM team_competition_memberships tcm JOIN competitions c ON c.id = tcm.competition_id
       WHERE tcm.valid_to IS NULL ORDER BY tcm.team_id, tcm.valid_from DESC
    ), prev AS (
      SELECT player_id, amount_cents FROM (
        SELECT v.player_id, v.amount_cents, row_number() OVER (PARTITION BY v.player_id ORDER BY vr.published_at DESC) AS rn
          FROM player_reference_values v JOIN valuation_runs vr ON vr.id = v.run_id AND vr.status = 'PUBLISHED') x
       WHERE rn = 2
    ), book AS (
      SELECT pm.player_id,
             max(o.limit_price_cents) FILTER (WHERE o.side = 'BUY') AS bid,
             min(o.limit_price_cents) FILTER (WHERE o.side = 'SELL') AS ask
        FROM orders o JOIN player_markets pm ON pm.id = o.player_market_id
       WHERE o.state = 'ACTIVE' AND o.qty_open > 0 AND o.expires_at > now() AND pm.status = 'OPEN'
       GROUP BY pm.player_id
    ), upcoming AS (
      SELECT DISTINCT e.player_id FROM drops d JOIN editions e ON e.id = d.edition_id WHERE d.status IN ('PUBLISHED', 'OPEN')
    ), base AS (
      SELECT p.id AS player_id, p.display_name, t.id AS team_id, t.name AS team_name, comp.id AS competition_id, comp.name AS competition_name,
             role.role, coalesce(pm.status::text, 'PROFILE_ONLY') AS market_status, p.data_quality::text AS data_quality, p.career_status::text AS career_status,
             CASE WHEN p.birth_date IS NULL THEN NULL
                  ELSE date_part('year', age((now() AT TIME ZONE 'Europe/Amsterdam')::date, p.birth_date))::int END AS age,
             prv.amount_cents AS reference_cents,
             CASE WHEN prv.amount_cents IS NOT NULL AND prev.amount_cents IS NOT NULL THEN prv.amount_cents - prev.amount_cents END AS change_cents,
             CASE WHEN pm.status = 'OPEN' THEN book.bid END AS best_bid_cents,
             CASE WHEN pm.status = 'OPEN' THEN book.ask END AS best_ask_cents,
             upcoming.player_id IS NOT NULL AS has_upcoming_drop
        FROM players p
        LEFT JOIN cur ON cur.player_id = p.id
        LEFT JOIN teams t ON t.id = cur.team_id
        LEFT JOIN comp ON comp.team_id = t.id
        LEFT JOIN role ON role.player_id = p.id
        LEFT JOIN player_markets pm ON pm.player_id = p.id
        LEFT JOIN public_reference_values prv ON prv.player_id = p.id
        LEFT JOIN prev ON prev.player_id = p.id
        LEFT JOIN book ON book.player_id = p.id
        LEFT JOIN upcoming ON upcoming.player_id = p.id
    )
    SELECT player_id, display_name, team_name, competition_name, role, age, market_status, data_quality, career_status,
           reference_cents::text, change_cents::text, best_bid_cents::text, best_ask_cents::text, has_upcoming_drop,
           count(*) OVER () AS total
      FROM base WHERE ${sql.join(where, sql` AND `)}
     ORDER BY ${sort}, px_search_key(display_name), player_id
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);

  let res = await run(requested);
  let page = requested;
  // A page past the end (old link, filter changed) shows the last page, like the demo model.
  if (res.rows.length === 0 && requested > 1) {
    const count = await run(1);
    const total = Number(count.rows[0]?.total ?? 0);
    page = Math.max(1, Math.ceil(total / pageSize));
    res = page === 1 ? count : await run(page);
  }
  const total = Number(res.rows[0]?.total ?? 0);
  return { rows: res.rows as MarketPageRow[], total, page, pages: Math.max(1, Math.ceil(total / pageSize)), pageSize };
}
