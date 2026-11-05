import { notFound, redirect } from "next/navigation";
import { depositByReference, getDb } from "@px/db";
import { loadConfig } from "@px/integrations/env";
import { currentUser } from "@/server/session";
import { euro } from "@/lib/format";
import { payments } from "@/server/payments";
import { decideDemoPayment } from "../(app)/betalingen/actions";

export const metadata = { title: "Demo-betaalpagina" };
export const dynamic = "force-dynamic";

/**
 * Stands in for the payment partner's checkout (demo only). It asks for no
 * payment details at all: the tester chooses what the simulated bank does.
 * Whatever is chosen, the platform books money only after the simulator's
 * confirmation reaches it (webhook or status query).
 */
const CHOICES = [
  { scenario: "SUCCESS", label: "Betaling gelukt", hint: "De betaalpartner bevestigt direct via een webhook." },
  { scenario: "DELAYED", label: "Gelukt, met vertraging", hint: "Eerst ‘nog niet beschikbaar’, na ongeveer 20 seconden bijgeschreven." },
  { scenario: "DUPLICATE_WEBHOOKS", label: "Gelukt, bevestiging komt dubbel", hint: "Dezelfde bevestiging wordt meerdere keren verstuurd; er wordt één keer geboekt." },
  { scenario: "UNKNOWN_THEN_SUCCESS", label: "Gelukt, bevestiging komt laat", hint: "De webhook komt pas na ongeveer 20 seconden; statuscontrole kan hem eerder vinden." },
  { scenario: "NO_WEBHOOK", label: "Gelukt, zonder webhook", hint: "Alleen de statuscontrole van het platform vindt de betaling." },
  { scenario: "FAIL", label: "Betaling mislukt", hint: "De bank weigert. Er wordt niets bijgeschreven." },
] as const;

type SP = Promise<{ ref?: string; terug?: string }>;

export default async function DemoCheckout({ searchParams }: { searchParams: SP }) {
  const cfg = loadConfig(process.env);
  if (cfg.mode !== "demo" || cfg.adapters.payment !== "demo") notFound();
  const user = await currentUser();
  if (!user) redirect("/login");
  const { ref = "", terug = "/betalingen" } = await searchParams;
  const back = terug.startsWith("/betalingen") ? terug : "/betalingen";
  const dep = await depositByReference(getDb().db, ref);
  const mine = dep && dep.userId === user.id;
  const atProvider = mine ? await payments().simulator!.operation(ref) : undefined;
  const open = mine && atProvider?.status === "AWAITING_CUSTOMER";

  return (
    <div className="min-h-dvh bg-[#eef1f4] px-4 py-8">
      <main className="mx-auto max-w-md overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <header className="flex items-center justify-between bg-slate-800 px-5 py-4 text-white">
          <span className="font-semibold">Betaalsimulator</span>
          <span className="rounded bg-amber-300 px-2 py-0.5 text-xs font-bold text-slate-900">DEMO · GEEN ECHT GELD</span>
        </header>
        <div className="space-y-4 p-5">
          {!mine ? (
            <p role="alert" className="text-sm">Deze betaling is niet gevonden of hoort niet bij jouw account.</p>
          ) : (
            <>
              <div>
                <p className="text-sm text-muted">Betaling aan Player Exchange (demo)</p>
                <p className="num text-3xl font-bold">{euro(dep.amountCents)}</p>
                <p className="text-xs text-muted">Referentie {ref}</p>
              </div>
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm">
                Dit is een gesimuleerde betaalpartner. Er wordt nergens om bank- of kaartgegevens gevraagd; voer die ook nergens in.
              </p>
              {open ? (
                <form action={decideDemoPayment} className="space-y-2">
                  <input type="hidden" name="ref" value={ref} />
                  <input type="hidden" name="terug" value={back} />
                  <fieldset className="space-y-2">
                    <legend className="mb-1 text-sm font-semibold">Kies wat de bank doet</legend>
                    {CHOICES.map((c) => (
                      <button key={c.scenario} name="scenario" value={c.scenario}
                        className={`block w-full rounded-lg border px-3 py-2.5 text-left ${c.scenario === "FAIL" ? "border-red-200 hover:bg-danger-soft" : "border-line hover:border-primary hover:bg-primary-soft"}`}>
                        <span className="block font-semibold">{c.label}</span>
                        <span className="block text-xs text-muted">{c.hint}</span>
                      </button>
                    ))}
                  </fieldset>
                </form>
              ) : (
                <p className="text-sm">Deze betaling is al afgehandeld bij de betaalpartner.</p>
              )}
            </>
          )}
          {/* A full page load: the return goes through the server, which asks the provider for the status. */}
          <a href={back} className="block text-center text-sm text-primary underline">Terug naar Player Exchange zonder te betalen</a>
        </div>
      </main>
    </div>
  );
}
