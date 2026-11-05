/**
 * The app's read model for the screens (R-28, fase 3).
 *
 * From PostgreSQL: competitions, teams, players (status, admission, team,
 * role, published reference), supply per player, order book levels, last
 * trade (when there is one), published reference history (change column,
 * reasons), recent matches, drops and the user's subscriptions, and the signed-in user's
 * card holdings, reservations and orders, and cash balances from the ledger.
 *
 * From the demo world until their phase moves them to the database:
 * the last trade before the first real one (R-46).
 * Overlay data is joined by player id, which the seed keeps identical.
 */
import "server-only";
import { cache } from "react";
import { cents, seasonKeyFor } from "@px/domain";
import { balancesFor, getDb, holdingsFor, lastTrades, listDropsForUser, publishedReferenceHistory, recentMatches, listAllPlayersInternal, orderBookLevels, ordersForUser, supplyFor } from "@px/db";
import { demoWorld, type DemoSubscription, type DemoWorld, type Drop, type Player, type Role } from "@px/demo";

const ROLES = new Set<Role>(["GOALKEEPER", "CENTRE_BACK", "FULL_BACK", "DEFENSIVE_MIDFIELDER", "CENTRAL_MIDFIELDER", "WINGER", "STRIKER"]);

export const loadWorld = cache(async (userId: string | null): Promise<DemoWorld> => {
  const overlay = demoWorld();
  const { db } = getDb();
  const season = seasonKeyFor(new Date());
  const [rows, supply, levels, trades, dropRows] = await Promise.all([listAllPlayersInternal(db), supplyFor(db, season), orderBookLevels(db), lastTrades(db), listDropsForUser(db, userId)]);
  const [history, matches] = await Promise.all([publishedReferenceHistory(db), recentMatches(db)]);
  const DROP_STATUS: Record<string, Drop["status"]> = { PUBLISHED: "PUBLISHED", OPEN: "OPEN", CLOSED: "CLOSED", ALLOCATING: "CLOSED", SETTLING: "CLOSED", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED", POSTPONED: "CANCELLED" };
  const drops: Drop[] = dropRows.map((d) => ({
    id: d.id,
    playerId: d.player_id,
    edition: d.season_key,
    priceCents: cents(Number(d.price_cents)),
    quantity: d.quantity,
    maxPerUser: d.max_per_user,
    publishedAt: new Date(d.publishes_at),
    opensAt: new Date(d.opens_at),
    closesAt: new Date(d.closes_at),
    status: DROP_STATUS[d.status] ?? "CLOSED",
    allocationMethod: "RANDOM_IF_OVERSUBSCRIBED",
    seedCommitment: d.seed_commitment ?? "",
    verification: { seedRevealed: d.seed_revealed, participants: d.participants, participantsDigest: d.participants_digest, resultDigest: d.result_digest, delivered: d.delivered },
    priceChanges: d.price_changes,
  }));
  const SUB_STATUS: Record<string, DemoSubscription["status"]> = {
    RESERVATION_PENDING: "PENDING", CONFIRMED: "CONFIRMED", WAITLISTED: "WAITLISTED", NOT_ALLOCATED: "NOT_ALLOCATED", RELEASED: "NOT_ALLOCATED", INVALID_LATE: "NOT_ALLOCATED", CANCELLED: "CANCELLED",
  };
  const subscriptions: DemoSubscription[] = userId
    ? dropRows.filter((d) => d.my_subscription_id).map((d) => ({
        id: d.my_subscription_id!,
        userId,
        dropId: d.id,
        status: d.my_status === "ALLOCATED" ? (d.my_allocation === "DELIVERED" ? "DELIVERED" : "ALLOCATED") : SUB_STATUS[d.my_status!] ?? "NOT_ALLOCATED",
        reservedCents: cents(["CONFIRMED", "WAITLISTED", "RESERVATION_PENDING"].includes(d.my_status!) ? Number(d.price_cents) : 0),
      }))
    : [];
  const nextDrop = new Map<string, Date>();
  for (const d of drops) if (d.status === "PUBLISHED" || d.status === "OPEN") if (!nextDrop.has(d.playerId)) nextDrop.set(d.playerId, d.opensAt);
  const book = new Map<string, { bids: { price: ReturnType<typeof cents>; quantity: number }[]; asks: { price: ReturnType<typeof cents>; quantity: number }[] }>();
  for (const l of levels) {
    const b = book.get(l.player_id) ?? { bids: [], asks: [] };
    (l.side === "BUY" ? b.bids : b.asks).push({ price: cents(Number(l.price)), quantity: l.quantity });
    book.set(l.player_id, b);
  }

  const competitions = new Map<string, DemoWorld["competitions"][number]>();
  const teams = new Map<string, DemoWorld["teams"][number]>();
  const overlayById = new Map(overlay.players.map((p) => [p.id, p]));
  const countryName = new Map(overlay.competitions.map((c) => [c.countryCode, c.country]));

  const players: Player[] = rows.map((r) => {
    if (r.competition_id && !competitions.has(r.competition_id)) {
      competitions.set(r.competition_id, { id: r.competition_id, name: r.competition_name!, country: countryName.get(r.country_code!) ?? r.country_code!, countryCode: r.country_code! });
    }
    if (r.team_id && !teams.has(r.team_id)) teams.set(r.team_id, { id: r.team_id, name: r.team_name!, competitionId: r.competition_id ?? "" });
    const o = overlayById.get(r.id);
    const s = supply.get(r.id);
    const marketStatus = r.market_status as Player["marketStatus"];
    const h = history.get(r.id);
    const reference = r.amount_cents === null ? null : {
      amount: cents(Number(r.amount_cents)),
      previous: h?.previous === null || h?.previous === undefined ? null : cents(h.previous),
      publishedAt: new Date(r.published_at!),
      informationAsOf: h ? new Date(h.informationAsOf) : new Date(r.published_at!),
      modelVersion: r.model_version!,
      isDemoModel: true as const,
      confidence: (h?.confidence ?? "LOW") as "HIGH" | "MEDIUM" | "LOW",
      reasons: h?.explanations ?? [],
      isHistorical: !!r.is_historical,
    };
    const name = r.display_name;
    const parts = name.split(/\s+/);
    return {
      id: r.id,
      displayName: name,
      initials: ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase(),
      birthDate: r.birth_date ?? "",
      age: r.age ?? 0,
      nationality: r.nationality ?? "",
      role: (r.role && ROLES.has(r.role as Role) ? r.role : o?.role ?? "CENTRAL_MIDFIELDER") as Role,
      teamId: r.team_id ?? "",
      competitionId: r.competition_id ?? "",
      previousTeamId: o?.previousTeamId ?? null,
      careerStatus: (r.career_status === "RETIRED" ? "RETIRED" : "ACTIVE") as Player["careerStatus"],
      dataQuality: r.data_quality as Player["dataQuality"],
      primaryAdmission: r.primary_admission as Player["primaryAdmission"],
      marketStatus,
      reference,
      // Order book from open orders in the database (fase 5). The last trade is
      // the latest settled execution; before the first real trade the demo
      // history stands in (R-46).
      bids: marketStatus === "OPEN" ? book.get(r.id)?.bids ?? [] : [],
      asks: marketStatus === "OPEN" ? book.get(r.id)?.asks ?? [] : [],
      lastTrade: (() => {
        const t = trades.get(r.id);
        if (t) return { price: cents(t.price), at: t.at };
        return marketStatus === "OPEN" ? o?.lastTrade ?? null : null;
      })(),
      supply: {
        inCirculation: s?.in_circulation ?? 0,
        soldThisSeason: s?.sold_this_season ?? 0,
        plannedThisSeason: s?.planned_this_season ?? 0,
        seasonMaximum: 500,
        nextDropAt: nextDrop.get(r.id) ?? null,
      },
      recentMatches: matches.get(r.id) ?? [],
      isFictional: true,
    };
  });

  let holdings: DemoWorld["holdings"] = {};
  let orders: DemoWorld["orders"] = [];
  let balances: DemoWorld["balances"] = {};
  if (userId) {
    const [h, os, b] = await Promise.all([holdingsFor(db, userId), ordersForUser(db, userId), balancesFor(db, userId)]);
    // Cash comes from the ledger (fase 4).
    balances = { [userId]: { available: cents(b.available), reserved: cents(b.reserved), pendingIncoming: cents(b.pendingIncoming) } };
    holdings = {
      [userId]: h.map((c) => ({
        cardId: c.card_id,
        playerId: c.player_id,
        serial: c.serial,
        edition: c.season_key,
        costCents: cents(Number(c.cost_basis_cents)),
        acquiredAt: new Date(c.acquired_at),
        reservedForSale: c.reserved_for_sale,
      })),
    };
    orders = os.map((o) => ({
      id: o.id,
      userId,
      playerId: o.player_id,
      side: o.side,
      limitPriceCents: cents(Number(o.limit_price_cents)),
      timeInForce: o.time_in_force,
      qty: { original: o.qty_original, open: o.qty_open, pending: o.qty_pending, filled: o.qty_filled, cancelled: o.qty_cancelled, expired: o.qty_expired },
      acceptedAt: new Date(o.accepted_at ?? Date.now()),
      expiresAt: new Date(o.expires_at ?? Date.now()),
      cardIds: o.card_ids ?? [],
    }));
  }

  return {
    ...overlay,
    competitions: [...competitions.values()].sort((a, b) => overlay.competitions.findIndex((c) => c.name === a.name) - overlay.competitions.findIndex((c) => c.name === b.name)),
    teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name, "nl")),
    players,
    holdings,
    orders,
    balances,
    drops,
    subscriptions,
  };
});
