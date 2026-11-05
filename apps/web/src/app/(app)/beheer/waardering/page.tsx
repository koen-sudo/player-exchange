import { getDb, listValuationRuns, runChanges } from "@px/db";
import { loadConfig } from "@px/integrations/env";
import { Card, DisabledReason, InfoNote, PageTitle, Pill } from "@/components/ui";
import { Flash } from "@/components/flash";
import { NotAllowed } from "@/components/login-required";
import { currentUser, hasPermission } from "@/server/session";
import { dateTime, euro } from "@/lib/format";
import { createValuationRunAction, publishValuationRunAction, reviewValuationRunAction } from "../actions";

export const metadata = { title: "Waarderingsruns" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, "green" | "amber" | "red" | "grey" | "blue"]> = {
  DRAFT: ["Concept", "grey"], VALIDATED: ["Gecontroleerd, wacht op beoordeling", "amber"], APPROVED: ["Goedgekeurd, wacht op publicatie", "blue"],
  PUBLISHED: ["Gepubliceerd", "green"], REJECTED: ["Afgewezen", "red"], FAILED: ["Controle mislukt", "red"], SUPERSEDED: ["Vervangen", "grey"],
};
const pct = (now: number, prev: number | null) => (prev ? `${now >= prev ? "+" : "−"}${Math.abs(Math.round(((now - prev) / prev) * 1000) / 10).toString().replace(".", ",")}%` : "nieuw");

