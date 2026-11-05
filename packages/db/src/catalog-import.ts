/**
 * Catalogue import (docs/07 "Importproces", BR-01, AT-02/03/04, fase 2).
 *
 * 1. Fetch with cursor and source version, per unit of work ("step").
 * 2. Store each raw page as a snapshot with a retention date.
 * 3. Validate schema and identity; problems go to quarantine (import_issues).
 * 4. Map external ids to the immutable internal player UUID.
 * 5. Update club and squad memberships. A player found in another club's
 *    squad is a transfer: same player id, same market, old membership closed.
 * 6. Only a complete, verified squad snapshot may close memberships of
 *    players who are missing from it. A partial feed never removes anyone,
 *    and players are never deleted.
 * 7. Idempotent on provider, entity id and content: re-running the same
 *    source version changes nothing.
 *
 * Resumability: progress is recorded per step (competition list, teams of a
 * competition, squad of a team). A resumed run skips completed steps and
 * redoes an interrupted step from its first page; upserts make that safe.
 * Each page is processed in its own transaction; provider calls happen
 * outside database transactions.
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { FootballDataProvider, ProviderPlayer } from "@px/integrations";
import type { Db, Executor } from "./client.ts";
import {
  competitionSeasons,
  competitions,
  importIssues,
  importRunSteps,
  importRuns,
  importSnapshots,
  playerMarkets,
  playerRoles,
  playerTeamMemberships,
  players,
  providerPlayerMappings,
  providerTeamMappings,
  teamCompetitionMemberships,
  teams,
} from "./schema.ts";

export const SNAPSHOT_RETENTION_DAYS = 90;
const ROLES = new Set(["GOALKEEPER", "CENTRE_BACK", "FULL_BACK", "DEFENSIVE_MIDFIELDER", "CENTRAL_MIDFIELDER", "WINGER", "STRIKER"]);
const MEMBERSHIP_TYPES = new Set(["FIRST_TEAM", "LOAN", "YOUTH", "RESERVE"]);

export type ImportStats = {
  competitions: number;
  teams: number;
  playersCreated: number;
  playersUpdated: number;
  playersUnchanged: number;
  membershipsOpened: number;
  membershipsClosed: number;
  issues: number;
  pages: number;
};

const emptyStats = (): ImportStats => ({
  competitions: 0, teams: 0, playersCreated: 0, playersUpdated: 0, playersUnchanged: 0,
  membershipsOpened: 0, membershipsClosed: 0, issues: 0, pages: 0,
});

/** Calendar date (Europe/Amsterdam) used for membership validity. */
function localDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function searchKey(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------
export const CATALOG_SCOPE = "catalog";

/** Queue a run. At most one active run per provider/scope (unique index). */
export async function queueCatalogImport(db: Db, provider: string, requestedBy: string | null): Promise<{ runId: string; alreadyActive: boolean }> {
  const inserted = await db
    .insert(importRuns)
    .values({ provider, scope: CATALOG_SCOPE, status: "QUEUED", requestedBy })
    .onConflictDoNothing()
    .returning({ id: importRuns.id });
  if (inserted[0]) return { runId: inserted[0].id, alreadyActive: false };
  const active = await db.query.importRuns.findFirst({
    where: and(eq(importRuns.provider, provider), eq(importRuns.scope, CATALOG_SCOPE), sql`${importRuns.status} in ('QUEUED','RUNNING')`),
  });
  return { runId: active!.id, alreadyActive: true };
}

/**
 * Claim the next run to work on: a queued run, or a running run whose
 * heartbeat is stale (its worker died). SKIP LOCKED lets several workers
 * poll safely.
 */
export async function claimNextRun(db: Db, staleAfterMs = 120_000): Promise<string | null> {
  const res = await db.execute<{ id: string }>(sql`
    UPDATE import_runs SET status = 'RUNNING', heartbeat_at = now(), attempts = attempts + 1,
           started_at = coalesce(started_at, now()), last_error = NULL
     WHERE id = (
       SELECT id FROM import_runs
        WHERE status = 'QUEUED'
           OR (status = 'RUNNING' AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => ${staleAfterMs / 1000})))
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1)
    RETURNING id`);
  return res.rows[0]?.id ?? null;
}

/** Re-queue a failed run; completed steps are kept and skipped. */
export async function retryRun(db: Db, runId: string): Promise<void> {
  await db.update(importRuns).set({ status: "QUEUED", lastError: null }).where(and(eq(importRuns.id, runId), eq(importRuns.status, "FAILED")));
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
export type RunOptions = { now?: () => Date; onPage?: () => void };

export async function runCatalogImport(db: Db, runId: string, provider: FootballDataProvider, opts: RunOptions = {}): Promise<ImportStats> {
  const now = opts.now ?? (() => new Date());
  const run = await db.query.importRuns.findFirst({ where: eq(importRuns.id, runId) });
  if (!run) throw new Error(`import run ${runId} not found`);
  if (run.provider !== provider.name) throw new Error(`run is for provider ${run.provider}, not ${provider.name}`);
  const stats: ImportStats = { ...emptyStats(), ...(run.stats as Partial<ImportStats>) };
  const today = localDate(now());

  if (run.status !== "RUNNING") {
    await db.update(importRuns).set({ status: "RUNNING", startedAt: run.startedAt ?? now(), heartbeatAt: now(), attempts: run.attempts + 1 }).where(eq(importRuns.id, runId));
  }

  const ctx: Ctx = { db, runId, provider, stats, today, now, sourceVersion: run.sourceVersion ?? null, onPage: opts.onPage };

  try {
    // Step 1: competitions
    const compIds = await step(ctx, "competitions", async () => {
      const list = await provider.competitions();
      const out: string[] = [];
      await db.transaction(async (tx) => {
        await snapshot(tx, ctx, "competitions", 0, "list", list);
        for (const c of list) {
          const [row] = await tx
            .insert(competitions)
            .values({ provider: provider.name, providerId: c.externalId, name: c.name, countryCode: c.countryCode })
            .onConflictDoUpdate({ target: [competitions.provider, competitions.providerId], set: { name: c.name, countryCode: c.countryCode } })
            .returning({ id: competitions.id });
          await tx.insert(competitionSeasons)
            .values({ competitionId: row!.id, providerSeasonId: c.seasonExternalId, startsOn: c.seasonStartsOn ?? null, endsOn: c.seasonEndsOn ?? null })
            .onConflictDoNothing();
          out.push(c.externalId);
        }
      });
      stats.competitions = out.length;
      return out;
    }, async () => (await db.select({ id: competitions.providerId }).from(competitions).where(eq(competitions.provider, provider.name))).map((r) => r.id));

    // Step 2: teams per competition
    const teamExtIds: string[] = [];
    for (const compExt of compIds) {
      const ids = await step(ctx, `teams:${compExt}`, async () => {
        const found: string[] = [];
        let cursor: string | undefined;
        let pageNo = 0;
        for (;;) {
          const page = await provider.teams(compExt, cursor);
          ctx.sourceVersion = page.sourceVersion;
          await db.transaction(async (tx) => {
            await snapshot(tx, ctx, `teams:${compExt}`, pageNo, page.sourceVersion, page);
            const comp = await tx.query.competitions.findFirst({ where: and(eq(competitions.provider, provider.name), eq(competitions.providerId, compExt)) });
            for (const t of page.items) {
              const teamId = await upsertTeam(tx, provider.name, t.externalId, t.name, t.shortName);
              await tx.insert(teamCompetitionMemberships).values({ teamId, competitionId: comp!.id, validFrom: today }).onConflictDoNothing();
              found.push(t.externalId);
            }
          });
          stats.pages++;
          pageNo++;
          ctx.onPage?.();
          if (!page.nextCursor) break;
          cursor = page.nextCursor;
        }
        return found;
      }, async () => {
        const rows = await db.execute<{ external_id: string }>(sql`
          SELECT ptm.external_id FROM provider_team_mappings ptm
            JOIN team_competition_memberships tcm ON tcm.team_id = ptm.team_id AND tcm.valid_to IS NULL
            JOIN competitions c ON c.id = tcm.competition_id
           WHERE ptm.provider = ${provider.name} AND c.provider = ${provider.name} AND c.provider_id = ${compExt}`);
        return rows.rows.map((r) => r.external_id);
      });
      teamExtIds.push(...ids);
    }
    stats.teams = teamExtIds.length;

    // Step 3: squad per team
    for (const teamExt of teamExtIds) {
      await step(ctx, `squad:${teamExt}`, () => importSquad(ctx, teamExt), async () => undefined);
    }

    await db.update(importRuns).set({
      status: "COMPLETED",
      finishedAt: now(),
      heartbeatAt: now(),
      stats,
      sourceVersion: ctx.sourceVersion,
      isCompleteSnapshot: true,
      coverage: { competitions: compIds.length, teams: teamExtIds.length },
    }).where(eq(importRuns.id, runId));
    return stats;
  } catch (e) {
    await db.update(importRuns).set({ status: "FAILED", lastError: (e as Error).message.slice(0, 500), stats, heartbeatAt: now() }).where(eq(importRuns.id, runId));
    throw e;
  }
}

type Ctx = {
  db: Db;
  runId: string;
  provider: FootballDataProvider;
  stats: ImportStats;
  today: string;
  now: () => Date;
  sourceVersion: string | null;
  onPage: (() => void) | undefined;
};

/** Run a step once; a completed step is skipped and its result re-derived. */
async function step<T>(ctx: Ctx, key: string, work: () => Promise<T>, whenDone: () => Promise<T>): Promise<T> {
  const existing = await ctx.db.query.importRunSteps.findFirst({ where: and(eq(importRunSteps.runId, ctx.runId), eq(importRunSteps.stepKey, key)) });
  if (existing?.status === "COMPLETED") return whenDone();
  await ctx.db.insert(importRunSteps).values({ runId: ctx.runId, stepKey: key, status: "RUNNING" })
    .onConflictDoUpdate({ target: [importRunSteps.runId, importRunSteps.stepKey], set: { status: "RUNNING", pagesDone: 0, cursor: null } });
  try {
    const result = await work();
    await ctx.db.update(importRunSteps).set({ status: "COMPLETED", completedAt: ctx.now() })
      .where(and(eq(importRunSteps.runId, ctx.runId), eq(importRunSteps.stepKey, key)));
    await ctx.db.update(importRuns).set({ heartbeatAt: ctx.now(), stats: ctx.stats, sourceVersion: ctx.sourceVersion }).where(eq(importRuns.id, ctx.runId));
    return result;
  } catch (e) {
    await ctx.db.update(importRunSteps).set({ status: "FAILED" })
      .where(and(eq(importRunSteps.runId, ctx.runId), eq(importRunSteps.stepKey, key)));
    throw e;
  }
}

async function snapshot(tx: Executor, ctx: Ctx, key: string, pageNo: number, sourceVersion: string, payload: unknown) {
  const retainUntil = new Date(ctx.now().getTime() + SNAPSHOT_RETENTION_DAYS * 86_400_000);
  await tx.insert(importSnapshots).values({ runId: ctx.runId, stepKey: key, pageNo, sourceVersion, payload, retainUntil })
    .onConflictDoUpdate({ target: [importSnapshots.runId, importSnapshots.stepKey, importSnapshots.pageNo], set: { payload, sourceVersion, retainUntil } });
}

async function upsertTeam(tx: Executor, provider: string, externalId: string, name: string, shortName?: string): Promise<string> {
  const mapped = await tx.query.providerTeamMappings.findFirst({ where: and(eq(providerTeamMappings.provider, provider), eq(providerTeamMappings.externalId, externalId)) });
  if (mapped) {
    await tx.update(teams).set({ name, shortName: shortName ?? null }).where(and(eq(teams.id, mapped.teamId), sql`(${teams.name}, coalesce(${teams.shortName}, '')) IS DISTINCT FROM (${name}::text, ${shortName ?? ""}::text)`));
    return mapped.teamId;
  }
  const [t] = await tx.insert(teams).values({ name, shortName: shortName ?? null }).returning({ id: teams.id });
  await tx.insert(providerTeamMappings).values({ provider, externalId, teamId: t!.id });
  return t!.id;
}

async function recordIssue(tx: Executor, ctx: Ctx, kind: "MISSING_FIELD" | "DUPLICATE" | "CONFLICTING_MATCH" | "SCHEMA", externalId: string, detail: Record<string, unknown>) {
  const res = await tx.insert(importIssues).values({
    importRunId: ctx.runId, kind, entityRef: `player:${externalId}`, detail, provider: ctx.provider.name, externalId,
  }).onConflictDoNothing().returning({ id: importIssues.id });
  if (res.length) ctx.stats.issues++;
}

function validatePlayer(p: ProviderPlayer): string | null {
  if (!p.externalId || typeof p.externalId !== "string") return "externalId";
  if (!p.displayName || typeof p.displayName !== "string") return "displayName";
  if (!p.teamExternalId) return "teamExternalId";
  if (!MEMBERSHIP_TYPES.has(p.membershipType)) return "membershipType";
  if (p.birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(p.birthDate)) return "birthDate";
  return null;
}

async function importSquad(ctx: Ctx, teamExt: string): Promise<void> {
  const { db, provider, stats, today } = ctx;
  const teamMap = await db.query.providerTeamMappings.findFirst({ where: and(eq(providerTeamMappings.provider, provider.name), eq(providerTeamMappings.externalId, teamExt)) });
  if (!teamMap) throw new Error(`team ${teamExt} not mapped`);
  const teamId = teamMap.teamId;
  const seen = new Set<string>(); // internal player ids seen in this squad
  const seenExt = new Set<string>();
  let cursor: string | undefined;
  let pageNo = 0;
  let complete = false;

  for (;;) {
    const page = await provider.squad(teamExt, cursor);
    ctx.sourceVersion = page.sourceVersion;
    await db.transaction(async (tx) => {
      await snapshot(tx, ctx, `squad:${teamExt}`, pageNo, page.sourceVersion, page);
      for (const p of page.items) {
        const problem = validatePlayer(p);
        if (problem) {
          await recordIssue(tx, ctx, "MISSING_FIELD", p.externalId ?? `unknown:${teamExt}:${pageNo}`, { field: problem, team: teamExt });
          continue;
        }
        if (seenExt.has(p.externalId)) {
          await recordIssue(tx, ctx, "DUPLICATE", p.externalId, { team: teamExt });
          continue;
        }
        seenExt.add(p.externalId);
        const playerId = await upsertPlayer(tx, ctx, p);
        if (!playerId) continue; // quarantined
        seen.add(playerId);
        await placeInTeam(tx, ctx, playerId, teamId, p.membershipType);
        if (p.role && ROLES.has(p.role)) {
          await tx.insert(playerRoles).values({ playerId, role: p.role, source: provider.name, validFrom: today }).onConflictDoNothing();
        }
      }
      await tx.update(importRunSteps).set({ cursor: page.nextCursor, pagesDone: pageNo + 1 })
        .where(and(eq(importRunSteps.runId, ctx.runId), eq(importRunSteps.stepKey, `squad:${teamExt}`)));
    });
    stats.pages++;
    pageNo++;
    ctx.onPage?.();
    if (!page.nextCursor) {
      complete = page.isCompleteSnapshot === true;
      break;
    }
    cursor = page.nextCursor;
  }

  // Only a complete squad snapshot may close memberships of absent players.
  if (complete) {
    await db.transaction(async (tx) => {
      const open = await tx.select({ id: playerTeamMemberships.id, playerId: playerTeamMemberships.playerId })
        .from(playerTeamMemberships)
        .where(and(eq(playerTeamMemberships.teamId, teamId), isNull(playerTeamMemberships.validTo)));
      for (const m of open) {
        if (seen.has(m.playerId)) continue;
        await closeMembership(tx, ctx, m.id);
      }
      await tx.update(importRunSteps).set({ isCompleteSnapshot: true })
        .where(and(eq(importRunSteps.runId, ctx.runId), eq(importRunSteps.stepKey, `squad:${teamExt}`)));
    });
  }
}

async function closeMembership(tx: Executor, ctx: Ctx, membershipId: string) {
  // valid_to must be after valid_from; a membership opened today is closed today + 0 → use next day guard.
  await tx.execute(sql`
    UPDATE player_team_memberships
       SET valid_to = greatest(${ctx.today}::date, valid_from + 1)
     WHERE id = ${membershipId} AND valid_to IS NULL`);
  ctx.stats.membershipsClosed++;
}

async function upsertPlayer(tx: Executor, ctx: Ctx, p: ProviderPlayer): Promise<string | null> {
  const provider = ctx.provider.name;
  const mapped = await tx.query.providerPlayerMappings.findFirst({ where: and(eq(providerPlayerMappings.provider, provider), eq(providerPlayerMappings.externalId, p.externalId)) });
  const fields = {
    displayName: p.displayName,
    firstName: p.firstName ?? null,
    lastName: p.lastName ?? null,
    birthDate: p.birthDate ?? null,
    nationality: p.nationality ?? null,
  };

  if (mapped) {
    const changed = await tx.update(players)
      .set({ ...fields, sourceVersion: ctx.sourceVersion, updatedAt: ctx.now(), version: sql`${players.version} + 1` })
      .where(and(
        eq(players.id, mapped.playerId),
        sql`(${players.displayName}, ${players.firstName}, ${players.lastName}, ${players.birthDate}, ${players.nationality})
            IS DISTINCT FROM (${fields.displayName}::text, ${fields.firstName}::text, ${fields.lastName}::text, ${fields.birthDate}::date, ${fields.nationality}::char(2))`,
      ))
      .returning({ id: players.id });
    if (changed.length) ctx.stats.playersUpdated++;
    else ctx.stats.playersUnchanged++;
    return mapped.playerId;
  }

  // New external id. If the same person (name + birth date) already exists
  // without a mapping from this provider, do not merge silently: quarantine.
  if (p.birthDate) {
    const candidates = await tx.execute<{ id: string }>(sql`
      SELECT pl.id FROM players pl
       WHERE px_search_key(pl.display_name) = ${searchKey(p.displayName)}
         AND pl.birth_date = ${p.birthDate}::date
       LIMIT 2`);
    if (candidates.rows.length > 0) {
      await recordIssue(tx, ctx, "CONFLICTING_MATCH", p.externalId, { candidates: candidates.rows.map((r) => r.id), name: p.displayName });
      return null;
    }
  }

  const [row] = await tx.insert(players).values({ ...fields, dataQuality: "PARTIAL", sourceVersion: ctx.sourceVersion }).returning({ id: players.id });
  await tx.insert(providerPlayerMappings).values({ provider, externalId: p.externalId, playerId: row!.id });
  // Importing a profile never admits it to issuance (docs/01 Catalogus).
  await tx.insert(playerMarkets).values({ playerId: row!.id, status: "PROFILE_ONLY" }).onConflictDoNothing();
  ctx.stats.playersCreated++;
  return row!.id;
}

async function placeInTeam(tx: Executor, ctx: Ctx, playerId: string, teamId: string, type: ProviderPlayer["membershipType"]) {
  const openHere = await tx.query.playerTeamMemberships.findFirst({
    where: and(eq(playerTeamMemberships.playerId, playerId), eq(playerTeamMemberships.teamId, teamId), isNull(playerTeamMemberships.validTo)),
  });
  if (openHere && openHere.membershipType === type) return;
  if (openHere) await closeMembership(tx, ctx, openHere.id);
  if (type === "FIRST_TEAM") {
    // Transfer: positive evidence the player now plays for this club.
    const elsewhere = await tx.select({ id: playerTeamMemberships.id }).from(playerTeamMemberships)
      .where(and(eq(playerTeamMemberships.playerId, playerId), eq(playerTeamMemberships.membershipType, "FIRST_TEAM"), isNull(playerTeamMemberships.validTo), ne(playerTeamMemberships.teamId, teamId)));
    for (const m of elsewhere) await closeMembership(tx, ctx, m.id);
  }
  await tx.insert(playerTeamMemberships).values({ playerId, teamId, membershipType: type, validFrom: ctx.today });
  ctx.stats.membershipsOpened++;
}
