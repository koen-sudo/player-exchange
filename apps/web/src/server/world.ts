/**
 * The app's read model for the screens (R-28, fase 3).
 *
 * From PostgreSQL: competitions, teams, players (status, admission, team,
 * role, published reference), supply per player, and the signed-in user's
 * card holdings, reservations and orders.
 *
 * From the demo world until their phase moves them to the database:
 * order book levels and last trade (fase 5), cash balances (fase 4),
 * transactions (fase 4/5), drops and subscriptions (fase 6), match lines and
 * the previous reference value used for the change column (fase 7).
 * Overlay data is joined by player id, which the seed keeps identical.
 */
import "server-only";
import { cache } from "react";
import { cents, seasonKeyFor } from "@px/domain";
import { getDb, holdingsFor, listAllPlayersInternal, ordersForUser, supplyFor } from "@px/db";
import { demoWorld, type DemoWorld, type Player, type Role } from "@px/demo";

const ROLES = new Set<Role>(["GOALKEEPER", "CENTRE_BACK", "FULL_BACK", "DEFENSIVE_MIDFIELDER", "CENTRAL_MIDFIELDER", "WINGER", "STRIKER"]);

export const loadWorld = cache(async (userId: string | null): Promise<DemoWorld> => {
  const overlay = demoWorld();
  const { db } = getDb();
  const season = seasonKeyFor(new Date());
  const [rows, supply] = await Promise.all([listAllPlayersInternal(db), supplyFor(db, season)]);

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
    const reference = r.amount_cents === null ? null : {
      amount: cents(Number(r.amount_cents)),
      previous: o?.reference?.previous ?? null,
      publishedAt: new Date(r.published_at!),
      informationAsOf: o?.reference?.informationAsOf ?? new Date(r.published_at!),
      modelVersion: r.model_version!,
      isDemoModel: true as const,
      confidence: o?.reference?.confidence ?? "LOW",
      reasons: o?.reference?.reasons ?? [],
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
      // Order book and last trade come from the demo overlay until fase 5.
      bids: marketStatus === "OPEN" ? o?.bids ?? [] : [],
      asks: marketStatus === "OPEN" ? o?.asks ?? [] : [],
      lastTrade: marketStatus === "OPEN" ? o?.lastTrade ?? null : null,
      supply: {
        inCirculation: s?.in_circulation ?? 0,
        soldThisSeason: s?.sold_this_season ?? 0,
        plannedThisSeason: s?.planned_this_season ?? 0,
        seasonMaximum: 500,
        nextDropAt: o?.supply.nextDropAt ?? null,
      },
      recentMatches: o?.recentMatches ?? [],
      isFictional: true,
    };
  });

  let holdings: DemoWorld["holdings"] = {};
  let orders: DemoWorld["orders"] = [];
  if (userId) {
    const [h, os] = await Promise.all([holdingsFor(db, userId), ordersForUser(db, userId)]);
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
  };
});
