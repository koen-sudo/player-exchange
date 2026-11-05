import { randomUUID } from "node:crypto";
import { createOrderPreview, getDb } from "@px/db";
import { loadConfig } from "@px/integrations/env";
import { currentUser } from "@/server/session";
import { apiError, apiFromError, apiOk, sameOrigin } from "@/server/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/order-previews — the server checks the order against current
 * state and computes all totals. It reserves nothing; valid 60 seconds (docs/06).
 */
export async function POST(req: Request) {
  const requestId = randomUUID();
  if (!sameOrigin(req)) return apiError("ACTION_NOT_ALLOWED", requestId, "cross-origin preview");
  const user = await currentUser();
  if (!user) return apiError("AUTH_REQUIRED", requestId);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("ACTION_NOT_ALLOWED", requestId, "invalid json");
  }
  if (!body || typeof body !== "object") return apiError("ACTION_NOT_ALLOWED", requestId);
  try {
    // The server determines the user from the session, never from the body.
    const preview = await createOrderPreview(getDb().db, loadConfig(process.env).mode, user.id, body as Record<string, unknown>);
    return apiOk(preview, requestId);
  } catch (e) {
    return apiFromError(e, requestId);
  }
}
