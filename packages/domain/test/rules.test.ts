import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../src/errors.ts";
import { cents } from "../src/money.ts";
import { assertValidLimitPrice, computeExpiresAt } from "../src/order-rules.ts";
import { seasonBounds, seasonKeyFor } from "../src/season.ts";
import { assertWithinPositionLimit, positionLimit } from "../src/position-limit.ts";
import { assertProgrammeChangeAllowed, assertValidSerial, defaultProgramme, nextSerials } from "../src/inventory.ts";
import {
  cancelRemainder,
  deriveStatus,
  expireRemainder,
  failOne,
  matchOne,
  newOrderQuantities,
  settleOne,
} from "../src/order-quantities.ts";

const code = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;

describe("time in force (BR-14, AT-37)", () => {
  const t0 = new Date("2026-10-24T22:30:00Z"); // night before DST ends in Europe
  it("accepts exactly 1, 7 and 30 days as 24/168/720 elapsed hours", () => {
    assert.equal(computeExpiresAt(t0, "ONE_DAY").toISOString(), "2026-10-25T22:30:00.000Z");
    assert.equal(computeExpiresAt(t0, "SEVEN_DAYS").getTime() - t0.getTime(), 168 * 3_600_000);
    assert.equal(computeExpiresAt(t0, "THIRTY_DAYS").getTime() - t0.getTime(), 720 * 3_600_000);
  });
  it("rejects any other duration", () => {
    for (const bad of ["TWO_DAYS", 24, "", null, "toString"]) {
      assert.throws(() => computeExpiresAt(t0, bad), code("TIME_IN_FORCE_INVALID"));
    }
  });
});

describe("limit prices (BR-19)", () => {
  it("accepts €0,20 .. €10.000 in steps of €0,01", () => {
    assertValidLimitPrice(cents(20));
    assertValidLimitPrice(cents(1_000_000));
    assert.throws(() => assertValidLimitPrice(cents(19)), code("PRICE_INVALID"));
    assert.throws(() => assertValidLimitPrice(cents(1_000_001)), code("PRICE_INVALID"));
  });
});

describe("platform season (BR-02, AT-38)", () => {
  it("2026-2027 bounds are 1 July 00:00 Amsterdam (CEST) converted to UTC", () => {
    const b = seasonBounds("2026-2027");
    assert.equal(b.startUtc.toISOString(), "2026-06-30T22:00:00.000Z");
    assert.equal(b.endUtcExclusive.toISOString(), "2027-06-30T22:00:00.000Z");
  });
  it("the exact transition instant belongs to the new season", () => {
    assert.equal(seasonKeyFor(new Date("2027-06-30T22:00:00.000Z")), "2027-2028");
    assert.equal(seasonKeyFor(new Date("2027-06-30T21:59:59.999Z")), "2026-2027");
  });
  it("UTC 1 July 00:00 is already in the new season locally", () => {
    assert.equal(seasonKeyFor(new Date("2026-07-01T00:00:00Z")), "2026-2027");
    assert.equal(seasonKeyFor(new Date("2026-11-05T16:00:00Z")), "2026-2027");
    assert.equal(seasonKeyFor(new Date("2026-01-15T12:00:00Z")), "2025-2026");
  });
});

describe("position limit (BR-18)", () => {
  it("min(50, max(3, floor(10% of issued)))", () => {
    assert.equal(positionLimit(0), 3);
    assert.equal(positionLimit(20), 3);
    assert.equal(positionLimit(39), 3);
    assert.equal(positionLimit(80), 8);
    assert.equal(positionLimit(499), 49);
    assert.equal(positionLimit(1_000), 50);
  });
  it("counts holdings, open buys, pending buys and reserved subscriptions", () => {
    const e = { held: 3, openBuyQuantity: 2, buyPendingSettlement: 1, reservedSubscriptions: 1 };
    assertWithinPositionLimit(e, 1, 80); // 8 <= 8
    assert.throws(() => assertWithinPositionLimit(e, 2, 80), code("POSITION_LIMIT_EXCEEDED"));
  });
});

describe("edition cap (BR-03, AT-06)", () => {
  it("serials are 1..500; the 501st is refused", () => {
    assertValidSerial(1);
    assertValidSerial(500);
    assert.throws(() => assertValidSerial(501), code("EDITION_CAP_EXCEEDED"));
    assert.throws(() => nextSerials(499, 2, 500), code("EDITION_CAP_EXCEEDED"));
    assert.deepEqual(nextSerials(498, 2, 500), [499, 500]);
  });
  it("cannot exceed the published programme", () => {
    assert.throws(() => nextSerials(195, 6, 200), code("EDITION_CAP_EXCEEDED"));
  });
  it("default programme is 20 + 36×5 = 200", () => {
    assert.equal(defaultProgramme().total, 200);
  });
  it("published programme cannot be increased; reduction needs a reason", () => {
    assert.throws(() => assertProgrammeChangeAllowed("PUBLISHED", 200, 201, "x"), DomainError);
    assert.throws(() => assertProgrammeChangeAllowed("PUBLISHED", 200, 150, ""), DomainError);
    assertProgrammeChangeAllowed("PUBLISHED", 200, 150, "Speler langdurig geblesseerd");
    assertProgrammeChangeAllowed("DRAFT", 100, 300, undefined);
  });
});

describe("order quantities", () => {
  it("partial fill, then cancel only frees the open remainder (AT-18, AT-19)", () => {
    let q = newOrderQuantities(3);
    q = matchOne(q); // 1 pending
    q = settleOne(q); // 1 filled
    q = matchOne(q); // 1 pending, 1 open
    assert.equal(deriveStatus(q), "PARTIALLY_FILLED");
    q = cancelRemainder(q);
    assert.deepEqual(q, { original: 3, open: 0, pending: 1, filled: 1, cancelled: 1, expired: 0 });
    assert.equal(deriveStatus(q), "IN_SETTLEMENT");
  });
  it("a failed fill on a cancelled order does not reopen it (AT-20)", () => {
    let q = matchOne(newOrderQuantities(1));
    q = expireRemainder(q);
    q = failOne(q, "CANCEL");
    assert.equal(q.open, 0);
    assert.equal(deriveStatus(q), "CANCELLED");
  });
  it("expired order status", () => {
    assert.equal(deriveStatus(expireRemainder(newOrderQuantities(2))), "EXPIRED");
  });
});
