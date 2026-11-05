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
import { claimNextRun, dropsCycle, expireOrders, getDb, marketsToMatch, paymentsContext, pollOpenOperations, runCatalogImport, runMarket, runReconciliation, type Db, type PaymentsCtx } from "@px/db";
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
  { name: "drops.open-close", schedule: "elke 5 s: openen en sluiten op de vastgelegde UTC-tijdstippen, toewijzen, afwikkelen, wachtlijst", fase: 6, run: async () => undefined },
  { name: "orders.expire", schedule: "elke 5 s: vrije restanten van verlopen orders sluiten", fase: 5, run: async () => undefined },
  { name: "trading.match", schedule: "elke 5 s: markten met een kruisend orderboek en geen open afwikkeling", fase: 5, run: async () => undefined },
  { name: "payments.poll", schedule: "elke 5 s: open stortingen/opnames opvragen of opnieuw indienen, wachtende webhooks koppelen", fase: 4, run: async () => undefined },
  { name: "payments.simulator-webhooks", schedule: "alleen demo: elke 5 s de webhooks van de betaalsimulator afleveren", fase: 4, run: async () => undefined },
  { name: "settlement.poll", schedule: "elke 5 s, samen met payments.poll (dezelfde operatietabel)", fase: 5, run: async () => undefined },
  { name: "reconciliation.daily", schedule: "elke 10 min in demo, minimaal dagelijks daarna", fase: 4, run: async () => undefined },
  { name: "notifications.outbox", schedule: "in-app direct uit de outbox; e-mail en push volgen met een notificatieprovider", fase: 6, run: async () => undefined },
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

/**
 * One payments cycle. In demo the simulator's webhooks are delivered over
 * HTTP to the web app, exactly like an external provider would.
 */
export async function paymentsOnce(ctx: PaymentsCtx & { simulator: ReturnType<typeof paymentsContext>["simulator"] }, webhookUrl: string): Promise<{ delivered: number; checked: number; finalised: number }> {
  let delivered = 0;
  if (ctx.simulator) {
    delivered = await ctx.simulator.deliverDue(async (headers, rawBody) => {
      const res = await fetch(webhookUrl, { method: "POST", headers, body: rawBody });
      if (res.status >= 300 && res.status !== 202) throw new Error(`webhook ${res.status}`);
    });
  }
  const polled = await pollOpenOperations(ctx);
  return { delivered, ...polled };
}

/** One trading cycle: expire free remainders, then match markets that cross. */
export async function tradingOnce(ctx: PaymentsCtx): Promise<{ expired: number; markets: number; executions: number }> {
  const expired = await expireOrders(ctx);
  const markets = await marketsToMatch(ctx.db);
  let executions = 0;
  for (const m of markets) executions += (await runMarket(ctx, m)).length;
  return { expired, markets: markets.length, executions };
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
  // Payments: webhook delivery (demo), polling and reconciliation.
  let paying = false;
  const payments = opts.pollMs === 0 ? null : setInterval(async () => {
    if (stopping || paying) return;
    paying = true;
    try {
      const db = opts.db ?? getDb(cfg.databaseUrl).db;
      const ctx = paymentsContext(db, cfg);
      const r = await paymentsOnce(ctx, `${cfg.webBaseUrl}/api/v1/webhooks/payments/demo`);
      if (r.delivered || r.finalised) console.log(JSON.stringify({ level: "info", msg: "payments cycle", ...r }));
      const dr = await dropsCycle(ctx);
      if (dr.opened || dr.allocated) console.log(JSON.stringify({ level: "info", msg: "drops cycle", ...dr }));
      const tr = await tradingOnce(ctx);
      if (tr.expired || tr.executions) console.log(JSON.stringify({ level: "info", msg: "trading cycle", ...tr }));
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "payments cycle failed", error: (e as Error).message }));
    } finally {
      paying = false;
    }
  }, pollMs);
  let reconciling = false;
  const reconcile = opts.pollMs === 0 ? null : setInterval(async () => {
    if (stopping || reconciling) return;
    reconciling = true;
    try {
      const db = opts.db ?? getDb(cfg.databaseUrl).db;
      const ctx = paymentsContext(db, cfg);
      const r = await runReconciliation(db, ctx.provider, ctx.providerName);
      console.log(JSON.stringify({ level: r.outcome === "MATCHED" ? "info" : "warn", msg: "reconciliation", ...r }));
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "reconciliation failed", error: (e as Error).message }));
    } finally {
      reconciling = false;
    }
  }, 10 * 60_000);
  const heartbeat = setInterval(() => {
    if (!stopping) console.log(JSON.stringify({ level: "info", msg: "worker heartbeat", mode: cfg.mode, jobs: JOBS.length, at: new Date().toISOString() }));
  }, 30_000);
  const stop = (signal: string) => {
    stopping = true;
    clearInterval(heartbeat);
    if (poll) clearInterval(poll);
    if (payments) clearInterval(payments);
    if (reconcile) clearInterval(reconcile);
    console.log(JSON.stringify({ level: "info", msg: "worker stopping", signal }));
  };
  // On a signal: stop scheduling, then close the database pool so the process exits.
  const shutdown = (signal: string) => {
    stop(signal);
    const handle = opts.db ? null : getDb(cfg.databaseUrl);
    void (handle ? handle.close() : Promise.resolve()).finally(() => process.exit(0));
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
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
