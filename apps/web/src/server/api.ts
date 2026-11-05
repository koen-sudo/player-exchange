/**
 * Shared API response helpers (docs/06 "Foutcodes").
 * Errors carry requestId, code and a usable Dutch message; internal details
 * stay in server logs.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { DomainError, USER_MESSAGES_NL, type ErrorCode } from "@px/domain";

const STATUS: Partial<Record<ErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  ACTION_NOT_ALLOWED: 403,
  VERIFICATION_REQUIRED: 403,
  COUNTRY_NOT_SUPPORTED: 403,
  IDEMPOTENCY_CONFLICT: 409,
  SUBSCRIPTION_EXISTS: 409,
  PREVIEW_EXPIRED: 409,
  PAYMENT_PENDING: 409,
  RECONCILIATION_HOLD: 423,
  INSUFFICIENT_AVAILABLE_FUNDS: 422,
  AMOUNT_INVALID: 422,
  MARKET_NOT_OPEN: 409,
  CARD_UNAVAILABLE: 409,
  SELF_TRADE_REJECTED: 409,
};

export function apiError(code: ErrorCode, requestId = randomUUID(), logDetail?: unknown) {
  if (logDetail !== undefined) console.warn(JSON.stringify({ requestId, code, detail: logDetail }));
  return NextResponse.json({ requestId, code, message: USER_MESSAGES_NL[code] }, { status: STATUS[code] ?? 422 });
}

/** Map a thrown error to the API catalogue; unknown errors never leak details. */
export function apiFromError(e: unknown, requestId = randomUUID()) {
  if (e instanceof DomainError) {
    return NextResponse.json({ requestId, code: e.code, message: e.userMessage }, { status: STATUS[e.code] ?? 422 });
  }
  console.error(JSON.stringify({ requestId, level: "error", error: String(e) }));
  return NextResponse.json({ requestId, code: "INTERNAL", message: "Er ging iets mis. Er is niets gewijzigd." }, { status: 500 });
}

export function apiOk<T>(data: T, requestId = randomUUID()) {
  return NextResponse.json({ requestId, data });
}

/** Mutating financial endpoints require an Idempotency-Key header (docs/06). */
export function idempotencyKey(req: Request): string | null {
  const k = req.headers.get("idempotency-key");
  return k && /^[A-Za-z0-9_-]{8,128}$/.test(k) ? k : null;
}

/** Cookie-authenticated mutations must come from our own origin (CSRF, docs/10). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}
