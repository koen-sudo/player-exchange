/**
 * Read models for the demo interface. The web app depends on the
 * `MarketReadModel` shape, not on the demo world, so the database-backed
 * implementation (fase 2–5) can replace this without touching the screens.
 */
import { type Cents, cents, deriveStatus, summarizePortfolio, ORDER_STATUS_LABELS_NL, type OrderStatus } from "@px/domain";
import type { DemoOrder, DemoWorld, MarketStatus, Player, Role } from "./world.ts";
import { ROLE_LABELS_NL } from "./world.ts";

// ---------------------------------------------------------------------------
// Market listing (UX-01)
// ---------------------------------------------------------------------------
export type MarketFilter = {
  q?: string;
  competitionId?: string;
  teamId?: string;
  role?: Role;
  minAge?: number;
  maxAge?: number;
  status?: MarketStatus | "TRADABLE";
  watchlistOnly?: boolean;
  watchlist?: ReadonlySet<string>;
  sort?: "name" | "reference" | "change" | "bid" | "ask" | "age";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type MarketRow = {
  playerId: string;
  name: string;
  initials: string;
  team: string;
  competition: string;
  role: string;
  age: number;
  reference: Cents | null;
  change: Cents | null;
  bestBid: Cents | null;
  bestAsk: Cents | null;
  status: MarketStatus;
  statusLabel: string;
  hasUpcomingDrop: boolean;
  dataQuality: Player["dataQuality"];
  careerStatus: Player["careerStatus"];
};

export const MARKET_STATUS_LABELS_NL: Record<MarketStatus, string> = {
  PROFILE_ONLY: "Profiel",
  PRELAUNCH: "Komende uitgifte",
  OPEN: "Handel",
  PAUSED: "Gepauzeerd",
  CLOSED: "Gesloten",
};

function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function toMarketRow(w: DemoWorld, p: Player): MarketRow {
  const team = w.teams.find((t) => t.id === p.teamId)!;
  const comp = w.competitions.find((c) => c.id === p.competitionId)!;
  const ref = p.reference;
  const hasUpcomingDrop = w.drops.some((d) => d.playerId === p.id && (d.status === "PUBLISHED" || d.status === "OPEN"));
  let statusLabel = MARKET_STATUS_LABELS_NL[p.marketStatus];
  if (p.marketStatus === "OPEN" && hasUpcomingDrop) statusLabel = "Handel · uitgifte gepland";
  if (p.careerStatus === "RETIRED") statusLabel = "Gestopt · collectible";
  return {
    playerId: p.id,
    name: p.displayName,
    initials: p.initials,
    team: team.name,
    competition: comp.name,
    role: ROLE_LABELS_NL[p.role],
    age: p.age,
    reference: ref ? ref.amount : null,
    change: ref && ref.previous !== null ? cents(ref.amount - ref.previous) : null,
    // A profile without issued cards shows no invented bid/ask (AT-05).
    bestBid: p.marketStatus === "OPEN" ? p.bids[0]?.price ?? null : null,
    bestAsk: p.marketStatus === "OPEN" ? p.asks[0]?.price ?? null : null,
    status: p.marketStatus,
    statusLabel,
    hasUpcomingDrop,
    dataQuality: p.dataQuality,
    careerStatus: p.careerStatus,
  };
}

export function listMarket(w: DemoWorld, f: MarketFilter = {}) {
  const q = f.q ? normalize(f.q.trim()) : "";
  let rows = w.players
    .filter((p) => !f.competitionId || p.competitionId === f.competitionId)
    .filter((p) => !f.teamId || p.teamId === f.teamId)
    .filter((p) => !f.role || p.role === f.role)
    .filter((p) => f.minAge === undefined || p.age >= f.minAge)
    .filter((p) => f.maxAge === undefined || p.age <= f.maxAge)
    .filter((p) => !f.status || (f.status === "TRADABLE" ? p.marketStatus === "OPEN" : p.marketStatus === f.status))
    .filter((p) => !f.watchlistOnly || (f.watchlist?.has(p.id) ?? false))
    .map((p) => toMarketRow(w, p))
    .filter((r) => !q || normalize(`${r.name} ${r.team} ${r.competition}`).includes(q));

  const dir = f.dir === "desc" ? -1 : 1;
  const nullsLast = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : (a - b) * dir);
  const sort = f.sort ?? "name";
  rows = rows.sort((a, b) => {
    switch (sort) {
      case "reference": return nullsLast(a.reference, b.reference);
      case "change": return nullsLast(a.change, b.change);
      case "bid": return nullsLast(a.bestBid, b.bestBid);
      case "ask": return nullsLast(a.bestAsk, b.bestAsk);
      case "age": return (a.age - b.age) * dir;
      default: return a.name.localeCompare(b.name, "nl") * dir;
    }
  });

  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(f.page ?? 1, 1), pages);
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pages, pageSize };
}

