"use server";

/**
 * Deposit and withdrawal form actions. The user comes from the session; the
 * amount is parsed and checked on the server; the form's request key makes a
 * double submit harmless.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DomainError, parseEuroInput } from "@px/domain";
import { depositByReference, getDb, SIM_SCENARIOS, requestWithdrawal, startDeposit, type SimScenario } from "@px/db";
import { loadConfig } from "@px/integrations/env";
import { guardSensitive } from "@/server/guard";
import { currentUser } from "@/server/session";
import { depositReturnUrl, payments } from "@/server/payments";

const back = (q: Record<string, string>) => `/betalingen?${new URLSearchParams(q).toString()}`;
const messageOf = (e: unknown) => {
  if (e instanceof DomainError) return e.userMessage;
  console.error(JSON.stringify({ level: "error", msg: "payment action failed", error: String(e) }));
  return "Er ging iets mis. Er is niets afgeschreven of bijgeschreven.";
};
const key = (f: FormData) => {
  const k = String(f.get("requestKey") ?? "");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(k)) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Vernieuw de pagina en probeer het opnieuw." });
  return k;
};

export async function depositAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  let target: string;
  try {
    await guardSensitive("deposit.start", user.id);
    const amount = parseEuroInput(String(formData.get("amount") ?? ""));
    const r = await startDeposit(payments(), { userId: user.id, amount, requestKey: key(formData), returnUrl: depositReturnUrl });
    target = r.redirectUrl ?? back({ storting: r.depositId });
  } catch (e) {
    target = back({ fout: messageOf(e) });
  }
  redirect(target);
}

export async function withdrawAction(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  let target: string;
  try {
    await guardSensitive("withdrawal.request", user.id);
    const amount = parseEuroInput(String(formData.get("amount") ?? ""));
    // Demo only: the tester picks how the simulated provider answers.
    const raw = String(formData.get("demoOutcome") ?? "SUCCESS");
    const scenario = loadConfig(process.env).mode === "demo" && (SIM_SCENARIOS as readonly string[]).includes(raw) ? (raw as SimScenario) : "SUCCESS";
    const r = await requestWithdrawal(payments({ scenario }), { userId: user.id, amount, requestKey: key(formData) });
    const text = r.status === "PAID" ? "Opname uitbetaald door de betaalpartner." : r.status === "FAILED" ? "De betaalpartner heeft de opname geweigerd. Het bedrag staat weer in je beschikbare saldo." : "Opname aangevraagd. De betaalpartner verwerkt hem; het bedrag blijft gereserveerd tot de uitkomst bekend is.";
    target = back({ melding: text });
  } catch (e) {
    target = back({ fout: messageOf(e) });
  }
  revalidatePath("/betalingen");
  redirect(target);
}

/** Demo checkout page: the tester decides what the simulated bank does. */
export async function decideDemoPayment(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const cfg = loadConfig(process.env);
  const ref = String(formData.get("ref") ?? "");
  const scenario = String(formData.get("scenario") ?? "");
  const terug = String(formData.get("terug") ?? "/betalingen");
  const safeBack = terug.startsWith("/betalingen") ? terug : "/betalingen";
  if (cfg.mode !== "demo" || !(SIM_SCENARIOS as readonly string[]).includes(scenario)) redirect(safeBack);
  // Only the person who started the payment can complete it in the demo.
  const dep = await depositByReference(getDb().db, ref);
  if (dep?.userId !== user.id) redirect(safeBack);
  await payments().simulator!.decideDeposit(ref, scenario as SimScenario);
  // Back to the platform, which waits for the provider's confirmation (webhook or status query).
  redirect(`/betalingen?storting=${dep.depositId}`);
}
