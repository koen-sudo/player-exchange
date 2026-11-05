import Link from "next/link";
import { listMarket, playerDetail, ROLE_LABELS_NL, type Role } from "@px/demo";
import { marketHref, parseMarketParams } from "@/lib/market-params";
import { Avatar, Card, Change, DataQualityBadge, EmptyState, Money, PageTitle, Pill } from "@/components/ui";
import { OrderTicket } from "@/components/order-ticket";
import { currentUser } from "@/server/session";
import { loadWorld } from "@/server/world";

export const metadata = { title: "Markt" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const withPlayer = (href: string, playerId: string) => `${href}${href.includes("?") ? "&" : "?"}speler=${encodeURIComponent(playerId)}`;

export default async function MarketPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const w = await loadWorld((await currentUser())?.id ?? null);
  const filter = parseMarketParams(sp);
  const user = await currentUser();
  const result = listMarket(w, { ...filter, watchlist: new Set<string>() });
  const selectedId = typeof sp.speler === "string" ? sp.speler : undefined;
  const selected = selectedId ? playerDetail(w, selectedId) : null;
  const teams = w.teams.filter((t) => !filter.competitionId || t.competitionId === filter.competitionId);

  const sortLink = (key: NonNullable<typeof filter.sort>, label: string) => {
    const active = (filter.sort ?? "name") === key;
    const nextDir = active && filter.dir !== "desc" ? "desc" : "asc";
    return (
      <Link href={marketHref(filter, { sort: key, dir: nextDir, page: 1 })} className="inline-flex items-center gap-1 hover:underline" aria-sort={active ? (filter.dir === "desc" ? "descending" : "ascending") : undefined}>
        {label}
        {active && <span aria-hidden>{filter.dir === "desc" ? "↓" : "↑"}</span>}
      </Link>
    );
  };

  return (
    <div>
      <PageTitle title="Markt" subtitle="Alle spelersprofielen uit zes competities. Fictieve spelers en bedragen." />

      {/* Filters are a GET form, so they live in the URL and survive back-navigation. */}
      <form action="/markt" className="mb-4 grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
        <label className="lg:col-span-2">
          <span className="text-xs text-muted">Zoeken</span>
          <input name="q" defaultValue={filter.q} placeholder="Naam, team of competitie" className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
        </label>
        <label>
          <span className="text-xs text-muted">Competitie</span>
          <select name="competitie" defaultValue={filter.competitionId ?? ""} className="mt-1 w-full rounded-lg border border-line px-3 py-2">
            <option value="">Alle competities</option>
            {w.competitions.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.country})</option>)}
          </select>
        </label>
        <label>
          <span className="text-xs text-muted">Team</span>
          <select name="team" defaultValue={filter.teamId ?? ""} className="mt-1 w-full rounded-lg border border-line px-3 py-2">
            <option value="">Alle teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>
          <span className="text-xs text-muted">Positie</span>
          <select name="rol" defaultValue={filter.role ?? ""} className="mt-1 w-full rounded-lg border border-line px-3 py-2">
            <option value="">Alle posities</option>
            {(Object.keys(ROLE_LABELS_NL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS_NL[r]}</option>)}
          </select>
        </label>
        <label>
          <span className="text-xs text-muted">Marktstatus</span>
          <select name="status" defaultValue={filter.status ?? ""} className="mt-1 w-full rounded-lg border border-line px-3 py-2">
            <option value="">Alle profielen</option>
            <option value="TRADABLE">Verhandelbaar</option>
            <option value="PROFILE_ONLY">Alleen profiel</option>
          </select>
        </label>
        <fieldset className="flex items-end gap-2 lg:col-span-2">
          <label className="flex-1">
            <span className="text-xs text-muted">Leeftijd van</span>
            <input name="minLeeftijd" inputMode="numeric" defaultValue={filter.minAge} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
          </label>
          <label className="flex-1">
            <span className="text-xs text-muted">tot en met</span>
            <input name="maxLeeftijd" inputMode="numeric" defaultValue={filter.maxAge} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
          </label>
        </fieldset>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="gevolgd" value="1" defaultChecked={filter.watchlistOnly} />
          Alleen gevolgde spelers
        </label>
        <div className="flex items-end gap-2 lg:col-span-3 lg:justify-end">
          <Link href={marketHref({}, {})} className="rounded-lg border border-slate-300 px-4 py-2">Wissen</Link>
          <button className="rounded-lg bg-primary px-4 py-2 font-semibold text-white">Toepassen</button>
        </div>
      </form>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Link href={marketHref(filter, { status: filter.status === "TRADABLE" ? undefined : "TRADABLE", page: 1 })} className={`rounded-full border px-3 py-1 ${filter.status === "TRADABLE" ? "border-primary bg-primary text-white" : "border-line bg-white"}`}>
          Verhandelbaar
        </Link>
        <span className="text-muted">{result.total} {result.total === 1 ? "speler" : "spelers"}</span>
      </div>

      <div className="flex gap-6">
        <div className="min-w-0 flex-1">
          {result.total === 0 ? (
            <EmptyState title="Geen resultaten">Pas je filters aan of wis ze om alle spelers te zien.</EmptyState>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto rounded-xl border border-line bg-white md:block">
                <table className="w-full text-sm">
                  <thead className="border-b border-line bg-slate-50 text-left text-muted">
                    <tr>
                      <th className="px-3 py-3 font-medium">{sortLink("name", "Speler")}</th>
                      <th className="px-3 py-3 text-right font-medium">{sortLink("reference", "Referentiewaarde")}</th>
                      <th className="px-3 py-3 text-right font-medium">{sortLink("change", "Wijziging")}</th>
                      <th className="px-3 py-3 text-right font-medium">{sortLink("bid", "Hoogste bod")}</th>
                      <th className="px-3 py-3 text-right font-medium">{sortLink("ask", "Laagste vraag")}</th>
                      <th className="px-3 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {result.rows.map((r) => (
                      <tr key={r.playerId} className={selectedId === r.playerId ? "bg-primary-soft/60" : "hover:bg-slate-50"}>
                        <td className="px-3 py-3">
                          <Link href={withPlayer(marketHref(filter, {}), r.playerId)} className="flex items-center gap-3" scroll={false}>
                            <Avatar initials={r.initials} />
                            <span>
                              <span className="block whitespace-nowrap font-semibold">{r.name}</span>
                              <span className="block whitespace-nowrap text-xs text-muted">{r.team} · {r.competition}</span>
                              <span className="block whitespace-nowrap text-xs text-muted">{r.role}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right"><Money cents={r.reference} /></td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">{r.change === null ? <span className="text-muted" title="Niet beschikbaar">—<span className="sr-only">Niet beschikbaar</span></span> : <Change cents={r.change} />}</td>
                        <td className="px-3 py-3 text-right">{r.status === "OPEN" ? (r.bestBid === null ? <span className="text-muted">Geen actueel bod</span> : <Money cents={r.bestBid} />) : <span className="text-muted">—</span>}</td>
                        <td className="px-3 py-3 text-right">{r.status === "OPEN" ? (r.bestAsk === null ? <span className="text-muted">Geen actuele vraag</span> : <Money cents={r.bestAsk} />) : <span className="text-muted">—</span>}</td>
                        <td className="px-3 py-3">
                          <span className="flex flex-wrap gap-1">
                            <Pill tone={r.status === "OPEN" ? "green" : "grey"}>{r.statusLabel}</Pill>
                            <DataQualityBadge quality={r.dataQuality} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile: labelled cards, prices stay separately recognisable */}
              <ul className="space-y-3 md:hidden">
                {result.rows.map((r) => (
                  <li key={r.playerId}>
                    <Link href={`/spelers/${r.playerId}`} className="block rounded-xl border border-line bg-white p-4">
                      <div className="flex items-center gap-3">
                        <Avatar initials={r.initials} />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{r.name}</p>
                          <p className="truncate text-xs text-muted">{r.team} · {r.role}</p>
                        </div>
                        <Pill tone={r.status === "OPEN" ? "green" : "grey"}>{r.statusLabel}</Pill>
                      </div>
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                        <div><dt className="text-muted">Referentie</dt><dd className="text-sm font-semibold"><Money cents={r.reference} /></dd></div>
                        <div><dt className="text-muted">Hoogste bod</dt><dd className="text-sm">{r.status === "OPEN" ? (r.bestBid === null ? "Geen bod" : <Money cents={r.bestBid} />) : "—"}</dd></div>
                        <div><dt className="text-muted">Laagste vraag</dt><dd className="text-sm">{r.status === "OPEN" ? (r.bestAsk === null ? "Geen vraag" : <Money cents={r.bestAsk} />) : "—"}</dd></div>
                      </dl>
                    </Link>
                  </li>
                ))}
              </ul>

              <nav aria-label="Paginering" className="mt-4 flex items-center justify-between text-sm">
                {result.page > 1 ? <Link href={marketHref(filter, { page: result.page - 1 })} className="rounded-lg border border-line bg-white px-3 py-1.5">Vorige</Link> : <span />}
                <span className="text-muted">Pagina {result.page} van {result.pages}</span>
                {result.page < result.pages ? <Link href={marketHref(filter, { page: result.page + 1 })} className="rounded-lg border border-line bg-white px-3 py-1.5">Volgende</Link> : <span />}
              </nav>
            </>
          )}
        </div>

        {/* Desktop compact trade panel (UX-01) */}
        {selected && (
          <aside className="sticky top-20 hidden h-fit w-[22rem] shrink-0 lg:block" aria-label={`Handelen in ${selected.name}`}>
            <div className="rounded-xl border border-line bg-white">
              <div className="flex items-center justify-between rounded-t-xl bg-navy px-4 py-3 text-white">
                <span className="font-semibold">{selected.name}</span>
                <Link href={marketHref(filter, {})} aria-label="Paneel sluiten" scroll={false} className="text-xl">×</Link>
              </div>
              <div className="space-y-3 p-4">
                <div className="flex justify-between text-sm"><span className="text-muted">Referentiewaarde</span><Money cents={selected.reference?.amount} className="font-semibold" /></div>
                {selected.canTrade ? (
                  <OrderTicket
                    playerId={selected.playerId}
                    playerName={selected.name}
                    bestBidMinor={selected.bestBid === null ? null : String(selected.bestBid)}
                    bestAskMinor={selected.bestAsk === null ? null : String(selected.bestAsk)}
                    freeCards={(user ? w.holdings[user.id] ?? [] : []).filter((c) => c.playerId === selected.playerId && !c.reservedForSale).length}
                    canTrade={!!user?.canTrade}
                    blockReason={!user ? "Log in om te handelen." : user.tradeBlockReason}
                  />
                ) : (
                  <Card><p className="text-sm text-muted">Voor deze speler zijn nog geen kaarten uitgegeven. Er is geen handel en er worden geen prijzen getoond.</p></Card>
                )}
                <Link href={`/spelers/${selected.playerId}`} className="block text-center text-sm font-medium text-primary hover:underline">Volledig profiel bekijken</Link>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
