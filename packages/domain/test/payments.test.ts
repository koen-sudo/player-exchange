import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { DomainError, parseEuroInput, validateDepositAmount, validateWithdrawalAmount, cents } from "../src/index.ts";

const code = (c: string) => (e: unknown) => e instanceof DomainError && e.code === c;

describe("euro input (Dutch notation)", () => {
  it("parses whole euros, cents and thousands separators", () => {
    assert.equal(parseEuroInput("25"), 2500);
    assert.equal(parseEuroInput("25,5"), 2550);
    assert.equal(parseEuroInput("25,05"), 2505);
    assert.equal(parseEuroInput("€ 1.250,00"), 125_000);
    assert.equal(parseEuroInput(" 0,20 "), 20);
  });
  it("refuses floats in other notations, three decimals and junk", () => {
    for (const raw of ["25.50", "25,555", "-5", "1e3", "", "abc", "1.25", "25,"]) assert.throws(() => parseEuroInput(raw), code("AMOUNT_INVALID"), raw);
  });
});

describe("deposit and withdrawal limits", () => {
  it("deposit between €5 and €2.500", () => {
    validateDepositAmount(cents(500));
    validateDepositAmount(cents(250_000));
    assert.throws(() => validateDepositAmount(cents(499)), code("AMOUNT_INVALID"));
    assert.throws(() => validateDepositAmount(cents(250_001)), code("AMOUNT_INVALID"));
  });
  it("a withdrawal never exceeds the available balance", () => {
    validateWithdrawalAmount(cents(1_000), cents(1_000));
    assert.throws(() => validateWithdrawalAmount(cents(1_001), cents(1_000)), code("INSUFFICIENT_AVAILABLE_FUNDS"));
    assert.throws(() => validateWithdrawalAmount(cents(99), cents(1_000)), code("AMOUNT_INVALID"));
  });
});
