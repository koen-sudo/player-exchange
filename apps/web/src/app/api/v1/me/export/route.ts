import { exportUserData, getDb } from "@px/db";
import { currentUser } from "@/server/session";
import { apiError } from "@/server/api";

export const dynamic = "force-dynamic";

/** GET /api/v1/me/export — the signed-in person's own data as a JSON download. */
export async function GET() {
  const user = await currentUser();
  if (!user) return apiError("AUTH_REQUIRED");
  const data = await exportUserData(getDb().db, user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="player-exchange-gegevens-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
