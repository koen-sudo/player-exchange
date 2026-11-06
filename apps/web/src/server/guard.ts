/**
 * Checks in front of every sensitive customer mutation (docs/10):
 * 1. Production only runs on fulfilled gates. If a gate is withdrawn while the
 *    server runs, money and order actions stop within 30 seconds.
 * 2. Per-user rate limits, counted in the database (shared by all instances).
 */
import "server-only";
import { getDb, hitRateLimit, unmetGates } from "@px/db";
import { DomainError, type RateLimitedAction } from "@px/domain";
import { loadConfig } from "@px/integrations/env";

let gateCache: { at: number; unmet: string[] } | null = null;

async function productionGatesMet(): Promise<boolean> {
  if (loadConfig(process.env).mode !== "production") return true;
  if (!gateCache || Date.now() - gateCache.at > 30_000) gateCache = { at: Date.now(), unmet: await unmetGates(getDb().db) };
  return gateCache.unmet.length === 0;
}

export async function guardSensitive(action: RateLimitedAction, userId: string): Promise<void> {
  if (!(await productionGatesMet())) {
    throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Deze functie is nog niet vrijgegeven." });
  }
  await hitRateLimit(getDb().db, action, userId);
}
