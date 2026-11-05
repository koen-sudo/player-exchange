/**
 * Shared API response helpers (docs/06 "Foutcodes").
 * Errors carry requestId, code and a usable Dutch message; internal details
 * stay in server logs.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { USER_MESSAGES_NL, type ErrorCode } from "@px/domain";

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
};

export function apiError(code: ErrorCode, requestId = randomUUID(), logDetail?: unknown) {
  if (logDetail !== undefined) console.warn(JSON.stringify({ requestId, code, detail: logDetail }));
  return NextResponse.json({ requestId, code, message: USER_MESSAGES_NL[code] }, { status: STATUS[code] ?? 422 });
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
