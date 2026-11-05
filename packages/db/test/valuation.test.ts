import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import { buildDemoWorld } from "@px/demo";
import { getCatalogPlayer } from "../src/catalog-read.ts";
import { loadIdentity } from "../src/identity.ts";
import { createValuationRun, nextPublicationSlot, publishValuationRun, reviewValuationRun, runChanges, valuationCycle } from "../src/valuation.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const w = buildDemoWorld();
const loginId = (login: string) => w.users.find((u) => u.login === login)!.id;
const noah = w.players.find((p) => p.displayName === "Noah Vermeer")!;
const elias = w.players.find((p) => p.displayName === "Elias Weber")!;
const isCode = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;

let t: TestDb;
let beheer: NonNullable<Awaited<ReturnType<typeof loadIdentity>>>;
let approver: NonNullable<Awaited<ReturnType<typeof loadIdentity>>>;
beforeAll(async () => {
  t = await createTestDb({ seeded: true });
  beheer = (await loadIdentity(t.db, loginId("beheer"), "demo"))!;
  approver = (await loadIdentity(t.db, loginId("approver"), "demo"))!;
  // One player whose external value is not available this week.
  await t.db.execute(sql`DELETE FROM external_valuations WHERE player_id = ${elias.id}`);
}, 60_000);
afterAll(async () => t.drop());

const publicAmount = async (playerId: string) => {
  const r = (await getCatalogPlayer(t.db, playerId))?.reference;
  return r ? Number(r.amountMinor) : null;
};

describe("valuation runs (docs/08, BR-08)", () => {
  let runId = "";

  it("a draft run computes values with the approved demo model and passes the automatic checks", async () => {
    const r = await createValuationRun(t.db, beheer);
    runId = r.runId;
    assert.equal(r.status, "VALIDATED");
    assert.ok(r.values > 100, `${r.values} values`);
    assert.ok(r.noValue > 0, "players without input get no new value");
    const row = (await t.db.execute<{ inputs: Record<string, unknown>; components: { structuralCents: number }; explanations: unknown[] }>(sql`
      SELECT inputs, components, explanations FROM player_reference_values WHERE run_id = ${runId} AND player_id = ${noah.id}`)).rows[0]!;
    assert.equal(row.components.structuralCents, 600, "Noah's structural part from his external value");
    assert.ok(Array.isArray(row.explanations) && row.explanations.length > 0);
    assert.ok(row.inputs.externalValues, "inputs are kept with every value");
  });

  it("a draft is never public (AT-29) and its values are frozen once reviewed", async () => {
    const before = await publicAmount(noah.id);
    assert.equal(before, 600, "still the published value");
    await assert.rejects(reviewValuationRun(t.db, beheer, { runId, decision: "APPROVE", reason: "zelf goedkeuren" }), isCode("ACTION_NOT_ALLOWED"));
    await assert.rejects(publishValuationRun(t.db, beheer, "demo", { runId, now: true }), isCode("ACTION_NOT_ALLOWED"));
    await reviewValuationRun(t.db, approver, { runId, decision: "APPROVE", reason: "Steekproef gecontroleerd" });
    await assert.rejects(t.db.execute(sql`UPDATE player_reference_values SET amount_cents = 1 WHERE run_id = ${runId}`));
    assert.equal(await publicAmount(noah.id), 600, "approved but not yet published: still not public");
  });

  it("publication waits for Monday 18:00 Amsterdam; the demo can publish at once; open orders do not change (AT-28)", async () => {
    const orders = (await t.db.execute(sql`SELECT id, limit_price_cents, qty_open, state, version FROM orders ORDER BY id`)).rows;
    const slot = await nextPublicationSlot(t.db, new Date("2026-11-04T10:00:00Z"));
    assert.equal(slot.toISOString(), "2026-11-09T17:00:00.000Z", "Monday 9 November 18:00 CET");
    assert.equal(await publishValuationRun(t.db, beheer, "demo", { runId }), false, "not yet due");
    await assert.rejects(publishValuationRun(t.db, beheer, "production", { runId, now: true }), isCode("ACTION_NOT_ALLOWED"));
    assert.equal(await publishValuationRun(t.db, beheer, "demo", { runId, now: true }), true);
    const after = await publicAmount(noah.id);
    const mine = (await t.db.execute<{ amount_cents: string }>(sql`SELECT amount_cents FROM player_reference_values WHERE run_id = ${runId} AND player_id = ${noah.id}`)).rows[0]!;
    assert.equal(after, Number(mine.amount_cents));
    assert.deepEqual((await t.db.execute(sql`SELECT id, limit_price_cents, qty_open, state, version FROM orders ORDER BY id`)).rows, orders);
  });

  it("a player without new input keeps the previous value with its old date", async () => {
    const missing = (await t.db.execute<{ player_id: string; published_at: string }>(sql`
      SELECT prv.player_id, prv.published_at::text FROM public_reference_values prv
       WHERE NOT EXISTS (SELECT 1 FROM player_reference_values v WHERE v.player_id = prv.player_id AND v.run_id = ${runId})`)).rows;
    assert.ok(missing.some((m) => m.player_id === elias.id));
    assert.ok(missing.every((m) => m.published_at.startsWith("2026-11-02")));
  });

  it("the review shows the largest changes with warnings", async () => {
    const ch = await runChanges(t.db, runId, 5);
    assert.equal(ch.length, 5);
    assert.ok(ch.every((c) => typeof c.amount_cents === "string"));
  });

  it("a rejected run is never published", async () => {
    const r = await createValuationRun(t.db, beheer);
    await reviewValuationRun(t.db, approver, { runId: r.runId, decision: "REJECT", reason: "Externe waardes te oud" });
    await assert.rejects(publishValuationRun(t.db, beheer, "demo", { runId: r.runId, now: true }), isCode("ACTION_NOT_ALLOWED"));
    await assert.rejects(t.db.execute(sql`UPDATE valuation_runs SET status = 'PUBLISHED', published_at = now() WHERE id = ${r.runId}`));
  });

  it("the weekly job prepares one draft on Monday afternoon and publishes only approved, due runs", async () => {
    const monday = new Date("2026-11-16T12:30:00Z"); // 13:30 Amsterdam
    const a = await valuationCycle(t.db, "demo", monday);
    const b = await valuationCycle(t.db, "demo", monday);
    assert.deepEqual([a.created, b.created], [true, false]);
    const tuesday = await valuationCycle(t.db, "demo", new Date("2026-11-17T12:30:00Z"));
    assert.equal(tuesday.created, false);
    const drafts = (await t.db.execute<{ status: string }>(sql`SELECT status::text FROM valuation_runs WHERE scheduled_publish_at = '2026-11-16T17:00:00Z'`)).rows;
    assert.deepEqual(drafts.map((d) => d.status), ["VALIDATED"], "waits for review; nothing published by itself");
  });
});
