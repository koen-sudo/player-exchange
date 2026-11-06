/**
 * Back-up and restore drill (docs/10 "Back-ups en aantoonbare herstelprocedure").
 *
 *   DATABASE_URL=postgres://… node packages/db/ops/restore-check.ts [--keep-dump path]
 *
 * 1. Makes a consistent dump of DATABASE_URL with pg_dump (custom format).
 * 2. Restores it into a new, empty database on the same server.
 * 3. Compares the restore with the source: row counts of every table, ledger
 *    balances, card owners, order quantities and the evidence tables.
 * 4. Runs every money, order, inventory and issuance invariant on the restore
 *    and checks the protective triggers are present and active.
 * 5. Removes the restored database. Exit code 0 only when everything matches.
 * The source database is only read.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "../src/client.ts";
import { issuanceInvariants } from "../src/drops.ts";
import { inventoryInvariants } from "../src/inventory.ts";
import { ledgerInvariants } from "../src/ledger.ts";
import { tradingInvariants } from "../src/trading.ts";

const source = process.env.DATABASE_URL;
if (!source) {
  console.error("DATABASE_URL ontbreekt.");
  process.exit(2);
}
// pg_dump/pg_restore must have the server's major version (a newer client writes
// settings an older server does not know). PG_BIN points at the right tools.
// Either PG_BIN (a directory with the tools) or PG_DOCKER_IMAGE (e.g. postgres:16).
const keepIdx = process.argv.indexOf("--keep-dump");
const dir = mkdtempSync(join(tmpdir(), "px-restore-"));
const dumpFile = keepIdx > 0 ? process.argv[keepIdx + 1]! : join(dir, "px.dump");
function pgTool(tool: string, args: string[]): Buffer {
  const image = process.env.PG_DOCKER_IMAGE;
  if (image) {
    const mount = dirname(dumpFile);
    return execFileSync("docker", ["run", "--rm", "--network", "host", "-v", `${mount}:${mount}`, image, tool, ...args], { stdio: ["ignore", "pipe", "inherit"] });
  }
  return execFileSync(process.env.PG_BIN ? join(process.env.PG_BIN, tool) : tool, args, { stdio: ["ignore", "pipe", "inherit"] });
}
const target = new URL(source);
const restoreName = `px_restore_${Date.now()}`;
const adminUrl = new URL(source);
adminUrl.pathname = "/postgres";
target.pathname = `/${restoreName}`;

async function fingerprint(db: Db) {
  const tables = (await db.execute<{ t: string }>(sql`
    SELECT schemaname || '.' || tablename AS t FROM pg_tables WHERE schemaname IN ('public', 'psp_sim') ORDER BY 1`)).rows.map((r) => r.t);
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = Number((await db.execute<{ n: string }>(sql.raw(`SELECT count(*) AS n FROM ${t}`))).rows[0]!.n);
  const one = async (q: string) => (await db.execute<{ v: string | null }>(sql.raw(q))).rows[0]!.v;
  return {
    counts,
    checks: {
      ledgerBalances: await one(`SELECT md5(string_agg(id::text || ':' || balance_cents, ',' ORDER BY id)) AS v FROM ledger_accounts`),
      journalTotal: await one(`SELECT sum(amount_cents)::text AS v FROM journal_lines`),
      cardOwners: await one(`SELECT md5(string_agg(id::text || ':' || coalesce(owner_user_id::text, '-') || ':' || status, ',' ORDER BY id)) AS v FROM cards`),
      orderQuantities: await one(`SELECT md5(string_agg(id::text || ':' || qty_open || '/' || qty_pending || '/' || qty_filled || '/' || qty_cancelled || '/' || qty_expired, ',' ORDER BY id)) AS v FROM orders`),
      auditTrail: await one(`SELECT md5(string_agg(id::text, ',' ORDER BY id)) AS v FROM audit_events`),
      publishedReferences: await one(`SELECT md5(string_agg(player_id::text || ':' || amount_cents, ',' ORDER BY player_id)) AS v FROM public_reference_values`),
    },
  };
}

const started = Date.now();
const report: Record<string, unknown> = { source: `${new URL(source).host}${new URL(source).pathname}`, restoredAs: restoreName };
let ok = false;
const src = createDb(source, { max: 2 });
const admin = createDb(adminUrl.toString(), { max: 1 });
let restored: ReturnType<typeof createDb> | null = null;
try {
  const serverMajor = Number((await src.db.execute<{ v: string }>(sql`SELECT current_setting('server_version_num') AS v`)).rows[0]!.v.slice(0, -4));
  const clientMajor = Number(/(\d+)\./.exec(pgTool("pg_dump", ["--version"]).toString())?.[1]);
  if (serverMajor !== clientMajor) throw new Error(`pg_dump ${clientMajor} past niet bij server ${serverMajor}; zet PG_BIN op de tools van versie ${serverMajor}, of PG_DOCKER_IMAGE=postgres:${serverMajor}.`);
  const before = await fingerprint(src.db);
  const t0 = Date.now();
  pgTool("pg_dump", ["--format=custom", "--no-owner", "--file", dumpFile, source]);
  report.dump = { seconds: (Date.now() - t0) / 1000, bytes: statSync(dumpFile).size };
  const after = await fingerprint(src.db);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("De brondatabase veranderde tijdens de controle; draai de oefening opnieuw in een rustig moment of op een kopie.");

  const t1 = Date.now();
  await admin.db.execute(sql.raw(`CREATE DATABASE ${restoreName}`));
  pgTool("pg_restore", ["--no-owner", "--exit-on-error", "--dbname", target.toString(), dumpFile]);
  report.restore = { seconds: (Date.now() - t1) / 1000 };
  restored = createDb(target.toString(), { max: 2 });
  const copy = await fingerprint(restored.db);

  const countDiffs = Object.keys({ ...before.counts, ...copy.counts }).filter((t) => before.counts[t] !== copy.counts[t]);
  const checkDiffs = Object.keys(before.checks).filter((k) => before.checks[k as keyof typeof before.checks] !== copy.checks[k as keyof typeof copy.checks]);
  const triggers = (await restored.db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND t.tgenabled <> 'D'`)).rows[0]!.n;
  const sourceTriggers = (await src.db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled <> 'D'`)).rows[0]!.n;
  // An append-only table must still refuse changes after the restore.
  let auditProtected = false;
  try {
    await restored.db.execute(sql`DELETE FROM audit_events WHERE id = (SELECT id FROM audit_events LIMIT 1)`);
  } catch {
    auditProtected = true;
  }
  const invariants = {
    ledger: await ledgerInvariants(restored.db),
    trading: await tradingInvariants(restored.db),
    inventory: await inventoryInvariants(restored.db),
    issuance: await issuanceInvariants(restored.db),
  };
  const allZero = Object.values(invariants).every((group) => Object.values(group).every((v) => v === 0));
  report.tables = Object.keys(before.counts).length;
  report.rows = Object.values(before.counts).reduce((a, b) => a + b, 0);
  report.countDifferences = countDiffs;
  report.checkDifferences = checkDiffs;
  report.triggers = { source: Number(sourceTriggers), restored: Number(triggers) };
  report.appendOnlyStillEnforced = auditProtected;
  report.invariants = invariants;
  ok = countDiffs.length === 0 && checkDiffs.length === 0 && sourceTriggers === triggers && auditProtected && allZero;
} catch (e) {
  report.error = (e as Error).message;
} finally {
  await restored?.close();
  await admin.db.execute(sql.raw(`DROP DATABASE IF EXISTS ${restoreName} WITH (FORCE)`)).catch(() => undefined);
  await admin.close();
  await src.close();
  if (keepIdx < 0) rmSync(dir, { recursive: true, force: true });
}
report.totalSeconds = (Date.now() - started) / 1000;
report.result = ok ? "GESLAAGD" : "MISLUKT";
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 1);
