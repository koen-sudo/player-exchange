import { loadConfig } from "@px/integrations/env";

export const dynamic = "force-dynamic";

export function GET() {
  const cfg = loadConfig(process.env);
  return Response.json({ status: "ok", mode: cfg.mode, time: new Date().toISOString() });
}
