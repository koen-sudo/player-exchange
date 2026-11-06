/**
 * Retention (docs/10 "Afscherming en bewaartermijn voor raw datasets").
 * Raw provider pages are kept until `retain_until` (R-24: 90 days until the
 * data licence sets the term, O-03), then removed. Money, ownership and audit
 * records are never removed here.
 */
import { sql } from "drizzle-orm";
import type { Executor } from "./client.ts";
import { pruneRateLimits } from "./rate-limit.ts";

export async function applyRetention(db: Executor): Promise<{ importSnapshots: number; rateLimitWindows: number }> {
  const snaps = await db.execute(sql`
    DELETE FROM import_snapshots s
     WHERE s.retain_until < now()
       AND NOT EXISTS (SELECT 1 FROM import_runs r WHERE r.id = s.run_id AND r.status IN ('QUEUED','RUNNING','PAUSED'))`);
  return { importSnapshots: snaps.rowCount ?? 0, rateLimitWindows: await pruneRateLimits(db) };
}
