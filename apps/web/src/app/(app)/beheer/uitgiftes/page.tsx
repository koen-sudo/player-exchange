import { dropCandidates, getDb, listDropsForAdmin } from "@px/db";
import { seasonKeyFor } from "@px/domain";
import { loadConfig } from "@px/integrations/env";
import { Card, DisabledReason, InfoNote, PageTitle, Pill } from "@/components/ui";
import { Flash } from "@/components/flash";
import { NotAllowed } from "@/components/login-required";
import { currentUser, hasPermission } from "@/server/session";
import { dateTime, euro } from "@/lib/format";
import { applyDropPriceAction, demoDropScheduleAction, proposeDropAction, publishDropAction, requestDropPriceAction } from "../actions";

export const metadata = { title: "Uitgifteplanning" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, "green" | "amber" | "red" | "grey" | "blue"]> = {
  DRAFT: ["Concept", "grey"], PUBLISHED: ["Gepubliceerd", "blue"], OPEN: ["Inschrijving open", "green"], CLOSED: ["Gesloten", "amber"],
  ALLOCATING: ["Toewijzen", "amber"], SETTLING: ["Afwikkelen", "amber"], COMPLETED: ["Afgerond", "green"], CANCELLED: ["Geannuleerd", "red"], POSTPONED: ["Uitgesteld", "grey"],
};

/** Next Tuesday 09:00 / 21:00 in Europe/Amsterdam as datetime-local values (BR-09 planning). */
function nextTuesday(): { open: string; close: string } {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  const d = new Date(local);
  d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7 || 7));
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { open: `${day}T09:00`, close: `${day}T21:00` };
}

