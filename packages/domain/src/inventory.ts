/**
 * Edition and card serial rules (BR-03, BR-04, data model "cards").
 * Hard cap: 500 card numbers per player per platform season.
 */
import { DomainError, invariant } from "./errors.ts";

export const EDITION_HARD_CAP = 500;

/** Serial numbers are 1..500 and unique within an edition. */
export function assertValidSerial(serial: number): void {
  if (!Number.isSafeInteger(serial) || serial < 1 || serial > EDITION_HARD_CAP) {
    throw new DomainError("EDITION_CAP_EXCEEDED", { serial });
  }
}

/**
 * Next serial numbers for `count` new cards, given the highest serial already
 * created in the edition and the published programme size. Never exceeds the
 * programme or the hard cap; never mints a replacement key outside the cap.
 */
export function nextSerials(highestExisting: number, count: number, programmeSize: number): number[] {
  invariant(Number.isSafeInteger(count) && count > 0, "count must be positive");
  invariant(programmeSize <= EDITION_HARD_CAP, "programme cannot exceed hard cap");
  const last = highestExisting + count;
  if (last > programmeSize || last > EDITION_HARD_CAP) {
    throw new DomainError("EDITION_CAP_EXCEEDED", { highestExisting, count, programmeSize });
  }
  return Array.from({ length: count }, (_, i) => highestExisting + i + 1);
}

/** Programme statuses (BR-04). */
export const PROGRAMME_STATUSES = ["DRAFT", "APPROVED", "PUBLISHED", "COMPLETED", "CANCELLED"] as const;
export type ProgrammeStatus = (typeof PROGRAMME_STATUSES)[number];

/**
 * After publication the planned total may only stay equal or go down, and a
 * reduction requires a reason (BR-04). No hidden increases.
 */
export function assertProgrammeChangeAllowed(
  status: ProgrammeStatus,
  currentPlanned: number,
  newPlanned: number,
  reason: string | undefined,
): void {
  invariant(newPlanned <= EDITION_HARD_CAP, "planned exceeds hard cap");
  if (status === "PUBLISHED") {
    invariant(newPlanned <= currentPlanned, "published programme cannot be increased");
    if (newPlanned < currentPlanned) invariant(!!reason && reason.trim().length > 0, "reduction requires a reason");
  }
  invariant(status !== "COMPLETED" && status !== "CANCELLED", "closed programme cannot change");
}

/** Working assumption A-03: 20 at opening + 36 follow-up drops of 5 = 200. */
export function defaultProgramme(): { opening: number; followUps: number; perFollowUp: number; total: number } {
  const opening = 20;
  const followUps = 36;
  const perFollowUp = 5;
  return { opening, followUps, perFollowUp, total: opening + followUps * perFollowUp };
}
