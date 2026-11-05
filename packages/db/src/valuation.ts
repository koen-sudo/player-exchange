/**
 * Valuation runs (fase 7, docs/08, BR-08, AT-28, AT-29).
 *
 *   create (compute with the approved model, inputs as known at the information date)
 *   → automatic checks: VALIDATED or FAILED
 *   → review by another person: APPROVED or REJECTED
 *   → publication, atomically: the whole run at once (Monday 18:00 Amsterdam,
 *     or "now" in the demo)
 *
 * - Users only ever see PUBLISHED runs (public_reference_values view).
 * - A player without enough input gets no new value: the previous one stays
 *   visible with its own date.
 * - Publishing never touches orders: limit orders keep their own price (AT-28).
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { computeDemoReference, DEMO_MODEL_KEY, DomainError, validateRunOutputs, type MatchInput, type ValuationRole } from "@px/domain";
import type { Db, Executor } from "./client.ts";
import { requirePermission, writeAudit, type AppMode, type Identity } from "./identity.ts";

type Actor = Pick<Identity, "id" | "permissions">;

/** Next Monday 18:00 Europe/Amsterdam after `from` (BR-08 planning), as UTC. */
export async function nextPublicationSlot(db: Executor, from = new Date()): Promise<Date> {
  const r = (await db.execute<{ at: string }>(sql`
    SELECT ((date_trunc('week', ${from.toISOString()}::timestamptz AT TIME ZONE 'Europe/Amsterdam') + interval '18 hours'
             + CASE WHEN ${from.toISOString()}::timestamptz AT TIME ZONE 'Europe/Amsterdam' >= date_trunc('week', ${from.toISOString()}::timestamptz AT TIME ZONE 'Europe/Amsterdam') + interval '18 hours'
                    THEN interval '7 days' ELSE interval '0' END) AT TIME ZONE 'Europe/Amsterdam')::text AS at`)).rows[0]!;
  return new Date(r.at);
}

type PlayerInputRow = { id: string; role: string | null; career_status: string; previous_cents: string | null };

