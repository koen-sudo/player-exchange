import { getDb, listExecutions, tradingInvariants, tradingStats } from "@px/db";
import { Card, PageTitle, Pill } from "@/components/ui";
import { NotAllowed } from "@/components/login-required";
import { currentUser, hasPermission } from "@/server/session";
import { dateTime, euro } from "@/lib/format";

export const metadata = { title: "Orders en uitvoeringen" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, "green" | "amber" | "red" | "grey" | "blue"]> = {
  MATCHED: ["Gematcht", "blue"], SUBMISSION_PENDING: ["Wacht op indiening", "amber"], PROVIDER_PENDING: ["Bij betaalpartner", "amber"],
  SETTLED: ["Afgewikkeld", "green"], FAILED: ["Mislukt", "red"], MANUAL_REVIEW: ["Handmatige controle", "red"],
};

export default async function TradingAdminPage() {
  const user = (await currentUser())!;
  if (!hasPermission(user, "trading.view")) return <NotAllowed />;
  const { db } = getDb();
  const [inv, stats, execs] = await Promise.all([tradingInvariants(db), tradingStats(db), listExecutions(db)]);
  const ok = Object.values(inv).every((v) => v === 0);
  return (
    <div className="space-y-5">
      <PageTitle title="Orders en uitvoeringen" subtitle="Per spelersmarkt is maximaal één afwikkeling tegelijk onderweg. Een uitvoering zonder antwoord blijft open en wordt met dezelfde sleutel opnieuw opgevraagd." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><p className="text-sm text-muted">Handelsinvarianten</p><p className="mt-1">{ok ? <Pill tone="green">Alle 5 in orde</Pill> : <Pill tone="red">Afwijking</Pill>}</p></Card>
        <Card><p className="text-sm text-muted">Open orders</p><p className="text-2xl font-semibold">{stats.open_orders}</p><p className="text-xs text-muted">{stats.open_buy_cards} kaarten gevraagd · {stats.open_sell_cards} aangeboden</p></Card>
        <Card><p className="text-sm text-muted">Afgewikkeld (24 uur)</p><p className="text-2xl font-semibold">{stats.settled_24h}</p><p className="text-xs text-muted">Volume {euro(Number(stats.volume_24h))}</p></Card>
        <Card><p className="text-sm text-muted">Commissie (24 uur)</p><p className="text-2xl font-semibold">{euro(Number(stats.fees_24h))}</p></Card>
      </div>
      {!ok && <Card><p className="text-sm">Aantallen kloppen niet: {inv.quantitiesNotAddingUp} · twee afwikkelingen in één markt: {inv.marketsWithTwoSettlements} · afgewikkeld zonder levering: {inv.settledWithoutDelivery} · reservering ≠ open kooporder: {inv.buyHoldsNotMatchingOpen} · kaarten ≠ verkooporder: {inv.sellCardsNotMatchingOrder}</p></Card>}
      <Card title="Uitvoeringen">
        {execs.length === 0 ? <p className="text-sm text-muted">Nog geen uitvoeringen.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted"><tr><th className="px-2 py-1 font-medium">Speler</th><th className="px-2 py-1 font-medium">Koper</th><th className="px-2 py-1 font-medium">Verkoper</th><th className="px-2 py-1 text-right font-medium">Prijs</th><th className="px-2 py-1 text-right font-medium">Commissie</th><th className="px-2 py-1 font-medium">Status</th><th className="px-2 py-1 font-medium">Gematcht</th></tr></thead>
              <tbody className="divide-y divide-line">
                {execs.map((x) => {
                  const [l, tone] = STATUS[x.status] ?? [x.status, "grey" as const];
                  return (
                    <tr key={x.id}>
                      <td className="px-2 py-2">{x.player_name}</td>
                      <td className="px-2 py-2">{x.buyer ?? "—"}</td>
                      <td className="px-2 py-2">{x.seller ?? "—"}</td>
                      <td className="num px-2 py-2 text-right">{euro(Number(x.price_cents))}</td>
                      <td className="num px-2 py-2 text-right">{x.fee_cents === null ? "—" : euro(Number(x.fee_cents))}</td>
                      <td className="px-2 py-2"><Pill tone={tone}>{l}</Pill>{x.attempts && x.attempts > 1 ? <span className="block text-xs text-muted">{x.attempts} pogingen</span> : null}</td>
                      <td className="whitespace-nowrap px-2 py-2">{dateTime(x.matched_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
