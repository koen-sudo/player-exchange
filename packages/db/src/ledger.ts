/**
 * Double-entry ledger for customer money (fase 4; docs/05 "Geldadministratie",
 * docs/07 "Grootboek").
 *
 * Every money movement is one journal entry with a unique business event id,
 * so retries and duplicate messages can never book twice. The database checks
 * that every entry balances and that customer buckets never go negative.
 *
 * Customer buckets (liabilities, credit increases):
 *   CUSTOMER_AVAILABLE, CUSTOMER_RESERVED, CUSTOMER_PENDING_INCOMING,
 *   PENDING_SETTLEMENT (per buyer), PENDING_WITHDRAWAL (per user).
 * Platform: PSP_SETTLEMENT_ASSET (asset), PLATFORM_FEE_CLEARING,
 *   PRIMARY_REVENUE_CLEARING, PLATFORM_LOSS (asset-like), CUSTOMER_RECEIVABLE (asset).
 *
 * A reservation only moves money between customer buckets and never creates
 * revenue. Gross fee and primary proceeds sit in clearing accounts; final VAT
 * and revenue treatment follows the fiscal set-up (O-08), nothing is hardcoded.
 */
import { sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import type { Executor } from "./client.ts";

export type AccountType =
  | "PSP_SETTLEMENT_ASSET" | "CUSTOMER_AVAILABLE" | "CUSTOMER_RESERVED" | "PENDING_SETTLEMENT" | "PENDING_WITHDRAWAL"
  | "PLATFORM_FEE_CLEARING" | "PRIMARY_REVENUE_CLEARING" | "CUSTOMER_RECEIVABLE" | "CUSTOMER_PENDING_INCOMING" | "PLATFORM_LOSS";

const CUSTOMER_TYPES: AccountType[] = ["CUSTOMER_AVAILABLE", "CUSTOMER_RESERVED", "CUSTOMER_PENDING_INCOMING", "PENDING_SETTLEMENT", "PENDING_WITHDRAWAL", "CUSTOMER_RECEIVABLE"];

export type Line = { account: { type: AccountType; userId?: string | null }; side: "DEBIT" | "CREDIT"; amount: number };

export type Mode = "demo" | "sandbox" | "production";

async function accountId(tx: Executor, type: AccountType, userId: string | null): Promise<string> {
  if (CUSTOMER_TYPES.includes(type) && type !== "PENDING_SETTLEMENT" && !userId) throw new DomainError("INVARIANT_VIOLATION", { detail: `${type} needs an owner` });
  await tx.execute(sql`INSERT INTO ledger_accounts(type, owner_user_id) VALUES (${type}, ${userId}) ON CONFLICT DO NOTHING`);
  const r = await tx.execute<{ id: string }>(sql`
    SELECT id FROM ledger_accounts WHERE type = ${type} AND owner_user_id IS NOT DISTINCT FROM ${userId}::uuid AND currency = 'EUR'`);
  return r.rows[0]!.id;
}

/**
 * Post one balanced entry. Returns false (and books nothing) when an entry
 * for this business event already exists: the same event is processed once.
 * Lines are locked in a fixed order (by account id) to avoid deadlocks.
 */
export async function post(tx: Executor, input: { eventId: string; kind: string; source: string; mode: Mode; memo?: string; lines: Line[]; reversesEntryId?: string }): Promise<boolean> {
  const lines = input.lines.filter((l) => l.amount !== 0);
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amount) || l.amount < 0) throw new DomainError("INVARIANT_VIOLATION", { detail: "amount must be positive integer cents" });
  }
  const debit = lines.filter((l) => l.side === "DEBIT").reduce((n, l) => n + l.amount, 0);
  const credit = lines.filter((l) => l.side === "CREDIT").reduce((n, l) => n + l.amount, 0);
  if (debit !== credit) throw new DomainError("INVARIANT_VIOLATION", { detail: `unbalanced entry ${input.eventId}: ${debit} vs ${credit}` });
  if (lines.length === 0) return true;

  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO journal_entries(business_event_id, kind, source, environment, memo, reverses_entry_id)
    VALUES (${input.eventId}, ${input.kind}, ${input.source}, ${input.mode}, ${input.memo ?? null}, ${input.reversesEntryId ?? null})
    ON CONFLICT (business_event_id) DO NOTHING RETURNING id`);
  const entryId = inserted.rows[0]?.id;
  if (!entryId) return false;

  const resolved = await Promise.all(lines.map(async (l) => ({ ...l, id: await accountId(tx, l.account.type, l.account.userId ?? null) })));
  resolved.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const l of resolved) {
    await tx.execute(sql`INSERT INTO journal_lines(journal_entry_id, ledger_account_id, side, amount_cents) VALUES (${entryId}, ${l.id}, ${l.side}, ${l.amount})`);
  }
  return true;
}

/** Translate a negative-balance refusal from the database into a domain error. */
export async function guardFunds<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string; constraint?: string }; constraint?: string };
    const code = err.code ?? err.cause?.code;
    const constraint = err.constraint ?? err.cause?.constraint ?? "";
    if (code === "23514" && /ledger_accounts/.test(constraint)) throw new DomainError("INSUFFICIENT_AVAILABLE_FUNDS");
    throw e;
  }
}

const A = (type: AccountType, userId?: string | null) => ({ type, userId: userId ?? null });
const dr = (account: Line["account"], amount: number): Line => ({ account, side: "DEBIT", amount });
const cr = (account: Line["account"], amount: number): Line => ({ account, side: "CREDIT", amount });

// ---------------------------------------------------------------------------
// Postings catalogue
// ---------------------------------------------------------------------------
export const postings = {
  /** Funds announced by the provider but not yet final (delayed-certainty methods). */
  depositPending: (userId: string, depositId: string, amount: number) => ({
    eventId: `deposit:${depositId}:pending`, kind: "DEPOSIT_PENDING",
    lines: [dr(A("PSP_SETTLEMENT_ASSET"), amount), cr(A("CUSTOMER_PENDING_INCOMING", userId), amount)],
  }),
  depositConfirmed: (userId: string, depositId: string, amount: number, wasPending: boolean) => ({
    eventId: `deposit:${depositId}:confirmed`, kind: "DEPOSIT_CONFIRMED",
    lines: wasPending
      ? [dr(A("CUSTOMER_PENDING_INCOMING", userId), amount), cr(A("CUSTOMER_AVAILABLE", userId), amount)]
      : [dr(A("PSP_SETTLEMENT_ASSET"), amount), cr(A("CUSTOMER_AVAILABLE", userId), amount)],
  }),
  depositFailedAfterPending: (userId: string, depositId: string, amount: number) => ({
    eventId: `deposit:${depositId}:failed`, kind: "DEPOSIT_FAILED",
    lines: [dr(A("CUSTOMER_PENDING_INCOMING", userId), amount), cr(A("PSP_SETTLEMENT_ASSET"), amount)],
  }),
  holdFunds: (userId: string, holdId: string, amount: number) => ({
    eventId: `hold:${holdId}:active`, kind: "HOLD",
    lines: [dr(A("CUSTOMER_AVAILABLE", userId), amount), cr(A("CUSTOMER_RESERVED", userId), amount)],
  }),
  releaseHold: (userId: string, holdId: string, amount: number, key: string) => ({
    eventId: `hold:${holdId}:release:${key}`, kind: "HOLD_RELEASE",
    lines: [dr(A("CUSTOMER_RESERVED", userId), amount), cr(A("CUSTOMER_AVAILABLE", userId), amount)],
  }),
  withdrawalHeld: (userId: string, withdrawalId: string, amount: number) => ({
    eventId: `withdrawal:${withdrawalId}:held`, kind: "WITHDRAWAL_HELD",
    lines: [dr(A("CUSTOMER_AVAILABLE", userId), amount), cr(A("PENDING_WITHDRAWAL", userId), amount)],
  }),
  withdrawalPaid: (userId: string, withdrawalId: string, amount: number) => ({
    eventId: `withdrawal:${withdrawalId}:paid`, kind: "WITHDRAWAL_PAID",
    lines: [dr(A("PENDING_WITHDRAWAL", userId), amount), cr(A("PSP_SETTLEMENT_ASSET"), amount)],
  }),
  withdrawalFailed: (userId: string, withdrawalId: string, amount: number) => ({
    eventId: `withdrawal:${withdrawalId}:failed`, kind: "WITHDRAWAL_FAILED",
    lines: [dr(A("PENDING_WITHDRAWAL", userId), amount), cr(A("CUSTOMER_AVAILABLE", userId), amount)],
  }),
  /** Match: the buyer's reserved limit for one card moves into settlement (docs/07 step 4). */
  executionPending: (buyerId: string, executionId: string, limit: number) => ({
    eventId: `execution:${executionId}:pending`, kind: "EXECUTION_PENDING",
    lines: [dr(A("CUSTOMER_RESERVED", buyerId), limit), cr(A("PENDING_SETTLEMENT", buyerId), limit)],
  }),
  /**
   * Final settlement of one card: the buyer pays the execution price, the
   * seller receives price − fee, the fee goes to clearing, and the price
   * improvement (limit − price) returns to the buyer's available balance.
   */
  executionSettled: (x: { buyerId: string; sellerId: string; executionId: string; limit: number; price: number; fee: number }) => ({
    eventId: `execution:${x.executionId}:settled`, kind: "EXECUTION_SETTLED",
    lines: [
      dr(A("PENDING_SETTLEMENT", x.buyerId), x.limit),
      cr(A("CUSTOMER_AVAILABLE", x.sellerId), x.price - x.fee),
      cr(A("PLATFORM_FEE_CLEARING"), x.fee),
      cr(A("CUSTOMER_AVAILABLE", x.buyerId), x.limit - x.price),
    ],
  }),
  /** Definitive failure: the buyer's money returns to the reservation, nothing is booked as revenue. */
  executionFailed: (buyerId: string, executionId: string, limit: number) => ({
    eventId: `execution:${executionId}:failed`, kind: "EXECUTION_FAILED",
    lines: [dr(A("PENDING_SETTLEMENT", buyerId), limit), cr(A("CUSTOMER_RESERVED", buyerId), limit)],
  }),
  /**
   * Chargeback (docs/07): take what is available, record the rest as a
   * receivable of this customer. Never touches other customers' money.
   */
  chargeback: (userId: string, depositId: string, amount: number, fromAvailable: number) => ({
    eventId: `chargeback:${depositId}`, kind: "CHARGEBACK",
    lines: [
      dr(A("CUSTOMER_AVAILABLE", userId), fromAvailable),
      dr(A("CUSTOMER_RECEIVABLE", userId), amount - fromAvailable),
      cr(A("PSP_SETTLEMENT_ASSET"), amount),
    ],
  }),
  /** Approved correction (four-eyes): money between a customer and the platform's loss account. */
  correction: (userId: string, approvalId: string, amount: number, direction: "CREDIT" | "DEBIT") => ({
    eventId: `correction:${approvalId}`, kind: "CORRECTION",
    lines: direction === "CREDIT"
      ? [dr(A("PLATFORM_LOSS"), amount), cr(A("CUSTOMER_AVAILABLE", userId), amount)]
      : [dr(A("CUSTOMER_AVAILABLE", userId), amount), cr(A("PLATFORM_LOSS"), amount)],
  }),
  /** Primary allocation: the subscription's reserved price goes into settlement. */
  allocationPending: (userId: string, allocationId: string, price: number) => ({
    eventId: `allocation:${allocationId}:pending`, kind: "ALLOCATION_PENDING",
    lines: [dr(A("CUSTOMER_RESERVED", userId), price), cr(A("PENDING_SETTLEMENT", userId), price)],
  }),
  /** Primary allocation settled: the price is platform revenue (primary sale, no seller). */
  allocationSettled: (userId: string, allocationId: string, price: number) => ({
    eventId: `allocation:${allocationId}:settled`, kind: "ALLOCATION_SETTLED",
    lines: [dr(A("PENDING_SETTLEMENT", userId), price), cr(A("PRIMARY_REVENUE_CLEARING"), price)],
  }),
  /** Primary allocation definitively failed: money back to the reservation. */
  allocationFailed: (userId: string, allocationId: string, price: number) => ({
    eventId: `allocation:${allocationId}:failed`, kind: "ALLOCATION_FAILED",
    lines: [dr(A("PENDING_SETTLEMENT", userId), price), cr(A("CUSTOMER_RESERVED", userId), price)],
  }),
  /** Opening balance for pre-existing customer money (demo seed or migration). */
  openingBalance: (userId: string, amount: number, reference: string) => ({
    eventId: `opening:${userId}:${reference}`, kind: "OPENING_BALANCE",
    lines: [dr(A("PSP_SETTLEMENT_ASSET"), amount), cr(A("CUSTOMER_AVAILABLE", userId), amount)],
  }),
};

export async function book(tx: Executor, mode: Mode, source: string, p: { eventId: string; kind: string; lines: Line[] }): Promise<boolean> {
  return guardFunds(() => post(tx, { ...p, source, mode }));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export type Balances = { available: number; reserved: number; pendingIncoming: number; inSettlement: number; pendingWithdrawal: number; receivable: number };

export async function balancesFor(db: Executor, userId: string): Promise<Balances> {
  const r = await db.execute<{ type: AccountType; balance_cents: string }>(sql`
    SELECT type::text AS type, balance_cents FROM ledger_accounts WHERE owner_user_id = ${userId}`);
  const get = (t: AccountType) => Number(r.rows.find((x) => x.type === t)?.balance_cents ?? 0);
  return {
    available: get("CUSTOMER_AVAILABLE"),
    reserved: get("CUSTOMER_RESERVED"),
    pendingIncoming: get("CUSTOMER_PENDING_INCOMING"),
    inSettlement: get("PENDING_SETTLEMENT"),
    pendingWithdrawal: get("PENDING_WITHDRAWAL"),
    receivable: get("CUSTOMER_RECEIVABLE"),
  };
}

/** Structural money invariants (docs/09). All counts must be zero. */
export async function ledgerInvariants(db: Executor) {
  const r = (await db.execute<{ unbalanced: number; projection: number; negative: number; holds_off: number }>(sql`
    SELECT
      (SELECT count(*) FROM (SELECT journal_entry_id FROM journal_lines GROUP BY journal_entry_id
         HAVING sum(CASE WHEN side = 'DEBIT' THEN amount_cents ELSE -amount_cents END) <> 0) x)::int AS unbalanced,
      (SELECT count(*) FROM ledger_projection_mismatches)::int AS projection,
      (SELECT count(*) FROM ledger_accounts WHERE owner_user_id IS NOT NULL AND type <> 'CUSTOMER_RECEIVABLE' AND balance_cents < 0)::int AS negative,
      (SELECT count(*) FROM (
         SELECT h.user_id, sum(h.confirmed_amount_cents - h.consumed_amount_cents - h.released_amount_cents) AS open_holds
           FROM cash_holds h WHERE h.status = 'ACTIVE' AND h.purpose <> 'WITHDRAWAL' GROUP BY h.user_id) x
         JOIN ledger_accounts a ON a.owner_user_id = x.user_id AND a.type = 'CUSTOMER_RESERVED'
        WHERE a.balance_cents <> x.open_holds)::int AS holds_off`)).rows[0]!;
  return { unbalancedEntries: r.unbalanced, projectionMismatches: r.projection, negativeCustomerBalances: r.negative, reservedNotMatchingHolds: r.holds_off };
}
