import Link from "next/link";
import { listDrops, type DropTab } from "@px/demo";
import { Avatar, EmptyState, InfoNote, Money, PageTitle, Pill } from "@/components/ui";
import { SubscribeFlow } from "@/components/subscribe-flow";
import { Flash } from "@/components/flash";
import { AutoRefresh } from "@/components/auto-refresh";
import { cancelSubscriptionAction } from "./actions";
import { currentUser } from "@/server/session";
import { euro, timeOnly, weekdayTime } from "@/lib/format";
import { loadWorld } from "@/server/world";

export const metadata = { title: "Uitgiftes" };

const TABS: [DropTab, string][] = [["binnenkort", "Binnenkort"], ["open", "Open"], ["mijn", "Mijn inschrijvingen"], ["afgerond", "Afgerond"]];
const SUB_LABELS = {
  PENDING: "Reservering wordt bevestigd", CONFIRMED: "Ingeschreven, wacht op toewijzing", ALLOCATED: "Kaart toegewezen, betaling in afwikkeling",
  DELIVERED: "Kaart geleverd", NOT_ALLOCATED: "Niet toegewezen, reservering vrijgegeven", WAITLISTED: "Op wachtlijst", CANCELLED: "Afgemeld, reservering vrijgegeven",
} as const;

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | undefined>>;

