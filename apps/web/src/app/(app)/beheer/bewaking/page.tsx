import { evaluateSignals, getDb, listAlerts } from "@px/db";
import { Card, PageTitle, Pill } from "@/components/ui";
import { Flash } from "@/components/flash";
import { NotAllowed } from "@/components/login-required";
import { currentUser, hasPermission } from "@/server/session";
import { dateTime } from "@/lib/format";
import { acknowledgeAlertAction } from "../actions";

export const metadata = { title: "Bewaking" };
export const dynamic = "force-dynamic";

const OWNER: Record<string, string> = {
  CATALOG_MANAGER: "Catalogusbeheer", VALUATION_ANALYST: "Waardering", FINANCE_OPERATOR: "Financiën", ISSUANCE_OPERATOR: "Uitgifte", SUPPORT: "Support",
};
const TONE = { OK: "green", WARNING: "amber", CRITICAL: "red" } as const;
const LABEL = { OK: "In orde", WARNING: "Let op", CRITICAL: "Kritiek" } as const;

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ melding?: string; fout?: string }> }) {
  const user = (await currentUser())!;
  if (!hasPermission(user, "operations.view") && !hasPermission(user, "finance.reconcile")) return <NotAllowed />;
  const sp = await searchParams;
  const { db } = getDb();
  const [signals, alerts] = await Promise.all([evaluateSignals(db), listAlerts(db)]);
  const open = alerts.filter((a) => a.status !== "RESOLVED");
  return (
    <div className="space-y-5">
      <PageTitle title="Bewaking" subtitle="Signalen uit docs/10 met een operationele eigenaar. De worker opent per signaal één melding en sluit hem zodra het signaal weer in orde is." />
      <Flash melding={sp.melding} fout={sp.fout} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {signals.map((s) => (
          <div key={s.key} className="rounded-xl border border-line bg-white p-4 text-sm" data-testid="signal">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{s.label}</p>
              <Pill tone={TONE[s.status]}>{LABEL[s.status]}</Pill>
            </div>
            <p className="mt-1 text-muted">{s.detail}</p>
            <p className="mt-2 text-xs text-muted">Eigenaar: {OWNER[s.owner] ?? s.owner} · Draaiboek: <code>{s.runbook}</code></p>
          </div>
        ))}
      </div>
      <Card title={`Meldingen (${open.length} open)`}>
        {alerts.length === 0 ? <p className="text-sm text-muted">Geen meldingen.</p> : (
          <ul className="divide-y divide-line text-sm">
            {alerts.map((a) => (
              <li key={a.id} className="space-y-1 py-2.5" data-testid="alert">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{signals.find((s) => s.key === a.signal_key)?.label ?? a.signal_key}</span>
                  <Pill tone={a.severity === "CRITICAL" ? "red" : "amber"}>{a.severity === "CRITICAL" ? "Kritiek" : "Let op"}</Pill>
                  <Pill tone={a.status === "OPEN" ? "red" : a.status === "ACKNOWLEDGED" ? "blue" : "grey"}>{a.status === "OPEN" ? "Open" : a.status === "ACKNOWLEDGED" ? "Opgepakt" : "Opgelost"}</Pill>
                  <span className="ml-auto text-xs text-muted">eigenaar {OWNER[a.owner_role] ?? a.owner_role} · sinds {dateTime(a.first_seen_at)}</span>
                </div>
                <p className="text-muted">{a.detail}</p>
                {a.status === "ACKNOWLEDGED" && <p className="text-xs">Opgepakt door {a.acknowledger}: {a.note}</p>}
                {a.status === "OPEN" && (
                  <form action={acknowledgeAlertAction} className="flex flex-wrap gap-2">
                    <input type="hidden" name="alertId" value={a.id} />
                    <input name="note" required minLength={5} placeholder="Wat doe je eraan?" aria-label="Wat doe je eraan?" className="min-w-48 flex-1 rounded-lg border border-line px-2 py-1.5" />
                    <button className="rounded-lg border border-slate-300 px-3 py-1.5">Oppakken</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
