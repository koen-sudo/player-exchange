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
import { loadConfig } from "@px/integrations/env";

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
  { name: "catalog.sync", schedule: "nachtelijks en handmatig", fase: 2, run: notYet(2) },
  { name: "fixtures.sync", schedule: "periodiek en na wedstrijdupdates", fase: 2, run: notYet(2) },
  { name: "external-valuations.check", schedule: "dagelijks", fase: 7, run: notYet(7) },
  { name: "valuation.weekly-run", schedule: "maandag 18.00 Europe/Amsterdam, na controle", fase: 7, run: notYet(7) },
  { name: "drops.open-close", schedule: "op vastgelegde UTC-tijdstippen", fase: 6, run: notYet(6) },
  { name: "orders.expire", schedule: "periodiek", fase: 5, run: notYet(5) },
  { name: "settlement.poll", schedule: "volgens status en providerlimieten", fase: 5, run: notYet(5) },
  { name: "reconciliation.daily", schedule: "minimaal dagelijks", fase: 4, run: notYet(4) },
  { name: "notifications.outbox", schedule: "continu via outbox", fase: 6, run: notYet(6) },
];

export function startWorker(env: Readonly<Record<string, string | undefined>> = process.env) {
  const cfg = loadConfig(env); // throws on invalid/unsafe configuration (AT-35)
  let stopping = false;
  const heartbeat = setInterval(() => {
    if (!stopping) console.log(JSON.stringify({ level: "info", msg: "worker heartbeat", mode: cfg.mode, jobs: JOBS.length, at: new Date().toISOString() }));
  }, 30_000);
  const stop = (signal: string) => {
    stopping = true;
    clearInterval(heartbeat);
    console.log(JSON.stringify({ level: "info", msg: "worker stopping", signal }));
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
  console.log(JSON.stringify({ level: "info", msg: "worker started", mode: cfg.mode, jobs: JOBS.map((j) => `${j.name} (fase ${j.fase})`) }));
  return { stop: () => stop("manual"), config: cfg };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    startWorker();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
