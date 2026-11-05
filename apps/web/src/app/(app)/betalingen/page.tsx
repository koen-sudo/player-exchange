import { demoWorld } from "@px/demo";
import { Card, DisabledReason, InfoNote, Money, PageTitle, Pill, Stat } from "@/components/ui";
import { currentUser } from "@/server/session";
import { LoginRequired } from "@/components/login-required";

export const metadata = { title: "Betalingen" };

export default async function PaymentsPage() {
  const user = await currentUser();
  if (!user) return <LoginRequired what="je betalingen" />;
  const b = demoWorld().balances[user.id] ?? { available: 0, reserved: 0, pendingIncoming: 0 };
  return (
    <div className="space-y-5">
      <PageTitle title="Betalingen" subtitle="Storten en opnemen lopen via de betaalpartner." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Beschikbaar saldo"><Money cents={b.available} /></Stat>
        <Stat label="Reserveringen"><Money cents={b.reserved} /></Stat>
        <Stat label="Nog niet beschikbaar"><Money cents={b.pendingIncoming} /></Stat>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Geld toevoegen">
          <button type="button" disabled className="w-full rounded-lg bg-primary py-3 font-semibold text-white disabled:opacity-50">Storting starten</button>
          <DisabledReason>Niet beschikbaar in de demo: er is nog geen betaalpartner gekozen (O-02). De gesimuleerde betaalstroom volgt in fase 4. Voer nergens echte betaalgegevens in.</DisabledReason>
        </Card>
        <Card title="Geld opnemen">
          <button type="button" disabled className="w-full rounded-lg border border-slate-300 py-3 font-medium disabled:opacity-50">Opname aanvragen</button>
          <DisabledReason>Niet beschikbaar in de demo. Opnames worden aangesloten met de betaalsimulator in fase 4.</DisabledReason>
        </Card>
      </div>
      <Card title="Status">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex justify-between"><dt>Verificatie</dt><dd>{user.verified ? <Pill tone="green">Bevestigd (demo)</Pill> : <Pill tone="amber">Nog niet gestart</Pill>}</dd></div>
          <div className="flex justify-between"><dt>Betaalrekening</dt><dd><Pill tone="grey">Niet gekoppeld</Pill></dd></div>
        </dl>
        <div className="mt-3"><InfoNote>Een terugkeer van de betaalpagina met "gelukt" geldt nooit als bevestiging. Saldo wordt pas beschikbaar na bevestiging door de betaalpartner.</InfoNote></div>
      </Card>
    </div>
  );
}