export default async function DropsAdminPage({ searchParams }: { searchParams: Promise<{ melding?: string; fout?: string }> }) {
  const user = (await currentUser())!;
  const canPrepare = hasPermission(user, "issuance.prepare");
  if (!canPrepare && !hasPermission(user, "catalog.view")) return <NotAllowed />;
  const sp = await searchParams;
  const { db } = getDb();
  const demo = loadConfig(process.env).mode === "demo";
  const tue = nextTuesday();
  const [drops, candidates] = await Promise.all([listDropsForAdmin(db), dropCandidates(db, seasonKeyFor(new Date(`${tue.open}:00Z`)))]);

  return (
    <div className="space-y-5">
      <PageTitle title="Uitgifteplanning" subtitle="Een uitgifte publiceren of de prijs wijzigen vraagt goedkeuring van een tweede persoon. De prijs kan tot de opening in beide richtingen wijzigen; daarna staat hij vast." />
      <Flash melding={sp.melding} fout={sp.fout} />
      {!canPrepare && <DisabledReason>Je rol kan uitgiftes bekijken maar niet voorbereiden.</DisabledReason>}

      {canPrepare && (
        <Card title="Nieuwe uitgifte">
          <form action={proposeDropAction} className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex min-w-0 flex-col gap-1 sm:col-span-2 lg:col-span-1">Speler
              <select name="playerId" required className="w-full min-w-0 rounded-lg border border-line bg-white px-2 py-2">
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.display_name} · ref. {c.reference_cents ? euro(Number(c.reference_cents)) : "—"} · nog {c.room} in programma</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">Prijs per kaart (€)<input name="price" required inputMode="decimal" placeholder="6,00" className="num rounded-lg border border-line px-2 py-2" /></label>
            <label className="flex flex-col gap-1">Aantal kaarten<input name="quantity" required type="number" min={1} max={500} defaultValue={5} className="num rounded-lg border border-line px-2 py-2" /></label>
            <label className="flex flex-col gap-1">Inschrijving opent (Amsterdam)<input name="opensAt" required type="datetime-local" defaultValue={tue.open} className="rounded-lg border border-line px-2 py-2" /></label>
            <label className="flex flex-col gap-1">Inschrijving sluit (Amsterdam)<input name="closesAt" required type="datetime-local" defaultValue={tue.close} className="rounded-lg border border-line px-2 py-2" /></label>
            <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">Reden voor de goedkeurder<input name="reason" required minLength={5} placeholder="Bijvoorbeeld: wekelijkse uitgifte na prijsrun" className="rounded-lg border border-line px-2 py-2" /></label>
            <div className="sm:col-span-2 lg:col-span-3"><button className="rounded-lg bg-primary px-4 py-2 font-semibold text-white">Concept vastleggen en goedkeuring aanvragen</button></div>
          </form>
          <p className="mt-2 text-xs text-muted">Alleen actieve, toegelaten spelers met een gepubliceerd uitgifteprogramma en ruimte daarin. Eerste ronde: één kaart per persoon.</p>
        </Card>
      )}

      <Card title={`Uitgiftes (${drops.length})`}>
        {drops.length === 0 ? <p className="text-sm text-muted">Nog geen uitgiftes.</p> : (
          <ul className="space-y-3">
            {drops.map((d) => {
              const [label, tone] = STATUS[d.status] ?? [d.status, "grey" as const];
              return (
                <li key={d.id} className="rounded-lg border border-line p-3 text-sm" data-testid="admin-drop">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{d.player_name}</span>
                    <Pill tone={tone}>{label}</Pill>
                    <span className="text-muted">editie {d.season_key}</span>
                    <span className="num ml-auto">{d.quantity} × {euro(Number(d.price_cents))}</span>
                  </div>
                  <p className="text-muted">Inschrijving {dateTime(d.opens_at)} – {dateTime(d.closes_at)} · {d.subscriptions} inschrijvingen{d.status === "SETTLING" || d.status === "COMPLETED" ? ` · geleverd ${d.delivered} · mislukt ${d.failed} · in afwikkeling ${d.pending} · onverkocht ${d.unsold}` : ""}</p>
                  {canPrepare && d.status === "DRAFT" && (
                    d.open_approval_status === "APPROVED" ? (
                      <form action={publishDropAction} className="mt-2">
                        <input type="hidden" name="dropId" value={d.id} />
                        <input type="hidden" name="approvalId" value={d.open_approval_id!} />
                        <button className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">Publiceren</button>
                      </form>
                    ) : <p className="mt-1 text-xs text-muted">{d.open_approval_status === "REQUESTED" ? "Wacht op goedkeuring door een tweede persoon (zie Goedkeuringen)." : "Goedkeuring niet (meer) geldig; maak een nieuwe uitgifte."}</p>
                  )}
                  {canPrepare && d.status === "PUBLISHED" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {d.price_change_approval && d.price_change_payload?.newPriceCents ? (
                        <form action={applyDropPriceAction}>
                          <input type="hidden" name="dropId" value={d.id} />
                          <input type="hidden" name="approvalId" value={d.price_change_approval} />
                          <input type="hidden" name="newPriceCents" value={d.price_change_payload.newPriceCents} />
                          <button className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">Goedgekeurde prijs {euro(d.price_change_payload.newPriceCents)} doorvoeren</button>
                        </form>
                      ) : (
                        <form action={requestDropPriceAction} className="flex flex-wrap gap-2">
                          <input type="hidden" name="dropId" value={d.id} />
                          <input name="price" required inputMode="decimal" placeholder="Nieuwe prijs" aria-label="Nieuwe prijs" className="num w-28 rounded-lg border border-line px-2 py-1.5" />
                          <input name="reason" required minLength={5} placeholder="Reden" aria-label="Reden prijswijziging" className="min-w-40 flex-1 rounded-lg border border-line px-2 py-1.5" />
                          <button className="rounded-lg border border-slate-300 px-3 py-1.5">Prijswijziging aanvragen</button>
                        </form>
                      )}
                    </div>
                  )}
                  {demo && canPrepare && (d.status === "PUBLISHED" || d.status === "OPEN") && (
                    <form action={demoDropScheduleAction} className="mt-2">
                      <input type="hidden" name="dropId" value={d.id} />
                      <input type="hidden" name="action" value={d.status === "PUBLISHED" ? "OPEN_NOW" : "CLOSE_NOW"} />
                      <button className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-1.5 text-amber-950">{d.status === "PUBLISHED" ? "Demo: inschrijving nu openen" : "Demo: nu sluiten en toewijzen"}</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {demo && <div className="mt-3"><InfoNote>De demoknoppen verschuiven alleen de planning, zodat je niet tot dinsdag hoeft te wachten. Ze bestaan niet buiten de demo-modus.</InfoNote></div>}
      </Card>
    </div>
  );
}
