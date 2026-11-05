/**
 * Market filters live in the URL so they survive back-navigation (UX-01).
 * Parsing is strict: unknown values are dropped, never trusted.
 */
import type { MarketFilter, Role } from "@px/demo";

const ROLES: readonly Role[] = ["GOALKEEPER", "CENTRE_BACK", "FULL_BACK", "DEFENSIVE_MIDFIELDER", "CENTRAL_MIDFIELDER", "WINGER", "STRIKER"];
const STATUSES = ["TRADABLE", "PROFILE_ONLY", "PRELAUNCH", "OPEN", "PAUSED", "CLOSED"] as const;
const SORTS = ["name", "reference", "change", "bid", "ask", "age"] as const;
const UUIDISH = /^[0-9a-f-]{36}$/;

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, k: string): string | undefined => {
  const v = p[k];
  return Array.isArray(v) ? v[0] : v;
};
const int = (v: string | undefined, lo: number, hi: number): number | undefined => {
  if (!v || !/^\d{1,3}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= lo && n <= hi ? n : undefined;
};

export function parseMarketParams(p: Params): MarketFilter {
  const f: MarketFilter = {};
  const q = one(p, "q");
  if (q && q.length <= 80) f.q = q;
  const comp = one(p, "competitie");
  if (comp && UUIDISH.test(comp)) f.competitionId = comp;
  const team = one(p, "team");
  if (team && UUIDISH.test(team)) f.teamId = team;
  const role = one(p, "rol");
  if (role && (ROLES as readonly string[]).includes(role)) f.role = role as Role;
  const minAge = int(one(p, "minLeeftijd"), 14, 45);
  const maxAge = int(one(p, "maxLeeftijd"), 14, 45);
  if (minAge !== undefined) f.minAge = minAge;
  if (maxAge !== undefined) f.maxAge = maxAge;
  const status = one(p, "status");
  if (status && (STATUSES as readonly string[]).includes(status)) f.status = status as MarketFilter["status"];
  if (one(p, "gevolgd") === "1") f.watchlistOnly = true;
  const sort = one(p, "sort");
  if (sort && (SORTS as readonly string[]).includes(sort)) f.sort = sort as MarketFilter["sort"];
  if (one(p, "richting") === "desc") f.dir = "desc";
  const page = int(one(p, "pagina"), 1, 999);
  if (page) f.page = page;
  return f;
}

/** Build a market URL keeping current filters and overriding some. */
export function marketHref(current: MarketFilter, patch: Partial<MarketFilter>): string {
  const f = { ...current, ...patch };
  const s = new URLSearchParams();
  if (f.q) s.set("q", f.q);
  if (f.competitionId) s.set("competitie", f.competitionId);
  if (f.teamId) s.set("team", f.teamId);
  if (f.role) s.set("rol", f.role);
  if (f.minAge !== undefined) s.set("minLeeftijd", String(f.minAge));
  if (f.maxAge !== undefined) s.set("maxLeeftijd", String(f.maxAge));
  if (f.status) s.set("status", f.status);
  if (f.watchlistOnly) s.set("gevolgd", "1");
  if (f.sort && f.sort !== "name") s.set("sort", f.sort);
  if (f.dir === "desc") s.set("richting", "desc");
  if (f.page && f.page > 1) s.set("pagina", String(f.page));
  const qs = s.toString();
  return qs ? `/markt?${qs}` : "/markt";
}
