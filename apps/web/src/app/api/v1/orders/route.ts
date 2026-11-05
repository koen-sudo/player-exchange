import { randomUUID } from "node:crypto";
import { placeOrder } from "@px/db";
import { currentUser } from "@/server/session";
import { apiError, apiFromError, apiOk, idempotencyKey, sameOrigin } from "@/server/api";
import { payments } from "@/server/payments";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/orders {previewId} — confirms a server preview and places the
 * order. Everything is checked again under locks; money or cards are reserved
 * in the same transaction. A repeat with the same Idempotency-Key returns the
 * same order.
 */
export async function POST(req: Request) {
  const requestId = randomUUID();
  if (!sameOrigin(req)) return apiError("ACTION_NOT_ALLOWED", requestId);
  const user = await currentUser();
  if (!user) return apiError("AUTH_REQUIRED", requestId);
  const key = idempotencyKey(req);
  if (!key) return apiError("ACTION_NOT_ALLOWED", requestId, "missing Idempotency-Key");
  try {
    const body = (await req.json().catch(() => ({}))) as { previewId?: unknown };
    const r = await placeOrder(payments(), user.id, { previewId: String(body.previewId ?? ""), requestKey: key });
    return apiOk(r, requestId);
  } catch (e) {
    return apiFromError(e, requestId);
  }
}
