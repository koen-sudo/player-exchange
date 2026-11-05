/**
 * Database client. One pool per process. All mutations that change money,
 * ownership or authorisation run inside `transaction` (docs/04 Backendregels).
 */
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export type DbHandle = { db: Db; pool: pg.Pool; close: () => Promise<void> };

export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10 });
  // Dates/timestamps are parsed by Drizzle; keep int8 as string from pg (money stays exact).
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

const globalKey = Symbol.for("px.db");
type GlobalWithDb = typeof globalThis & { [globalKey]?: DbHandle };

/** Process-wide handle for the web app and worker (reused across hot reloads). */
export function getDb(url = process.env.DATABASE_URL): DbHandle {
  const g = globalThis as GlobalWithDb;
  if (!url) throw new Error("DATABASE_URL ontbreekt");
  g[globalKey] ??= createDb(url);
  return g[globalKey];
}
