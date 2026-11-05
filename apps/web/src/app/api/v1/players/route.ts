import { demoWorld, listMarket } from "@px/demo";
import { parseMarketParams } from "@/lib/market-params";
import { apiOk } from "@/server/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const result = listMarket(demoWorld(), parseMarketParams(params));
  // Amounts on the wire are integer-cent strings (docs/06).
  return apiOk({
    ...result,
    rows: result.rows.map((r) => ({
      ...r,
      reference: r.reference === null ? null : String(r.reference),
      change: r.change === null ? null : String(r.change),
      bestBid: r.bestBid === null ? null : String(r.bestBid),
      bestAsk: r.bestAsk === null ? null : String(r.bestAsk),
    })),
  });
}
