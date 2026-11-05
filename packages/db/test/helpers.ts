/**
 * Integration-test databases on a real PostgreSQL.
 *
 * A template database is built once per migration set (and optionally once
 * with the demo seed). Each test file clones its own database from the
 * template, so tests are isolated and fast. Connection settings come from
 * PGHOST/PGPORT/PGUSER/PGPASSWORD (defaults: localhost, px/px).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { seedSql } from "@px/demo/seed";
import { createDb, type DbHandle } from "../src/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

const conn = () => ({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "px",
  password: process.env.PGPASSWORD ?? "px",
});

export function urlFor(database: string): string {
  const c = conn();
  return `postgres://${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${database}`;
}

function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort().map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));
}

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ ...conn(), database: "postgres" });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function ensureTemplate(seeded: boolean): Promise<string> {
  const files = migrationFiles();
  const hash = createHash("sha256").update(files.map((f) => f.sql).join("\n")).update(seeded ? seedSql() : "").digest("hex").slice(0, 12);
  const name = `px_tpl_${seeded ? "seed" : "empty"}_${hash}`;
  await admin(async (c) => {
    // Serialise template creation across parallel test workers.
    await c.query("SELECT pg_advisory_lock(hashtext($1))", [name]);
    try {
      const exists = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      if (exists.rowCount) return;
      const building = `${name}_build`;
      await c.query(`DROP DATABASE IF EXISTS ${building}`);
      await c.query(`CREATE DATABASE ${building}`);
      const t = new pg.Client({ ...conn(), database: building });
      await t.connect();
      try {
        for (const f of files) await t.query(f.sql);
        if (seeded) await t.query(seedSql());
      } finally {
        await t.end();
      }
      await c.query(`ALTER DATABASE ${building} RENAME TO ${name}`);
    } finally {
      await c.query("SELECT pg_advisory_unlock(hashtext($1))", [name]);
    }
  });
  return name;
}

export type TestDb = DbHandle & { name: string; url: string; drop: () => Promise<void> };

export async function createTestDb(opts: { seeded?: boolean } = {}): Promise<TestDb> {
  const template = await ensureTemplate(opts.seeded ?? false);
  const name = `px_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  await admin((c) => c.query(`CREATE DATABASE ${name} TEMPLATE ${template}`));
  const url = urlFor(name);
  const handle = createDb(url, { max: 5 });
  return {
    ...handle,
    name,
    url,
    drop: async () => {
      await handle.close();
      await admin((c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    },
  };
}
