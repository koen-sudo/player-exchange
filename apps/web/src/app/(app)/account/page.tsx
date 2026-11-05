import { Card, DisabledReason, PageTitle, Pill } from "@/components/ui";
import { currentUser } from "@/server/session";
import { LoginRequired } from "@/components/login-required";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) return <LoginRequired what="je account" />;
  const later = (fase: string) => <DisabledReason>Wijzigen volgt in {fase}. In de demo zijn accountgegevens vast.</DisabledReason>;
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
          {later("fase 2")}
          <p className="mt-2 text-xs text-muted">Een wijziging van identiteit of woonland kan een nieuwe beoordeling vereisen.</p>
        </Card>
        <Card title="Verificatie">
          <p className="text-sm">{user.verified ? <Pill tone="green">Identiteit en leeftijd bevestigd (demo)</Pill> : <Pill tone="amber">Verificatie vereist om te handelen</Pill>}</p>
          {!user.verified && (
            <>
              <button type="button" disabled className="mt-3 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white disabled:opacity-50">Verificatie starten</button>
              <DisabledReason>De identiteitsprovider is nog niet gekozen (O-06). Verificatie volgt in fase 2.</DisabledReason>
            </>
          )}
        </Card>
        <Card title="Meldingen">
          <p className="text-sm text-muted">In-app en e-mail voor inschrijving, toewijzing, afgewikkelde transacties en uitbetalingen.</p>
          {later("fase 6")}
        </Card>
        <Card title="Beveiliging en sessies">
          <p className="text-sm text-muted">Inloggen via een externe identiteitsprovider. Actieve sessies en uitloggen op alle apparaten volgen met de koppeling.</p>
          {later("fase 2")}
        </Card>
        <Card title="Gegevensverzoeken">
          <p className="text-sm text-muted">Inzage, export en verwijdering van je gegevens.</p>
          {later("fase 9")}
        </Card>
      </div>
    </div>
  );
}
