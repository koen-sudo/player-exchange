import Link from "next/link";
import { notFound } from "next/navigation";
import { playerDetail } from "@px/demo";
import { Avatar, Card, Change, DataQualityBadge, Money, Pill, InfoNote } from "@/components/ui";
import { OrderTicket } from "@/components/order-ticket";
import { currentUser } from "@/server/session";
import { dateTime, weekdayTime, euro } from "@/lib/format";
import { loadWorld } from "@/server/world";

type Props = { params: Promise<{ playerId: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: Props) {
  const { playerId } = await params;
  const d = playerDetail(await loadWorld(null), playerId);
  return { title: d ? d.name : "Speler niet gevonden" };
}

const TABS = [
  ["overzicht", "Overzicht"],
  ["statistieken", "Statistieken"],
  ["handel", "Handel"],
  ["uitgifte", "Uitgifte"],
] as const;

export default async function PlayerPage({ params, searchParams }: Props) {
  const { playerId } = await params;
  const { tab = "overzicht" } = await searchParams;
  const w = await loadWorld((await currentUser())?.id ?? null);
  const d = playerDetail(w, playerId);
  if (!d) notFound();
  const user = await currentUser();
  const freeCards = (user ? w.holdings[user.id] ?? [] : []).filter((c) => c.playerId === d.playerId && !c.reservedForSale).length;
  const ref = d.reference;
  const next = d.drops.find((x) => x.status === "PUBLISHED" || x.status === "OPEN");

  return (
    <div>
      <nav aria-label="Kruimelpad" className="mb-3 text-sm text-muted">
        <Link href="/markt" className="hover:underline">Markt</Link> / <span>{d.competition}</span> / <span className="text-ink">{d.name}</span>
      </nav>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-xl border border-line bg-white p-5">
            <div className="flex items-center gap-4">
              <Avatar initials={d.initials} size="lg" />
              <div>
                <h1 className="text-2xl font-bold md:text-3xl">{d.name}</h1>
                <p className="text-muted">
                  {d.age} jaar · {d.role} · {d.team} · {d.competition} · Fictief profiel
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Pill tone={d.status === "OPEN" ? "green" : "grey"}>{d.statusLabel}</Pill>
                  <DataQualityBadge quality={d.dataQuality} />
                  {d.previousTeam && <Pill tone="blue">Getransfereerd van {d.previousTeam}</Pill>}
                </div>
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4">
              <div className="col-span-3 rounded-lg bg-primary-soft p-3 sm:col-span-1">
                <dt className="text-sm font-medium">Referentiewaarde</dt>
                <dd className="text-2xl font-bold"><Money cents={ref?.amount} /></dd>
                <dd className="text-xs text-muted">
                  {ref
                    ? ref.isHistorical
                      ? `Historisch, laatst actief ${dateTime(ref.publishedAt)}`
                      : `Gepubliceerd ${dateTime(ref.publishedAt)} · ${ref.modelVersion}${ref.isDemoModel ? " (demomodel)" : ""}`
                    : "Geen gepubliceerde referentie"}
                </dd>
                {ref && <dd className="mt-1 text-xs">Wijziging: <Change cents={ref.previous === null ? null : ref.amount - ref.previous} /></dd>}
              </div>
              <div className="p-3">
                <dt className="text-sm text-muted">Laatste verkoop</dt>
                <dd className="text-xl font-semibold">{d.lastTrade ? <Money cents={d.lastTrade.price} /> : <span className="text-base text-muted">Niet beschikbaar</span>}</dd>
                {d.lastTrade && <dd className="text-xs text-muted">{dateTime(d.lastTrade.at)}</dd>}
              </div>
              <div className="p-3">
                <dt className="text-sm text-muted">Hoogste bod</dt>
                <dd className="text-xl font-semibold">{d.bestBid === null ? <span className="text-base text-muted">Geen actueel bod</span> : <Money cents={d.bestBid} />}</dd>
              </div>
              <div className="p-3">
                <dt className="text-sm text-muted">Laagste vraag</dt>
                <dd className="text-xl font-semibold">{d.bestAsk === null ? <span className="text-base text-muted">Geen actuele vraag</span> : <Money cents={d.bestAsk} />}</dd>
              </div>
            </dl>
            {d.canTrade && (
              <div className="mt-4 grid grid-cols-2 gap-3 xl:hidden">
                <a href="#handelen" className="rounded-lg bg-primary py-2.5 text-center font-semibold text-white">Kopen</a>
                <a href="#handelen" className="rounded-lg border border-slate-300 py-2.5 text-center font-medium">Verkopen</a>
              </div>
            )}
          </section>

          <nav aria-label="Spelersonderdelen" className="grid grid-cols-4 overflow-hidden rounded-lg border border-line bg-white text-center text-sm">
            {TABS.map(([key, label]) => (
              <Link key={key} href={`/spelers/${d.playerId}?tab=${key}`} aria-current={tab === key ? "page" : undefined} className={`py-2.5 ${tab === key ? "bg-primary font-semibold text-white" : "hover:bg-slate-50"}`}>
                {label}
              </Link>
            ))}
          </nav>

          {tab === "overzicht" && (
            <>
              <Card title="Waarom gewijzigd?">
                {ref && ref.reasons.length ? (
                  <ul className="divide-y divide-line">
                    {ref.reasons.map((r) => (
                      <li key={r.title} className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr]">
                        <span className="font-semibold">{r.title}</span>
                        <span className="text-sm text-muted">{r.detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Er is geen modelverklaring beschikbaar.</p>
                )}
                <div className="mt-3"><InfoNote>De referentiewaarde is een modelwaardering, geen bod en geen uitvoerbare prijs. Open orders behouden hun eigen limiet.</InfoNote></div>
              </Card>
              <MatchesCard d={d} />
            </>
          )}
          {tab === "statistieken" && <MatchesCard d={d} />}
          {(tab === "overzicht" || tab === "handel") && <BookCard d={d} />}
          {tab === "uitgifte" && (
            <Card title="Uitgifteplanning">
              {d.drops.length === 0 ? (
                <p className="text-sm text-muted">Geen uitgiftes aangekondigd.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {d.drops.map((x) => (
                    <li key={x.id} className="flex flex-wrap justify-between gap-2 py-2">
                      <span>{weekdayTime(x.opensAt)} – {weekdayTime(x.closesAt).split(" ").pop()} · {x.quantity} kaarten · max {x.maxPerUser} per persoon</span>
                      <span className="num font-medium">{euro(x.priceCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {d.primaryBlockedReason && <p className="mt-3 text-sm text-muted">{d.primaryBlockedReason}</p>}
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <section id="handelen" className="scroll-mt-24 rounded-xl border border-line bg-white">
            <div className="rounded-t-xl bg-navy px-4 py-3 font-semibold text-white">Handelen in {d.name}</div>
            <div className="p-4">
              {d.canTrade ? (
                <OrderTicket
                  playerId={d.playerId}
                  playerName={d.name}
                  bestBidMinor={d.bestBid === null ? null : String(d.bestBid)}
                  bestAskMinor={d.bestAsk === null ? null : String(d.bestAsk)}
                  freeCards={freeCards}
                  canTrade={!!user?.canTrade}
                  blockReason={!user ? "Log in om te handelen." : user.tradeBlockReason}
                />
              ) : (
                <p className="text-sm text-muted">Voor deze speler zijn nog geen kaarten uitgegeven. Er is geen handel en er worden geen prijzen getoond.</p>
              )}
            </div>
          </section>

          {/* Supply belongs to this player (UX-02, eerdere voorraadfout). */}
          <section className="rounded-xl border border-line bg-white">
            <div className="rounded-t-xl bg-navy px-4 py-3 font-semibold text-white">Voorraad {d.name}</div>
            <dl className="divide-y divide-line text-sm">
              <SupplyRow k="In omloop" v={d.supply.inCirculation} />
              <SupplyRow k="Verkocht dit seizoen" v={d.supply.soldThisSeason} />
              <SupplyRow k="Gepland dit seizoen" v={d.supply.plannedThisSeason} />
              <SupplyRow k="Maximum per seizoen" v={d.supply.seasonMaximum} />
              <div className="flex justify-between px-4 py-3">
                <dt>Volgende uitgifte</dt>
                <dd className="font-semibold">{next ? weekdayTime(next.opensAt) : "Niet gepland"}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

function SupplyRow({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex justify-between px-4 py-3">
      <dt>{k}</dt>
      <dd className="num font-semibold">{v}</dd>
    </div>
  );
}

function MatchesCard({ d }: { d: NonNullable<ReturnType<typeof playerDetail>> }) {
  const unknown = (v: number | null) => (v === null ? <span className="text-muted">n.b.</span> : v);
  return (
    <Card title="Recente wedstrijden">
      {d.player.recentMatches.length === 0 ? (
        <p className="text-sm text-muted">Voor deze speler zijn onvoldoende wedstrijdgegevens beschikbaar.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr><th className="py-1 font-medium">Wedstrijd</th><th className="py-1 text-right font-medium">Minuten</th><th className="py-1 text-right font-medium">Goals</th><th className="py-1 text-right font-medium">Assists</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.player.recentMatches.map((m) => (
              <tr key={m.fixture + m.playedAt.toISOString()}>
                <td className="py-2">{m.fixture}</td>
                <td className="num py-2 text-right">{unknown(m.minutes)}</td>
                <td className="num py-2 text-right">{unknown(m.goals)}</td>
                <td className="num py-2 text-right">{unknown(m.assists)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.dataQuality === "PARTIAL" && <p className="mt-2 text-xs text-muted">n.b. = niet beschikbaar bij de databron; dit telt niet als nul.</p>}
    </Card>
  );
}

function BookCard({ d }: { d: NonNullable<ReturnType<typeof playerDetail>> }) {
  if (!d.canTrade) return null;
  const side = (title: string, rows: { price: number; quantity: number }[], empty: string) => (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="bg-navy px-4 py-2 font-semibold text-white">{title}</div>
      <table className="w-full text-sm">
        <thead className="text-left text-muted"><tr><th className="px-4 py-1 font-medium">Prijs</th><th className="px-4 py-1 text-right font-medium">Aantal</th></tr></thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 ? (
            <tr><td colSpan={2} className="px-4 py-3 text-muted">{empty}</td></tr>
          ) : (
            rows.map((r) => (
              <tr key={r.price}><td className="num px-4 py-2">{euro(r.price)}</td><td className="num px-4 py-2 text-right">{r.quantity}</td></tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {side("Koopbiedingen", d.book.bids, "Geen actueel bod")}
      {side("Verkooporders", d.book.asks, "Geen actuele vraag")}
    </div>
  );
}
