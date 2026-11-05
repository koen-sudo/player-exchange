import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cents, formatEuro, parseCentsString } from "../src/money.ts";
import { applySettledFill, commissionOnGross, EMPTY_ACCUMULATOR, sellPreview } from "../src/commission.ts";
import { balance, holdForBuyOrder, holdForWithdrawal, releaseBuyRemainder, settleBuyFill, settleSellFill } from "../src/cash.ts";
import { DomainError } from "../src/errors.ts";

describe("money", () => {
  it("parses integer cent strings and rejects decimals", () => {
    assert.equal(parseCentsString("620"), 620);
    assert.throws(() => parseCentsString("6.20"), DomainError);
    assert.throws(() => parseCentsString("06"), DomainError);
  });
  it("never renders a missing amount as €0,00", () => {
    assert.equal(formatEuro(null), "Niet beschikbaar");
    assert.match(formatEuro(cents(620)), /6,20/);
  });
});

describe("commission BR-20", () => {
  it("rounds half up on cents", () => {
    assert.equal(commissionOnGross(cents(50)), 3); // 2.5 -> 3
    assert.equal(commissionOnGross(cents(100)), 5);
    assert.equal(commissionOnGross(cents(600)), 30);
    assert.equal(commissionOnGross(cents(2000)), 100);
  });

  it("matches the exact commission example (docs/09)", () => {
    const first = applySettledFill(EMPTY_ACCUMULATOR, cents(50));
    assert.deepEqual([first.next.settledGross, first.next.bookedCommission, first.commission, first.net], [50, 3, 3, 47]);
    const second = applySettledFill(first.next, cents(50));
    assert.deepEqual([second.next.settledGross, second.next.bookedCommission, second.commission, second.net], [100, 5, 2, 48]);
    assert.equal(first.net + second.net, 95);
  });

  it("splitting a sell order into fills never changes its total commission", () => {
    for (const price of [20, 33, 50, 99, 101, 617, 999]) {
      for (const qty of [1, 2, 3, 7, 13]) {
        let acc = EMPTY_ACCUMULATOR;
        let total = 0;
        for (let i = 0; i < qty; i++) {
          const f = applySettledFill(acc, cents(price));
          acc = f.next;
          total += f.commission;
        }
        assert.equal(total, commissionOnGross(cents(price * qty)), `price ${price} qty ${qty}`);
      }
    }
  });

  it("sell preview at limit: €6,00 -> commission €0,30, net €5,70 (wireframe 04)", () => {
    assert.deepEqual(sellPreview(1, cents(600)), { gross: 600, commission: 30, net: 570 });
  });
});

describe("exact money example (docs/09)", () => {
  it("buyer and seller balances after partial fill and cancel", () => {
    // Buyer: €100 available, buy 2 cards limit €6,20.
    let buyer = balance(10_000);
    buyer = holdForBuyOrder(buyer, 2, cents(620));
    assert.deepEqual([buyer.available, buyer.reserved], [8_760, 1_240]);

    // One card executes against a resting ask of €6,00.
    const fill = settleBuyFill(buyer, cents(620), cents(600));
    buyer = fill.balance;
    assert.equal(fill.paid, 600);
    assert.equal(fill.released, 20);
    assert.deepEqual([buyer.available, buyer.reserved], [8_780, 620]);

    // Seller receives €5,70, platform fee €0,30.
    const sellerFill = applySettledFill(EMPTY_ACCUMULATOR, cents(600));
    assert.deepEqual([sellerFill.net, sellerFill.commission], [570, 30]);
    const seller = settleSellFill(balance(0), sellerFill.net);
    assert.equal(seller.available, 570);
    // Money is conserved: buyer pays = seller net + fee.
    assert.equal(fill.paid, sellerFill.net + sellerFill.commission);

    // Cancel the second card.
    buyer = releaseBuyRemainder(buyer, 1, cents(620));
    assert.deepEqual([buyer.available, buyer.reserved], [9_400, 0]);
  });

  it("two buy orders cannot reserve more than available (AT-12)", () => {
    let b = balance(1_000);
    b = holdForBuyOrder(b, 1, cents(600));
    assert.throws(() => holdForBuyOrder(b, 1, cents(600)), (e: unknown) => e instanceof DomainError && e.code === "INSUFFICIENT_AVAILABLE_FUNDS");
  });

  it("withdrawal and buy order cannot use the same available balance (AT-31)", () => {
    let b = balance(1_000);
    b = holdForWithdrawal(b, cents(800));
    assert.throws(() => holdForBuyOrder(b, 1, cents(600)), DomainError);
  });

  it("secondary sale of €20: buyer pays €20, seller gets €19, fee €1 (docs/07)", () => {
    const f = applySettledFill(EMPTY_ACCUMULATOR, cents(2_000));
    assert.deepEqual([f.gross, f.net, f.commission], [2_000, 1_900, 100]);
  });
});
