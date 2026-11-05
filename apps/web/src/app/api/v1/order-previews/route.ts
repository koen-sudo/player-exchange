import { randomUUID } from "node:crypto";
import { currentUser } from "@/server/session";
import { buildOrderPreview } from "@/server/order-preview";
import { apiError, apiOk, sameOrigin } from "@/server/api";
import { loadWorld } from "@/server/world";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = randomUUID();
  if (!sameOrigin(req)) return apiError("ACTION_NOT_ALLOWED", requestId, "cross-origin preview");
  const user = await currentUser();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("ACTION_NOT_ALLOWED", requestId, "invalid json");
  }
  if (!body || typeof body !== "object") return apiError("ACTION_NOT_ALLOWED", requestId);
  // The server determines the user from the session, never from the body.
  const actor = user ? { id: user.id, trade: user.actions.TRADE } : null;
  const result = buildOrderPreview(await loadWorld(user?.id ?? null), actor, body as Record<string, unknown>, new Date(), randomUUID);
  return result.ok ? apiOk(result.preview, requestId) : apiError(result.code, requestId, result.details);
}
