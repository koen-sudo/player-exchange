import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDemoWorld } from "../src/world.ts";
import { listDrops, listMarket, ordersFor, playerDetail, portfolio } from "../src/queries.ts";

const w = buildDemoWorld();
const anna = w.users.find((u) => u.login === "anna")!;
const noah = w.players.find((p) => p.displayName === "Noah Vermeer")!;

describe("demo fixture matches docs/09", () => {
  it("6 competitions × 4 teams × 10 players = 240", () => {
    assert.equal(w.competitions.length, 6);
    assert.equal(w.teams.length, 24);
    assert.equal(w.players.length, 240);
    assert.deepEqual(w.competitions.map((c) => c.name), ["Premier League", "LaLiga", "Bundesliga", "Ligue 1", "Eredivisie", "Pro League"]);
  });
  it("20 open markets per competition, 120 in total", () => {
    for (const c of w.competitions) {
      assert.equal(w.players.filter((p) => p.competitionId === c.id && p.marketStatus === "OPEN").length, 20, c.name);
    }
    assert.equal(w.players.filter((p) => p.marketStatus === "OPEN").length, 120);
  });
  it("all seven role categories occur", () => {
    assert.equal(new Set(w.players.map((p) => p.role)).size, 7);
  });
  it("contains the special cases", () => {
    assert.ok(w.players.some((p) => p.dataQuality === "MISSING" && p.reference === null), "profile without data");
    assert.ok(w.players.some((p) => p.previousTeamId !== null), "transfer");
    assert.ok(w.players.some((p) => p.careerStatus === "RETIRED"), "retired");
    const minor = w.players.find((p) => p.age < 18);
    assert.ok(minor, "minor");
    assert.equal(minor.primaryAdmission, "INELIGIBLE");
    assert.equal(minor.marketStatus, "PROFILE_ONLY");
  });
  it("is deterministic and uses unique ids and names", () => {
    assert.deepEqual(buildDemoWorld().players.map((p) => p.displayName), w.players.map((p) => p.displayName));
    assert.equal(new Set(w.players.map((p) => p.id)).size, 240);
    assert.equal(new Set(w.players.map((p) => p.displayName)).size, 240);
  });
  it("every player is marked fictional", () => {
    assert.ok(w.players.every((p) => p.isFictional));
  });
  it("supply never exceeds the season maximum", () => {
    assert.ok(w.players.every((p) => p.supply.inCirculation <= 500 && p.supply.plannedThisSeason <= 500));
  });
});

describe("market listing (UX-01)", () => {
  it("default shows all profiles, filter 'Verhandelbaar' shows open markets", () => {
    assert.equal(listMarket(w, { pageSize: 100 }).total, 240);
    assert.equal(listMarket(w, { status: "TRADABLE" }).total, 120);
  });
  it("profiles without cards show no bid or ask (AT-05)", () => {
    const rows = listMarket(w, { status: "PROFILE_ONLY", pageSize: 100 }).rows;
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.bestBid === null && r.bestAsk === null));
  });
  it("search ignores accents and case", () => {
    assert.ok(listMarket(w, { q: "VERMEER" }).rows.some((r) => r.name === "Noah Vermeer"));
    const atletico = listMarket(w, { q: "atletico sierra", pageSize: 100 });
    assert.equal(atletico.total, 10);
    assert.ok(atletico.rows.every((r) => r.team === "Atlético Sierra"));
  });
  it("sorting by reference puts unknown values last in both directions", () => {
    for (const dir of ["asc", "desc"] as const) {
      const rows = listMarket(w, { sort: "reference", dir, pageSize: 100, page: 3 }).rows;
      const last = rows[rows.length - 1]!;
      assert.equal(last.reference, null, dir);
    }
  });
  it("paginates", () => {
    const r = listMarket(w, { pageSize: 25, page: 10 });
    assert.equal(r.pages, 10);
    assert.equal(r.rows.length, 15);
  });
});

describe("wireframe figures", () => {
  it("Noah Vermeer detail", () => {
    const d = playerDetail(w, noah.id)!;
    assert.equal(d.age, 21);
    assert.equal(d.team, "Noordwijk");
    assert.equal(d.reference?.amount, 600);
    assert.equal(d.lastTrade?.price, 610);
    assert.equal(d.bestBid, 570);
    assert.equal(d.bestAsk, 620);
    assert.deepEqual([d.supply.inCirculation, d.supply.plannedThisSeason, d.supply.seasonMaximum], [80, 200, 500]);
    assert.ok(d.supply.nextDropAt);
  });
  it("Anna's portfolio: 3 spelers · 6 kaarten, €30,60 / €33,00, €120 available, €12,40 reserved", () => {
    const p = portfolio(w, anna.id);
    assert.equal(p.summary.label, "3 spelers · 6 kaarten");
    assert.equal(p.summary.totalCost, 3_060);
    assert.equal(p.summary.totalReference, 3_300);
    assert.deepEqual([p.balance.available, p.balance.reserved], [12_000, 1_240]);
  });
  it("Anna's open buy order reserves €12,40", () => {
    const o = ordersFor(w, anna.id).find((x) => x.side === "BUY" && x.status === "OPEN")!;
    assert.equal(o.reservedCents, 1_240);
    assert.equal(o.statusLabel, "Open");
  });
  it("upcoming drops: Noah €6,00, Lucas €3,40, Elias €4,60, 5 cards, 1 per person", () => {
    const rows = listDrops(w, "binnenkort").map((x) => [x.player.displayName, x.drop.priceCents, x.drop.quantity, x.drop.maxPerUser]);
    assert.deepEqual(rows.sort(), [["Elias Weber", 460, 5, 1], ["Lucas Moreau", 340, 5, 1], ["Noah Vermeer", 600, 5, 1]]);
  });
  it("drop window is Tuesday 09:00–21:00 Amsterdam", () => {
    const d = listDrops(w, "binnenkort")[0]!.drop;
    const fmt = (x: Date) => new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "long", hour: "2-digit", minute: "2-digit" }).format(x);
    assert.equal(fmt(d.opensAt), "dinsdag 09:00");
    assert.equal(fmt(d.closesAt), "dinsdag 21:00");
  });
});
