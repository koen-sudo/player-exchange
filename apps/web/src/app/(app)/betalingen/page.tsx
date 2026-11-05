import { randomUUID } from "node:crypto";
import Link from "next/link";
import { balancesFor, getDb, paymentAccountFor, paymentHistory, reconciliationHold, type PaymentHistoryItem } from "@px/db";
import { DEFAULT_PAYMENT_LIMITS } from "@px/domain";
import { loadConfig } from "@px/integrations/env";
import { Card, DisabledReason, InfoNote, Money, PageTitle, Pill, Stat } from "@/components/ui";
import { Flash } from "@/components/flash";
import { AutoRefresh } from "@/components/auto-refresh";
import { currentUser } from "@/server/session";
import { LoginRequired } from "@/components/login-required";
import { dateTime, euro } from "@/lib/format";
import { depositAction, withdrawAction } from "./actions";

export const metadata = { title: "Betalingen" };
export const dynamic = "force-dynamic";

type Tone = "green" | "grey" | "amber" | "blue" | "red";
const DEPOSIT_STATUS: Record<string, [string, Tone]> = {
  INITIATED: ["Wacht op betaling", "amber"],
  PENDING: ["In verwerking, nog niet beschikbaar", "amber"],
  CONFIRMED: ["Bijgeschreven", "green"],
  FAILED: ["Mislukt", "red"],
  REVERSED: ["Teruggeboekt", "red"],
};
const WITHDRAWAL_STATUS: Record<string, [string, Tone]> = {
  REQUESTED: ["Aangevraagd", "amber"],
  HELD: ["Aangevraagd", "amber"],
  SUBMITTED: ["Bij betaalpartner", "amber"],
  PENDING: ["In verwerking", "amber"],
  PAID: ["Uitbetaald", "green"],
  FAILED: ["Mislukt, bedrag terug", "red"],
};
const statusOf = (i: PaymentHistoryItem) => (i.kind === "DEPOSIT" ? DEPOSIT_STATUS : WITHDRAWAL_STATUS)[i.status] ?? [i.status, "grey" as Tone];
const isOpen = (i: PaymentHistoryItem) => ["INITIATED", "PENDING", "HELD", "SUBMITTED", "REQUESTED"].includes(i.status);

const DEMO_OUTCOMES = [
  ["SUCCESS", "Uitbetaald"],
  ["DELAYED", "Uitbetaald met vertraging"],
  ["UNKNOWN_THEN_SUCCESS", "Geen antwoord, later toch uitbetaald"],
  ["FAIL", "Geweigerd door de bank"],
] as const;

type SP = Promise<{ melding?: string; fout?: string; storting?: string }>;

