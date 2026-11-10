/**
 * One place that turns a thrown error into what a person may see (F-11).
 * Malformed input that only the database noticed (an id that is not a UUID,
 * a number out of range) is the person's input, not a server fault.
 */
import { DomainError } from "@px/domain";

const INPUT_SQLSTATES = new Set(["22P02", "22003", "22007", "22008"]);

function sqlState(e: unknown): string | undefined {
  for (let cur: unknown = e, depth = 0; cur && depth < 4; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

export function asDomainError(e: unknown): DomainError | null {
  if (e instanceof DomainError) return e;
  const state = sqlState(e);
  if (state && INPUT_SQLSTATES.has(state)) return new DomainError("INPUT_INVALID");
  return null;
}

export const GENERIC_ERROR_NL = "Er ging iets mis. Er is niets gewijzigd.";

/** The message for a person; logs unexpected errors. */
export function userMessageFor(e: unknown, context: string): string {
  const d = asDomainError(e);
  if (d) return d.userMessage;
  console.error(JSON.stringify({ level: "error", msg: context, error: String(e) }));
  return GENERIC_ERROR_NL;
}
