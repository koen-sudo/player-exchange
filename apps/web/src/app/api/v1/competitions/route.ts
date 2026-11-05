import { getDb, listCompetitions } from "@px/db";
import { apiOk } from "@/server/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/competitions — the configured competitions and their coverage. */
export async function GET() {
  return apiOk(await listCompetitions(getDb().db));
}
