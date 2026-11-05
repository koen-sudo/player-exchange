import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { marketHref, parseMarketParams } from "../src/lib/market-params.ts";

describe("market URL state (UX-01)", () => {
  it("round-trips filters and drops unknown values", () => {
    const f = parseMarketParams({ q: "noah", rol: "WINGER", status: "TRADABLE", sort: "reference", richting: "desc", pagina: "2", evil: "x", competitie: "not-a-uuid" });
    assert.deepEqual(f, { q: "noah", role: "WINGER", status: "TRADABLE", sort: "reference", dir: "desc", page: 2 });
    assert.equal(marketHref(f, { page: 1 }), "/markt?q=noah&rol=WINGER&status=TRADABLE&sort=reference&richting=desc");
    assert.equal(marketHref({}, {}), "/markt");
  });
});

import { euroInputToMinor } from "../src/lib/format.ts";

describe("euro input (UX-06 numeric keyboard)", () => {
  it("accepts Dutch and dot notation, rejects ambiguity", () => {
    assert.equal(euroInputToMinor("6,20"), "620");
    assert.equal(euroInputToMinor("6,2"), "620");
    assert.equal(euroInputToMinor("€ 6"), "600");
    assert.equal(euroInputToMinor("0,05"), "5");
    assert.equal(euroInputToMinor("6.20"), "620");
    assert.equal(euroInputToMinor("6,205"), null);
    assert.equal(euroInputToMinor("1.000,00"), null);
    assert.equal(euroInputToMinor(""), null);
  });
});
