import { getDb, listCatalogPlayers } from "@px/db";
import { parseMarketParams } from "@/lib/market-params";
import { apiOk } from "@/server/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/players — search, filters and cursor pagination (docs/06). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const f = parseMarketParams(params);
  const limit = Number(url.searchParams.get("limit") ?? 25);
  const page = await listCatalogPlayers(getDb().db, {
    q: f.q,
    competitionId: f.competitionId,
    teamId: f.teamId,
    role: f.role,
    minAge: f.minAge,
    maxAge: f.maxAge,
    marketStatus: f.status,
    limit: Number.isInteger(limit) ? limit : 25,
    cursor: url.searchParams.get("cursor"),
  });
  return apiOk(page);
}
