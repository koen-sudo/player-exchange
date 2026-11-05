import { ordersFor, transactionsFor, type OrderView } from "@px/demo";
import { Avatar, Card, PageTitle, Pill } from "@/components/ui";
import { currentUser } from "@/server/session";
import { LoginRequired } from "@/components/login-required";
import { dateTime, euro } from "@/lib/format";
import { loadWorld } from "@/server/world";

export const metadata = { title: "Transacties" };

const KIND = { PRIMARY_PURCHASE: "Uitgifte", SECONDARY_PURCHASE: "Aankoop", SECONDARY_SALE: "Verkoop" } as const;

export default async function TransactionsPage() {
  const user = await currentUser();
  if (!user) return <LoginRequired what="je orders en transacties" />;
  const w = await loadWorld((await currentUser())?.id ?? null);
  const orders = ordersFor(w, user.id);
  const groups: [string, OrderView[]][] = [
    ["Open orders", orders.filter((o) => o.status === "OPEN")],
    ["Gedeeltelijk uitgevoerd", orders.filter((o) => o.status === "PARTIALLY_FILLED")],
    ["Uitvoeringen in afwikkeling", orders.filter((o) => o.status === "IN_SETTLEMENT")],
    ["Geannuleerd en verlopen", orders.filter((o) => o.status === "CANCELLED" || o.status === "EXPIRED")],
  ];
  const tx = transactionsFor(w, user.id);

  return (
    <div className="space-y-5">
      <PageTitle title="Orders en transacties" subtitle="Alleen het nog niet gematchte deel van een order kan worden geannuleerd." />
      {groups.map(([title, list]) => (
        <Card key={title} title={`${title} (${list.length})`}>
          {list.length === 0 ? <p className="text-sm text-muted">Niets in deze categorie.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr><th className="py-1 font-medium">Speler</th><th className="py-1 font-medium">Type</th><th className="py-1 text-right font-medium">Aantal</th><th className="py-1 text-right font-medium">Limiet</th><th className="py-1 font-medium">Duur tot</th><th className="py-1 font-medium">Status</th><th className="py-1"><span className="sr-only">Acties</span></th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.map((o) => (
                    <tr key={o.id}>
                      <td className="py-2"><span className="flex items-center gap-2"><Avatar initials={o.initials} size="sm" />{o.playerName}</span></td>
                      <td className="py-2"><Pill tone={o.side === "BUY" ? "green" : "blue"}>{o.side === "BUY" ? "Kopen" : "Verkopen"}</Pill></td>
                      <td className="num py-2 text-right">{o.qty.open > 0 ? `${o.qty.open} open van ${o.qty.original}` : o.qty.original}</td>
                      <td className="num py-2 text-right">{euro(o.limitPriceCents)}</td>
                      <td className="py-2">{dateTime(o.expiresAt)}</td>
                      <td className="py-2"><Pill tone={o.status === "OPEN" ? "green" : o.status === "IN_SETTLEMENT" ? "amber" : "grey"}>{o.statusLabel}</Pill></td>
                      <td className="py-2 text-right">
                        {o.qty.open > 0 && (
                          <span title="Annuleren wordt in fase 5 aangesloten">
                            <button type="button" disabled className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-50">Annuleren</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {list.some((o) => o.qty.open > 0) && <p className="mt-2 text-xs text-muted">Annuleren is in de demo nog niet beschikbaar: de handelsdienst wordt in fase 5 aangesloten.</p>}
            </div>
          )}
        </Card>
      ))}
      <Card title={`Afgewikkelde transacties (${tx.filter((t) => t.status === "SETTLED").length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted"><tr><th className="py-1 font-medium">Datum</th><th className="py-1 font-medium">Speler</th><th className="py-1 font-medium">Type</th><th className="py-1 text-right font-medium">Aantal</th><th className="py-1 text-right font-medium">Prijs per stuk</th><th className="py-1 text-right font-medium">Commissie</th><th className="py-1 text-right font-medium">Totaal</th></tr></thead>
            <tbody className="divide-y divide-line">
              {tx.map((t) => (
                <tr key={t.id}>
                  <td className="py-2">{dateTime(t.at)}</td>
                  <td className="py-2">{t.player.displayName}</td>
                  <td className="py-2">{KIND[t.kind]}</td>
                  <td className="num py-2 text-right">{t.quantity}</td>
                  <td className="num py-2 text-right">{euro(t.priceCents)}</td>
                  <td className="num py-2 text-right">{euro(t.feeCents)}</td>
                  <td className="num py-2 text-right">{euro(t.priceCents * t.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
