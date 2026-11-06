import { getDb, latestContractRuns, listGates } from "@px/db";
import { blockedFlows, PAYMENT_CAPABILITIES, type ContractResult } from "@px/integrations";
import { loadConfig } from "@px/integrations/env";
import { Card, InfoNote, PageTitle, Pill } from "@/components/ui";
import { Flash } from "@/components/flash";
import { NotAllowed } from "@/components/login-required";
import { currentUser, hasPermission } from "@/server/session";
import { payments } from "@/server/payments";
import { dateTime } from "@/lib/format";
import { runContractTestsAction } from "../actions";

export const metadata = { title: "Koppelingen" };
export const dynamic = "force-dynamic";

const CAP: Record<string, string> = {
  HOLD_FUNDS: "Saldo reserveren", RELEASE_HOLD: "Reservering vrijgeven", SETTLE_INTERNAL_SALE: "Interne verkoop afwikkelen", SPLIT_COMMISSION: "Commissie splitsen",
  QUERY_STATUS: "Betalingsstatus opvragen", PAYOUT: "Uitbetalen", DEPOSIT: "Storten", RECONCILIATION_REPORT: "Reconciliatierapport",
};
const FLOW: Record<string, string> = { deposit: "Storten", buyOrder: "Kooporders", secondarySettlement: "Afwikkeling handel", primarySubscription: "Inschrijven op uitgiftes", withdrawal: "Opnemen", reconciliation: "Reconciliatie" };
const GATE: Record<string, string> = {
  LEGAL: "Juridisch", CONTRACTS: "Contracten", PAYMENTS: "Betalen", DATA: "Data", IMAGERY: "Beeld", PLAYER_IDENTITY: "Spelersidentiteit (O-10)",
  VALUATION: "Waardering", ENGINEERING: "Techniek", SECURITY: "Security", OPERATIONS: "Operations",
};
const STATUS_TONE = { PASSED: "green", FAILED: "red", BLOCKED: "amber" } as const;
const STATUS_LABEL = { PASSED: "Geslaagd", FAILED: "Mislukt", BLOCKED: "Geblokkeerd" } as const;

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ melding?: string; fout?: string }> }) {
  const user = (await currentUser())!;
  if (!hasPermission(user, "operations.view") && !hasPermission(user, "catalog.view")) return <NotAllowed />;
  const sp = await searchParams;
  const { db } = getDb();
  const cfg = loadConfig(process.env);
  const report = payments().provider.capabilities();
  const blocked = blockedFlows(report);
  const [runs, gates] = await Promise.all([
    latestContractRuns(db),
    listGates(db),
  ]);
  const adapters: [string, string, string, string][] = [
    ["Betalen", cfg.adapters.payment === "demo" ? "Betaalsimulator" : cfg.adapters.payment, cfg.mode, "Keuze betaalpartner open (O-02)"],
    ["Voetbaldata", cfg.adapters.footballData === "fixture" ? "Fixturebestand" : cfg.adapters.footballData, cfg.mode, "Keuze dataleverancier open (O-03)"],
    ["Externe waardes", "Demo-transferwaardes (seed)", cfg.mode, "Volgt met de dataleverancier (O-03)"],
    ["Identiteit", cfg.adapters.identity === "demo" ? "Demo-verificatie" : cfg.adapters.identity, cfg.mode, "Keuze identiteitsprovider open (O-06)"],
    ["Notificaties", "Alleen in de app (outbox)", cfg.mode, "E-mail/push volgen met een notificatieprovider"],
  ];
  return (
    <div className="space-y-5">
      <PageTitle title="Koppelingen" subtitle="Welke adapter er draait, wat hij werkelijk ondersteunt en het bewijs uit de contracttests. Een ontbrekende capability blokkeert de betreffende geldstroom." />
      <Flash melding={sp.melding} fout={sp.fout} />
      <InfoNote>Alle koppelingen zijn demo-adapters. Elke echte adapter (sandbox of productie) moet dezelfde contracttests doorstaan voordat hij gebruikt mag worden.</InfoNote>

      <Card title="Adapters">
        <ul className="divide-y divide-line text-sm">
          {adapters.map(([area, name, env, note]) => (
            <li key={area} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><span className="font-medium">{area}</span> · {name}</span><span className="flex items-center gap-2 text-xs text-muted">{note}<Pill tone="amber">{env}</Pill></span></li>
          ))}
        </ul>
      </Card>

      <Card title={`Capabilityrapport betalen · ${report.adapter} (${report.environment})`}>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          {PAYMENT_CAPABILITIES.map((c) => (
            <div key={c} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"><span>{CAP[c]}</span>{report.supported.has(c) ? <Pill tone="green">Ondersteund</Pill> : <Pill tone="red">Ontbreekt</Pill>}</div>
          ))}
        </div>
        <p className="mt-3 text-sm">{blocked.length ? `Geblokkeerde geldstromen: ${blocked.map((b) => FLOW[b.flow] ?? b.flow).join(", ")}.` : "Alle geldstromen hebben de benodigde capabilities."}</p>
      </Card>

      <Card title="Contracttests" action={hasPermission(user, "operations.view") ? <form action={runContractTestsAction}><button className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white">Contracttests uitvoeren</button></form> : undefined}>
        {runs.length === 0 ? <p className="text-sm text-muted">Nog niet uitgevoerd.</p> : runs.map((r) => (
          <div key={r.id} className="mb-4 last:mb-0" data-testid="contract-run">
            <p className="text-sm font-semibold">{r.kind === "PAYMENT" ? "Betalen" : "Voetbaldata"} · {r.adapter} ({r.environment}) · {dateTime(r.ran_at)}</p>
            <p className="text-xs text-muted">{r.passed} geslaagd · {r.failed} mislukt · {r.blocked} geblokkeerd</p>
            <ul className="mt-1 divide-y divide-line text-sm">
              {(r.results as ContractResult[]).map((x, i) => (
                <li key={i} className="flex flex-wrap items-start justify-between gap-2 py-1.5"><span>{x.check}{x.detail ? <span className="block text-xs text-muted">{x.detail}</span> : null}</span><Pill tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Pill></li>
              ))}
            </ul>
          </div>
        ))}
      </Card>

      <Card title="Productiegates">
        <p className="mb-2 text-sm text-muted">Een gate is alleen vervuld met bewijs én goedkeuring door een tweede persoon (databaseregel). Productie start niet zolang een vereiste gate open is.</p>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          {gates.map((g) => (
            <div key={g.key} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"><span>{GATE[g.key] ?? g.key}</span>{g.satisfied ? <Pill tone="green">Vervuld</Pill> : <Pill tone="grey">Open</Pill>}</div>
          ))}
        </div>
      </Card>
    </div>
  );
}
