/**
 * Verifiable random allocation for oversubscribed drops (BR-11, BR-12).
 *
 * Uses standard primitives only (SHA-256, HMAC-SHA256 from node:crypto);
 * no home-made cryptography (CLAUDE.md).
 *
 * 1. A random 32-byte seed is generated before opening; only its commitment
 *    SHA-256(seed) is published/registered. The seed itself is stored encrypted.
 * 2. After close, the list of valid participants is frozen (subscription ids of
 *    timely confirmed, admitted subscriptions).
 * 3. Rank key per participant = HMAC-SHA256(seed, version|dropId|participantsDigest|subscriptionId).
 *    Sort ascending by key (ties impossible in practice; broken by id).
 * 4. First `available` are winners, the rest form the fixed waitlist.
 *
 * Same seed + drop + frozen snapshot -> identical ranking, so a retry never
 * changes winners (AT-24). Public verification exposes only subscription ids
 * and digests, never personal data.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { invariant } from "./errors.ts";

export const ALLOCATION_ALGORITHM_VERSION = "alloc-v1";

export function generateSeed(): Buffer {
  return randomBytes(32);
}

export function seedCommitment(seed: Buffer): string {
  invariant(seed.length === 32, "seed must be 32 bytes");
  return createHash("sha256").update(seed).digest("hex");
}

export function verifySeed(seed: Buffer, commitmentHex: string): boolean {
  const actual = Buffer.from(seedCommitment(seed), "hex");
  const expected = Buffer.from(commitmentHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function participantsDigest(subscriptionIds: readonly string[]): string {
  const unique = new Set(subscriptionIds);
  invariant(unique.size === subscriptionIds.length, "duplicate participant in snapshot");
  const sorted = [...subscriptionIds].sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex");
}

export type AllocationResult = {
  readonly algorithmVersion: string;
  readonly dropId: string;
  readonly seedCommitment: string;
  readonly participantsDigest: string;
  readonly ranking: readonly string[]; // subscription ids, best rank first
  readonly winners: readonly string[];
  readonly waitlist: readonly string[];
  readonly resultDigest: string;
};

export function allocate(params: {
  seed: Buffer;
  commitment: string;
  dropId: string;
  frozenSubscriptionIds: readonly string[];
  availableCards: number;
}): AllocationResult {
  const { seed, commitment, dropId, frozenSubscriptionIds, availableCards } = params;
  invariant(verifySeed(seed, commitment), "seed does not match commitment");
  invariant(Number.isSafeInteger(availableCards) && availableCards >= 0, "availableCards invalid");
  const pDigest = participantsDigest(frozenSubscriptionIds);

  const keyed = frozenSubscriptionIds.map((id) => ({
    id,
    key: createHmac("sha256", seed)
      .update(`${ALLOCATION_ALGORITHM_VERSION}|${dropId}|${pDigest}|${id}`)
      .digest("hex"),
  }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : 1));
  const ranking = keyed.map((k) => k.id);
  const winners = ranking.slice(0, availableCards);
  const waitlist = ranking.slice(availableCards);
  const resultDigest = createHash("sha256")
    .update(`${ALLOCATION_ALGORITHM_VERSION}|${dropId}|${pDigest}|${ranking.join(",")}|${availableCards}`)
    .digest("hex");

  return {
    algorithmVersion: ALLOCATION_ALGORITHM_VERSION,
    dropId,
    seedCommitment: commitment,
    participantsDigest: pDigest,
    ranking,
    winners,
    waitlist,
    resultDigest,
  };
}

/**
 * Waitlist promotion (BR-12): only after a *definitive* failure of the
 * current holder's settlement, and only within the waitlist window
 * (default 24h after first allocation). An uncertain (pending) outcome keeps
 * the card held: no second buyer for the same card (AT-26, AT-27).
 */
export type HolderSettlement = "SETTLED" | "PENDING" | "UNKNOWN" | "FAILED";

export function nextWaitlistCandidate(params: {
  holderSettlement: HolderSettlement;
  waitlist: readonly string[];
  alreadyTried: ReadonlySet<string>;
  isStillAdmitted: (subscriptionId: string) => boolean;
  firstAllocatedAt: Date;
  now: Date;
  windowHours?: number;
}): string | "HOLD" | "UNSOLD" {
  const { holderSettlement, waitlist, alreadyTried, isStillAdmitted, firstAllocatedAt, now } = params;
  if (holderSettlement !== "FAILED") return "HOLD";
  const windowMs = (params.windowHours ?? 24) * 3_600_000;
  if (now.getTime() - firstAllocatedAt.getTime() > windowMs) return "UNSOLD";
  for (const id of waitlist) {
    if (!alreadyTried.has(id) && isStillAdmitted(id)) return id;
  }
  return "UNSOLD";
}
