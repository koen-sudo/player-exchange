/**
 * Fictitious football data provider (docs/07 FootballDataProvider, O-03).
 *
 * Serves the demo world through the same paginated contract a real supplier
 * adapter implements, so the import pipeline is exercised end to end.
 * Scenario switches let tests simulate what real feeds do:
 *
 * - version "v1": the demo world as-is.
 * - version "v2": a mid-season transfer between two competitions, a newly
 *   promoted youth player, a player who left a club, and a renamed player.
 * - partialTeams: squads that are delivered without the completeness flag
 *   and with players missing (a partial feed must not delete anyone).
 * - failAfterCalls: throw after N provider calls (simulates an outage or
 *   crash, so a resumed import can be tested).
 * - duplicateInTeam / conflictingPlayer: data-quality problems that must be
 *   quarantined, not merged.
 *
 * External ids equal the demo ids so the demo seed and the import agree.
 */
import type { FootballDataProvider, Page, ProviderCompetition, ProviderPlayer, ProviderTeam } from "@px/integrations";
import { buildDemoWorld, type DemoWorld, type Player } from "./world.ts";

export type FixtureScenario = {
  version?: "v1" | "v2";
  pageSize?: number;
  partialTeams?: readonly string[]; // team external ids
  failAfterCalls?: number;
  duplicateInTeam?: string; // team external id that lists one player twice
  conflictingPlayer?: boolean; // adds a new external id for an existing person
};

export const FIXTURE_PROVIDER = "fixture";

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

const SEASON = { externalId: "2026-2027", startsOn: "2026-07-01", endsOn: "2027-06-30" };

export function createFixtureProvider(scenario: FixtureScenario = {}, world: DemoWorld = buildDemoWorld()): FootballDataProvider & { calls: number } {
  const version = scenario.version ?? "v1";
  const pageSize = scenario.pageSize ?? 4;
  const sourceVersion = `fixture-${version}`;
  const squads = buildSquads(world, version, scenario);
  let calls = 0;
  // One fixture per demo match line; a missing statistic is left out, never zero.
  const allFixtures = world.players.flatMap((p) =>
    p.recentMatches.map((m, i) => {
      const [home, away] = m.fixture.split(" – ");
      const team = (n: string) => world.teams.find((t) => t.name === n)?.id ?? `extra:${n}`;
      const stats: Record<string, number> = {};
      if (m.goals !== null) stats.goals = m.goals;
      if (m.assists !== null) stats.assists = m.assists;
      return {
        competitionId: p.competitionId,
        externalId: `fx-${p.id}-${i}`,
        homeTeamExternalId: team(home!),
        awayTeamExternalId: team(away!),
        kickoffAt: m.playedAt.toISOString(),
        status: "FINISHED",
        stats: { playerExternalId: p.id, minutes: m.minutes, stats, version: 1, asOf: new Date(m.playedAt.getTime() + 3 * 3_600_000).toISOString() },
      };
    }),
  );
  const fixturesFor = (competitionId: string) => allFixtures.filter((f) => f.competitionId === competitionId).map(({ competitionId: _c, ...f }) => f);

  const tick = () => {
    calls++;
    if (scenario.failAfterCalls !== undefined && calls > scenario.failAfterCalls) {
      throw new ProviderUnavailableError(`fixture provider unavailable after ${scenario.failAfterCalls} calls`);
    }
  };
  const page = <T>(items: T[], cursor: string | undefined, complete: boolean): Page<T> => {
    const start = cursor ? Number(cursor) : 0;
    const slice = items.slice(start, start + pageSize);
    const next = start + pageSize < items.length ? String(start + pageSize) : null;
    return { items: slice, nextCursor: next, sourceVersion, ...(next === null ? { isCompleteSnapshot: complete } : {}) };
  };

  const provider = {
    name: FIXTURE_PROVIDER,
    get calls() {
      return calls;
    },
    async competitions(): Promise<ProviderCompetition[]> {
      tick();
      return world.competitions.map((c) => ({
        externalId: c.id,
        name: c.name,
        countryCode: c.countryCode,
        seasonExternalId: SEASON.externalId,
        seasonStartsOn: SEASON.startsOn,
        seasonEndsOn: SEASON.endsOn,
      }));
    },
    async teams(competitionExternalId: string, cursor?: string): Promise<Page<ProviderTeam>> {
      tick();
      const teams = world.teams
        .filter((t) => t.competitionId === competitionExternalId)
        .map((t) => ({ externalId: t.id, name: t.name, competitionExternalId }));
      return page(teams, cursor, true);
    },
    async squad(teamExternalId: string, cursor?: string): Promise<Page<ProviderPlayer>> {
      tick();
      const partial = scenario.partialTeams?.includes(teamExternalId) ?? false;
      let list = squads.get(teamExternalId) ?? [];
      if (partial) list = list.slice(0, Math.max(1, Math.floor(list.length / 2)));
      return page(list, cursor, !partial);
    },
    async fixtures(competitionExternalId: string, sinceIso: string, cursor?: string) {
      tick();
      const since = Date.parse(sinceIso);
      return page(fixturesFor(competitionExternalId).filter((f) => Date.parse(f.kickoffAt) >= since).map(({ stats: _s, ...f }) => f), cursor, true);
    },
    async playerMatchStats(fixtureExternalId: string) {
      tick();
      const f = allFixtures.find((x) => x.externalId === fixtureExternalId);
      return f ? [f.stats] : [];
    },
  };
  return provider;
}