/** Compute a DRAFT run for all players and run the automatic checks. */
export async function createValuationRun(db: Db, actor: Actor | null, input: { informationAsOf?: Date; scheduledPublishAt?: Date } = {}): Promise<{ runId: string; status: string; values: number; noValue: number }> {
  if (actor) requirePermission(actor, "valuation.prepare");
  const asOf = input.informationAsOf ?? new Date();
  const model = (await db.execute<{ id: string; version_key: string }>(sql`
    SELECT id, version_key FROM valuation_model_versions WHERE version_key = ${DEMO_MODEL_KEY} AND status = 'APPROVED'`)).rows[0];
  if (!model) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Er is geen goedgekeurde modelversie." });
  const scheduled = input.scheduledPublishAt ?? (await nextPublicationSlot(db, asOf));

  const players = (await db.execute<PlayerInputRow>(sql`
    SELECT p.id,
           (SELECT r.role FROM player_roles r WHERE r.player_id = p.id AND r.valid_to IS NULL ORDER BY r.weight DESC, r.valid_from DESC LIMIT 1) AS role,
           p.career_status::text, prv.amount_cents AS previous_cents
      FROM players p LEFT JOIN public_reference_values prv ON prv.player_id = p.id ORDER BY p.id`)).rows;
  const ext = (await db.execute<{ player_id: string; amount_cents: string; as_of: string; known_at: string }>(sql`
    SELECT player_id, amount_cents, as_of::text, known_at::text FROM external_valuations`)).rows;
  // Latest version of each player's match line.
  const stats = (await db.execute<{ player_id: string; kickoff_at: string; minutes: number | null; stats: Record<string, number>; source_as_of: string }>(sql`
    SELECT DISTINCT ON (s.player_id, s.fixture_id) s.player_id, f.kickoff_at::text, s.minutes, s.stats, s.source_as_of::text
      FROM player_match_stats s JOIN fixtures f ON f.id = s.fixture_id
     WHERE f.kickoff_at IS NOT NULL
     ORDER BY s.player_id, s.fixture_id, s.version DESC`)).rows;
  const extBy = new Map<string, typeof ext>();
  for (const e of ext) extBy.set(e.player_id, [...(extBy.get(e.player_id) ?? []), e]);
  const statsBy = new Map<string, typeof stats>();
  for (const m of stats) statsBy.set(m.player_id, [...(statsBy.get(m.player_id) ?? []), m]);

  return db.transaction(async (tx) => {
    const run = (await tx.execute<{ id: string }>(sql`
      INSERT INTO valuation_runs(model_version_id, scope, data_version, information_as_of, status, created_by, scheduled_publish_at)
      VALUES (${model.id}, 'all', ${`db-${asOf.toISOString()}`}, ${asOf.toISOString()}::timestamptz, 'DRAFT', ${actor?.id ?? null}, ${scheduled.toISOString()}::timestamptz)
      RETURNING id`)).rows[0]!;
    const outputs: { amountCents: number; warnings: string[] }[] = [];
    let noValue = 0;
    const digest = createHash("sha256");
    for (const p of players) {
      const matches: MatchInput[] = (statsBy.get(p.id) ?? []).map((m) => ({
        kickoffAt: new Date(m.kickoff_at), knownAt: new Date(m.source_as_of), minutes: m.minutes,
        goals: typeof m.stats.goals === "number" ? m.stats.goals : null, assists: typeof m.stats.assists === "number" ? m.stats.assists : null,
      }));
      const inputs = {
        role: p.role, careerStatus: p.career_status,
        externalValues: (extBy.get(p.id) ?? []).map((e) => ({ amountCents: Number(e.amount_cents), asOf: e.as_of, knownAt: e.known_at })),
        matches: matches.map((m) => ({ kickoffAt: m.kickoffAt.toISOString(), minutes: m.minutes, goals: m.goals, assists: m.assists })),
        previousCents: p.previous_cents === null ? null : Number(p.previous_cents),
      };
      digest.update(JSON.stringify([p.id, inputs]));
      const out = computeDemoReference({
        playerId: p.id, role: (p.role as ValuationRole | null) ?? null, careerStatus: p.career_status as "ACTIVE",
        externalValues: inputs.externalValues.map((e) => ({ amountCents: e.amountCents, asOf: new Date(e.asOf), knownAt: new Date(e.knownAt) })),
        matches, previousCents: inputs.previousCents,
      }, asOf);
      if (out.kind === "NO_VALUE") {
        noValue++;
        continue;
      }
      const amount = out.amount;
      const explanations = out.kind === "VALUE" ? out.explanations : [{ title: "Historische referentie", detail: "De speler is gestopt; dit is de laatste referentiewaarde." }];
      await tx.execute(sql`
        INSERT INTO player_reference_values(player_id, run_id, amount_cents, confidence, explanations, warnings, is_historical, inputs, components, previous_cents)
        VALUES (${p.id}, ${run.id}, ${amount}, ${out.kind === "VALUE" ? out.confidence : "LOW"}, ${JSON.stringify(explanations)}::jsonb, ${JSON.stringify(out.warnings)}::jsonb,
                ${out.kind === "HISTORICAL"}, ${JSON.stringify(inputs)}::jsonb, ${JSON.stringify(out.kind === "VALUE" ? out.components : {})}::jsonb, ${inputs.previousCents})`);
      outputs.push({ amountCents: amount, warnings: out.warnings });
    }
    const check = validateRunOutputs(outputs);
    const changed = (await tx.execute<{ up: number; down: number; same: number }>(sql`
      SELECT count(*) FILTER (WHERE amount_cents > previous_cents)::int AS up, count(*) FILTER (WHERE amount_cents < previous_cents)::int AS down,
             count(*) FILTER (WHERE amount_cents = previous_cents)::int AS same FROM player_reference_values WHERE run_id = ${run.id}`)).rows[0]!;
    const status = check.ok ? "VALIDATED" : "FAILED";
    await tx.execute(sql`
      UPDATE valuation_runs SET status = ${status}, computed_at = now(), input_snapshot_ref = ${digest.digest("hex")},
             checks = ${JSON.stringify(check)}::jsonb,
             summary = ${JSON.stringify({ values: outputs.length, noValue, players: players.length, ...changed })}::jsonb
       WHERE id = ${run.id}`);
    await writeAudit(tx, { actorId: actor?.id ?? null, actorKind: actor ? "ADMIN" : "SYSTEM", action: "VALUATION_RUN_CREATED", reason: actor ? "Conceptrun aangemaakt" : null, entityType: "valuation_run", entityId: run.id, related: { status, values: outputs.length, noValue } });
    return { runId: run.id, status, values: outputs.length, noValue };
  });
}

