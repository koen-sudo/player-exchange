import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { listAllPlayersInternal } from "../src/catalog-read.ts";
import { marketPage } from "../src/market-read.ts";
import { orderBookLevels } from "../src/trading.ts";
import { publishedReferenceHistory } from "../src/valuation.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

let t: TestDb;
beforeAll(async () => { t = await createTestDb({ seeded: true }); }, 60_000);
afterAll(async () => t.drop());

describe("market page in SQL (R-69)", () => {
  it("pages through every player exactly once", async () => {
    const all = await listAllPlayersInternal(t.db);
    const first = await marketPage(t.db, { pageSize: 50 });
    assert.equal(first.total, all.length);
    const seen = new Set<string>();
    for (let p = 1; p <= first.pages; p++) for (const r of (await marketPage(t.db, { pageSize: 50, page: p })).rows) seen.add(r.player_id);
    assert.equal(seen.size, all.length);
    const past = await marketPage(t.db, { pageSize: 50, page: 999 });
    assert.equal(past.page, first.pages, "a page past the end shows the last page");
  });

  it("matches the read model for reference, change, bid and ask", async () => {
    const [all, history, levels] = await Promise.all([listAllPlayersInternal(t.db), publishedReferenceHistory(t.db), orderBookLevels(t.db)]);
    const rows = new Map<string, Awaited<ReturnType<typeof marketPage>>["rows"][number]>();
    const first = await marketPage(t.db, { pageSize: 100 });
    for (let p = 1; p <= first.pages; p++) for (const r of (await marketPage(t.db, { pageSize: 100, page: p })).rows) rows.set(r.player_id, r);
    for (const p of all) {
      const r = rows.get(p.id)!;
      assert.equal(r.reference_cents, p.amount_cents, p.display_name);
      const prev = history.get(p.id)?.previous ?? null;
      const change = p.amount_cents !== null && prev !== null ? String(Number(p.amount_cents) - prev) : null;
      assert.equal(r.change_cents, change, `${p.display_name} change`);
      const open = p.market_status === "OPEN";
      const bids = levels.filter((l) => l.player_id === p.id && l.side === "BUY").map((l) => Number(l.price));
      const asks = levels.filter((l) => l.player_id === p.id && l.side === "SELL").map((l) => Number(l.price));
      assert.equal(r.best_bid_cents, open && bids.length ? String(Math.max(...bids)) : null, `${p.display_name} bid`);
      assert.equal(r.best_ask_cents, open && asks.length ? String(Math.min(...asks)) : null, `${p.display_name} ask`);
    }
  });

  it("filters and sorts like the market screen", async () => {
    const noah = await marketPage(t.db, { q: "noah verm" });
    assert.ok(noah.rows.some((r) => r.display_name === "Noah Vermeer"));
    const accent = await marketPage(t.db, { q: "NOAH" });
    assert.equal(accent.total >= 1, true);
    const tradable = await marketPage(t.db, { status: "TRADABLE", pageSize: 100 });
    assert.ok(tradable.total > 0 && tradable.rows.every((r) => r.market_status === "OPEN"));
    const profile = await marketPage(t.db, { status: "PROFILE_ONLY", pageSize: 100 });
    assert.ok(profile.rows.every((r) => r.best_bid_cents === null && r.best_ask_cents === null), "no invented prices (AT-05)");
    const byRef = (await marketPage(t.db, { sort: "reference", dir: "desc", pageSize: 100 })).rows.map((r) => r.reference_cents);
    const firstNull = byRef.indexOf(null);
    const valued = (firstNull < 0 ? byRef : byRef.slice(0, firstNull)).map(Number);
    assert.deepEqual(valued, [...valued].sort((a, b) => b - a));
    if (firstNull >= 0) assert.ok(byRef.slice(firstNull).every((v) => v === null), "nulls last");
    const young = await marketPage(t.db, { minAge: 18, maxAge: 21, role: "STRIKER", pageSize: 100 });
    assert.ok(young.rows.every((r) => r.age! >= 18 && r.age! <= 21 && r.role === "STRIKER"));
    const injected = await marketPage(t.db, { q: "%' OR 1=1 --" });
    assert.equal(injected.total, 0);
  });
});
