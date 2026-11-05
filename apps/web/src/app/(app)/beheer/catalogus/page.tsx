import { catalogCoverage, getDb, listImportRuns, listOpenImportIssues } from "@px/db";
import { Card, DisabledReason, PageTitle, Pill } from "@/components/ui";
import { Flash } from "@/components/flash";
import { NotAllowed } from "@/components/login-required";
import { currentUser, hasPermission } from "@/server/session";
import { dateTime } from "@/lib/format";
import { startCatalogImport } from "../actions";

export const metadata = { title: "Catalogus" };
export const dynamic = "force-dynamic";

const RUN_TONE = { QUEUED: "blue", RUNNING: "amber", PAUSED: "grey", COMPLETED: "green", FAILED: "red" } as const;
const RUN_LABEL = { QUEUED: "Ingepland", RUNNING: "Bezig", PAUSED: "Gepauzeerd", COMPLETED: "Voltooid", FAILED: "Mislukt" } as const;
const ISSUE_LABEL: Record<string, string> = { MISSING_FIELD: "Ontbrekend veld", DUPLICATE: "Dubbel aangeleverd", CONFLICTING_MATCH: "Mogelijke dubbele identiteit", SCHEMA: "Ongeldig formaat" };

type SP = Promise<{ melding?: string; fout?: string }>;

export default async function CatalogAdminPage({ searchParams }: { searchParams: SP }) {
  const user = (await currentUser())!;
  if (!hasPermission(user, "catalog.view")) return <NotAllowed />;
  const sp = await searchParams;
  const { db } = getDb();
  const [cov, runs, issues] = await Promise.all([catalogCoverage(db), listImportRuns(db), listOpenImportIssues(db)]);
  const canImport = hasPermission(user, "catalog.import");

  return (
    <div className="space-y-5">
      <PageTitle title="Catalogus en importstatus" subtitle="Bron: fictieve fixtureprovider. Een echte dataleverancier volgt na de datalicentie (O-03)." />
      <Flash melding={sp.melding} fout={sp.fout} />

      <Card title="Dekking per competitie">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted"><tr><th className="px-2 py-1 font-medium">Competitie</th><th className="px-2 py-1 text-right font-medium">Teams</th><th className="px-2 py-1 text-right font-medium">Spelers</th><th className="px-2 py-1 text-right font-medium">Open markten</th><th className="px-2 py-1 text-right font-medium">Zonder data</th></tr></thead>
            <tbody className="divide-y divide-line">
              {cov.perCompetition.map((c) => (
                <tr key={c.competition}><td className="px-2 py-2">{c.competition}</td><td className="num px-2 py-2 text-right">{c.teams}</td><td className="num px-2 py-2 text-right">{c.players}</td><td className="num px-2 py-2 text-right">{c.openMarkets}</td><td className="num px-2 py-2 text-right">{c.missingData}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted">Totaal {cov.players} profielen, waarvan {cov.withoutTeam} zonder actuele club. Profielen worden nooit verwijderd; alleen lidmaatschappen worden afgesloten.</p>
      </Card>

      <Card title="Import starten">
        <form action={startCatalogImport} className="flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1">
            <span className="text-xs text-muted">Reden (voor de auditlog)</span>
            <input name="reason" placeholder="Bijvoorbeeld: selecties na transferperiode" disabled={!canImport} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
          </label>
          <button disabled={!canImport} className="rounded-lg bg-primary px-4 py-2.5 font-semibold text-white disabled:opacity-50">Import starten</button>
        </form>
        {!canImport && <DisabledReason>Je rol heeft geen recht om imports te starten.</DisabledReason>}
        <p className="mt-2 text-xs text-muted">De worker verwerkt de import op de achtergrond. Een onderbroken import gaat verder waar hij was.</p>
      </Card>

      <Card title="Recente imports">
        {runs.length === 0 ? <p className="text-sm text-muted">Nog geen imports.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted"><tr><th className="px-2 py-1 font-medium">Aangemaakt</th><th className="px-2 py-1 font-medium">Status</th><th className="px-2 py-1 text-right font-medium">Nieuw</th><th className="px-2 py-1 text-right font-medium">Bijgewerkt</th><th className="px-2 py-1 text-right font-medium">Transfers/vertrek</th><th className="px-2 py-1 text-right font-medium">Problemen</th><th className="px-2 py-1 font-medium">Bronversie</th></tr></thead>
              <tbody className="divide-y divide-line">
                {runs.map((r) => {
                  const s = r.stats as Record<string, number>;
                  return (
                    <tr key={r.id}>
                      <td className="px-2 py-2">{dateTime(r.createdAt)}</td>
                      <td className="px-2 py-2"><Pill tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Pill>{r.lastError && <span className="ml-2 text-xs text-down">{r.lastError}</span>}</td>
                      <td className="num px-2 py-2 text-right">{s.playersCreated ?? 0}</td>
                      <td className="num px-2 py-2 text-right">{s.playersUpdated ?? 0}</td>
                      <td className="num px-2 py-2 text-right">{s.membershipsClosed ?? 0}</td>
                      <td className="num px-2 py-2 text-right">{s.issues ?? 0}</td>
                      <td className="px-2 py-2 text-muted">{r.sourceVersion ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Quarantaine (${issues.length})`}>
        {issues.length === 0 ? <p className="text-sm text-muted">Geen openstaande importproblemen.</p> : (
          <ul className="divide-y divide-line text-sm">
            {issues.map((i) => (
              <li key={i.id} className="flex flex-wrap justify-between gap-2 px-2 py-2">
                <span><Pill tone="amber">{ISSUE_LABEL[i.kind] ?? i.kind}</Pill> <span className="ml-2">{String(i.detail.name ?? i.external_id ?? "")}</span></span>
                <span className="text-muted">{dateTime(i.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Een mogelijke dubbele identiteit wordt nooit automatisch samengevoegd. Afhandelen volgt met de beoordelingsflow.</p>
      </Card>
    </div>
  );
}
