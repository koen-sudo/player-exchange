import { getDb, listTeams } from "@px/db";
import { apiOk } from "@/server/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/teams?competitionId=… */
export async function GET(req: Request) {
  const competitionId = new URL(req.url).searchParams.get("competitionId") ?? undefined;
  return apiOk(await listTeams(getDb().db, competitionId));
}