export default async function ValuationAdminPage({ searchParams }: { searchParams: Promise<{ melding?: string; fout?: string; run?: string }> }) {
  const user = (await currentUser())!;
  const canPrepare = hasPermission(user, "valuation.prepare");
  const canReview = hasPermission(user, "approvals.decide");
  const canPublish = hasPermission(user, "valuation.publish");
  if (!canPrepare && !canReview) return <NotAllowed />;
  const sp = await searchParams;
  const { db } = getDb();
  const demo = loadConfig(process.env).mode === "demo";
  const runs = await listValuationRuns(db);
  const open = runs.find((r) => r.id === sp.run) ?? runs.find((r) => r.status === "VALIDATED" || r.status === "APPROVED") ?? runs[0];
  const changes = open ? await runChanges(db, open.id, 20) : [];

  return (
    <div className="space-y-5">
      <PageTitle title="Waarderingsruns" subtitle="Concept → automatische controle → beoordeling door een tweede persoon → publicatie (maandag 18.00). Alleen gepubliceerde waardes zijn zichtbaar voor gebruikers; open orders veranderen nooit mee." />
      <Flash melding={sp.melding} fout={sp.fout} />
      <InfoNote>Het model is een gemarkeerd demomodel (demo-v1): structureel deel uit een externe transferwaarde plus een begrensde vormcorrectie uit recente wedstrijden. Het is geen gevalideerde productieformule (docs/08) en wordt in productie geweigerd.</InfoNote>

      {canPrepare && (
        <Card title="Nieuwe conceptrun">
          <form action={createValuationRunAction}><button className="rounded-lg bg-primary px-4 py-2 font-semibold text-white">Conceptrun berekenen</button></form>
          <p className="mt-2 text-xs text-muted">De worker maakt op maandag vanaf 12.00 automatisch een conceptrun voor die week. Gebruikt alleen gegevens die op de peildatum bekend waren.</p>
        </Card>
      )}

      {open && (
        <Card title={`Run van ${dateTime(open.information_as_of)}`} action={<Pill tone={(STATUS[open.status] ?? [open.status, "grey"])[1]}>{(STATUS[open.status] ?? [open.status])[0]}</Pill>}>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex justify-between gap-2"><dt className="text-muted">Model</dt><dd>{open.version_key}{open.is_demo ? " (demo)" : ""}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Waardes</dt><dd className="num">{open.summary.values ?? 0}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Zonder nieuwe waarde</dt><dd className="num">{open.summary.noValue ?? 0}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Gestegen / gedaald / gelijk</dt><dd className="num">{open.summary.up ?? 0} / {open.summary.down ?? 0} / {open.summary.same ?? 0}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Grote wijzigingen (≥25%)</dt><dd className="num">{open.checks.flaggedLargeChanges ?? 0}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Gepland</dt><dd>{open.scheduled_publish_at ? dateTime(open.scheduled_publish_at) : "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Aangemaakt door</dt><dd>{open.creator ?? "Worker"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted">Goedgekeurd door</dt><dd>{open.approver ?? "—"}</dd></div>
          </dl>
          {open.checks.errors && open.checks.errors.length > 0 && <p role="alert" className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-down">{open.checks.errors.join(" · ")}</p>}

          <h3 className="mt-4 text-sm font-semibold">Grootste wijzigingen</h3>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted"><tr><th className="py-1 pr-4 font-medium">Speler</th><th className="py-1 pr-4 text-right font-medium">Vorige</th><th className="py-1 pr-4 text-right font-medium">Nieuw</th><th className="py-1 pr-4 text-right font-medium">Wijziging</th><th className="py-1 pr-4 font-medium">Betrouwbaarheid</th><th className="py-1 font-medium">Waarschuwingen</th></tr></thead>
              <tbody className="divide-y divide-line">
                {changes.map((c) => (
                  <tr key={c.player_id}>
                    <td className="py-1.5 pr-4">{c.name}{c.is_historical ? " (historisch)" : ""}</td>
                    <td className="num whitespace-nowrap py-1.5 pr-4 text-right">{c.previous_cents === null ? "—" : euro(Number(c.previous_cents))}</td>
                    <td className="num whitespace-nowrap py-1.5 pr-4 text-right">{euro(Number(c.amount_cents))}</td>
                    <td className="num whitespace-nowrap py-1.5 pr-4 text-right">{pct(Number(c.amount_cents), c.previous_cents === null ? null : Number(c.previous_cents))}</td>
                    <td className="py-1.5 pr-4">{({ HIGH: "Hoog", MEDIUM: "Gemiddeld", LOW: "Laag" } as Record<string, string>)[c.confidence] ?? c.confidence}</td>
                    <td className="py-1.5 text-xs text-muted">{c.warnings.join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {open.status === "VALIDATED" && (canReview && open.created_by !== user.id ? (
            <form action={reviewValuationRunAction} className="mt-4 flex flex-wrap gap-2">
              <input type="hidden" name="runId" value={open.id} />
              <input name="reason" required minLength={5} placeholder="Toelichting bij je beoordeling" aria-label="Toelichting bij je beoordeling" className="min-w-48 flex-1 rounded-lg border border-line px-2 py-1.5 text-sm" />
              <button name="decision" value="APPROVE" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white">Goedkeuren</button>
              <button name="decision" value="REJECT" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Afwijzen</button>
            </form>
          ) : <div className="mt-3"><DisabledReason>{open.created_by === user.id ? "Je eigen run; een tweede persoon moet hem beoordelen." : "Je rol kan runs niet beoordelen."}</DisabledReason></div>)}
          {open.status === "APPROVED" && canPublish && (
            <form action={publishValuationRunAction} className="mt-4 flex flex-wrap gap-2">
              <input type="hidden" name="runId" value={open.id} />
              <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Publiceren als het geplande moment is bereikt</button>
              {demo && <button name="now" value="1" className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm text-amber-950">Demo: nu publiceren</button>}
            </form>
          )}
        </Card>
      )}

      <Card title="Alle runs">
        <ul className="divide-y divide-line text-sm">
          {runs.map((r) => {
            const [label, tone] = STATUS[r.status] ?? [r.status, "grey" as const];
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="valuation-run">
                <a href={`/beheer/waardering?run=${r.id}`} className="hover:underline">Peildatum {dateTime(r.information_as_of)} · {r.version_key}</a>
                <span className="flex items-center gap-2"><span className="text-xs text-muted">{r.published_at ? `gepubliceerd ${dateTime(r.published_at)}` : r.scheduled_publish_at ? `gepland ${dateTime(r.scheduled_publish_at)}` : ""}</span><Pill tone={tone}>{label}</Pill></span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