/** Review by a second person: approve or reject a validated run. */
export async function reviewValuationRun(db: Db, actor: Actor, input: { runId: string; decision: "APPROVE" | "REJECT"; reason: string }): Promise<void> {
  requirePermission(actor, "approvals.decide");
  const reason = input.reason.trim();
  if (reason.length < 5) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Geef een toelichting van minimaal 5 tekens." });
  await db.transaction(async (tx) => {
    const r = (await tx.execute<{ status: string; created_by: string | null }>(sql`SELECT status::text, created_by FROM valuation_runs WHERE id = ${input.runId} FOR UPDATE`)).rows[0];
    if (!r || r.status !== "VALIDATED") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Alleen een gecontroleerde conceptrun kan worden beoordeeld." });
    if (r.created_by === actor.id) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Je kunt je eigen run niet beoordelen." });
    await tx.execute(sql`INSERT INTO valuation_reviews(run_id, decision, actor_id, reason) VALUES (${input.runId}, ${input.decision}, ${actor.id}, ${reason})`);
    if (input.decision === "APPROVE") {
      await tx.execute(sql`UPDATE valuation_runs SET status = 'APPROVED', approved_by = ${actor.id}, approved_at = now() WHERE id = ${input.runId}`);
    } else {
      await tx.execute(sql`UPDATE valuation_runs SET status = 'REJECTED' WHERE id = ${input.runId}`);
    }
    await writeAudit(tx, { actorId: actor.id, actorKind: "ADMIN", action: input.decision === "APPROVE" ? "VALUATION_RUN_APPROVED" : "VALUATION_RUN_REJECTED", reason, entityType: "valuation_run", entityId: input.runId });
  });
}

/**
 * Publish an approved run, atomically. Without `now` it only publishes when
 * the scheduled moment has come; the demo may publish at once.
 * Production refuses a demo model.
 */
export async function publishValuationRun(db: Db, actor: Actor | null, mode: AppMode, input: { runId: string; now?: boolean }): Promise<boolean> {
  if (actor) requirePermission(actor, "valuation.publish");
  if (input.now && mode !== "demo") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Direct publiceren kan alleen in de demo; productie volgt de planning." });
  return db.transaction(async (tx) => {
    const r = (await tx.execute<{ status: string; due: boolean; is_demo: boolean }>(sql`
      SELECT vr.status::text, vr.scheduled_publish_at <= now() AS due, mv.is_demo
        FROM valuation_runs vr JOIN valuation_model_versions mv ON mv.id = vr.model_version_id WHERE vr.id = ${input.runId} FOR UPDATE OF vr`)).rows[0];
    if (!r || r.status !== "APPROVED") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Alleen een goedgekeurde run kan worden gepubliceerd." });
    if (mode === "production" && r.is_demo) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Een demomodel wordt nooit in productie gepubliceerd." });
    if (!input.now && !r.due) return false;
    await tx.execute(sql`UPDATE valuation_runs SET status = 'PUBLISHED', published_at = now() WHERE id = ${input.runId}`);
    await writeAudit(tx, { actorId: actor?.id ?? null, actorKind: actor ? "ADMIN" : "SYSTEM", action: "VALUATION_RUN_PUBLISHED", reason: actor ? "Gepubliceerd na goedkeuring" : null, entityType: "valuation_run", entityId: input.runId });
    return true;
  });
}

/**
 * Worker job (BR-08 planning): on Monday from 12:00 Amsterdam a draft run for
 * this week is prepared if none exists; approved runs are published when their
 * moment (Monday 18:00) has come. Nothing is published without approval.
 */
