import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { DomainError } from "@px/domain";
import { asDomainError, userMessageFor } from "../src/server/errors.ts";

describe("error mapping (F-11)", () => {
  it("malformed input the database noticed is the person's input error", () => {
    // How drizzle wraps a pg error: the SQLSTATE sits on the cause.
    const wrapped = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error('invalid input syntax for type uuid: "abc"'), { code: "22P02" }) });
    assert.equal(asDomainError(wrapped)?.code, "INPUT_INVALID");
    assert.equal(userMessageFor(wrapped, "test"), "Deze invoer is ongeldig. Er is niets gewijzigd.");
  });

  it("domain errors pass through, other failures stay generic", () => {
    assert.equal(asDomainError(new DomainError("MARKET_NOT_OPEN"))?.code, "MARKET_NOT_OPEN");
    const constraint = Object.assign(new Error("x"), { code: "23505" });
    assert.equal(asDomainError(constraint), null, "a constraint violation is not blamed on the person");
    const orig = console.error;
    console.error = () => undefined;
    try {
      assert.equal(userMessageFor(new Error("boom"), "test"), "Er ging iets mis. Er is niets gewijzigd.");
    } finally {
      console.error = orig;
    }
  });
});
