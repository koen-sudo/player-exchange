/**
 * Cash holds (BR-16): money set aside for a buy order or a subscription.
 * The hold row and the ledger posting are written in the same transaction.
 * Consumed (paid into settlement) + released never exceed what was held.
 */
import { sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import type { Executor } from "./client.ts";
import { book, postings, type Mode } from "./ledger.ts";

export type HoldPurpose = "BUY_ORDER" | "SUBSCRIPTION";

export async function createHold(tx: Executor, mode: Mode, input: { userId: string; purpose: HoldPurpose; orderId?: string; subscriptionId?: string; amount: number }): Promise<string> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new DomainError("INVARIANT_VIOLATION", { detail: "hold amount" });
  // Lock the user's available account row first (docs/04 lock order: wallets).
  await tx.execute(sql`SELECT id FROM ledger_accounts WHERE owner_user_id = ${input.userId} AND type = 'CUSTOMER_AVAILABLE' FOR UPDATE`);
  const r = await tx.execute<{ id: string }>(sql`
    INSERT INTO cash_holds(user_id, purpose, order_id, subscription_id, requested_amount_cents, confirmed_amount_cents, status)
    VALUES (${input.userId}, ${input.purpose}, ${input.orderId ?? null}, ${input.subscriptionId ?? null}, ${input.amount}, ${input.amount}, 'ACTIVE')
    RETURNING id`);
  const holdId = r.rows[0]!.id;
  await book(tx, mode, "holds", postings.holdFunds(input.userId, holdId, input.amount));
  return holdId;
}

type HoldRow = { id: string; user_id: string; confirmed_amount_cents: string; consumed_amount_cents: string; released_amount_cents: string; status: string };

async function lockHold(tx: Executor, holdId: string): Promise<HoldRow & { open: number }> {
  const h = (await tx.execute<HoldRow>(sql`SELECT id, user_id, confirmed_amount_cents, consumed_amount_cents, released_amount_cents, status::text FROM cash_holds WHERE id = ${holdId} FOR UPDATE`)).rows[0];
  if (!h) throw new DomainError("INVARIANT_VIOLATION", { detail: "unknown hold" });
  return { ...h, open: Number(h.confirmed_amount_cents) - Number(h.consumed_amount_cents) - Number(h.released_amount_cents) };
}

/** Return part (or all) of the open amount to available. `key` makes the release idempotent. */
export async function releaseHold(tx: Executor, mode: Mode, holdId: string, amount: number, key: string): Promise<void> {
  const h = await lockHold(tx, holdId);
  if (amount <= 0) return;
  if (amount > h.open) throw new DomainError("INVARIANT_VIOLATION", { detail: "release exceeds open hold" });
  const booked = await book(tx, mode, "holds", postings.releaseHold(h.user_id, holdId, amount, key));
  if (!booked) return; // already released under this key
  await tx.execute(sql`
    UPDATE cash_holds SET released_amount_cents = released_amount_cents + ${amount},
           status = CASE WHEN confirmed_amount_cents = consumed_amount_cents + released_amount_cents + ${amount} THEN 'RELEASED'::hold_status ELSE status END,
           version = version + 1
     WHERE id = ${holdId}`);
}

/** Mark part of the hold as used for a match (the ledger posting is executionPending). */
export async function consumeHold(tx: Executor, holdId: string, amount: number): Promise<void> {
  const h = await lockHold(tx, holdId);
  if (amount > h.open) throw new DomainError("INVARIANT_VIOLATION", { detail: "consume exceeds open hold" });
  await tx.execute(sql`
    UPDATE cash_holds SET consumed_amount_cents = consumed_amount_cents + ${amount},
           status = CASE WHEN confirmed_amount_cents = consumed_amount_cents + ${amount} + released_amount_cents THEN 'CONSUMED'::hold_status ELSE status END,
           version = version + 1
     WHERE id = ${holdId}`);
}

/** Put a consumed amount back into the hold after a definitive settlement failure. */
export async function restoreConsumed(tx: Executor, holdId: string, amount: number): Promise<void> {
  await lockHold(tx, holdId);
  await tx.execute(sql`
    UPDATE cash_holds SET consumed_amount_cents = consumed_amount_cents - ${amount}, status = 'ACTIVE', version = version + 1
     WHERE id = ${holdId} AND consumed_amount_cents >= ${amount}`);
}
