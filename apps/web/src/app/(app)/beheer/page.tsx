import Link from "next/link";
import { catalogCoverage, getDb } from "@px/db";
import { Card, PageTitle, Pill } from "@/components/ui";
import { currentUser, hasPermission } from "@/server/session";

export const metadata = { title: "Beheer" };
export const dynamic = "force-dynamic";

const MODULES: [string, string, string, string | null][] = [
  ["Catalogus en importstatus", "Competities, teams, spelers, imports en quarantaine", "catalog.view", "/beheer/catalogus"],
  ["Gebruikers en beperkingen", "Status, verificatie en beperkingen per bevoegdheid", "users.view", "/beheer/gebruikers"],
  ["Auditlog", "Alle beheeracties met actor en reden", "audit.view", "/beheer/audit"],
  ["Spelertoelating", "Primaire toelating en marktstatus", "catalog.view", "/beheer/spelers"],
  ["Editie- en voorraadbeheer", "Edities, programma's en kaartnummers", "catalog.view", "/beheer/voorraad"],
  ["Goedkeuringen", "Vier-ogenprincipe voor gevoelige handelingen", "approvals.decide", "/beheer/goedkeuringen"],
  ["Betalingsafwijkingen en reconciliatie", "Pending operaties, grootboek en aansluiting met de betaalpartner", "finance.operate", "/beheer/betalingen"],
  ["Orders en uitvoeringen", "Uitvoeringen, afwikkeling en handelsinvarianten", "trading.view", "/beheer/handel"],
  ["Uitgifteplanning en toewijzingen", "Drops, prijswijzigingen, trekkingen en wachtlijsten", "issuance.prepare", "/beheer/uitgiftes"],
  ["Waarderingsruns", "Concept, controle, beoordeling en publicatie", "valuation.prepare", "/beheer/waardering"],
];

const GATES = ["Juridisch", "Contracten", "Betalen", "Data", "Beeld", "Spelersidentiteit", "Waardering", "Techniek", "Security", "Operations"];

export default async function AdminPage() {
  const user = (await currentUser())!;
  const cov = await catalogCoverage(getDb().db);
  const open = cov.perCompetition.reduce((n, c) => n + c.openMarkets, 0);
  const missing = cov.perCompetition.reduce((n, c) => n + c.missingData, 0);
  return (
    <div className="space-y-5">
      <PageTitle title="Beheer" subtitle={`Ingelogd als ${user.displayName} · rollen: ${user.roles.join(", ")}`} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Card><p className="text-sm text-muted">Catalogusspelers</p><p className="text-2xl font-semibold">{cov.players}</p></Card>
        <Card><p className="text-sm text-muted">Open markten</p><p className="text-2xl font-semibold">{open}</p></Card>
        <Card><p className="text-sm text-muted">Profielen zonder data</p><p className="text-2xl font-semibold">{missing}</p></Card>
        <Card><p className="text-sm text-muted">Modus</p><p className="text-2xl font-semibold">Demo</p></Card>
      </div>
      <Card title="Modules">
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MODULES.map(([name, desc, perm, href]) => {
            const available = href !== null && hasPermission(user, perm);
            const body = (
              <>
                <p className="font-semibold">{name}</p>
                <p className="text-sm text-muted">{desc}</p>
                <p className="mt-2">{href === null ? <Pill tone="grey">Volgt in {perm}</Pill> : available ? <Pill tone="green">Beschikbaar</Pill> : <Pill tone="amber">Geen rechten</Pill>}</p>
              </>
            );
            return (
              <li key={name}>
                {available ? <Link href={href!} className="block h-full rounded-lg border border-line p-3 hover:border-primary">{body}</Link> : <div className="h-full rounded-lg border border-line p-3">{body}</div>}
              </li>
            );
          })}
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