export async function valuationCycle(db: Db, mode: AppMode, now = new Date()): Promise<{ created: boolean; published: number }> {
  const local = (await db.execute<{ dow: number; hour: number }>(sql`
    SELECT extract(isodow FROM ${now.toISOString()}::timestamptz AT TIME ZONE 'Europe/Amsterdam')::int AS dow,
           extract(hour FROM ${now.toISOString()}::timestamptz AT TIME ZONE 'Europe/Amsterdam')::int AS hour`)).rows[0]!;
  let created = false;
  if (local.dow === 1 && local.hour >= 12) {
    const slot = await nextPublicationSlot(db, new Date(now.getTime() - 7 * 3_600_000));
    const exists = (await db.execute(sql`SELECT 1 FROM valuation_runs WHERE scheduled_publish_at = ${slot.toISOString()}::timestamptz`)).rows.length;
    if (!exists) {
      await createValuationRun(db, null, { informationAsOf: now, scheduledPublishAt: slot });
      created = true;
    }
  }
  const due = (await db.execute<{ id: string }>(sql`SELECT id FROM valuation_runs WHERE status = 'APPROVED' AND scheduled_publish_at <= now()`)).rows;
  let published = 0;
  for (const r of due) if (await publishValuationRun(db, null, mode, { runId: r.id })) published++;
  return { created, published };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function listValuationRuns(db: Executor, limit = 20) {
  return (await db.execute<{ id: string; status: string; version_key: string; is_demo: boolean; information_as_of: string; computed_at: string | null; published_at: string | null;
    scheduled_publish_at: string | null; created_by: string | null; creator: string | null; approver: string | null; checks: { ok?: boolean; errors?: string[]; flaggedLargeChanges?: number }; summary: Record<string, number> }>(sql`
    SELECT vr.id, vr.status::text, mv.version_key, mv.is_demo, vr.information_as_of::text, vr.computed_at::text, vr.published_at::text, vr.scheduled_publish_at::text,
           vr.created_by, cu.display_name AS creator, au.display_name AS approver, vr.checks, vr.summary
      FROM valuation_runs vr JOIN valuation_model_versions mv ON mv.id = vr.model_version_id
      LEFT JOIN user_profiles cu ON cu.user_id = vr.created_by LEFT JOIN user_profiles au ON au.user_id = vr.approved_by
     ORDER BY vr.information_as_of DESC, vr.created_at DESC LIMIT ${limit}`)).rows;
}

/** Admin review: the largest changes and every warning of a run (internal, never public). */
export async function runChanges(db: Executor, runId: string, limit = 25) {
  return (await db.execute<{ player_id: string; name: string; amount_cents: string; previous_cents: string | null; confidence: string; warnings: string[]; is_historical: boolean }>(sql`
    SELECT v.player_id, p.display_name AS name, v.amount_cents, v.previous_cents, v.confidence, v.warnings, v.is_historical
      FROM player_reference_values v JOIN players p ON p.id = v.player_id
     WHERE v.run_id = ${runId}
     ORDER BY CASE WHEN v.previous_cents IS NULL OR v.previous_cents = 0 THEN 0 ELSE abs(v.amount_cents - v.previous_cents)::numeric / v.previous_cents END DESC, p.display_name
     LIMIT ${limit}`)).rows;
}

/** For the change column: per player the latest and the one before (published runs only). */
export async function publishedReferenceHistory(db: Executor): Promise<Map<string, { previous: number | null; explanations: { title: string; detail: string }[]; confidence: string; informationAsOf: string }>> {
  const r = await db.execute<{ player_id: string; amount_cents: string; explanations: { title: string; detail: string }[]; confidence: string; information_as_of: string; rn: number }>(sql`
    SELECT * FROM (
      SELECT v.player_id, v.amount_cents, v.explanations, v.confidence, vr.information_as_of::text,
             row_number() OVER (PARTITION BY v.player_id ORDER BY vr.published_at DESC)::int AS rn
        FROM player_reference_values v JOIN valuation_runs vr ON vr.id = v.run_id AND vr.status = 'PUBLISHED'
    ) x WHERE rn <= 2`);
  const out = new Map<string, { previous: number | null; explanations: { title: string; detail: string }[]; confidence: string; informationAsOf: string }>();
  for (const row of r.rows.filter((x) => x.rn === 1)) out.set(row.player_id, { previous: null, explanations: row.explanations, confidence: row.confidence, informationAsOf: row.information_as_of });
  for (const row of r.rows.filter((x) => x.rn === 2)) {
    const cur = out.get(row.player_id);
    if (cur) cur.previous = Number(row.amount_cents);
  }
  return out;
}

/** Recent matches per player for the profile (latest stats version per fixture). */
export async function recentMatches(db: Executor, playerIds?: string[], perPlayer = 5) {
  const filter = playerIds ? sql`AND s.player_id = ANY(${`{${playerIds.join(",")}}`}::uuid[])` : sql``;
  const r = await db.execute<{ player_id: string; home: string; away: string; kickoff_at: string; minutes: number | null; stats: Record<string, number>; rn: number }>(sql`
    SELECT * FROM (
      SELECT x.*, row_number() OVER (PARTITION BY x.player_id ORDER BY x.kickoff_at DESC)::int AS rn FROM (
        SELECT DISTINCT ON (s.player_id, s.fixture_id) s.player_id, ht.name AS home, at.name AS away, f.kickoff_at::text, s.minutes, s.stats
          FROM player_match_stats s JOIN fixtures f ON f.id = s.fixture_id
          JOIN teams ht ON ht.id = f.home_team_id JOIN teams at ON at.id = f.away_team_id
         WHERE f.kickoff_at <= now() ${filter}
         ORDER BY s.player_id, s.fixture_id, s.version DESC) x
    ) y WHERE rn <= ${perPlayer}`);
  const out = new Map<string, { fixture: string; minutes: number | null; goals: number | null; assists: number | null; playedAt: Date }[]>();
  for (const m of r.rows) {
    const list = out.get(m.player_id) ?? [];
    list.push({ fixture: `${m.home} – ${m.away}`, minutes: m.minutes, goals: typeof m.stats.goals === "number" ? m.stats.goals : null, assists: typeof m.stats.assists === "number" ? m.stats.assists : null, playedAt: new Date(m.kickoff_at) });
    out.set(m.player_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime());
  return out;
}
