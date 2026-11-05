import { randomUUID } from "node:crypto";
import { cancelOrder } from "@px/db";
import { currentUser } from "@/server/session";
import { apiError, apiFromError, apiOk, sameOrigin } from "@/server/api";
import { payments } from "@/server/payments";

export const dynamic = "force-dynamic";

/** POST /api/v1/orders/{id}/cancel — cancels only the free, unmatched remainder (UX-08). */
export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const requestId = randomUUID();
  if (!sameOrigin(req)) return apiError("ACTION_NOT_ALLOWED", requestId);
  const user = await currentUser();
  if (!user) return apiError("AUTH_REQUIRED", requestId);
  try {
    return apiOk(await cancelOrder(payments(), user.id, (await params).orderId), requestId);
  } catch (e) {
    return apiFromError(e, requestId);
  }
}
