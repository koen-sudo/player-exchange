"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DomainError } from "@px/domain";
import { cancelOrder } from "@px/db";
import { currentUser } from "@/server/session";
import { payments } from "@/server/payments";

/** Cancel the free remainder of one of the user's own orders (UX-08). */
export async function cancelOrderAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  let target: string;
  try {
    const r = await cancelOrder(payments(), user.id, String(formData.get("orderId") ?? ""));
    target = `/transacties?melding=${encodeURIComponent(`${r.cancelled} ${r.cancelled === 1 ? "kaart" : "kaarten"} geannuleerd. Het vrijgekomen deel staat weer tot je beschikking.`)}`;
  } catch (e) {
    const msg = e instanceof DomainError ? e.userMessage : "Er ging iets mis. Er is niets gewijzigd.";
    if (!(e instanceof DomainError)) console.error(JSON.stringify({ level: "error", msg: "cancel failed", error: String(e) }));
    target = `/transacties?fout=${encodeURIComponent(msg)}`;
  }
  revalidatePath("/transacties");
  redirect(target);
}
