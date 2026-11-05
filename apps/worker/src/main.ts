/**
 * Worker process (docs/04, docs/07 "Achtergrondtaken").
 *
 * Fase 0: process skeleton with configuration guard, job registry, graceful
 * shutdown and a health heartbeat. Jobs are registered with their planned
 * schedule; their bodies are implemented in the fases listed. BullMQ/Redis are
 * wired in when packages are installable. Redis is never the source of truth
 * for money, ownership or final order status: every job re-reads PostgreSQL
 * and protects double work with database unique keys.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, type AppConfig } from "@px/integrations/env";
import type { FootballDataProvider } from "@px/integrations";
import { claimNextRun, getDb, runCatalogImport, type Db } from "@px/db";
import { createFixtureProvider } from "@px/demo";

export type JobDefinition = {
  name: string;
  schedule: string; // human-readable plan; the scheduler stores UTC instants
  fase: number;
  run: () => Promise<void>;
};

const notYet = (fase: number) => async () => {
  throw new Error(`job body is implemented in fase ${fase}`);
};

export const JOBS: JobDefinition[] = [
  { name: "catalog.sync", schedule: "continu: ingeplande en onderbroken imports (database als wachtrij)", fase: 2, run: async () => undefined },
  { name: "fixtures.sync", schedule: "periodiek en na wedstrijdupdates", fase: 2, run: notYet(2) },
  { name: "external-valuations.check", schedule: "dagelijks", fase: 7, run: notYet(7) },
  { name: "valuation.weekly-run", schedule: "maandag 18.00 Europe/Amsterdam, na controle", fase: 7, run: notYet(7) },
  { name: "drops.open-close", schedule: "op vastgelegde UTC-tijdstippen", fase: 6, run: notYet(6) },
  { name: "orders.expire", schedule: "periodiek", fase: 5, run: notYet(5) },
  { name: "settlement.poll", schedule: "volgens status en providerlimieten", fase: 5, run: notYet(5) },
  { name: "reconciliation.daily", schedule: "minimaal dagelijks", fase: 4, run: notYet(4) },
  { name: "notifications.outbox", schedule: "continu via outbox", fase: 6, run: notYet(6) },
];

/** Supplier adapter for the configured football data provider. */
export function footballProvider(cfg: AppConfig): FootballDataProvider {
  if (cfg.adapters.footballData === "fixture") return createFixtureProvider();
  throw new Error(`football data provider "${cfg.adapters.footballData}" is not implemented yet (O-03)`);
}

/**
 * One polling cycle: claim a queued run (or one whose worker died) and run it.
 * Returns the run id it worked on, or null when there was nothing to do.
 */
export async function catalogSyncOnce(db: Db, provider: FootballDataProvider): Promise<string | null> {
  const runId = await claimNextRun(db);
  if (!runId) return null;
  try {
    const stats = await runCatalogImport(db, runId, provider);
    console.log(JSON.stringify({ level: "info", msg: "catalog import completed", runId, stats }));
  } catch (e) {
    // The run is marked FAILED with the error; completed steps are kept for a retry.
    console.error(JSON.stringify({ level: "error", msg: "catalog import failed", runId, error: (e as Error).message }));
  }
  return runId;
}

export function startWorker(env: Readonly<Record<string, string | undefined>> = process.env, opts: { pollMs?: number; db?: Db } = {}) {
  const cfg = loadConfig(env); // throws on invalid/unsafe configuration (AT-35)
  let stopping = false;
  let busy = false;
  const pollMs = opts.pollMs ?? 5_000;
  const poll = opts.pollMs === 0 ? null : setInterval(async () => {
    if (stopping || busy) return;
    busy = true;
    try {
      const db = opts.db ?? getDb(cfg.databaseUrl).db;
      await catalogSyncOnce(db, footballProvider(cfg));
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "catalog poll failed", error: (e as Error).message }));
    } finally {
      busy = false;
    }
  }, pollMs);
  const heartbeat = setInterval(() => {
    if (!stopping) console.log(JSON.stringify({ level: "info", msg: "worker heartbeat", mode: cfg.mode, jobs: JOBS.length, at: new Date().toISOString() }));
  }, 30_000);
  const stop = (signal: string) => {
    stopping = true;
    clearInterval(heartbeat);
    if (poll) clearInterval(poll);
    console.log(JSON.stringify({ level: "info", msg: "worker stopping", signal }));
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
  console.log(JSON.stringify({ level: "info", msg: "worker started", mode: cfg.mode, jobs: JOBS.map((j) => `${j.name} (fase ${j.fase})`) }));
  return { stop: () => stop("manual"), config: cfg };
}

function isMainModule(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    startWorker();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
