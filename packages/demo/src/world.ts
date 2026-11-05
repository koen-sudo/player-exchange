/**
 * Demo world — fictitious data only (docs/09 "Basisfixture").
 *
 * - 6 competitions × 4 teams × 10 players = 240 catalogue players.
 * - 20 open markets per competition = 120 open markets.
 * - All seven role categories, profiles with insufficient data, a transfer
 *   between two competitions, a retired player and a minor without primary
 *   admission.
 * - The wireframe players (Noah Vermeer, Lucas Moreau, Mateo Ruiz, Elias Weber)
 *   with the exact wireframe figures, so the demo matches the approved screens.
 *
 * Deterministic: same seed, same world. Not a real competition import and
 * must never be presented as one. All names and clubs are invented.
 */
import { type Cents, cents, seasonKeyFor } from "@px/domain";

export const DEMO_NOW = new Date("2026-11-05T17:00:00Z"); // Thursday 18:00 Amsterdam
export const DEMO_SEASON = seasonKeyFor(DEMO_NOW);

export type Role =
  | "GOALKEEPER"
  | "CENTRE_BACK"
  | "FULL_BACK"
  | "DEFENSIVE_MIDFIELDER"
  | "CENTRAL_MIDFIELDER"
  | "WINGER"
  | "STRIKER";

export const ROLE_LABELS_NL: Record<Role, string> = {
  GOALKEEPER: "Keeper",
  CENTRE_BACK: "Centrale verdediger",
  FULL_BACK: "Back",
  DEFENSIVE_MIDFIELDER: "Verdedigende middenvelder",
  CENTRAL_MIDFIELDER: "Middenvelder",
  WINGER: "Vleugelspeler",
  STRIKER: "Aanvaller",
};

export type MarketStatus = "PROFILE_ONLY" | "PRELAUNCH" | "OPEN" | "PAUSED" | "CLOSED";
export type CareerStatus = "ACTIVE" | "RETIRED";
export type DataQuality = "OK" | "PARTIAL" | "STALE" | "MISSING";
export type PrimaryAdmission = "INELIGIBLE" | "REVIEW" | "APPROVED" | "PAUSED";

export type Competition = { id: string; name: string; country: string; countryCode: string };
export type Team = { id: string; name: string; competitionId: string };

export type ReferenceValue = {
  amount: Cents;
  previous: Cents | null;
  publishedAt: Date;
  informationAsOf: Date;
  modelVersion: string;
  isDemoModel: true;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasons: { title: string; detail: string }[];
  isHistorical: boolean;
};

export type MatchLine = { fixture: string; minutes: number | null; goals: number | null; assists: number | null; playedAt: Date };

export type BookLevel = { price: Cents; quantity: number };

export type Supply = {
  inCirculation: number; // all definitively delivered cards, all seasons
  soldThisSeason: number;
  plannedThisSeason: number;
  seasonMaximum: 500;
  nextDropAt: Date | null;
};

export type Player = {
  id: string;
  displayName: string;
  initials: string;
  birthDate: string;
  age: number;
  nationality: string;
  role: Role;
  teamId: string;
  competitionId: string;
  previousTeamId: string | null; // transfer within the season
  careerStatus: CareerStatus;
  dataQuality: DataQuality;
  primaryAdmission: PrimaryAdmission;
  marketStatus: MarketStatus;
  reference: ReferenceValue | null;
  bids: BookLevel[];
  asks: BookLevel[];
  lastTrade: { price: Cents; at: Date } | null;
  supply: Supply;
  recentMatches: MatchLine[];
  isFictional: true;
};

export type Drop = {
  id: string;
  playerId: string;
  edition: string;
  priceCents: Cents;
  quantity: number;
  maxPerUser: number;
  publishedAt: Date;
  opensAt: Date;
  closesAt: Date;
  status: "PUBLISHED" | "OPEN" | "CLOSED" | "COMPLETED" | "CANCELLED";
  allocationMethod: "RANDOM_IF_OVERSUBSCRIBED";
  seedCommitment: string;
};