/** Fixed v2 changes, exported so tests can assert on them. */
export function v2Changes(world: DemoWorld = buildDemoWorld()) {
  const byComp = (name: string) => world.competitions.find((c) => c.name === name)!.id;
  const teamsOf = (comp: string) => world.teams.filter((t) => t.competitionId === byComp(comp));
  const ere = teamsOf("Eredivisie");
  const pl = teamsOf("Premier League");
  const bel = teamsOf("Pro League");
  const inTeam = (teamId: string) => world.players.filter((p) => p.teamId === teamId);
  // A player with an open market moves from the Eredivisie to the Premier League.
  const transfer = inTeam(ere[1]!.id).find((p) => p.marketStatus === "OPEN")!;
  // A profile-only player leaves his Pro League club (destination unknown).
  const leaver = inTeam(bel[2]!.id).find((p) => p.marketStatus === "PROFILE_ONLY")!;
  // A player's display name is corrected by the provider.
  const renamed = inTeam(pl[0]!.id)[3]!;
  return {
    transfer: { player: transfer, fromTeam: ere[1]!, toTeam: pl[3]! },
    leaver: { player: leaver, team: bel[2]! },
    renamed: { player: renamed, newName: `${renamed.displayName} Jr.` },
    newcomer: { externalId: "fx-new-0001", name: "Sem van Dalen", team: ere[0]! },
  };
}

function toProviderPlayer(p: Player, teamExternalId: string, overrides: Partial<ProviderPlayer> = {}): ProviderPlayer {
  const [first, ...rest] = p.displayName.split(" ");
  return {
    externalId: p.id,
    displayName: p.displayName,
    firstName: first,
    lastName: rest.join(" "),
    birthDate: p.birthDate,
    nationality: p.nationality,
    teamExternalId,
    membershipType: "FIRST_TEAM",
    role: p.role,
    ...overrides,
  };
}

function buildSquads(world: DemoWorld, version: "v1" | "v2", scenario: FixtureScenario): Map<string, ProviderPlayer[]> {
  const squads = new Map<string, ProviderPlayer[]>();
  for (const t of world.teams) {
    squads.set(t.id, world.players.filter((p) => p.teamId === t.id).map((p) => toProviderPlayer(p, t.id)));
  }
  if (version === "v2") {
    const c = v2Changes(world);
    const from = squads.get(c.transfer.fromTeam.id)!;
    squads.set(c.transfer.fromTeam.id, from.filter((p) => p.externalId !== c.transfer.player.id));
    squads.get(c.transfer.toTeam.id)!.push(toProviderPlayer(c.transfer.player, c.transfer.toTeam.id));
    const leaverTeam = squads.get(c.leaver.team.id)!;
    squads.set(c.leaver.team.id, leaverTeam.filter((p) => p.externalId !== c.leaver.player.id));
    const renamedTeam = squads.get(c.renamed.player.teamId)!;
    const idx = renamedTeam.findIndex((p) => p.externalId === c.renamed.player.id);
    renamedTeam[idx] = { ...renamedTeam[idx]!, displayName: c.renamed.newName };
    squads.get(c.newcomer.team.id)!.push({
      externalId: c.newcomer.externalId,
      displayName: c.newcomer.name,
      firstName: "Sem",
      lastName: "van Dalen",
      birthDate: "2008-02-11",
      nationality: "NL",
      teamExternalId: c.newcomer.team.id,
      membershipType: "YOUTH",
      role: "STRIKER",
    });
  }
  if (scenario.duplicateInTeam) {
    const list = squads.get(scenario.duplicateInTeam)!;
    list.push({ ...list[0]! });
  }
  if (scenario.conflictingPlayer) {
    // Same person (name + birth date) delivered under a new external id.
    const team = world.teams[0]!;
    const existing = squads.get(team.id)![1]!;
    squads.get(team.id)!.push({ ...existing, externalId: "fx-conflict-0001" });
  }
  return squads;
}
