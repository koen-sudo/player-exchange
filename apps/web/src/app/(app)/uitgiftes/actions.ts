"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DomainError } from "@px/domain";
import { cancelSubscription, subscribe } from "@px/db";
import { guardSensitive } from "@/server/guard";
import { currentUser } from "@/server/session";
import { payments } from "@/server/payments";

export type SubscribeResult = { ok: true; message: string } | { ok: false; message: string };

/** Step 3 of UX-05: reserve the amount and confirm the subscription. */
export async function subscribeAction(dropId: string, requestKey: string): Promise<SubscribeResult> {
  const user = await currentUser();
  if (!user) return { ok: false, message: "Log in om in te schrijven." };
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestKey)) return { ok: false, message: "Vernieuw de pagina en probeer het opnieuw." };
  try {
    await guardSensitive("drop.subscribe", user.id);
    const r = await subscribe(payments(), user.id, { dropId, requestKey });
    // No revalidation here: that would re-render the page under the open
    // dialog. The dialog refreshes the page when it is closed.
    return r.status === "CONFIRMED"
      ? { ok: true, message: "Je bent ingeschreven. Het bedrag is gereserveerd; je betaalt alleen als je een kaart krijgt. Na sluiting volgt de toewijzing." }
      : { ok: true, message: "Je inschrijving wordt nog bevestigd." };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, message: e.userMessage };
    console.error(JSON.stringify({ level: "error", msg: "subscribe failed", error: String(e) }));
    return { ok: false, message: "Er ging iets mis. Er is niets gereserveerd." };
  }
}

export async function cancelSubscriptionAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const back = String(formData.get("terug") ?? "/uitgiftes");
  const safe = back.startsWith("/uitgiftes") ? back : "/uitgiftes";
  let note: string;
  try {
    await cancelSubscription(payments(), user.id, String(formData.get("subscriptionId") ?? ""));
    note = `melding=${encodeURIComponent("Je bent afgemeld. De reservering is vrijgegeven.")}`;
  } catch (e) {
    note = `fout=${encodeURIComponent(e instanceof DomainError ? e.userMessage : "Er ging iets mis. Er is niets gewijzigd.")}`;
  }
  revalidatePath("/uitgiftes");
  redirect(`${safe}${safe.includes("?") ? "&" : "?"}${note}`);
}