export type DemoUser = {
  id: string;
  login: string;
  displayName: string;
  role: "TRADER" | "REGISTERED" | "ADMIN";
  adminRoles: string[];
  verified: boolean;
  residenceCountry: string;
};

export type HeldCardRecord = { cardId: string; playerId: string; serial: number; edition: string; costCents: Cents; acquiredAt: Date; reservedForSale: boolean };

export type DemoOrder = {
  id: string;
  userId: string;
  playerId: string;
  side: "BUY" | "SELL";
  limitPriceCents: Cents;
  timeInForce: "ONE_DAY" | "SEVEN_DAYS" | "THIRTY_DAYS";
  qty: { original: number; open: number; pending: number; filled: number; cancelled: number; expired: number };
  acceptedAt: Date;
  expiresAt: Date;
  cardIds: string[];
};

export type DemoTransaction = {
  id: string;
  userId: string;
  playerId: string;
  kind: "PRIMARY_PURCHASE" | "SECONDARY_PURCHASE" | "SECONDARY_SALE";
  quantity: number;
  priceCents: Cents;
  feeCents: Cents;
  status: "SETTLED" | "PROVIDER_PENDING";
  at: Date;
};

export type DemoSubscription = {
  id: string;
  userId: string;
  dropId: string;
  status: "CONFIRMED" | "ALLOCATED" | "DELIVERED" | "NOT_ALLOCATED" | "WAITLISTED";
  reservedCents: Cents;
};

export type DemoWorld = {
  now: Date;
  season: string;
  competitions: Competition[];
  teams: Team[];
  players: Player[];
  drops: Drop[];
  users: DemoUser[];
  balances: Record<string, { available: Cents; reserved: Cents; pendingIncoming: Cents }>;
  holdings: Record<string, HeldCardRecord[]>;
  orders: DemoOrder[];
  transactions: DemoTransaction[];
  subscriptions: DemoSubscription[];
};

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable UUID-shaped id from a namespace and index (fictitious data only). */
export function demoId(ns: number, index: number): string {
  const hex = (n: number, w: number) => n.toString(16).padStart(w, "0");
  return `d${hex(ns, 7)}-0000-4000-8000-${hex(index, 12)}`;
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase();
}

function ageOn(birthDate: string, on: Date): number {
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  let age = on.getUTCFullYear() - y;
  if (on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d)) age--;
  return age;
}

const hoursAgo = (h: number) => new Date(DEMO_NOW.getTime() - h * 3_600_000);