// ---------------------------------------------------------------------------
// Player detail (UX-02)
// ---------------------------------------------------------------------------
export function playerDetail(w: DemoWorld, playerId: string) {
  const p = w.players.find((x) => x.id === playerId);
  if (!p) return null;
  const row = toMarketRow(w, p);
  const previousTeam = p.previousTeamId ? w.teams.find((t) => t.id === p.previousTeamId)?.name ?? null : null;
  const drops = w.drops.filter((d) => d.playerId === p.id).sort((a, b) => b.opensAt.getTime() - a.opensAt.getTime());
  return {
    ...row,
    player: p,
    previousTeam,
    nationality: p.nationality,
    reference: p.reference,
    lastTrade: p.lastTrade,
    book: { bids: p.marketStatus === "OPEN" ? p.bids : [], asks: p.marketStatus === "OPEN" ? p.asks : [] },
    supply: p.supply,
    drops,
    canTrade: p.marketStatus === "OPEN",
    primaryBlockedReason:
      p.careerStatus === "RETIRED" ? "Speler is gestopt: geen nieuwe primaire uitgifte." :
      p.primaryAdmission !== "APPROVED" ? "Speler is niet toegelaten tot primaire uitgifte." : null,
  };
}

// ---------------------------------------------------------------------------
// Portfolio (UX-03)
// ---------------------------------------------------------------------------
export function portfolio(w: DemoWorld, userId: string) {
  const held = w.holdings[userId] ?? [];
  const refs = new Map<string, Cents>();
  const bids = new Map<string, Cents>();
  for (const c of held) {
    const p = w.players.find((x) => x.id === c.playerId)!;
    if (p.reference && !p.reference.isHistorical) refs.set(p.id, p.reference.amount);
    const bid = p.marketStatus === "OPEN" ? p.bids[0]?.price : undefined;
    if (bid !== undefined) bids.set(p.id, bid);
  }
  const summary = summarizePortfolio(held, refs, bids);
  const balance = w.balances[userId] ?? { available: cents(0), reserved: cents(0), pendingIncoming: cents(0) };
  const positions = summary.positions.map((pos) => {
    const p = w.players.find((x) => x.id === pos.playerId)!;
    return { ...pos, row: toMarketRow(w, p), cards: held.filter((c) => c.playerId === p.id) };
  });
  return { summary, balance, positions };
}

// ---------------------------------------------------------------------------
// Orders and transactions (UX-08)
// ---------------------------------------------------------------------------
export type OrderView = DemoOrder & { status: OrderStatus; statusLabel: string; playerName: string; initials: string; reservedCents: Cents };

export function ordersFor(w: DemoWorld, userId: string): OrderView[] {
  return w.orders
    .filter((o) => o.userId === userId)
    .map((o) => {
      const p = w.players.find((x) => x.id === o.playerId)!;
      const status = deriveStatus(o.qty);
      return {
        ...o,
        status,
        statusLabel: ORDER_STATUS_LABELS_NL[status],
        playerName: p.displayName,
        initials: p.initials,
        reservedCents: o.side === "BUY" ? cents((o.qty.open + o.qty.pending) * o.limitPriceCents) : cents(0),
      };
    })
    .sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime());
}

export function transactionsFor(w: DemoWorld, userId: string) {
  return w.transactions
    .filter((t) => t.userId === userId)
    .map((t) => ({ ...t, player: w.players.find((p) => p.id === t.playerId)! }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

// ---------------------------------------------------------------------------
// Drops (UX-04)
// ---------------------------------------------------------------------------
export type DropTab = "binnenkort" | "open" | "mijn" | "afgerond";

export function listDrops(w: DemoWorld, tab: DropTab, userId?: string, competitionId?: string) {
  const mySubs = new Map(w.subscriptions.filter((s) => s.userId === userId).map((s) => [s.dropId, s]));
  return w.drops
    .filter((d) => {
      if (tab === "binnenkort") return d.status === "PUBLISHED";
      if (tab === "open") return d.status === "OPEN";
      if (tab === "afgerond") return d.status === "COMPLETED" || d.status === "CANCELLED" || d.status === "CLOSED";
      return mySubs.has(d.id);
    })
    .map((d) => {
      const p = w.players.find((x) => x.id === d.playerId)!;
      return { drop: d, player: p, row: toMarketRow(w, p), subscription: mySubs.get(d.id) ?? null };
    })
    .filter((x) => !competitionId || x.player.competitionId === competitionId)
    .sort((a, b) => a.drop.opensAt.getTime() - b.drop.opensAt.getTime());
}
