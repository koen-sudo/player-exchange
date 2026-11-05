import { ordersFor, type OrderView } from "@px/demo";
import { getDb, tradesForUser } from "@px/db";
import { Flash } from "@/components/flash";
import { cancelOrderAction } from "./actions";
import { Avatar, Card, PageTitle, Pill } from "@/components/ui";
import { currentUser } from "@/server/session";
import { LoginRequired } from "@/components/login-required";
import { dateTime, euro } from "@/lib/format";
import { loadWorld } from "@/server/world";

export const metadata = { title: "Transacties" };

export const dynamic = "force-dynamic";

const KIND = { PRIMARY: "Uitgifte", BUY: "Aankoop", SELL: "Verkoop", OPENING: "Beginbezit (demo)" } as const;
const TRADE_STATUS: Record<string, [string, "green" | "amber" | "red" | "grey"]> = {
  SETTLED: ["Afgewikkeld", "green"], MATCHED: ["In afwikkeling", "amber"], SUBMISSION_PENDING: ["In afwikkeling", "amber"],
  PROVIDER_PENDING: ["In afwikkeling", "amber"], MANUAL_REVIEW: ["Handmatige controle", "amber"], FAILED: ["Mislukt, teruggedraaid", "red"],
};

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ melding?: string; fout?: string }> }) {
  const sp = await searchParams;
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
  const names = new Map(w.players.map((p) => [p.id, p.displayName]));
  const tx = await tradesForUser(getDb().db, user.id);

  return (
    <div className="space-y-5">
      <PageTitle title="Orders en transacties" subtitle="Alleen het nog niet gematchte deel van een order kan worden geannuleerd." />
      <Flash melding={sp.melding} fout={sp.fout} />
      {groups.map(([title, list]) => (
        <Card key={title} title={`${title} (${list.length})`}>
          {list.length === 0 ? <p className="text-sm text-muted">Niets in deze categorie.</p> : (
            <>
              {/* Phones: one card per order. */}
              <ul className="divide-y divide-line lg:hidden">
                {list.map((o) => (
                  <li key={o.id} className="space-y-2 py-3 first:pt-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-medium"><Avatar initials={o.initials} size="sm" />{o.playerName}</span>
                      <Pill tone={o.status === "OPEN" ? "green" : o.status === "IN_SETTLEMENT" ? "amber" : "grey"}>{o.statusLabel}</Pill>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                      <dt className="text-muted">Type</dt><dd>{o.side === "BUY" ? "Kopen" : "Verkopen"}</dd>
                      <dt className="text-muted">Aantal</dt><dd className="num">{o.qty.open > 0 ? `${o.qty.open} open van ${o.qty.original}` : o.qty.original}</dd>
                      <dt className="text-muted">Limiet</dt><dd className="num">{euro(o.limitPriceCents)}</dd>
                      <dt className="text-muted">Loopt tot</dt><dd>{dateTime(o.expiresAt)}</dd>
                    </dl>
                    {o.qty.open > 0 && <CancelButton o={o} full />}
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted">
                    <tr><th className="py-1 pr-4 font-medium">Speler</th><th className="py-1 pr-4 font-medium">Type</th><th className="py-1 pr-4 text-right font-medium">Aantal</th><th className="py-1 pr-4 text-right font-medium">Limiet</th><th className="py-1 pr-4 font-medium">Loopt tot</th><th className="py-1 pr-4 font-medium">Status</th><th className="py-1"><span className="sr-only">Acties</span></th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {list.map((o) => (
                      <tr key={o.id}>
                        <td className="py-2 pr-4"><span className="flex items-center gap-2"><Avatar initials={o.initials} size="sm" />{o.playerName}</span></td>
                        <td className="py-2 pr-4"><Pill tone={o.side === "BUY" ? "green" : "blue"}>{o.side === "BUY" ? "Kopen" : "Verkopen"}</Pill></td>
                        <td className="num whitespace-nowrap py-2 pr-4 text-right">{o.qty.open > 0 ? `${o.qty.open} open van ${o.qty.original}` : o.qty.original}</td>
                        <td className="num whitespace-nowrap py-2 pr-4 text-right">{euro(o.limitPriceCents)}</td>
                        <td className="whitespace-nowrap py-2 pr-4">{dateTime(o.expiresAt)}</td>
                        <td className="py-2 pr-4"><Pill tone={o.status === "OPEN" ? "green" : o.status === "IN_SETTLEMENT" ? "amber" : "grey"}>{o.statusLabel}</Pill></td>
                        <td className="py-2 text-right">{o.qty.open > 0 && <CancelButton o={o} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {list.some((o) => o.qty.pending > 0) && <p className="mt-2 text-xs text-muted">Een kaart in afwikkeling kan niet meer worden geannuleerd; annuleren geldt alleen voor het vrije restant.</p>}
            </>
          )}
        </Card>
      ))}
      <Card title={`Kaartbewegingen (${tx.length})`}>
        {tx.length === 0 ? <p className="text-sm text-muted">Nog geen transacties.</p> : (
          <>
            <ul className="divide-y divide-line text-sm lg:hidden">
              {tx.map((t) => {
                const [label, tone] = TRADE_STATUS[t.status] ?? [t.status, "grey" as const];
                return (
                  <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div>
                      <p className="font-medium">{names.get(t.player_id) ?? "Onbekende speler"} <span className="text-muted">#{t.serial}</span></p>
                      <p className="text-xs text-muted">{KIND[t.kind]} · {dateTime(t.at)}{t.fee_cents !== null ? ` · commissie ${euro(Number(t.fee_cents))}` : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="num font-semibold">{euro(t.price_cents === null ? null : Number(t.price_cents))}</p>
                      <Pill tone={tone}>{label}</Pill>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead className="text-left text-muted"><tr><th className="py-1 pr-4 font-medium">Datum</th><th className="py-1 pr-4 font-medium">Speler</th><th className="py-1 pr-4 font-medium">Type</th><th className="py-1 pr-4 text-right font-medium">Kaart</th><th className="py-1 pr-4 text-right font-medium">Prijs</th><th className="py-1 pr-4 text-right font-medium">Commissie</th><th className="py-1 font-medium">Status</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {tx.map((t) => {
                    const [label, tone] = TRADE_STATUS[t.status] ?? [t.status, "grey" as const];
                    return (
                      <tr key={t.id} data-testid="trade-row">
                        <td className="whitespace-nowrap py-2 pr-4">{dateTime(t.at)}</td>
                        <td className="py-2 pr-4">{names.get(t.player_id) ?? "Onbekende speler"}</td>
                        <td className="py-2 pr-4">{KIND[t.kind]}</td>
                        <td className="num py-2 pr-4 text-right">#{t.serial}</td>
                        <td className="num whitespace-nowrap py-2 pr-4 text-right">{euro(t.price_cents === null ? null : Number(t.price_cents))}</td>
                        <td className="num whitespace-nowrap py-2 pr-4 text-right">{t.fee_cents === null ? "—" : euro(Number(t.fee_cents))}</td>
                        <td className="py-2"><Pill tone={tone}>{label}</Pill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function CancelButton({ o, full }: { o: OrderView; full?: boolean }) {
  return (
    <form action={cancelOrderAction}>
      <input type="hidden" name="orderId" value={o.id} />
      <button className={`rounded-lg border border-slate-300 px-3 py-1 hover:border-down hover:text-down ${full ? "w-full py-2" : ""}`}
        aria-label={`${o.qty.open} open ${o.qty.open === 1 ? "kaart" : "kaarten"} van ${o.playerName} annuleren`}>Annuleren</button>
    </form>
  );
}
