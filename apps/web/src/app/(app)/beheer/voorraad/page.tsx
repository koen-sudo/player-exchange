import Link from "next/link";
import { seasonKeyFor } from "@px/domain";
import { getCatalogPlayer, getDb, listPlayersForAdmission, programmeOverview } from "@px/db";
import { Card, DisabledReason, PageTitle, Pill } from "@/components/ui";
import { Flash } from "@/components/flash";
import { NotAllowed } from "@/components/login-required";
import { currentUser, hasPermission } from "@/server/session";
import { dateTime } from "@/lib/format";
import { askProgrammeApproval, draftProgramme, publishApprovedProgramme } from "../actions";

export const metadata = { title: "Voorraad" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, "green" | "grey" | "amber" | "blue" | "red"]> = {
  DRAFT: ["Concept", "amber"], APPROVED: ["Goedgekeurd", "blue"], PUBLISHED: ["Gepubliceerd", "green"],
  SUPERSEDED: ["Vervangen", "grey"], COMPLETED: ["Afgerond", "grey"], CANCELLED: ["Geannuleerd", "red"],
};
const APPROVAL: Record<string, string> = { REQUESTED: "wacht op goedkeuring", APPROVED: "goedgekeurd, klaar om te publiceren", REJECTED: "afgewezen", EXECUTED: "uitgevoerd", INVALIDATED: "vervallen door wijziging" };

type SP = Promise<{ speler?: string; q?: string; melding?: string; fout?: string }>;

export default async function InventoryAdminPage({ searchParams }: { searchParams: SP }) {
  const user = (await currentUser())!;
  if (!hasPermission(user, "catalog.view")) return <NotAllowed />;
  const sp = await searchParams;
  const { db } = getDb();
  const canPrepare = hasPermission(user, "issuance.prepare");
  const player = sp.speler ? await getCatalogPlayer(db, sp.speler) : null;
  const overview = player ? await programmeOverview(db, player.id) : [];
  const search = !player ? await listPlayersForAdmission(db, { q: sp.q, admission: sp.q ? undefined : "APPROVED", limit: 20 }) : [];
  const season = seasonKeyFor(new Date());
  const nextSeason = `${Number(season.slice(0, 4)) + 1}-${Number(season.slice(0, 4)) + 2}`;
  const editions = [...new Set(overview.map((r) => r.season_key))];

  return (
    <div className="space-y-5">
      <PageTitle title="Edities en voorraad" subtitle="Maximaal 500 kaarten per speler per seizoen. Publiceren of wijzigen van een programma vraagt goedkeuring van een tweede persoon." />
      <Flash melding={sp.melding} fout={sp.fout} />
      {!player ? (
        <Card title="Kies een speler">
          <form className="mb-3 flex gap-2"><input name="q" defaultValue={sp.q} placeholder="Zoek speler" className="flex-1 rounded-lg border border-line px-3 py-2" /><button className="rounded-lg bg-primary px-4 py-2 font-semibold text-white">Zoeken</button></form>
          <ul className="divide-y divide-line text-sm">
            {search.map((p) => (
              <li key={p.id} className="flex justify-between py-2"><Link href={`/beheer/voorraad?speler=${p.id}`} className="font-medium text-primary hover:underline">{p.display_name}</Link><span className="text-muted">{p.team} · {p.in_circulation} in omloop</span></li>
            ))}
          </ul>
          {!sp.q && <p className="mt-2 text-xs text-muted">Zonder zoekterm tonen we toegelaten spelers.</p>}
        </Card>
      ) : (
        <>
          <p className="text-sm"><Link href="/beheer/voorraad" className="text-primary hover:underline">Andere speler</Link></p>
          <Card title={`${player.name} · ${player.team?.name ?? "geen club"}`}>
            {editions.length === 0 && <p className="text-sm text-muted">Nog geen edities.</p>}
            {editions.map((season) => {
              const rows = overview.filter((r) => r.season_key === season);
              const first = rows[0]!;
              return (
                <div key={season} className="mb-4 rounded-lg border border-line p-3">
                  <p className="font-semibold">Editie {season}</p>
                  <p className="text-sm text-muted">{first.cards_total} kaarten aangemaakt · {first.cards_owned} geleverd · {first.cards_platform} platformvoorraad · maximum 500</p>
                  <ul className="mt-2 space-y-2 text-sm">
                    {rows.filter((r) => r.programme_id).map((r) => (
                      <li key={r.programme_id} className="rounded-md bg-slate-50 p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">Versie {r.version}</span><Pill tone={STATUS[r.status!]![1]}>{STATUS[r.status!]![0]}</Pill>
                          <span className="num">{r.planned_total} kaarten</span>
                          {r.published_at && <span className="text-muted">gepubliceerd {dateTime(r.published_at)}</span>}
                          {r.approval_status && <span className="text-muted">· goedkeuring {APPROVAL[r.approval_status] ?? r.approval_status}</span>}
                        </div>
                        {r.change_reason && <p className="mt-1 text-muted">Reden: {r.change_reason}</p>}
                        {canPrepare && r.status === "DRAFT" && (!r.approval_status || r.approval_status === "REJECTED" || r.approval_status === "INVALIDATED") && (
                          <form action={askProgrammeApproval} className="mt-2 flex flex-wrap gap-2">
                            <input type="hidden" name="programmeId" value={r.programme_id!} /><input type="hidden" name="playerId" value={player.id} />
                            <input name="reason" required minLength={5} placeholder="Toelichting voor de goedkeurder" className="min-w-48 flex-1 rounded-lg border border-line px-2 py-1.5" />
                            <button className="rounded-lg border border-slate-300 px-3 py-1.5">Goedkeuring aanvragen</button>
                          </form>
                        )}
                        {canPrepare && r.status === "DRAFT" && r.approval_status === "APPROVED" && (
                          <form action={publishApprovedProgramme} className="mt-2">
                            <input type="hidden" name="programmeId" value={r.programme_id!} /><input type="hidden" name="approvalId" value={r.approval_id!} /><input type="hidden" name="playerId" value={player.id} />
                            <button className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">Publiceren</button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </Card>
          <Card title="Nieuw programma of wijziging">
            {canPrepare ? (
              <form action={draftProgramme} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="playerId" value={player.id} />
                <label className="text-sm"><span className="block text-xs text-muted">Seizoen</span>
                  <select name="seasonKey" className="mt-1 rounded-lg border border-line px-2 py-1.5"><option>{season}</option><option>{nextSeason}</option></select></label>
                <label className="text-sm"><span className="block text-xs text-muted">Aantal kaarten (max. 500)</span>
                  <input name="plannedTotal" type="number" min={1} max={500} required inputMode="numeric" className="mt-1 w-32 rounded-lg border border-line px-2 py-1.5" /></label>
                <label className="min-w-56 flex-1 text-sm"><span className="block text-xs text-muted">Reden</span>
                  <input name="reason" required minLength={5} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5" /></label>
                <button className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">Concept maken</button>
              </form>
            ) : <DisabledReason>Je rol kan geen uitgifteprogramma's voorbereiden.</DisabledReason>}
            <p className="mt-2 text-xs text-muted">Een gepubliceerd programma kan alleen worden verlaagd, met reden, en nooit onder het aantal al gemaakte kaarten.</p>
          </Card>
        </>
      )}
    </div>
  );
}
