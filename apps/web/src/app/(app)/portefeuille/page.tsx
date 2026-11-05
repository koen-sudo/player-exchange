import Link from "next/link";
import { demoWorld, ordersFor, portfolio, transactionsFor } from "@px/demo";
import { Avatar, Card, EmptyState, InfoNote, Money, PageTitle, Pill, Stat, buttonPrimary, buttonSecondary } from "@/components/ui";
import { currentUser } from "@/server/session";
import { dateOnly, euro } from "@/lib/format";
import { LoginRequired } from "@/components/login-required";

export const metadata = { title: "Portefeuille" };

export default async function PortfolioPage() {
  const user = await currentUser();
  if (!user) return <LoginRequired what="je portefeuille" />;
  const w = demoWorld();
  const p = portfolio(w, user.id);
  const orders = ordersFor(w, user.id).filter((o) => o.qty.open > 0 || o.qty.pending > 0);
  const tx = transactionsFor(w, user.id).slice(0, 5);
  const inSettlement = orders.reduce((n, o) => n + o.qty.pending, 0);

  return (
    <div>
      <PageTitle
        title="Portefeuille"
        subtitle="Je saldo, kaarten, openstaande orders en recente transacties."
        actions={
          <>
            <Link href="/betalingen" className={buttonPrimary}>Geld toevoegen</Link>
            <Link href="/betalingen" className={buttonSecondary}>Opnemen</Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Beschikbaar saldo"><Money cents={p.balance.available} /></Stat>
        <Stat label="Gereserveerd"><Money cents={p.balance.reserved} /></Stat>
        <Stat label="Aankoopwaarde kaarten"><Money cents={p.summary.totalCost} /></Stat>
        <Stat label="Referentiewaarde kaarten" hint={p.summary.cardsWithoutReference > 0 ? `${p.summary.cardsWithoutReference} kaarten zonder gepubliceerde referentie niet meegeteld` : undefined}>
          <Money cents={p.summary.totalReference} />
        </Stat>
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm text-muted">
        <span>In afwikkeling: {inSettlement === 0 && p.balance.pendingIncoming === 0 ? "niets" : `${inSettlement} kaarten · ${euro(p.balance.pendingIncoming)} nog niet beschikbaar`}</span>
        <InfoNote>Referentiewaarde is een modelwaardering, geen verkoopprijs.</InfoNote>
      </div>

      {/* WF-01: players and cards are counted separately. */}
      <section className="mt-6 rounded-xl border border-line bg-white">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-lg font-semibold">Mijn kaarten</h2>
          <span className="text-sm font-medium text-muted">{p.summary.label}</span>
        </header>
        {p.positions.length === 0 ? (
          <div className="p-4"><EmptyState title="Nog geen kaarten">Bekijk de <Link href="/uitgiftes" className="text-primary underline">uitgiftes</Link> of de <Link href="/markt" className="text-primary underline">markt</Link>.</EmptyState></div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Speler</th>
                    <th className="px-4 py-2 text-right font-medium">In bezit</th>
                    <th className="px-4 py-2 text-right font-medium">Vrij te verkopen</th>
                    <th className="px-4 py-2 text-right font-medium">Gereserveerd</th>
                    <th className="px-4 py-2 text-right font-medium">Gem. aankoop</th>
                    <th className="px-4 py-2 text-right font-medium">Aankoopwaarde</th>
                    <th className="px-4 py-2 text-right font-medium">Referentiewaarde</th>
                    <th className="px-4 py-2 text-right font-medium">Hoogste bod per kaart</th>
                    <th className="px-4 py-2 font-medium"><span className="sr-only">Acties</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {p.positions.map((pos) => (
                    <tr key={pos.playerId}>
                      <td className="px-4 py-3">
                        <Link href={`/spelers/${pos.playerId}`} className="flex items-center gap-3">
                          <Avatar initials={pos.row.initials} />
                          <span><span className="block font-semibold">{pos.row.name}</span><span className="block text-xs text-muted">{pos.row.role} · {pos.row.team}</span></span>
                        </Link>
                      </td>
                      <td className="num px-4 py-3 text-right">{pos.quantity}</td>
                      <td className="num px-4 py-3 text-right">{pos.availableForSale}</td>
                      <td className="num px-4 py-3 text-right">{pos.reserved}</td>
                      <td className="px-4 py-3 text-right"><Money cents={pos.averageCost} /></td>
                      <td className="px-4 py-3 text-right"><Money cents={pos.totalCost} /></td>
                      <td className="px-4 py-3 text-right"><Money cents={pos.totalReference} /></td>
                      <td className="px-4 py-3 text-right">{pos.highestBidPerCard === null ? <span className="text-muted">Geen actueel bod</span> : <Money cents={pos.highestBidPerCard} />}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/spelers/${pos.playerId}?tab=handel`} className="text-primary hover:underline">Handelen</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {p.positions.map((pos) => (
                <li key={pos.playerId}>
                  <Link href={`/spelers/${pos.playerId}`} className="flex items-center gap-3 px-4 py-3">
                    <Avatar initials={pos.row.initials} />
                    <span className="min-w-0 flex-1"><span className="block font-semibold">{pos.row.name}</span><span className="block text-xs text-muted">{pos.quantity} in bezit · {pos.reserved} gereserveerd</span></span>
                    <span className="text-right text-sm"><span className="block text-xs text-muted">Referentie</span><Money cents={pos.totalReference} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title={`Openstaande orders (${orders.length})`} action={<Link href="/transacties" className="text-sm text-primary hover:underline">Alle orders</Link>}>
          {orders.length === 0 ? <p className="text-sm text-muted">Geen openstaande orders.</p> : (
            <ul className="divide-y divide-line text-sm">
              {orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-3 py-2">
                  <Avatar initials={o.initials} size="sm" />
                  <span className="min-w-0 flex-1 font-medium">{o.playerName}</span>
                  <Pill tone={o.side === "BUY" ? "green" : "blue"}>{o.side === "BUY" ? "Kopen" : "Verkopen"}</Pill>
                  <span className="num">{o.qty.open} × {euro(o.limitPriceCents)}</span>
                  <Pill tone="green">{o.statusLabel}</Pill>
                </li>
              ))}
            </ul>
          )}
          {orders.some((o) => o.side === "BUY") && (
            <p className="mt-2 text-xs text-muted">Gereserveerd voor kooporders: {euro(orders.reduce((n, o) => n + o.reservedCents, 0))}.</p>
          )}
        </Card>
        <Card title="Recente transacties">
          {tx.length === 0 ? <p className="text-sm text-muted">Nog geen transacties.</p> : (
            <ul className="divide-y divide-line text-sm">
              {tx.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="w-24 text-muted">{dateOnly(t.at)}</span>
                  <span className="min-w-0 flex-1 font-medium">{t.player.displayName}</span>
                  <span className="num">{t.quantity} × {euro(t.priceCents)}</span>
                  <Pill tone={t.status === "SETTLED" ? "green" : "amber"}>{t.status === "SETTLED" ? "Afgewikkeld" : "In afwikkeling"}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
