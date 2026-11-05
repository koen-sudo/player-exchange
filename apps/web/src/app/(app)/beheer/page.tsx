import { demoWorld } from "@px/demo";
import { Card, PageTitle, Pill } from "@/components/ui";
import { currentUser, hasAdminRole } from "@/server/session";
import { LoginRequired, NotAllowed } from "@/components/login-required";

export const metadata = { title: "Beheer" };

const MODULES: [string, string, string][] = [
  ["Catalogus", "Competities, teams, spelers en mappings", "fase 2"],
  ["Importstatus", "Importruns, dekking en quarantaine", "fase 2"],
  ["Spelertoelating", "Primaire toelating en marktstatus", "fase 3"],
  ["Editie- en voorraadbeheer", "Edities, programma's en kaartnummers", "fase 3"],
  ["Uitgifteplanning", "Drops voorbereiden, publiceren en uitstellen", "fase 6"],
  ["Toewijzingen", "Snapshots, trekkingen en wachtlijsten", "fase 6"],
  ["Waarderingsruns", "Concept, review en publicatie", "fase 7"],
  ["Gebruikers en beperkingen", "Beperkingen per bevoegdheid", "fase 2"],
  ["Orders en uitvoeringen", "Orderboeken en afwikkeling", "fase 5"],
  ["Betalingsafwijkingen", "Pending en mislukte provideroperaties", "fase 4"],
  ["Reconciliatie", "Dagelijkse aansluiting en verschillen", "fase 4"],
  ["Auditlog", "Alle beheeracties met actor en reden", "fase 2"],
];

const GATES = ["Juridisch", "Contracten", "Betalen", "Data", "Beeld", "Spelersidentiteit", "Waardering", "Techniek", "Security", "Operations"];

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) return <LoginRequired what="beheer" />;
  // Server-side authorisation on every request (docs/02 UX-11).
  if (!hasAdminRole(user)) return <NotAllowed />;
  const w = demoWorld();
  const open = w.players.filter((p) => p.marketStatus === "OPEN").length;
  const missing = w.players.filter((p) => p.dataQuality === "MISSING").length;
  return (
    <div className="space-y-5">
      <PageTitle title="Beheer" subtitle={`Ingelogd als ${user.displayName} · rollen: ${user.adminRoles.join(", ")}`} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Card><p className="text-sm text-muted">Catalogusspelers</p><p className="text-2xl font-semibold">{w.players.length}</p></Card>
        <Card><p className="text-sm text-muted">Open markten</p><p className="text-2xl font-semibold">{open}</p></Card>
        <Card><p className="text-sm text-muted">Profielen zonder data</p><p className="text-2xl font-semibold">{missing}</p></Card>
        <Card><p className="text-sm text-muted">Modus</p><p className="text-2xl font-semibold">Demo</p></Card>
      </div>
      <Card title="Modules">
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MODULES.map(([name, desc, fase]) => (
            <li key={name} className="rounded-lg border border-line p-3">
              <p className="font-semibold">{name}</p>
              <p className="text-sm text-muted">{desc}</p>
              <p className="mt-2"><Pill tone="grey">Volgt in {fase}</Pill></p>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Livevoorwaarden (productiegates)">
        <p className="mb-3 text-sm text-muted">Productie is geblokkeerd. Een gate telt alleen met bewijs en goedkeuring door een tweede bevoegde persoon.</p>
        <ul className="flex flex-wrap gap-2">
          {GATES.map((g) => <li key={g}><Pill tone="red">{g}: open</Pill></li>)}
        </ul>
      </Card>
    </div>
  );
}
