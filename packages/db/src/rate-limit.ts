/**
 * Fixed-window rate limiting in PostgreSQL: one atomic upsert per attempt, so
 * all web instances share the limit and concurrent requests cannot slip past
 * it. A refused attempt still counts (a script gains nothing by retrying).
 */
import { sql } from "drizzle-orm";
import { DomainError, RATE_LIMITS, type RateLimitedAction } from "@px/domain";
import type { Executor } from "./client.ts";

export async function hitRateLimit(db: Executor, action: RateLimitedAction, subject: string): Promise<{ hits: number; limit: number }> {
  const { limit, windowSeconds } = RATE_LIMITS[action];
  const bucket = `${action}:${subject}`;
  const r = await db.execute<{ hits: number }>(sql`
    INSERT INTO rate_limit_hits(bucket, window_start, hits)
    VALUES (${bucket}, to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}) * ${windowSeconds}), 1)
    ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limit_hits.hits + 1
    RETURNING hits`);
  const hits = Number(r.rows[0]!.hits);
  if (hits > limit) throw new DomainError("RATE_LIMITED", { detail: `${action} ${hits}/${limit}` });
  return { hits, limit };
}

/** Old windows are only bookkeeping; the worker removes them daily. */
export async function pruneRateLimits(db: Executor): Promise<number> {
  const r = await db.execute(sql`DELETE FROM rate_limit_hits WHERE window_start < now() - interval '1 day'`);
  return r.rowCount ?? 0;
}
