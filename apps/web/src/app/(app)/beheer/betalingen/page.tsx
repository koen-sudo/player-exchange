import { getDb, ledgerInvariants, ledgerTotals, listBreaks, listOpenOperations, listReconciliationRuns, type BreakRow } from "@px/db";
import { Card, DisabledReason, InfoNote, PageTitle, Pill } from "@/components/ui";
import { Flash } from "@/components/flash";
import { NotAllowed } from "@/components/login-required";
import { currentUser, hasPermission } from "@/server/session";
import { dateTime, euro } from "@/lib/format";
import { approveResolution, proposeResolution, reconcileNow } from "../actions";

export const metadata = { title: "Betalingen en reconciliatie" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  AMOUNT: "Bedrag wijkt af",
  STATUS: "Status wijkt af",
  MISSING_IN_LEDGER: "Bij betaalpartner, niet in grootboek",
  MISSING_AT_PROVIDER: "In grootboek, niet bij betaalpartner",
  PROJECTION: "Saldo wijkt af van journaal",
};
const OP_TYPE: Record<string, string> = { DEPOSIT: "Storting", WITHDRAWAL: "Opname", HOLD: "Reservering", RELEASE: "Vrijgave", SECONDARY_SETTLEMENT: "Afwikkeling", PRIMARY_SETTLEMENT: "Uitgifte" };
const OP_STATUS: Record<string, [string, "amber" | "red" | "grey" | "blue"]> = {
  CREATED: ["Aangemaakt", "grey"], SUBMITTED: ["Ingediend", "blue"], PENDING: ["Pending", "amber"], UNKNOWN: ["Uitkomst onbekend", "red"], MANUAL_REVIEW: ["Handmatige controle", "red"],
};

type SP = Promise<{ melding?: string; fout?: string }>;