// ---------------------------------------------------------------------------
// Static fictitious catalogue
// ---------------------------------------------------------------------------
const COMPETITIONS: { name: string; country: string; cc: string; teams: string[]; first: string[]; last: string[] }[] = [
  { name: "Premier League", country: "Engeland", cc: "GB", teams: ["Ashford Rovers", "Kingsbridge United", "Harlow Town", "Westmere City"],
    first: ["Oliver", "Harry", "Jack", "George", "Charlie", "Thomas", "James", "Alfie", "Leo", "Oscar"], last: ["Hartley", "Pembroke", "Ashworth", "Fenwick", "Marlow", "Thornton", "Whitlock", "Bramley", "Calloway", "Denholm", "Kershaw", "Langford"] },
  { name: "LaLiga", country: "Spanje", cc: "ES", teams: ["Real Almendra", "CD Puerto Claro", "Atlético Sierra", "UD Valdeluz"],
    first: ["Mateo", "Pablo", "Hugo", "Álvaro", "Daniel", "Adrián", "Diego", "Marco", "Iker", "Sergio"], last: ["Ruiz", "Navarro", "Iglesias", "Cortés", "Lozano", "Serrano", "Molina", "Delgado", "Vidal", "Castaño", "Olmedo", "Prieto"] },
  { name: "Bundesliga", country: "Duitsland", cc: "DE", teams: ["SV Lindenau", "FC Rheinfels", "Eintracht Holmsee", "VfB Grünwald"],
    first: ["Elias", "Finn", "Jonas", "Luis", "Paul", "Felix", "Noah", "Ben", "Moritz", "Lukas"], last: ["Weber", "Hartmann", "Krüger", "Lindner", "Brandt", "Vogel", "Seidel", "Kessler", "Roth", "Albrecht", "Fuchs", "Lorenz"] },
  { name: "Ligue 1", country: "Frankrijk", cc: "FR", teams: ["AS Belmont", "Olympique Varenne", "FC Saint-Aurèle", "Stade Montclair"],
    first: ["Lucas", "Hugo", "Louis", "Gabriel", "Arthur", "Jules", "Raphaël", "Léo", "Nathan", "Théo"], last: ["Moreau", "Lefèvre", "Girard", "Rousseau", "Fontaine", "Chevalier", "Garnier", "Lambert", "Bonnet", "Mercier", "Dupuis", "Marchand"] },
  { name: "Eredivisie", country: "Nederland", cc: "NL", teams: ["Noordwijk", "Rivieren SC", "Velden FC", "Polder FC"],
    first: ["Noah", "Daan", "Sem", "Levi", "Finn", "Milan", "Jesse", "Thijs", "Ruben", "Luuk"], last: ["Vermeer", "Bakker", "Dekker", "Mulder", "Brouwer", "Kuipers", "Hoekstra", "Verbeek", "Smits", "Postma", "Jonkers", "Willems"] },
  { name: "Pro League", country: "België", cc: "BE", teams: ["KV Scheldeoord", "Sporting Leiedal", "RFC Hautrive", "KSK Kempenhout"],
    first: ["Arthur", "Louis", "Jules", "Lucas", "Noah", "Victor", "Mathis", "Lars", "Wout", "Seppe"], last: ["Peeters", "Janssens", "Maes", "Claes", "Wouters", "Goossens", "De Smet", "Vermeulen", "Lemmens", "Van Damme", "Hermans", "Michiels"] },
];

const ROLE_ORDER: Role[] = [
  "CENTRAL_MIDFIELDER", "STRIKER", "WINGER", "CENTRE_BACK", "FULL_BACK",
  "GOALKEEPER", "DEFENSIVE_MIDFIELDER", "WINGER", "CENTRE_BACK", "FULL_BACK",
];

const REASONS: { title: string; detail: string }[] = [
  { title: "Meer speelminuten", detail: "De afgelopen wedstrijden speelde hij meer minuten dan in de voorgaande periode." },
  { title: "Sterkere wedstrijdprestaties", detail: "Hij was direct betrokken bij meerdere doelpunten en creëerde extra kansen." },
  { title: "Minder speeltijd", detail: "Hij kwam de afgelopen wedstrijden minder in actie dan daarvoor." },
  { title: "Nieuwe externe marktwaarde", detail: "Een bijgewerkte externe transferwaarde is verwerkt in het structurele deel." },
  { title: "Defensief sterker", detail: "Meer gewonnen duels en onderscheppingen dan in de vorige periode." },
];

// Monday 2 November 2026 18:00 Amsterdam = 17:00 UTC (A-05).
const LAST_RUN = new Date("2026-11-02T17:00:00Z");
const RUN_AS_OF = new Date("2026-11-02T06:00:00Z");
// Next drop window: Tuesday 10 November 2026 09:00–21:00 Amsterdam (A-06).
const NEXT_OPEN = new Date("2026-11-10T08:00:00Z");
const NEXT_CLOSE = new Date("2026-11-10T20:00:00Z");
// Previous window: Tuesday 3 November 2026.
const PREV_OPEN = new Date("2026-11-03T08:00:00Z");
const PREV_CLOSE = new Date("2026-11-03T20:00:00Z");

