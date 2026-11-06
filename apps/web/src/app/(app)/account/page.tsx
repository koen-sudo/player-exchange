import { Card, DisabledReason, PageTitle, Pill } from "@/components/ui";
import { currentUser } from "@/server/session";
import { LoginRequired } from "@/components/login-required";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) return <LoginRequired what="je account" />;
  const later = (what: string) => <DisabledReason>{what} In de demo zijn accountgegevens vast.</DisabledReason>;
  return (
    <div className="space-y-5">
      <PageTitle title="Account" subtitle="Profiel, verificatie en voorkeuren." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Profiel">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt>Naam</dt><dd>{user.displayName}</dd></div>
            <div className="flex justify-between"><dt>Woonland</dt><dd>{user.residenceCountry === "NL" ? "Nederland" : user.residenceCountry}</dd></div>
            <div className="flex justify-between"><dt>Taal</dt><dd>Nederlands</dd></div>
          </dl>
          {later("Wijzigen volgt met de identiteitsprovider (O-06).")}
          <p className="mt-2 text-xs text-muted">Een wijziging van identiteit of woonland kan een nieuwe beoordeling vereisen.</p>
        </Card>
        <Card title="Verificatie">
          <p className="text-sm">{user.verified ? <Pill tone="green">Identiteit en leeftijd bevestigd (demo)</Pill> : <Pill tone="amber">Verificatie vereist om te handelen</Pill>}</p>
          {!user.verified && (
            <>
              <button type="button" disabled className="mt-3 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white disabled:opacity-50">Verificatie starten</button>
              <DisabledReason>De identiteitsprovider is nog niet gekozen (O-06). Verificatie volgt met die koppeling.</DisabledReason>
            </>
          )}
        </Card>
        <Card title="Meldingen">
          <p className="text-sm text-muted">Meldingen over inschrijving, toewijzing, afgewikkelde transacties en uitbetalingen staan in de app. E-mail en push volgen met een notificatieprovider.</p>
        </Card>
        <Card title="Beveiliging en sessies">
          <p className="text-sm text-muted">Inloggen via een externe identiteitsprovider; beheerders gebruiken tweestapsverificatie. Een sessie verloopt na 8 uur. Actieve sessies en uitloggen op alle apparaten volgen met die koppeling (O-06).</p>
        </Card>
        <Card title="Gegevensverzoeken">
          <p className="text-sm text-muted">Download alles wat we over je bewaren: profiel, saldi en boekingen, stortingen en opnames, orders, transacties, kaarten, inschrijvingen en meldingen.</p>
          <a href="/api/v1/me/export" className="mt-3 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold" download>Mijn gegevens downloaden (JSON)</a>
          <p className="mt-3 text-xs text-muted">Verwijderen gaat via support. Gegevens over geld en transacties bewaren we zolang de wet dat vraagt; die termijnen volgen uit de juridische beoordeling.</p>
        </Card>
      </div>
    </div>
  );
}
