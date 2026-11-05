import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/server/session";
import { apiError, idempotencyKey, sameOrigin } from "@/server/api";

export const dynamic = "force-dynamic";

/**
 * Placing an order requires the trading, ledger and settlement services
 * (fases 4–5). In this demo build the endpoint validates the request shape,
 * session and idempotency key, then states explicitly that nothing was placed.
 * It never pretends an order exists.
 */
export async function POST(req: Request) {
  const requestId = randomUUID();
  if (!sameOrigin(req)) return apiError("ACTION_NOT_ALLOWED", requestId);
  const user = await currentUser();
  if (!user) return apiError("AUTH_REQUIRED", requestId);
  if (!user.actions.TRADE.allowed) return apiError(user.actions.TRADE.code, requestId);
  if (!idempotencyKey(req)) return apiError("ACTION_NOT_ALLOWED", requestId, "missing Idempotency-Key");
  return NextResponse.json(
    {
      requestId,
      code: "DEMO_NOT_PLACED",
      message: "Demo: de order is gecontroleerd maar niet geplaatst. De handelsdienst wordt in fase 5 aangesloten.",
    },
    { status: 501 },
  );
}