export default async function PaymentsPage({ searchParams }: { searchParams: SP }) {
  const user = await currentUser();
  if (!user) return <LoginRequired what="je betalingen" />;
  const sp = await searchParams;
  const { db } = getDb();
  const cfg = loadConfig(process.env);
  const [b, history, account, hold] = await Promise.all([
    balancesFor(db, user.id),
    paymentHistory(db, user.id),
    paymentAccountFor(db, user.id, cfg.adapters.payment),
    reconciliationHold(db, user.id),
  ]);
  const focus = sp.storting ? history.find((h) => h.id === sp.storting && h.kind === "DEPOSIT") : undefined;
  const anyOpen = history.some(isOpen);
  const canDeposit = user.actions.DEPOSIT;
  const canWithdraw = user.actions.WITHDRAW;
  const demo = cfg.mode === "demo";

  return (
    <div className="space-y-5">
      <PageTitle title="Betalingen" subtitle="Storten en opnemen lopen via de betaalpartner. Saldo wordt pas beschikbaar na bevestiging door de betaalpartner." />
      {anyOpen && <AutoRefresh />}
      <Flash melding={sp.melding} fout={sp.fout} />
      {focus && (
        <p role="status" className={`rounded-lg px-4 py-3 text-sm ${focus.status === "CONFIRMED" ? "bg-primary-soft" : focus.status === "FAILED" ? "bg-danger-soft" : "bg-warn-soft"}`}>
          {focus.status === "CONFIRMED" && <>Storting van <strong>{euro(focus.amountCents)}</strong> is bevestigd door de betaalpartner en bijgeschreven.</>}
          {focus.status === "INITIATED" && <>We hebben nog geen bevestiging van de betaalpartner voor je storting van <strong>{euro(focus.amountCents)}</strong>. Er is nog niets bijgeschreven. Deze pagina ververst vanzelf.</>}
          {focus.status === "PENDING" && <>De betaalpartner verwerkt je storting van <strong>{euro(focus.amountCents)}</strong>. Het bedrag staat bij ‘Nog niet beschikbaar’ tot de betaling definitief is.</>}
          {focus.status === "FAILED" && <>Je storting van <strong>{euro(focus.amountCents)}</strong> is niet gelukt{focus.failureReason ? `: ${focus.failureReason}` : ""}. Er is niets afgeschreven.</>}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Beschikbaar saldo"><Money cents={b.available} /></Stat>
        <Stat label="Reserveringen" hint="Voor open kooporders en inschrijvingen"><Money cents={b.reserved} /></Stat>
        <Stat label="Nog niet beschikbaar" hint="Ontvangen, nog niet definitief"><Money cents={b.pendingIncoming + b.inSettlement} /></Stat>
        <Stat label="Opname onderweg"><Money cents={b.pendingWithdrawal} /></Stat>
      </div>
      {b.receivable > 0 && <InfoNote>Er staat een openstaand bedrag van {euro(b.receivable)} op je account na een teruggeboekte betaling. Neem contact op met support.</InfoNote>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Geld toevoegen">
          <form action={depositAction} className="space-y-3">
            <input type="hidden" name="requestKey" value={randomUUID()} />
            <label className="block text-sm font-medium" htmlFor="deposit-amount">Bedrag</label>
            <div className="flex items-center rounded-lg border border-line px-3 focus-within:border-primary">
              <span className="text-muted" aria-hidden>€</span>
              <input id="deposit-amount" name="amount" inputMode="decimal" required defaultValue="25,00" disabled={!canDeposit.allowed}
                aria-describedby="deposit-help" className="num w-full bg-transparent px-2 py-2.5 outline-none" />
            </div>
            <p id="deposit-help" className="text-xs text-muted">Tussen {euro(DEFAULT_PAYMENT_LIMITS.depositMin)} en {euro(DEFAULT_PAYMENT_LIMITS.depositMax)} per storting.</p>
            <button disabled={!canDeposit.allowed} className="w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:opacity-50">Verder naar betalen</button>
            {!canDeposit.allowed && <DisabledReason>{canDeposit.reason}</DisabledReason>}
            {demo && <p className="text-xs text-muted">Demo: je gaat naar een gesimuleerde betaalpagina. Er wordt nergens om betaalgegevens gevraagd.</p>}
          </form>
        </Card>
        <Card title="Geld opnemen">
          <form action={withdrawAction} className="space-y-3">
            <input type="hidden" name="requestKey" value={randomUUID()} />
            <label className="block text-sm font-medium" htmlFor="withdraw-amount">Bedrag</label>
            <div className="flex items-center rounded-lg border border-line px-3 focus-within:border-primary">
              <span className="text-muted" aria-hidden>€</span>
              <input id="withdraw-amount" name="amount" inputMode="decimal" required placeholder="0,00" disabled={!canWithdraw.allowed || hold || !account}
                aria-describedby="withdraw-help" className="num w-full bg-transparent px-2 py-2.5 outline-none" />
            </div>
            <p id="withdraw-help" className="text-xs text-muted">Maximaal je beschikbare saldo ({euro(b.available)}). Naar {account?.displayRef ?? "je betaalrekening"}.</p>
            {demo && (
              <label className="block text-sm">
                <span className="font-medium">Demo: antwoord van de betaalpartner</span>
                <select name="demoOutcome" className="mt-1 w-full rounded-lg border border-line bg-white px-2 py-2">
                  {DEMO_OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            )}
            <button disabled={!canWithdraw.allowed || hold || !account} className="w-full rounded-lg border border-slate-300 py-3 font-medium hover:border-primary disabled:opacity-50">Opname aanvragen</button>
            {!canWithdraw.allowed && <DisabledReason>{canWithdraw.reason}</DisabledReason>}
            {canWithdraw.allowed && hold && <DisabledReason>Opnemen is tijdelijk geblokkeerd: er loopt een onderzoek naar een verschil met de betaalpartner.</DisabledReason>}
            {canWithdraw.allowed && !account && <DisabledReason>Er is nog geen bevestigde betaalrekening voor uitbetalingen.</DisabledReason>}
          </form>
        </Card>
      </div>

      <Card title="Stortingen en opnames">
        {history.length === 0 ? <p className="text-sm text-muted">Nog geen stortingen of opnames.</p> : (
          <ul className="divide-y divide-line text-sm">
            {history.map((h) => {
              const [label, tone] = statusOf(h);
              return (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid="payment-row">
                  <div>
                    <p className="font-medium">{h.isOpening ? "Openingssaldo (demo)" : h.kind === "DEPOSIT" ? "Storting" : "Opname"}</p>
                    <p className="text-xs text-muted">{dateTime(h.createdAt)}{h.failureReason ? ` · ${h.failureReason}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`num font-semibold ${h.status === "FAILED" ? "text-muted line-through" : h.kind === "WITHDRAWAL" ? "" : "text-up"}`}>{h.kind === "WITHDRAWAL" ? "−" : "+"}{euro(h.amountCents)}</span>
                    <Pill tone={tone}>{label}</Pill>
                    {h.kind === "DEPOSIT" && h.status === "INITIATED" && h.redirectUrl && <Link href={h.redirectUrl} className="text-primary underline">Verder betalen</Link>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Status">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-2"><dt>Verificatie</dt><dd>{user.verified ? <Pill tone="green">Bevestigd (demo)</Pill> : <Pill tone="amber">Nog niet gestart</Pill>}</dd></div>
          <div className="flex justify-between gap-2"><dt>Betaalrekening</dt><dd>{account?.status === "ACTIVE" ? <Pill tone="green">{account.displayRef ?? "Gekoppeld"}</Pill> : <Pill tone="grey">Niet gekoppeld</Pill>}</dd></div>
        </dl>
        <div className="mt-3"><InfoNote>Een terugkeer van de betaalpagina met “gelukt” geldt nooit als bevestiging. Saldo wordt pas beschikbaar na bevestiging door de betaalpartner.{demo ? " In deze demo is de betaalpartner een simulator; er gaat geen echt geld om." : ""}</InfoNote></div>
      </Card>
    </div>
  );
}
