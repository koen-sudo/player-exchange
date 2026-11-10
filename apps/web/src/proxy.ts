/**
 * Runs before every request (Next.js proxy).
 *
 * 1. Online demo behind a password (DEMO_ACCESS_PASSWORD). Standard HTTP Basic
 *    authentication over HTTPS; no own protocol. Exempt: the health check (for
 *    the host) and the provider webhook (it carries its own HMAC signature).
 * 2. Content-Security-Policy with a fresh nonce per page request (F-06 rest).
 *    Only scripts that Next.js renders with this nonce may run; 'strict-dynamic'
 *    lets them load their own chunks. Injected inline script has no nonce and
 *    is refused. Styles keep 'unsafe-inline' (style attributes). No
 *    form-action: a deposit redirects to the payment provider's checkout.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

const GATE_EXEMPT = [/^\/api\/v1\/health$/, /^\/api\/v1\/webhooks\//];

function passwordOk(request: NextRequest, password: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const given = decoded.slice(decoded.indexOf(":") + 1);
  // Compare digests so length differences leak nothing.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(password).digest();
  return timingSafeEqual(a, b);
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const password = process.env.DEMO_ACCESS_PASSWORD;
  if (password && !GATE_EXEMPT.some((r) => r.test(path)) && !passwordOk(request, password)) {
    return new NextResponse("Deze demo is afgeschermd. Vraag het wachtwoord aan de eigenaar.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Player Exchange demo", charset="UTF-8"', "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (path.startsWith("/api/")) return NextResponse.next();

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const https = (process.env.WEB_BASE_URL ?? "").startsWith("https://");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
