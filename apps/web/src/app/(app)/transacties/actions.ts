"use server";

import { userMessageFor } from "@/server/errors";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DomainError } from "@px/domain";
import { cancelOrder } from "@px/db";
import { guardSensitive } from "@/server/guard";
import { currentUser } from "@/server/session";
import { payments } from "@/server/payments";

/** Cancel the free remainder of one of the user's own orders (UX-08). */
export async function cancelOrderAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  let target: string;
  try {
    await guardSensitive("order.cancel", user.id);
    const r = await cancelOrder(payments(), user.id, String(formData.get("orderId") ?? ""));
    target = `/transacties?melding=${encodeURIComponent(`${r.cancelled} ${r.cancelled === 1 ? "kaart" : "kaarten"} geannuleerd. Het vrijgekomen deel staat weer tot je beschikking.`)}`;
  } catch (e) {
    const msg = userMessageFor(e, "cancel failed");
    target = `/transacties?fout=${encodeURIComponent(msg)}`;
  }
  revalidatePath("/transacties");
  redirect(target);
}
