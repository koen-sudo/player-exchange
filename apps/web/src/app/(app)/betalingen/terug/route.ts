import { redirect } from "next/navigation";
import { refreshDeposit } from "@px/db";
import { currentUser } from "@/server/session";
import { payments } from "@/server/payments";

export const dynamic = "force-dynamic";

/**
 * Return from the checkout page. The platform asks the provider for the
 * status (server to server); the return itself never confirms a payment
 * (AT-11, docs/07 Deposits).
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const id = new URL(req.url).searchParams.get("storting") ?? "";
  if (/^[0-9a-f-]{36}$/.test(id)) {
    try {
      await refreshDeposit(payments(), user.id, id);
    } catch (e) {
      console.warn(JSON.stringify({ level: "warn", msg: "deposit refresh on return failed", error: String(e) }));
    }
  }
  redirect(`/betalingen?storting=${encodeURIComponent(id)}`);
}
