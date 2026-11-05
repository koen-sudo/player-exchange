import { getCatalogPlayer, getDb } from "@px/db";
import { apiOk } from "@/server/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/players/{id} — public profile and data status (docs/06). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = await getCatalogPlayer(getDb().db, id);
  if (!player) return Response.json({ code: "NOT_FOUND", message: "Speler niet gevonden." }, { status: 404 });
  return apiOk(player);
}
