import { randomUUID } from "node:crypto";
import { requestWithdrawal } from "@px/db";
import { parseCentsString } from "@px/domain";
import { guardSensitive } from "@/server/guard";
import { currentUser } from "@/server/session";
import { apiError, apiFromError, apiOk, idempotencyKey, sameOrigin } from "@/server/api";
import { payments } from "@/server/payments";

export const dynamic = "force-dynamic";

/** POST /api/v1/withdrawals {amountCents: "1500"} — requests a payout (docs/06). */
export async function POST(req: Request) {
  const requestId = randomUUID();
  if (!sameOrigin(req)) return apiError("ACTION_NOT_ALLOWED", requestId);
  const user = await currentUser();
  if (!user) return apiError("AUTH_REQUIRED", requestId);
  const key = idempotencyKey(req);
  if (!key) return apiError("ACTION_NOT_ALLOWED", requestId, "missing Idempotency-Key");
  try {
    await guardSensitive("withdrawal.request", user.id);
    const body = (await req.json().catch(() => ({}))) as { amountCents?: unknown };
    const amount = parseCentsString(String(body.amountCents ?? ""));
    const r = await requestWithdrawal(payments(), { userId: user.id, amount, requestKey: key });
    return apiOk(r, requestId);
  } catch (e) {
    return apiFromError(e, requestId);
  }
}
