/**
 * Load and concurrency measurements for docs/09 "Performance" (fase 9).
 *
 *   PGHOST=… PGUSER=… PGPASSWORD=… node packages/db/perf/load.ts [--keep]
 *
 * Builds a fresh database from the migrations and the demo seed, adds
 * fictitious players up to 10,000 in the catalogue, and measures:
 *  1. market queries (the indexed catalogue query behind /api/v1/players and
 *     /markt) for several filters;
 *  2. order acceptance (server preview + placement with a cash hold, the
 *     payment simulator in the same database, so no provider latency);
 *  3. 100 simultaneous order requests on one market, followed by matching
 *     and settlement, and then every money, order and inventory invariant.
 * Prints a JSON report. With --keep the database stays for HTTP measurements.
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import { sql } from "drizzle-orm";
import { createDb } from "../src/client.ts";
import { listCatalogPlayers } from "../src/catalog-read.ts";
import { book, ledgerInvariants, postings } from "../src/ledger.ts";
import { inventoryInvariants } from "../src/inventory.ts";
import { createPaymentSimulator } from "../src/payment-simulator.ts";
import { handlePaymentWebhook, type PaymentsCtx } from "../src/payments.ts";
import { createOrderPreview, placeOrder, runMarket, tradingInvariants } from "../src/trading.ts";
import { createTestDb } from "../test/helpers.ts";

const TARGET_PLAYERS = 10_000;
const keep = process.argv.includes("--keep");

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]! * 10) / 10;
};
const summary = (xs: number[]) => ({ n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), max: pct(xs, 100) });
async function timed<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const t0 = performance.now();
  const r = await fn();
  return [performance.now() - t0, r];
}

const t = await createTestDb({ seeded: true });
const big = createDb(t.url, { max: 20 });
const db = big.db;
const report: Record<string, unknown> = {
  hardware: { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, memoryGb: Math.round(os.totalmem() / 2 ** 30), node: process.version },
  database: (await db.execute<{ v: string }>(sql`SELECT version() AS v`)).rows[0]!.v.split(",")[0],
};

try {
  // ---------------------------------------------------------------- dataset
  const existing = Number((await db.execute<{ n: string }>(sql`SELECT count(*) n FROM players`)).rows[0]!.n);
  const extra = TARGET_PLAYERS - existing;
  await db.execute(sql`
    WITH t AS (SELECT id, row_number() OVER (ORDER BY id) - 1 AS i, count(*) OVER () AS n FROM teams),
    names AS (
      SELECT g,
             (ARRAY['Daan','Sem','Milan','Levi','Luuk','Finn','Jesse','Thijs','Ruben','Stijn','Mats','Jens','Bas','Koen','Tim'])[1 + g % 15] || ' ' ||
             (ARRAY['Bakker','Visser','Smit','Meijer','de Boer','Mulder','de Groot','Bos','Vos','Peters','Hendriks','Dekker','Brouwer','van Dijk','Kok'])[1 + (g / 15) % 15] ||
             ' ' || g AS name
        FROM generate_series(1, ${extra}::int) g
    ), ins AS (
      INSERT INTO players(id, display_name, birth_date, nationality, data_quality, primary_admission, is_fictional)
      SELECT gen_random_uuid(), name, date '1990-01-01' + (g % 5000), 'NL', 'OK', 'INELIGIBLE', true FROM names
      RETURNING id, display_name
    ), numbered AS (SELECT id, row_number() OVER (ORDER BY id) AS k FROM ins),
    m AS (
      INSERT INTO player_team_memberships(player_id, team_id, membership_type, valid_from)
      SELECT n.id, t.id, 'FIRST_TEAM', '2026-07-01' FROM numbered n JOIN t ON t.i = n.k % t.n
      RETURNING player_id
    ), r AS (
      INSERT INTO player_roles(player_id, role, source, valid_from)
      SELECT id, (ARRAY['GOALKEEPER','CENTRE_BACK','FULL_BACK','DEFENSIVE_MIDFIELDER','CENTRAL_MIDFIELDER','WINGER','STRIKER'])[1 + k % 7], 'perf', '2026-07-01' FROM numbered
      RETURNING player_id
    )
    INSERT INTO player_markets(player_id, status)
    SELECT id, CASE WHEN k % 5 = 0 THEN 'OPEN'::market_status ELSE 'PROFILE_ONLY'::market_status END FROM numbered`);
  await db.execute(sql`ANALYZE`);
  const players = Number((await db.execute<{ n: string }>(sql`SELECT count(*) n FROM players`)).rows[0]!.n);
  const comp = (await db.execute<{ id: string }>(sql`SELECT id FROM competitions ORDER BY name LIMIT 1`)).rows[0]!.id;
  report.dataset = { players, teams: Number((await db.execute<{ n: string }>(sql`SELECT count(*) n FROM teams`)).rows[0]!.n), fictitiousAdded: extra };

  // ---------------------------------------------------------- 1. market queries
  const cases: Record<string, Parameters<typeof listCatalogPlayers>[1]> = {
    "eerste pagina, geen filter": {},
    "zoeken op naam ('vis')": { q: "vis" },
    "competitie": { competitionId: comp },
    "rol aanvaller": { role: "STRIKER" },
    "verhandelbaar": { marketStatus: "TRADABLE" },
    "leeftijd 21–25 + rol": { minAge: 21, maxAge: 25, role: "WINGER" },
  };
  const market: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(cases)) {
    for (let i = 0; i < 10; i++) await listCatalogPlayers(db, f); // warm-up
    const xs: number[] = [];
    for (let i = 0; i < 200; i++) xs.push((await timed(() => listCatalogPlayers(db, f)))[0]);
    market[name] = summary(xs);
  }
  // Deep pagination: walk 20 pages with the cursor.
  {
    const xs: number[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const [ms, page] = await timed(() => listCatalogPlayers(db, { cursor, limit: 50 }));
      xs.push(ms);
      cursor = page.nextCursor;
    }
    market["pagina 1–20 via cursor"] = summary(xs);
  }
  report.marketQueryMs = market;

  // ------------------------------------------------------ test market + traders
  const playerId = randomUUID();
  await db.execute(sql`INSERT INTO players(id, display_name, is_fictional) VALUES (${playerId}, 'Perfspeler', true)`);
  const marketId = (await db.execute<{ id: string }>(sql`INSERT INTO player_markets(player_id, status) VALUES (${playerId}, 'OPEN') RETURNING id`)).rows[0]!.id;
  const edition = (await db.execute<{ id: string }>(sql`INSERT INTO editions(player_id, season_key) VALUES (${playerId}, '2026-2027') RETURNING id`)).rows[0]!.id;
  await db.execute(sql`INSERT INTO issuance_programs(edition_id, version, planned_total, status, published_at, is_opening_balance) VALUES (${edition}, 1, 400, 'PUBLISHED', now(), true)`);
  let serial = 0;
  async function trader(name: string, euros: number, cards: number): Promise<string> {
    const id = randomUUID();
    await db.execute(sql`INSERT INTO users(id, auth_subject, is_test_account) VALUES (${id}, ${`perf:${name}:${id}`}, true)`);
    await db.execute(sql`INSERT INTO user_profiles(user_id, display_name, residence_country, verification_status, age_confirmed) VALUES (${id}, ${name}, 'NL', 'VERIFIED', true)`);
    await db.execute(sql`INSERT INTO terms_acceptances(user_id, document_key, document_version) SELECT ${id}, document_key, document_version FROM terms_documents WHERE is_current`);
    if (euros) await db.transaction((tx) => book(tx, "demo", "perf", postings.openingBalance(id, euros * 100, "perf")));
    if (cards) {
      const from = serial;
      serial += cards;
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO cards(edition_id, player_id, serial_number, status, owner_user_id, cost_basis_cents)
          SELECT ${edition}, ${playerId}, g, 'OWNED', ${id}, 300 FROM generate_series(${from + 1}::int, ${from + cards}::int) g`);
        await tx.execute(sql`
          INSERT INTO ownership_events(card_id, new_owner_id, cause, reference, cost_basis_cents)
          SELECT id, owner_user_id, 'OPENING_BALANCE', 'perf', 300 FROM cards WHERE edition_id = ${edition} AND owner_user_id = ${id}`);
      });
    }
    return id;
  }
  const sim = createPaymentSimulator(db, { secret: "perf", delaySeconds: 0 });
  const ctx: PaymentsCtx = { db, provider: sim, providerName: "demo", mode: "demo" };
  const place = async (user: string, side: "BUY" | "SELL", price: number) => {
    const p = await createOrderPreview(db, "demo", user, { side, playerId, quantity: 1, limitPriceMinor: String(price), timeInForce: "SEVEN_DAYS" });
    return placeOrder(ctx, user, { previewId: p.previewId, requestKey: randomUUID() });
  };

  // ---------------------------------------------------- 2. order acceptance
  {
    const buyers = await Promise.all(Array.from({ length: 50 }, (_, i) => trader(`koper${i}`, 1000, 0)));
    const sellers = await Promise.all(Array.from({ length: 20 }, (_, i) => trader(`verkoper${i}`, 0, 10)));
    const xs: number[] = [];
    // Non-crossing prices: buys 1,00–2,99, sells 50,00+, so we measure acceptance only.
    for (let i = 0; i < 200; i++) {
      const buy = i % 4 !== 3;
      const user = buy ? buyers[i % 50]! : sellers[i % 20]!;
      xs.push((await timed(() => place(user, buy ? "BUY" : "SELL", buy ? 100 + (i % 200) : 5000 + i)))[0]);
    }
    report.orderAcceptanceMs = summary(xs);
    await db.execute(sql`UPDATE orders SET state = state WHERE false`);
  }

  // -------------------------------------- 3. 100 simultaneous requests, one market
  {
    const sellers = await Promise.all(Array.from({ length: 50 }, (_, i) => trader(`s${i}`, 0, 1)));
    const buyers = await Promise.all(Array.from({ length: 50 }, (_, i) => trader(`b${i}`, 100, 0)));
    // Everything crosses at 30,00–30,49 (above the resting buys, below the resting sells).
    const reqs = [
      ...sellers.map((u, i) => () => place(u, "SELL", 3000 + (i % 50))),
      ...buyers.map((u) => () => place(u, "BUY", 3049)),
    ].sort(() => Math.random() - 0.5);
    const t0 = performance.now();
    const results = await Promise.allSettled(reqs.map((r) => r()));
    const wall = performance.now() - t0;
    const rejected = results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.code ?? (r as PromiseRejectedResult).reason));
    // Matching and settlement as the worker does it (webhooks delivered in-process).
    for (let round = 0; round < 200; round++) {
      const done = await runMarket(ctx, marketId, 200);
      const delivered = await sim.deliverDue(async (headers, rawBody) => void (await handlePaymentWebhook(ctx, { headers, rawBody })));
      if (!done.length && !delivered) break;
    }
    const exec = (await db.execute<{ status: string; n: string }>(sql`
      SELECT x.status::text, count(*) n FROM executions x JOIN orders o ON o.id = x.buy_order_id WHERE o.player_market_id = ${marketId} AND o.limit_price_cents = 3049 GROUP BY 1`)).rows;
    const ownersOk = (await db.execute<{ n: string }>(sql`
      SELECT count(*) n FROM cards c WHERE c.edition_id = ${edition}
         AND c.owner_user_id <> (SELECT e.new_owner_id FROM ownership_events e WHERE e.card_id = c.id ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1)`)).rows[0]!.n;
    report.concurrency = {
      requests: reqs.length,
      wallClockMs: Math.round(wall),
      accepted: results.length - rejected.length,
      rejected,
      executionsByStatus: Object.fromEntries(exec.map((r) => [r.status, Number(r.n)])),
      cardsWithOwnerNotMatchingLastEvent: Number(ownersOk),
      ledger: await ledgerInvariants(db),
      trading: await tradingInvariants(db),
      inventory: await inventoryInvariants(db),
    };
  }
} finally {
  await big.close();
  if (keep) {
    console.error(`Database bewaard: ${t.url}`);
    await t.close();
  } else {
    await t.drop();
  }
}
console.log(JSON.stringify(report, null, 2));