export default async function PaymentsAdminPage({ searchParams }: { searchParams: SP }) {
  const user = (await currentUser())!;
  const canReconcile = hasPermission(user, "finance.reconcile");
  const canApprove = hasPermission(user, "approvals.decide");
  if (!canReconcile && !canApprove && !hasPermission(user, "finance.operate")) return <NotAllowed />;
  const sp = await searchParams;
  const { db } = getDb();
  const [inv, totals, breaks, ops, runs] = await Promise.all([ledgerInvariants(db), ledgerTotals(db), listBreaks(db, { limit: 50 }), listOpenOperations(db), listReconciliationRuns(db, 5)]);
  const open = breaks.filter((b) => b.status !== "RESOLVED");
  const closed = breaks.filter((b) => b.status === "RESOLVED").slice(0, 10);
  const invOk = Object.values(inv).every((v) => v === 0);
  const last = runs[0];

  return (
    <div className="space-y-5">
      <PageTitle title="Betalingen en reconciliatie" subtitle="Grootboek, openstaande operaties bij de betaalpartner en verschillen. Een materieel verschil blokkeert opnames en sluit alleen met twee personen." />
      <Flash melding={sp.melding} fout={sp.fout} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><p className="text-sm text-muted">Financiële invarianten</p><p className="mt-1">{invOk ? <Pill tone="green">Alle 4 in orde</Pill> : <Pill tone="red">Afwijking</Pill>}</p></Card>
        <Card><p className="text-sm text-muted">Laatste reconciliatie</p><p className="mt-1">{last ? <><Pill tone={last.outcome === "MATCHED" ? "green" : last.outcome === "BREAKS_FOUND" ? "red" : "grey"}>{last.outcome === "MATCHED" ? "Sluit aan" : last.outcome === "BREAKS_FOUND" ? "Verschillen" : last.outcome}</Pill> <span className="text-xs text-muted">{dateTime(last.as_of)}</span></> : <span className="text-sm">Nog niet uitgevoerd</span>}</p></Card>
        <Card><p className="text-sm text-muted">Open verschillen</p><p className="text-2xl font-semibold">{open.length}</p></Card>
        <Card><p className="text-sm text-muted">Open operaties</p><p className="text-2xl font-semibold">{ops.length}</p></Card>
      </div>

      <Card title="Grootboek (platformbreed)" action={canReconcile ? <form action={reconcileNow}><button className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white">Reconciliatie nu uitvoeren</button></form> : undefined}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
          {([
            ["Bij betaalpartner (activa)", totals.pspAsset],
            ["Klantsaldi beschikbaar", totals.customerAvailable],
            ["Klantreserveringen", totals.customerReserved],
            ["Ontvangen, nog niet definitief", totals.pendingIncoming],
            ["In afwikkeling", totals.pendingSettlement],
            ["Opnames onderweg", totals.pendingWithdrawal],
            ["Vorderingen op klanten", totals.receivables],
            ["Commissie (clearing)", totals.feeClearing],
          ] as [string, number][]).map(([l, v]) => (
            <div key={l} className="flex justify-between gap-3 border-b border-line py-1"><dt className="text-muted">{l}</dt><dd className="num">{euro(v)}</dd></div>
          ))}
        </dl>
        {last?.summary && <p className="mt-3 text-xs text-muted">Laatste run: betaalpartner netto {euro(last.summary.providerNet)}, grootboek netto {euro(last.summary.ledgerNet)}, {last.summary.operations} operaties en {last.summary.providerLines} regels van de betaalpartner vergeleken.</p>}
        {!invOk && <InfoNote>Ongebalanceerde boekingen: {inv.unbalancedEntries} · saldo ≠ journaal: {inv.projectionMismatches} · negatieve klantsaldi: {inv.negativeCustomerBalances} · reserveringen ≠ holds: {inv.reservedNotMatchingHolds}</InfoNote>}
      </Card>

      <Card title={`Verschillen (${open.length} open)`}>
        {open.length === 0 ? <p className="text-sm text-muted">Geen open verschillen.</p> : (
          <ul className="space-y-3">
            {open.map((b) => <BreakItem key={b.id} b={b} userId={user.id} canReconcile={canReconcile} canApprove={canApprove} />)}
          </ul>
        )}
        {closed.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted">Recent afgehandeld ({closed.length})</summary>
            <ul className="mt-2 divide-y divide-line">
              {closed.map((b) => <li key={b.id} className="py-2">{KIND[b.kind] ?? b.kind} · {euro(Number(b.difference_cents))} · {b.resolution_note}</li>)}
            </ul>
          </details>
        )}
      </Card>

      <Card title="Openstaande operaties bij de betaalpartner">
        {ops.length === 0 ? <p className="text-sm text-muted">Geen openstaande operaties.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted"><tr><th className="px-2 py-1 font-medium">Soort</th><th className="px-2 py-1 font-medium">Gebruiker</th><th className="px-2 py-1 text-right font-medium">Bedrag</th><th className="px-2 py-1 font-medium">Status</th><th className="px-2 py-1 font-medium">Pogingen</th><th className="px-2 py-1 font-medium">Sinds</th></tr></thead>
              <tbody className="divide-y divide-line">
                {ops.map((o) => {
                  const [l, tone] = OP_STATUS[o.status] ?? [o.status, "grey" as const];
                  return (
                    <tr key={o.id}>
                      <td className="px-2 py-2">{OP_TYPE[o.type] ?? o.type}</td>
                      <td className="px-2 py-2">{o.user_name ?? "—"}</td>
                      <td className="num px-2 py-2 text-right">{euro(Number(o.amount_cents))}</td>
                      <td className="px-2 py-2"><Pill tone={tone}>{l}</Pill>{o.last_error && <span className="block text-xs text-muted">{o.last_error.slice(0, 80)}</span>}</td>
                      <td className="px-2 py-2">{o.attempts}</td>
                      <td className="whitespace-nowrap px-2 py-2">{dateTime(o.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">De worker vraagt open operaties elke 5 seconden opnieuw op bij de betaalpartner, met dezelfde idempotency-key. Een onbekende uitkomst blijft pending en wordt nooit als mislukt behandeld.</p>
      </Card>
    </div>
  );
}

function BreakItem({ b, userId, canReconcile, canApprove }: { b: BreakRow; userId: string; canReconcile: boolean; canApprove: boolean }) {
  return (
    <li className="rounded-lg border border-line p-3 text-sm" data-testid="break">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{KIND[b.kind] ?? b.kind}</span>
        <Pill tone={b.severity === "MATERIAL" ? "red" : "amber"}>{b.severity === "MATERIAL" ? "Materieel" : "Waarschuwing"}</Pill>
        {b.status === "INVESTIGATING" && <Pill tone="blue">Voorstel ligt klaar</Pill>}
        <span className="num ml-auto">{euro(Number(b.difference_cents))}</span>
      </div>
      <p className="text-muted">{b.user_name ? `Gebruiker: ${b.user_name}` : "Platformbreed: blokkeert alle opnames"} · gevonden {dateTime(b.created_at)}</p>
      <p className="text-xs text-muted">{Object.entries(b.detail).map(([k, v]) => `${k}: ${typeof v === "number" ? euro(v) : String(v)}`).join(" · ")}</p>
      {b.status === "INVESTIGATING" && <p className="mt-1">Voorstel van {b.resolver}: {b.resolution_note}</p>}
      {b.status === "OPEN" && canReconcile && (
        <form action={proposeResolution} className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="breakId" value={b.id} />
          <input name="note" required minLength={10} placeholder="Oorzaak en oplossing" aria-label="Oorzaak en oplossing" className="min-w-48 flex-1 rounded-lg border border-line px-2 py-1.5" />
          <button className="rounded-lg border border-slate-300 px-3 py-1.5">{b.severity === "MATERIAL" ? "Voorstel indienen" : "Afhandelen"}</button>
        </form>
      )}
      {b.status === "INVESTIGATING" && canApprove && b.resolved_by !== userId && (
        <form action={approveResolution} className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="breakId" value={b.id} />
          <input name="reason" required minLength={5} placeholder="Toelichting bij je besluit" aria-label="Toelichting" className="min-w-48 flex-1 rounded-lg border border-line px-2 py-1.5" />
          <button className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">Goedkeuren en sluiten</button>
        </form>
      )}
      {b.status === "INVESTIGATING" && b.resolved_by === userId && <DisabledReason>Je eigen voorstel; een andere bevoegde persoon moet het goedkeuren.</DisabledReason>}
    </li>
  );
}