// Wireframe players, fixed figures.
type Pinned = { name: string; comp: string; team: number; role: Role; birth: string; ref: number; prev: number; bids: BookLevel[]; asks: BookLevel[]; last: number; inCirc: number };
const PINNED: Pinned[] = [
  { name: "Noah Vermeer", comp: "Eredivisie", team: 0, role: "CENTRAL_MIDFIELDER", birth: "2005-03-14", ref: 600, prev: 560, last: 610, inCirc: 80,
    bids: [{ price: cents(570), quantity: 2 }, { price: cents(560), quantity: 3 }], asks: [{ price: cents(620), quantity: 1 }, { price: cents(630), quantity: 2 }] },
  { name: "Lucas Moreau", comp: "Ligue 1", team: 0, role: "STRIKER", birth: "2004-09-02", ref: 340, prev: 350, last: 330, inCirc: 45,
    bids: [{ price: cents(310), quantity: 1 }], asks: [{ price: cents(355), quantity: 2 }] },
  { name: "Mateo Ruiz", comp: "LaLiga", team: 0, role: "WINGER", birth: "2003-06-21", ref: 820, prev: 780, last: 800, inCirc: 60,
    bids: [{ price: cents(790), quantity: 1 }], asks: [{ price: cents(840), quantity: 1 }] },
  { name: "Elias Weber", comp: "Bundesliga", team: 0, role: "CENTRE_BACK", birth: "2004-01-30", ref: 460, prev: 460, last: 450, inCirc: 25,
    bids: [], asks: [{ price: cents(480), quantity: 1 }] },
];

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------
export function buildDemoWorld(seed = 20261105): DemoWorld {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  const competitions: Competition[] = COMPETITIONS.map((c, i) => ({ id: demoId(1, i + 1), name: c.name, country: c.country, countryCode: c.cc }));
  const teams: Team[] = [];
  COMPETITIONS.forEach((c, ci) =>
    c.teams.forEach((t, ti) => teams.push({ id: demoId(2, ci * 10 + ti + 1), name: t, competitionId: competitions[ci]!.id })),
  );

  const players: Player[] = [];
  const usedNames = new Set<string>(PINNED.map((p) => p.name));
  let n = 0;

  COMPETITIONS.forEach((c, ci) => {
    const comp = competitions[ci]!;
    c.teams.forEach((_, ti) => {
      const team = teams.find((t) => t.competitionId === comp.id && t.name === c.teams[ti])!;
      for (let slot = 0; slot < 10; slot++) {
        n++;
        const pinned = slot === 0 && ti === 0 ? PINNED.find((p) => p.comp === c.name) : undefined;
        let name = pinned?.name;
        while (!name || (usedNames.has(name) && !pinned)) {
          name = `${pick(c.first)} ${pick(c.last)}`;
        }
        usedNames.add(name);

        const role = pinned?.role ?? ROLE_ORDER[slot]!;
        const birth = pinned?.birth ?? `${between(1995, 2007)}-${String(between(1, 12)).padStart(2, "0")}-${String(between(1, 28)).padStart(2, "0")}`;
        const open = slot < 5; // 5 per team × 4 teams = 20 open markets per competition

        let careerStatus: CareerStatus = "ACTIVE";
        let dataQuality: DataQuality = rnd() < 0.85 ? "OK" : "PARTIAL";
        let primaryAdmission: PrimaryAdmission = open ? "APPROVED" : pick(["INELIGIBLE", "REVIEW"] as const);
        let marketStatus: MarketStatus = open ? "OPEN" : "PROFILE_ONLY";
        let birthDate = birth;
        let previousTeamId: string | null = null;
        let teamId = team.id;
        let competitionId = comp.id;

        // Special fixture cases (docs/09).
        if (c.name === "Eredivisie" && ti === 3 && slot === 9) {
          birthDate = "2010-04-18"; // minor: profile only, no primary admission
          primaryAdmission = "INELIGIBLE";
          marketStatus = "PROFILE_ONLY";
        }
        if (c.name === "Premier League" && ti === 2 && slot === 4) {
          careerStatus = "RETIRED"; // cards remain tradeable as collectible, no new primary issue
          primaryAdmission = "INELIGIBLE";
        }
        if ((ti === 3 && slot === 7) || (ti === 1 && slot === 8)) {
          dataQuality = "MISSING"; // insufficient data: no reference value
        }
        if (c.name === "Pro League" && ti === 1 && slot === 2) {
          // transfer from Eredivisie (Polder FC) to Pro League mid-season: same player id and market
          previousTeamId = teams.find((t) => t.name === "Polder FC")?.id ?? null;
        }

        const refAmount = pinned ? pinned.ref : between(120, 1_450);
        const prevAmount = pinned ? pinned.prev : Math.max(100, refAmount + between(-60, 60));
        const reference: ReferenceValue | null =
          dataQuality === "MISSING"
            ? null
            : {
                amount: cents(refAmount),
                previous: cents(prevAmount),
                publishedAt: LAST_RUN,
                informationAsOf: RUN_AS_OF,
                modelVersion: "demo-v0",
                isDemoModel: true,
                confidence: dataQuality === "OK" ? "MEDIUM" : "LOW",
                reasons: refAmount >= prevAmount ? [REASONS[0]!, REASONS[1]!] : [REASONS[2]!],
                isHistorical: careerStatus === "RETIRED",
              };

        let bids: BookLevel[] = [];
        let asks: BookLevel[] = [];
        let lastTrade: Player["lastTrade"] = null;
        let inCirculation = 0;
        if (marketStatus === "OPEN") {
          inCirculation = pinned?.inCirc ?? 20 + 5 * between(0, 12);
          if (pinned) {
            bids = pinned.bids;
            asks = pinned.asks;
            lastTrade = { price: cents(pinned.last), at: hoursAgo(5) };
          } else {
            const mid = refAmount;
            const nb = rnd() < 0.15 ? 0 : between(1, 3);
            const na = between(1, 3);
            for (let i = 0; i < nb; i++) bids.push({ price: cents(Math.max(20, mid - 20 - i * 10 - between(0, 20))), quantity: between(1, 4) });
            for (let i = 0; i < na; i++) asks.push({ price: cents(mid + 20 + i * 10 + between(0, 20)), quantity: between(1, 3) });
            lastTrade = rnd() < 0.8 ? { price: cents(mid + between(-30, 30)), at: hoursAgo(between(1, 120)) } : null;
          }
        }

        const pinnedTeamFixtures = ["Rivieren SC – Noordwijk", "Noordwijk – Velden FC", "Polder FC – Noordwijk", "Noordwijk – Stadse Boys", "Meerdijk – Noordwijk"];
        const recentMatches: MatchLine[] = dataQuality === "MISSING"
          ? []
          : Array.from({ length: 5 }, (_, i) => {
              const opp = pick(c.teams.filter((t) => t !== team.name));
              const fixture = pinned?.name === "Noah Vermeer" ? pinnedTeamFixtures[i]! : i % 2 ? `${team.name} – ${opp}` : `${opp} – ${team.name}`;
              const pinnedLine = pinned?.name === "Noah Vermeer" ? [[90, 1, 1], [78, 0, 1], [90, 1, 0], [67, 0, 0], [90, 0, 1]][i]! : null;
              const partial = dataQuality === "PARTIAL" && i >= 3;
              return {
                fixture,
                minutes: pinnedLine ? pinnedLine[0]! : partial ? null : between(0, 90),
                goals: pinnedLine ? pinnedLine[1]! : partial ? null : rnd() < 0.2 ? 1 : 0,
                assists: pinnedLine ? pinnedLine[2]! : partial ? null : rnd() < 0.2 ? 1 : 0,
                playedAt: hoursAgo(24 * (4 + 7 * i)),
              };
            });

        players.push({
          id: demoId(3, n),
          displayName: name,
          initials: initials(name),
          birthDate,
          age: ageOn(birthDate, DEMO_NOW),
          nationality: c.cc,
          role,
          teamId,
          competitionId,
          previousTeamId,
          careerStatus,
          dataQuality,
          primaryAdmission,
          marketStatus,
          reference,
          bids,
          asks,
          lastTrade,
          supply: {
            inCirculation,
            soldThisSeason: inCirculation, // demo: all delivered cards are from this first season
            plannedThisSeason: marketStatus === "OPEN" ? 200 : 0,
            seasonMaximum: 500,
            nextDropAt: null,
          },
          recentMatches,
          isFictional: true,
        });
      }
    });
  });

  const byName = (name: string) => players.find((p) => p.displayName === name)!;
  const noah = byName("Noah Vermeer");
  const lucas = byName("Lucas Moreau");
  const mateo = byName("Mateo Ruiz");
  const elias = byName("Elias Weber");

  // ---------------------------------------------------------------------------
  // Drops: published Thursday 18:00, open Tuesday 09:00–21:00 (BR-09)
  // ---------------------------------------------------------------------------
  const commitment = (i: number) => (i.toString(16).padStart(2, "0")).repeat(32);
  const drops: Drop[] = [
    ...[noah, lucas, elias].map((p, i): Drop => ({
      id: demoId(4, i + 1),
      playerId: p.id,
      edition: DEMO_SEASON,
      priceCents: p.reference!.amount,
      quantity: 5,
      maxPerUser: 1,
      publishedAt: DEMO_NOW,
      opensAt: NEXT_OPEN,
      closesAt: NEXT_CLOSE,
      status: "PUBLISHED",
      allocationMethod: "RANDOM_IF_OVERSUBSCRIBED",
      seedCommitment: commitment(i + 1),
    })),
    { id: demoId(4, 10), playerId: mateo.id, edition: DEMO_SEASON, priceCents: cents(780), quantity: 5, maxPerUser: 1,
      publishedAt: new Date("2026-10-29T17:00:00Z"), opensAt: PREV_OPEN, closesAt: PREV_CLOSE, status: "COMPLETED",
      allocationMethod: "RANDOM_IF_OVERSUBSCRIBED", seedCommitment: commitment(10) },
    { id: demoId(4, 11), playerId: lucas.id, edition: DEMO_SEASON, priceCents: cents(350), quantity: 5, maxPerUser: 1,
      publishedAt: new Date("2026-10-29T17:00:00Z"), opensAt: PREV_OPEN, closesAt: PREV_CLOSE, status: "COMPLETED",
      allocationMethod: "RANDOM_IF_OVERSUBSCRIBED", seedCommitment: commitment(11) },
  ];
  for (const d of drops) {
    if (d.status !== "PUBLISHED") continue;
    const p = players.find((x) => x.id === d.playerId)!;
    p.supply.nextDropAt = d.opensAt;
  }

  // ---------------------------------------------------------------------------
  // Users and the wireframe portfolio
  // ---------------------------------------------------------------------------
  const users: DemoUser[] = [
    { id: demoId(5, 1), login: "anna", displayName: "Anna de Vries", role: "TRADER", adminRoles: [], verified: true, residenceCountry: "NL" },
    { id: demoId(5, 2), login: "bram", displayName: "Bram Jansen", role: "REGISTERED", adminRoles: [], verified: false, residenceCountry: "NL" },
    { id: demoId(5, 3), login: "beheer", displayName: "Sanne (beheer)", role: "ADMIN", adminRoles: ["CATALOG_MANAGER", "ISSUANCE_OPERATOR", "VALUATION_ANALYST", "FINANCE_OPERATOR"], verified: true, residenceCountry: "NL" },
    { id: demoId(5, 4), login: "approver", displayName: "Joris (goedkeurder)", role: "ADMIN", adminRoles: ["APPROVER"], verified: true, residenceCountry: "NL" },
  ];
  const anna = users[0]!;

  const card = (p: Player, serial: number, cost: number, acquiredDaysAgo: number, reservedForSale = false): HeldCardRecord => ({
    cardId: demoId(6, Number(p.id.slice(-4)) * 1000 + serial),
    playerId: p.id,
    serial,
    edition: DEMO_SEASON,
    costCents: cents(cost),
    acquiredAt: hoursAgo(24 * acquiredDaysAgo),
    reservedForSale,
  });

  const holdings: Record<string, HeldCardRecord[]> = {
    [anna.id]: [
      card(noah, 12, 580, 30), card(noah, 13, 580, 30), card(noah, 14, 580, 30),
      card(lucas, 7, 320, 32), card(lucas, 8, 320, 32, true),
      card(mateo, 21, 680, 34),
    ],
  };

  const orders: DemoOrder[] = [
    {
      id: demoId(7, 1), userId: anna.id, playerId: noah.id, side: "BUY", limitPriceCents: cents(620), timeInForce: "SEVEN_DAYS",
      qty: { original: 2, open: 2, pending: 0, filled: 0, cancelled: 0, expired: 0 },
      acceptedAt: hoursAgo(20), expiresAt: new Date(hoursAgo(20).getTime() + 168 * 3_600_000), cardIds: [],
    },
    {
      id: demoId(7, 2), userId: anna.id, playerId: lucas.id, side: "SELL", limitPriceCents: cents(355), timeInForce: "THIRTY_DAYS",
      qty: { original: 1, open: 1, pending: 0, filled: 0, cancelled: 0, expired: 0 },
      acceptedAt: hoursAgo(50), expiresAt: new Date(hoursAgo(50).getTime() + 720 * 3_600_000), cardIds: [holdings[anna.id]![4]!.cardId],
    },
    {
      id: demoId(7, 3), userId: anna.id, playerId: mateo.id, side: "BUY", limitPriceCents: cents(700), timeInForce: "ONE_DAY",
      qty: { original: 1, open: 0, pending: 0, filled: 0, cancelled: 0, expired: 1 },
      acceptedAt: hoursAgo(200), expiresAt: hoursAgo(176), cardIds: [],
    },
  ];

  const transactions: DemoTransaction[] = [
    { id: demoId(8, 1), userId: anna.id, playerId: noah.id, kind: "SECONDARY_PURCHASE", quantity: 1, priceCents: cents(580), feeCents: cents(0), status: "SETTLED", at: hoursAgo(24 * 30) },
    { id: demoId(8, 2), userId: anna.id, playerId: noah.id, kind: "SECONDARY_PURCHASE", quantity: 2, priceCents: cents(580), feeCents: cents(0), status: "SETTLED", at: hoursAgo(24 * 30 - 2) },
    { id: demoId(8, 3), userId: anna.id, playerId: lucas.id, kind: "PRIMARY_PURCHASE", quantity: 2, priceCents: cents(320), feeCents: cents(0), status: "SETTLED", at: hoursAgo(24 * 32) },
    { id: demoId(8, 4), userId: anna.id, playerId: mateo.id, kind: "PRIMARY_PURCHASE", quantity: 1, priceCents: cents(680), feeCents: cents(0), status: "SETTLED", at: hoursAgo(24 * 34) },
  ];

  const subscriptions: DemoSubscription[] = [
    { id: demoId(9, 1), userId: anna.id, dropId: demoId(4, 10), status: "NOT_ALLOCATED", reservedCents: cents(0) },
    { id: demoId(9, 2), userId: anna.id, dropId: demoId(4, 11), status: "WAITLISTED", reservedCents: cents(0) },
  ];

  return {
    now: DEMO_NOW,
    season: DEMO_SEASON,
    competitions,
    teams,
    players,
    drops,
    users,
    balances: {
      [anna.id]: { available: cents(12_000), reserved: cents(1_240), pendingIncoming: cents(0) },
      [users[1]!.id]: { available: cents(0), reserved: cents(0), pendingIncoming: cents(0) },
    },
    holdings,
    orders,
    transactions,
    subscriptions,
  };
}

let cached: DemoWorld | undefined;
export function demoWorld(): DemoWorld {
  cached ??= buildDemoWorld();
  return cached;
}
