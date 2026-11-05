import { loadConfig } from "@px/integrations/env";
import { handlePaymentWebhook } from "@px/db";
import { NextResponse } from "next/server";
import { payments } from "@/server/payments";

export const dynamic = "force-dynamic";

/**
 * Webhook endpoint of the demo payment simulator. Authenticated by the
 * provider signature only, never by cookies. A duplicate is acknowledged and
 * changes nothing (AT-10).
 */
export async function POST(req: Request) {
  if (loadConfig(process.env).adapters.payment !== "demo") return new NextResponse(null, { status: 404 });
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  try {
    const r = await handlePaymentWebhook(payments(), { headers, rawBody });
    return NextResponse.json({ result: r.result }, { status: r.http });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "payment webhook failed", error: String(e) }));
    // Not acknowledged: the provider delivers again; nothing is booked twice.
    return NextResponse.json({ result: "ERROR" }, { status: 500 });
  }
}
