import Link from "next/link";
import { getDb, listPlayersForAdmission } from "@px/db";
import { Card, DisabledReason, PageTitle, Pill } from "@/components/ui";
import { Flash } from "@/components/flash";
import { NotAllowed } from "@/components/login-required";
import { currentUser, hasPermission } from "@/server/session";
import { changeAdmission, changeMarketStatus } from "../actions";

export const metadata = { title: "Spelertoelating" };
export const dynamic = "force-dynamic";

const ADMISSION_LABEL: Record<string, string> = { INELIGIBLE: "Niet toegelaten", REVIEW: "In beoordeling", APPROVED: "Toegelaten", PAUSED: "Gepauzeerd" };
const MARKET_LABEL: Record<string, string> = { PROFILE_ONLY: "Alleen profiel", PRELAUNCH: "Komende uitgifte", OPEN: "Handel open", PAUSED: "Gepauzeerd", CLOSED: "Gesloten" };
const DATA_LABEL: Record<string, string> = { PARTIAL: "Gedeeltelijke data", STALE: "Verouderde data", MISSING: "Onvoldoende data" };
const tone = (a: string) => (a === "APPROVED" || a === "OPEN" ? "green" : a === "PAUSED" || a === "CLOSED" ? "red" : a === "REVIEW" || a === "PRELAUNCH" ? "amber" : "grey") as "green" | "red" | "amber" | "grey";

type SP = Promise<{ q?: string; toelating?: string; melding?: string; fout?: string }>;

export default async function PlayersAdminPage({ searchParams }: { searchParams: SP }) {
  const user = (await currentUser())!;
  if (!hasPermission(user, "catalog.view")) return <NotAllowed />;
  const sp = await searchParams;
  const canAdmit = hasPermission(user, "players.admit");
  const players = await listPlayersForAdmission(getDb().db, { q: sp.q, admission: sp.toelating, limit: 40 });

  return (
    <div className="space-y-5">
      <PageTitle title="Spelertoelating" subtitle="Een geïmporteerd profiel is nooit automatisch toegelaten tot uitgifte. Toelaten en marktstatus wijzigen gebeurt hier, met reden." />
      <Flash melding={sp.melding} fout={sp.fout} />
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-4">
        <label className="min-w-56 flex-1"><span className="block text-xs text-muted">Zoek speler</span>
          <input name="q" defaultValue={sp.q} className="mt-1 w-full rounded-lg border border-line px-3 py-2" /></label>
        <label><span className="block text-xs text-muted">Toelating</span>
          <select name="toelating" defaultValue={sp.toelating ?? ""} className="mt-1 rounded-lg border border-line px-3 py-2">
            <option value="">Alle</option>
            {Object.entries(ADMISSION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <button className="rounded-lg bg-primary px-4 py-2 font-semibold text-white">Zoeken</button>
      </form>
      {!canAdmit && <DisabledReason>Je rol kan spelers bekijken maar niet toelaten.</DisabledReason>}
      <div className="space-y-3">
        {players.map((p) => (
          <Card key={p.id} title={<span className="flex flex-wrap items-center gap-2">{p.display_name}<span className="text-sm font-normal text-muted">{p.team ?? "Geen club"} · {p.age ?? "?"} jaar</span></span>}
            action={<Link href={`/beheer/voorraad?speler=${p.id}`} className="text-sm text-primary hover:underline">Voorraad</Link>}>
            <div className="flex flex-wrap gap-2 text-sm">
              <Pill tone={tone(p.primary_admission)}>{ADMISSION_LABEL[p.primary_admission]}</Pill>
              <Pill tone={tone(p.market_status)}>{MARKET_LABEL[p.market_status]}</Pill>
              <Pill tone="grey">{p.in_circulation} kaarten in omloop</Pill>
              {p.career_status !== "ACTIVE" && <Pill tone="red">Gestopt</Pill>}
              {p.data_quality !== "OK" && <Pill tone="amber">{DATA_LABEL[p.data_quality] ?? p.data_quality}</Pill>}
            </div>
            {p.blocker && <p className="mt-2 text-sm text-muted">Kan niet worden toegelaten: {p.blocker}</p>}
            {canAdmit && (
              <div className="mt-3 grid gap-3 border-t border-line pt-3 lg:grid-cols-2">
                <form action={changeAdmission} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="playerId" value={p.id} /><input type="hidden" name="q" value={sp.q ?? ""} />
                  <label className="text-sm"><span className="block text-xs text-muted">Toelating</span>
                    <select name="admission" defaultValue={p.primary_admission} className="mt-1 rounded-lg border border-line px-2 py-1.5">
                      {Object.entries(ADMISSION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></label>
                  <label className="min-w-40 flex-1 text-sm"><span className="block text-xs text-muted">Reden</span>
                    <input name="reason" required minLength={5} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5" /></label>
                  <button className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">Opslaan</button>
                </form>
                <form action={changeMarketStatus} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="playerId" value={p.id} /><input type="hidden" name="q" value={sp.q ?? ""} />
                  <label className="text-sm"><span className="block text-xs text-muted">Marktstatus</span>
                    <select name="status" defaultValue={p.market_status} className="mt-1 rounded-lg border border-line px-2 py-1.5">
                      {Object.entries(MARKET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></label>
                  <label className="min-w-40 flex-1 text-sm"><span className="block text-xs text-muted">Reden</span>
                    <input name="reason" required minLength={5} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5" /></label>
                  <button className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">Opslaan</button>
                </form>
              </div>
            )}
          </Card>
        ))}
        {players.length === 0 && <p className="text-sm text-muted">Geen spelers gevonden.</p>}
      </div>
    </div>
  );
}