export default async function DropsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "binnenkort") as DropTab;
  const w = await loadWorld((await currentUser())?.id ?? null);
  const user = await currentUser();
  const comp = w.competitions.find((c) => c.id === sp.competitie);
  const rows = listDrops(w, tab, user?.id, comp?.id);
  const selected = rows.find((r) => r.drop.id === sp.uitgifte) ?? rows[0];
  const next = listDrops(w, "binnenkort")[0]?.drop;
  const href = (patch: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ tab, competitie: comp?.id, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/uitgiftes?${s.toString()}`;
  };

  return (
    <div>
      <PageTitle title="Uitgiftes" subtitle="Spelers, prijzen en aantallen vooraf bekend." />
      <Flash melding={sp.melding} fout={sp.fout} />
      {rows.some((r) => r.drop.status === "CLOSED" || r.subscription?.status === "ALLOCATED") && <AutoRefresh />}

      {next && (
        <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-line bg-primary-soft px-5 py-4">
          <span className="text-xl font-bold capitalize">{weekdayTime(next.opensAt).split(" ")[0]} · {timeOnly(next.opensAt)}–{timeOnly(next.closesAt)}</span>
          <span className="text-muted">Inschrijving opent binnenkort</span>
        </div>
      )}

      <nav aria-label="Uitgiftes" className="mb-3 flex flex-wrap gap-2">
        {TABS.map(([k, label]) => (
          <Link key={k} href={href({ tab: k, uitgifte: undefined })} aria-current={tab === k ? "page" : undefined} className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-primary text-white" : "border border-line bg-white"}`}>{label}</Link>
        ))}
      </nav>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href={href({ competitie: undefined, uitgifte: undefined })} className={`rounded-full px-3 py-1 ${!comp ? "bg-navy text-white" : "border border-line bg-white"}`}>Alle</Link>
        {w.competitions.map((c) => (
          <Link key={c.id} href={href({ competitie: c.id, uitgifte: undefined })} className={`rounded-full px-3 py-1 ${comp?.id === c.id ? "bg-navy text-white" : "border border-line bg-white"}`}>{c.country}</Link>
        ))}
      </div>

      {tab === "mijn" && !user ? (
        <EmptyState title="Log in om je inschrijvingen te zien" />
      ) : rows.length === 0 ? (
        <EmptyState title="Geen uitgiftes in deze weergave" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Speler</th>
                  <th className="px-4 py-2 text-right font-medium">Prijs per kaart</th>
                  <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">Aantal</th>
                  <th className="hidden px-4 py-2 text-right font-medium md:table-cell">Max. per persoon</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.drop.id} className={selected?.drop.id === r.drop.id ? "bg-primary-soft/60" : ""}>
                    <td className="px-4 py-3">
                      <Link href={href({ uitgifte: r.drop.id })} className="flex items-center gap-3" scroll={false}>
                        <Avatar initials={r.player.initials} />
                        <span><span className="block font-semibold">{r.player.displayName}</span><span className="block text-xs text-muted">{r.row.role} · {r.row.competition}</span></span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right"><Money cents={r.drop.priceCents} /></td>
                    <td className="num hidden px-4 py-3 text-right sm:table-cell">{r.drop.quantity}</td>
                    <td className="num hidden px-4 py-3 text-right md:table-cell">{r.drop.maxPerUser}</td>
                    <td className="px-4 py-3">
                      {r.subscription ? <Pill tone={r.subscription.status === "DELIVERED" ? "green" : "blue"}>{SUB_LABELS[r.subscription.status]}</Pill> : <Pill tone={r.drop.status === "OPEN" ? "green" : "grey"}>{r.drop.status === "PUBLISHED" ? "Binnenkort" : r.drop.status === "OPEN" ? "Open" : r.drop.status === "CLOSED" ? "Toewijzing loopt" : "Afgerond"}</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <aside className="space-y-4 rounded-xl border border-line bg-white p-4">
              <div className="flex items-center gap-3">
                <Avatar initials={selected.player.initials} />
                <div><p className="font-semibold">{selected.player.displayName}</p><p className="text-xs text-muted">{selected.row.role} · {selected.row.team}</p></div>
              </div>
              <div className="rounded-lg bg-primary-soft p-3">
                <p className="text-sm">Referentiewaarde</p>
                <p className="text-2xl font-bold"><Money cents={selected.player.reference?.amount} /></p>
                <p className="text-xs text-muted">Prijs per kaart in deze uitgifte: {euro(selected.drop.priceCents)}</p>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-line p-2"><dt className="text-muted">Kaarten</dt><dd className="font-semibold">{selected.drop.quantity}</dd></div>
                <div className="rounded-lg border border-line p-2"><dt className="text-muted">Maximum eerste ronde</dt><dd className="font-semibold">{selected.drop.maxPerUser} per persoon</dd></div>
                <div className="col-span-2 rounded-lg border border-line p-2"><dt className="text-muted">Inschrijven</dt><dd className="font-semibold capitalize">{weekdayTime(selected.drop.opensAt)} – {timeOnly(selected.drop.closesAt)}</dd></div>
                <div className="col-span-2 rounded-lg border border-line p-2"><dt className="text-muted">Te reserveren bij inschrijving</dt><dd className="num font-semibold">{euro(selected.drop.priceCents * selected.drop.maxPerUser)}</dd></div>
              </dl>
              <InfoNote>Het bedrag wordt gereserveerd bij inschrijving; je betaalt alleen bij toewijzing. Bij meer inschrijvingen dan kaarten volgt een willekeurige, controleerbare toewijzing.</InfoNote>
              {selected.subscription && (
                <div className="rounded-lg border border-line p-3 text-sm" data-testid="my-subscription">
                  <p className="font-semibold">Jouw inschrijving</p>
                  <p>{SUB_LABELS[selected.subscription.status]}</p>
                  {selected.subscription.status === "CONFIRMED" && selected.drop.status === "OPEN" && (
                    <form action={cancelSubscriptionAction} className="mt-2">
                      <input type="hidden" name="subscriptionId" value={selected.subscription.id} />
                      <input type="hidden" name="terug" value={href({ uitgifte: selected.drop.id })} />
                      <button className="w-full rounded-lg border border-slate-300 py-2 hover:border-down hover:text-down">Afmelden</button>
                    </form>
                  )}
                </div>
              )}
              {selected.drop.status === "COMPLETED" || selected.drop.status === "CLOSED" || selected.drop.status === "CANCELLED" ? (
                <p className="text-sm text-muted">{selected.drop.status === "CLOSED" ? "De inschrijving is gesloten; de toewijzing en afwikkeling lopen." : selected.drop.status === "CANCELLED" ? "Deze uitgifte is geannuleerd." : "Deze uitgifte is afgerond."}</p>
              ) : selected.subscription && selected.subscription.status !== "CANCELLED" ? null : (
                <SubscribeFlow
                  dropId={selected.drop.id}
                  playerName={selected.player.displayName}
                  priceLabel={euro(selected.drop.priceCents)}
                  quantity={selected.drop.quantity}
                  maxPerUser={selected.drop.maxPerUser}
                  windowLabel={`${weekdayTime(selected.drop.opensAt)}`}
                  isOpen={selected.drop.status === "OPEN"}
                  canSubscribe={!!user?.canSubscribe && selected.subscription?.status !== "CANCELLED"}
                  blockReason={!user ? "Log in om in te schrijven." : selected.subscription?.status === "CANCELLED" ? "Je hebt je voor deze uitgifte afgemeld." : user.subscribeBlockReason}
                />
              )}
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Controleerbare trekking</summary>
                <dl className="mt-2 space-y-1 break-all">
                  <div><dt className="font-medium text-ink">Vastgelegde commitment (SHA-256)</dt><dd className="font-mono">{selected.drop.seedCommitment || "Wordt vóór opening vastgelegd"}</dd></div>
                  {selected.drop.verification?.seedRevealed && (
                    <>
                      <div><dt className="font-medium text-ink">Seed (na de trekking vrijgegeven)</dt><dd className="font-mono">{selected.drop.verification.seedRevealed}</dd></div>
                      <div><dt className="font-medium text-ink">Deelnemers</dt><dd>{selected.drop.verification.participants} · digest <span className="font-mono">{selected.drop.verification.participantsDigest}</span></dd></div>
                      <div><dt className="font-medium text-ink">Resultaat-digest</dt><dd className="font-mono">{selected.drop.verification.resultDigest}</dd></div>
                    </>
                  )}
                </dl>
                <p className="mt-2">Algoritme alloc-v1: rangorde op HMAC-SHA256(seed, versie|uitgifte|deelnemersdigest|inschrijving). Er worden geen persoonsgegevens getoond.</p>
              </details>
            </aside>
          )}
        </div>
      )}

      {selected && (
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-white px-5 py-3 text-sm">
          <span className="flex items-center gap-2 font-semibold"><Avatar initials={selected.player.initials} size="sm" />{selected.player.displayName}</span>
          <span>In omloop <strong className="num">{selected.player.supply.inCirculation}</strong></span>
          <span>Verkocht dit seizoen <strong className="num">{selected.player.supply.soldThisSeason}</strong></span>
          <span>Gepland dit seizoen <strong className="num">{selected.player.supply.plannedThisSeason}</strong></span>
          <span>Maximum <strong className="num">{selected.player.supply.seasonMaximum}</strong></span>
        </div>
      )}
    </div>
  );
}
