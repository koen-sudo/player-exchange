import Link from "next/link";
import { listDrops, listMarket, portfolio } from "@px/demo";
import { Avatar, Card, Change, Money, PageTitle, Stat } from "@/components/ui";
import { currentUser } from "@/server/session";
import { weekdayTime } from "@/lib/format";
import { loadWorld } from "@/server/world";

export const metadata = { title: "Overzicht" };

export default async function OverviewPage() {
  const w = await loadWorld((await currentUser())?.id ?? null);
  const user = await currentUser();
  const p = user ? portfolio(w, user.id) : null;
  const movers = listMarket(w, { status: "TRADABLE", sort: "change", dir: "desc", pageSize: 5 }).rows;
  const drops = listDrops(w, "binnenkort").slice(0, 3);

  return (
    <div className="space-y-6">
      <PageTitle title={user ? `Welkom, ${user.displayName.split(" ")[0]}` : "Overzicht"} subtitle="Volg spelers, bekijk uitgiftes en beheer je kaarten." />
      {p ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Beschikbaar saldo"><Money cents={p.balance.available} /></Stat>
          <Stat label="Gereserveerd"><Money cents={p.balance.reserved} /></Stat>
          <Stat label="Kaartbezit">{p.summary.label}</Stat>
          <Stat label="Referentiewaarde kaarten" hint="Modelwaardering, geen verkoopprijs"><Money cents={p.summary.totalReference} /></Stat>
        </div>
      ) : (
        <Card>
          <p>Bekijk de markt zonder account. <Link href="/login" className="font-semibold text-primary underline">Log in</Link> met een demo-account om je portefeuille en de orderflow te zien.</p>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Grootste stijgers in referentiewaarde" action={<Link href="/markt?status=TRADABLE&sort=change&richting=desc" className="text-sm text-primary hover:underline">Naar de markt</Link>}>
          <ul className="divide-y divide-line">
            {movers.map((r) => (
              <li key={r.playerId}>
                <Link href={`/spelers/${r.playerId}`} className="flex items-center gap-3 py-2">
                  <Avatar initials={r.initials} size="sm" />
                  <span className="min-w-0 flex-1"><span className="block font-medium">{r.name}</span><span className="block text-xs text-muted">{r.team}</span></span>
                  <span className="text-right text-sm"><Money cents={r.reference} /><br /><Change cents={r.change} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Komende uitgiftes" action={<Link href="/uitgiftes" className="text-sm text-primary hover:underline">Alle uitgiftes</Link>}>
          <ul className="divide-y divide-line">
            {drops.map((d) => (
              <li key={d.drop.id} className="flex items-center gap-3 py-2">
                <Avatar initials={d.player.initials} size="sm" />
                <span className="min-w-0 flex-1"><span className="block font-medium">{d.player.displayName}</span><span className="block text-xs capitalize text-muted">{weekdayTime(d.drop.opensAt)} · {d.drop.quantity} kaarten</span></span>
                <Money cents={d.drop.priceCents} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
