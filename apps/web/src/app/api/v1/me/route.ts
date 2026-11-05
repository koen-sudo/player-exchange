import { currentUser } from "@/server/session";
import { apiError, apiOk } from "@/server/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/me — own profile, status and allowed actions (docs/06).
 * Only ever about the signed-in user; the id comes from the session.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return apiError("AUTH_REQUIRED");
  return apiOk({
    id: user.id,
    displayName: user.displayName,
    verified: user.verified,
    residenceCountry: user.residenceCountry,
    roles: user.roles,
    allowedActions: Object.fromEntries(
      Object.entries(user.actions).map(([k, v]) => [k, v.allowed ? { allowed: true } : { allowed: false, code: v.code, reason: v.reason }]),
    ),
  });
}
