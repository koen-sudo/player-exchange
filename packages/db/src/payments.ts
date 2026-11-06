/**
 * Deposits, withdrawals, payment webhooks and status polling (fase 4).
 *
 * Rules (docs/07 Deposits, CLAUDE.md):
 * - Every external call has a durable operation row with a stable
 *   idempotency key, written and committed before the call is made.
 * - Provider calls happen outside database transactions.
 * - Available balance is booked only after the provider confirms. A browser
 *   redirect never confirms anything by itself (AT-11).
 * - A webhook is a notification: it is verified, stored once in the inbox
 *   (AT-10) and then the platform asks the provider for the status
 *   (fetch-on-notify). Late, duplicate or out-of-order events cannot book twice
 *   because an operation is financially processed exactly once.
 * - An unknown outcome is pending, never failure.
 */
import { createHash, randomUUID } from "node:crypto";
import { recordWebhookRejection } from "./operations.ts";
import { sql } from "drizzle-orm";
import { cents, decideAction, DEFAULT_PAYMENT_LIMITS, DomainError, validateDepositAmount, validateWithdrawalAmount, type UserAction } from "@px/domain";
import type { PaymentProvider, ProviderOutcome } from "@px/integrations";
import type { Db, Executor } from "./client.ts";
import { admissionFacts, writeAudit, type AppMode } from "./identity.ts";
import { balancesFor, book, postings } from "./ledger.ts";
import { applySettlementOutcome, continueAfterOperation, submitSettlement } from "./trading.ts";
import { applyAllocationOutcome, continueAfterAllocationOperation, parseSeedKey, submitAllocation } from "./drops.ts";
import { createPaymentSimulator, SIM_PROVIDER, type PaymentSimulator, type SimScenario as SimScenarioName } from "./payment-simulator.ts";

export type PaymentsCtx = { db: Db; provider: PaymentProvider; providerName: string; mode: AppMode };

type OpRow = {
  id: string;
  type: "DEPOSIT" | "WITHDRAWAL" | "SECONDARY_SETTLEMENT" | "PRIMARY_SETTLEMENT";
  execution_id: string | null;
  allocation_id: string | null;
  idempotency_key: string;
  provider_reference: string | null;
  amount_cents: string;
  status: string;
  user_id: string;
  financially_processed_at: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
export async function assertAllowed(db: Executor, userId: string, action: UserAction, mode: AppMode): Promise<void> {
  const facts = await admissionFacts(db, userId, mode);
  if (!facts) throw new DomainError("AUTH_REQUIRED");
  const d = decideAction(action, facts);
  if (!d.allowed) throw new DomainError(d.code, { userMessage: d.reason });
}

/**
 * Request idempotency for a person's form or API call (docs/06). The first
 * call claims the key; a retry with the same content gets the stored answer,
 * a retry with other content is refused.
 */
async function claimRequest(tx: Executor, actorId: string, endpoint: string, key: string, hash: string): Promise<Record<string, unknown> | null> {
  const ins = await tx.execute(sql`
    INSERT INTO idempotency_requests(actor_id, endpoint, key, request_hash) VALUES (${actorId}, ${endpoint}, ${key}, ${hash})
    ON CONFLICT DO NOTHING RETURNING key`);
  if (ins.rows.length) return null;
  const prior = (await tx.execute<{ request_hash: string; response_body: Record<string, unknown> | null }>(sql`
    SELECT request_hash, response_body FROM idempotency_requests WHERE actor_id = ${actorId} AND endpoint = ${endpoint} AND key = ${key}`)).rows[0]!;
  if (prior.request_hash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT");
  return prior.response_body ?? {};
}

async function storeResponse(tx: Executor, actorId: string, endpoint: string, key: string, body: Record<string, unknown>) {
  await tx.execute(sql`
    UPDATE idempotency_requests SET response_status = 200, response_body = ${JSON.stringify(body)}::jsonb
     WHERE actor_id = ${actorId} AND endpoint = ${endpoint} AND key = ${key}`);
}

/** Open material reconciliation breaks for this user, or platform-wide ones, block withdrawals. */
export async function reconciliationHold(db: Executor, userId: string): Promise<boolean> {
  const r = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM reconciliation_breaks
     WHERE status <> 'RESOLVED' AND severity = 'MATERIAL' AND (user_id = ${userId} OR user_id IS NULL)`);
  return r.rows[0]!.n > 0;
}

async function notify(tx: Executor, userId: string, template: string, dedupeKey: string, payload: Record<string, unknown>) {
  await tx.execute(sql`
    INSERT INTO notification_outbox(user_id, template, channel, dedupe_key, payload)
    VALUES (${userId}, ${template}, 'IN_APP', ${dedupeKey}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT (dedupe_key) DO NOTHING`);
}

const lockOp = async (tx: Executor, opId: string) =>
  (await tx.execute<OpRow>(sql`SELECT id, type, execution_id, allocation_id, idempotency_key, provider_reference, amount_cents, status::text, user_id, financially_processed_at, created_at FROM settlement_operations WHERE id = ${opId} FOR UPDATE`)).rows[0];

// ---------------------------------------------------------------------------
// Applying a provider outcome (the only place that books deposit/withdrawal money)
// ---------------------------------------------------------------------------
export type ApplyResult = "FINALISED" | "PENDING" | "UNCHANGED" | "ALREADY_FINAL";

export async function applyOperationOutcome(tx: Executor, mode: AppMode, opId: string, outcome: ProviderOutcome): Promise<ApplyResult> {
  const op = await lockOp(tx, opId);
  if (!op) throw new DomainError("INVARIANT_VIOLATION", { detail: `unknown operation ${opId}` });
  if (op.financially_processed_at) return "ALREADY_FINAL";
  const amount = Number(op.amount_cents);
  if (outcome.providerReference && !op.provider_reference) {
    await tx.execute(sql`UPDATE settlement_operations SET provider_reference = ${outcome.providerReference} WHERE id = ${op.id}`);
  }
  if (op.type === "SECONDARY_SETTLEMENT") return applySettlementOutcome(tx, mode, { id: op.id, execution_id: op.execution_id! }, outcome);
  if (op.type === "PRIMARY_SETTLEMENT") return applyAllocationOutcome(tx, mode, { id: op.id, allocation_id: op.allocation_id! }, outcome);
  const finalise = async (status: "SUCCEEDED" | "FAILED", error: string | null) => {
    await tx.execute(sql`
      UPDATE settlement_operations SET status = ${status}, financially_processed_at = now(), outcome_known_at = now(),
             last_error = ${error}, updated_at = now(), version = version + 1
       WHERE id = ${op.id}`);
    await writeAudit(tx, { actorId: null, actorKind: "PROVIDER", action: `${op.type}_${status}`, entityType: "settlement_operation", entityId: op.id, related: { amount, providerReference: outcome.providerReference } });
  };
  const setStatus = (status: string) =>
    tx.execute(sql`UPDATE settlement_operations SET status = ${status}::operation_status, updated_at = now(), version = version + 1 WHERE id = ${op.id}`);

  if (op.type === "DEPOSIT") {
    const dep = (await tx.execute<{ id: string; status: string }>(sql`SELECT id, status FROM deposits WHERE operation_id = ${op.id} FOR UPDATE`)).rows[0]!;
    if (outcome.providerReference) await tx.execute(sql`UPDATE deposits SET provider_reference = coalesce(provider_reference, ${outcome.providerReference}) WHERE id = ${dep.id}`);
    switch (outcome.status) {
      case "SUCCEEDED":
        await book(tx, mode, "payments", postings.depositConfirmed(op.user_id, dep.id, amount, dep.status === "PENDING"));
        await tx.execute(sql`UPDATE deposits SET status = 'CONFIRMED', confirmed_at = now() WHERE id = ${dep.id}`);
        await finalise("SUCCEEDED", null);
        await notify(tx, op.user_id, "DEPOSIT_CONFIRMED", `deposit:${dep.id}:final`, { depositId: dep.id, amountCents: amount });
        return "FINALISED";
      case "FAILED":
        if (dep.status === "PENDING") await book(tx, mode, "payments", postings.depositFailedAfterPending(op.user_id, dep.id, amount));
        await tx.execute(sql`UPDATE deposits SET status = 'FAILED', failure_reason = ${outcome.reason} WHERE id = ${dep.id}`);
        await finalise("FAILED", outcome.reason);
        await notify(tx, op.user_id, "DEPOSIT_FAILED", `deposit:${dep.id}:final`, { depositId: dep.id, amountCents: amount });
        return "FINALISED";
      case "PENDING":
        if (outcome.stage === "PROCESSING" && dep.status === "INITIATED") {
          // Delayed certainty: shown as "nog niet beschikbaar", never spendable.
          await book(tx, mode, "payments", postings.depositPending(op.user_id, dep.id, amount));
          await tx.execute(sql`UPDATE deposits SET status = 'PENDING', pending_since = now() WHERE id = ${dep.id}`);
          await setStatus("PENDING");
          return "PENDING";
        }
        return "UNCHANGED";
      case "UNKNOWN":
        return "UNCHANGED";
    }
  }

  // WITHDRAWAL: the money was moved to PENDING_WITHDRAWAL when it was requested.
  const wd = (await tx.execute<{ id: string; status: string }>(sql`SELECT id, status FROM withdrawals WHERE operation_id = ${op.id} FOR UPDATE`)).rows[0]!;
  switch (outcome.status) {
    case "SUCCEEDED":
      await book(tx, mode, "payments", postings.withdrawalPaid(op.user_id, wd.id, amount));
      await tx.execute(sql`UPDATE withdrawals SET status = 'PAID', completed_at = now() WHERE id = ${wd.id}`);
      await finalise("SUCCEEDED", null);
      await notify(tx, op.user_id, "WITHDRAWAL_PAID", `withdrawal:${wd.id}:final`, { withdrawalId: wd.id, amountCents: amount });
      return "FINALISED";
    case "FAILED":
      await book(tx, mode, "payments", postings.withdrawalFailed(op.user_id, wd.id, amount));
      await tx.execute(sql`UPDATE withdrawals SET status = 'FAILED', completed_at = now(), failure_reason = ${outcome.reason} WHERE id = ${wd.id}`);
      await finalise("FAILED", outcome.reason);
      await notify(tx, op.user_id, "WITHDRAWAL_FAILED", `withdrawal:${wd.id}:final`, { withdrawalId: wd.id, amountCents: amount });
      return "FINALISED";
    case "PENDING":
      if (wd.status !== "PENDING") await tx.execute(sql`UPDATE withdrawals SET status = 'PENDING' WHERE id = ${wd.id}`);
      await setStatus("PENDING");
      return "PENDING";
    case "UNKNOWN":
      return "UNCHANGED";
  }
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------
export type DepositStart = { depositId: string; redirectUrl: string | null };

export async function startDeposit(ctx: PaymentsCtx, input: { userId: string; amount: number; requestKey: string; returnUrl: (depositId: string) => string }): Promise<DepositStart> {
  validateDepositAmount(cents(input.amount));
  await assertAllowed(ctx.db, input.userId, "DEPOSIT", ctx.mode);
  const endpoint = "POST /deposits";
  const depositId = await ctx.db.transaction(async (tx) => {
    const prior = await claimRequest(tx, input.userId, endpoint, input.requestKey, `amount=${input.amount}`);
    if (prior) return prior.depositId as string;
    const open = (await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM deposits WHERE user_id = ${input.userId} AND status IN ('INITIATED','PENDING')`)).rows[0]!.n;
    if (open >= DEFAULT_PAYMENT_LIMITS.maxOpenDeposits) {
      throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: `Je hebt al ${open} stortingen die nog niet zijn afgerond. Rond die eerst af.` });
    }
    const id = randomUUID();
    const op = (await tx.execute<{ id: string }>(sql`
      INSERT INTO settlement_operations(type, idempotency_key, provider, amount_cents, status, user_id)
      VALUES ('DEPOSIT', ${`deposit:${id}`}, ${ctx.providerName}, ${input.amount}, 'CREATED', ${input.userId}) RETURNING id`)).rows[0]!;
    await tx.execute(sql`
      INSERT INTO deposits(id, user_id, amount_cents, provider, status, operation_id)
      VALUES (${id}, ${input.userId}, ${input.amount}, ${ctx.providerName}, 'INITIATED', ${op.id})`);
    await writeAudit(tx, { actorId: input.userId, actorKind: "USER", action: "DEPOSIT_STARTED", entityType: "deposit", entityId: id, related: { amount: input.amount } });
    await storeResponse(tx, input.userId, endpoint, input.requestKey, { depositId: id });
    return id;
  });
  return submitDeposit(ctx, depositId, input.returnUrl(depositId));
}

/** Ask the provider for a checkout. Safe to repeat: same idempotency key, same checkout. */
export async function submitDeposit(ctx: PaymentsCtx, depositId: string, returnUrl: string): Promise<DepositStart> {
  const row = (await ctx.db.execute<{ redirect_url: string | null; status: string; user_id: string; amount_cents: string; op_id: string; key: string }>(sql`
    SELECT d.redirect_url, d.status, d.user_id, d.amount_cents, o.id AS op_id, o.idempotency_key AS key
      FROM deposits d JOIN settlement_operations o ON o.id = d.operation_id WHERE d.id = ${depositId}`)).rows[0];
  if (!row) throw new DomainError("INVARIANT_VIOLATION", { detail: "unknown deposit" });
  if (row.redirect_url || row.status !== "INITIATED") return { depositId, redirectUrl: row.redirect_url };
  let outcome: ProviderOutcome & { redirectUrl?: string };
  try {
    outcome = await ctx.provider.startDeposit({ idempotencyKey: row.key, userAccountRef: `user:${row.user_id}`, amount: Number(row.amount_cents), returnUrl });
  } catch (e) {
    await ctx.db.execute(sql`UPDATE settlement_operations SET status = 'UNKNOWN', attempts = attempts + 1, last_error = ${String(e)}, updated_at = now() WHERE id = ${row.op_id}`);
    throw new DomainError("PAYMENT_PENDING", { userMessage: "De betaalpartner reageert nu niet. Probeer het zo opnieuw; er is niets afgeschreven." });
  }
  await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE settlement_operations SET status = 'SUBMITTED', attempts = attempts + 1, provider_reference = ${outcome.providerReference}, updated_at = now() WHERE id = ${row.op_id} AND status IN ('CREATED','UNKNOWN')`);
    await tx.execute(sql`UPDATE deposits SET provider_reference = ${outcome.providerReference}, redirect_url = ${outcome.redirectUrl ?? null} WHERE id = ${depositId}`);
  });
  return { depositId, redirectUrl: outcome.redirectUrl ?? null };
}

/**
 * The person came back from the checkout page. We may ask the provider for
 * the status (server to server), but the return itself confirms nothing.
 */
export async function refreshDeposit(ctx: PaymentsCtx, userId: string, depositId: string): Promise<string> {
  const row = (await ctx.db.execute<{ op_id: string; key: string; status: string }>(sql`
    SELECT o.id AS op_id, o.idempotency_key AS key, d.status FROM deposits d JOIN settlement_operations o ON o.id = d.operation_id
     WHERE d.id = ${depositId} AND d.user_id = ${userId}`)).rows[0];
  if (!row) throw new DomainError("ACTION_NOT_ALLOWED");
  if (["CONFIRMED", "FAILED", "REVERSED"].includes(row.status)) return row.status;
  const outcome = await ctx.provider.queryStatus({ idempotencyKey: row.key });
  await ctx.db.transaction((tx) => applyOperationOutcome(tx, ctx.mode, row.op_id, outcome));
  return (await ctx.db.execute<{ status: string }>(sql`SELECT status FROM deposits WHERE id = ${depositId}`)).rows[0]!.status;
}

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------
export async function requestWithdrawal(ctx: PaymentsCtx, input: { userId: string; amount: number; requestKey: string }): Promise<{ withdrawalId: string; status: string }> {
  await assertAllowed(ctx.db, input.userId, "WITHDRAW", ctx.mode);
  const endpoint = "POST /withdrawals";
  const withdrawalId = await ctx.db.transaction(async (tx) => {
    const prior = await claimRequest(tx, input.userId, endpoint, input.requestKey, `amount=${input.amount}`);
    if (prior) return prior.withdrawalId as string;
    if (await reconciliationHold(tx, input.userId)) throw new DomainError("RECONCILIATION_HOLD");
    const account = (await tx.execute<{ id: string }>(sql`
      SELECT id FROM payment_accounts WHERE user_id = ${input.userId} AND provider = ${ctx.providerName} AND status = 'ACTIVE' ORDER BY created_at LIMIT 1`)).rows[0];
    if (!account) throw new DomainError("PAYMENT_ACCOUNT_MISSING");
    // Lock the available balance first; the hold and an order cannot both use it (AT-31).
    await tx.execute(sql`SELECT id FROM ledger_accounts WHERE owner_user_id = ${input.userId} AND type = 'CUSTOMER_AVAILABLE' FOR UPDATE`);
    validateWithdrawalAmount(cents(input.amount), cents((await balancesFor(tx, input.userId)).available));
    const id = randomUUID();
    const op = (await tx.execute<{ id: string }>(sql`
      INSERT INTO settlement_operations(type, idempotency_key, provider, amount_cents, status, user_id)
      VALUES ('WITHDRAWAL', ${`withdrawal:${id}`}, ${ctx.providerName}, ${input.amount}, 'CREATED', ${input.userId}) RETURNING id`)).rows[0]!;
    await tx.execute(sql`
      INSERT INTO withdrawals(id, user_id, amount_cents, payment_account_id, status, operation_id)
      VALUES (${id}, ${input.userId}, ${input.amount}, ${account.id}, 'HELD', ${op.id})`);
    await book(tx, ctx.mode, "payments", postings.withdrawalHeld(input.userId, id, input.amount));
    await writeAudit(tx, { actorId: input.userId, actorKind: "USER", action: "WITHDRAWAL_REQUESTED", entityType: "withdrawal", entityId: id, related: { amount: input.amount } });
    await storeResponse(tx, input.userId, endpoint, input.requestKey, { withdrawalId: id });
    return id;
  });
  return { withdrawalId, status: await submitWithdrawal(ctx, withdrawalId) };
}

/** Submit (or replay with the same key) a payout. A timeout leaves it pending, never failed. */
export async function submitWithdrawal(ctx: PaymentsCtx, withdrawalId: string): Promise<string> {
  const row = (await ctx.db.execute<{ op_id: string; key: string; op_status: string; amount_cents: string; user_id: string; display_ref: string | null; account_ref: string }>(sql`
    SELECT o.id AS op_id, o.idempotency_key AS key, o.status::text AS op_status, w.amount_cents, w.user_id, pa.display_ref, pa.provider_account_id AS account_ref
      FROM withdrawals w JOIN settlement_operations o ON o.id = w.operation_id JOIN payment_accounts pa ON pa.id = w.payment_account_id
     WHERE w.id = ${withdrawalId}`)).rows[0];
  if (!row) throw new DomainError("INVARIANT_VIOLATION", { detail: "unknown withdrawal" });
  if (!["CREATED", "UNKNOWN", "SUBMITTED"].includes(row.op_status)) return currentWithdrawalStatus(ctx.db, withdrawalId);
  let outcome: ProviderOutcome;
  try {
    outcome = await ctx.provider.payout({ idempotencyKey: row.key, userAccountRef: row.account_ref, amount: Number(row.amount_cents), destinationRef: row.display_ref ?? row.account_ref });
  } catch (e) {
    await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE settlement_operations SET status = 'UNKNOWN', attempts = attempts + 1, last_error = ${String(e)}, updated_at = now() WHERE id = ${row.op_id} AND financially_processed_at IS NULL`);
      await tx.execute(sql`UPDATE withdrawals SET status = 'SUBMITTED' WHERE id = ${withdrawalId} AND status = 'HELD'`);
    });
    return currentWithdrawalStatus(ctx.db, withdrawalId);
  }
  await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE settlement_operations SET status = 'SUBMITTED', attempts = attempts + 1, updated_at = now() WHERE id = ${row.op_id} AND financially_processed_at IS NULL AND status IN ('CREATED','UNKNOWN')`);
    await tx.execute(sql`UPDATE withdrawals SET status = 'SUBMITTED' WHERE id = ${withdrawalId} AND status = 'HELD'`);
    await applyOperationOutcome(tx, ctx.mode, row.op_id, outcome);
  });
  return currentWithdrawalStatus(ctx.db, withdrawalId);
}

async function currentWithdrawalStatus(db: Executor, id: string): Promise<string> {
  return (await db.execute<{ status: string }>(sql`SELECT status FROM withdrawals WHERE id = ${id}`)).rows[0]!.status;
}

// ---------------------------------------------------------------------------
// Webhooks (inbox) and polling
// ---------------------------------------------------------------------------
export type WebhookResult = { http: number; result: "PROCESSED" | "DUPLICATE" | "QUEUED" | "INVALID_SIGNATURE" };

export async function handlePaymentWebhook(ctx: PaymentsCtx, input: { headers: Record<string, string>; rawBody: string }): Promise<WebhookResult> {
  const v = ctx.provider.verifyWebhook(input);
  if (!v.valid || !v.eventId) {
    // Counted for monitoring; the body itself is not kept.
    await recordWebhookRejection(ctx.db, { provider: ctx.providerName, reason: "signature", bodySha256: createHash("sha256").update(input.rawBody).digest("hex"), bytes: Buffer.byteLength(input.rawBody) });
    return { http: 401, result: "INVALID_SIGNATURE" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { http: 400, result: "INVALID_SIGNATURE" };
  }
  const ins = await ctx.db.execute(sql`
    INSERT INTO inbox_events(provider, external_event_id, payload, signature_valid)
    VALUES (${ctx.providerName}, ${v.eventId}, ${JSON.stringify(payload)}::jsonb, true)
    ON CONFLICT DO NOTHING RETURNING external_event_id`);
  if (!ins.rows.length) {
    const prior = (await ctx.db.execute<{ processing_status: string }>(sql`SELECT processing_status FROM inbox_events WHERE provider = ${ctx.providerName} AND external_event_id = ${v.eventId}`)).rows[0]!;
    if (prior.processing_status !== "RECEIVED") return { http: 200, result: "DUPLICATE" };
  }
  return processInboxEvent(ctx, v.eventId);
}

/** Process one stored event: look up the operation and ask the provider for the status. */
export async function processInboxEvent(ctx: PaymentsCtx, eventId: string): Promise<WebhookResult> {
  const ev = (await ctx.db.execute<{ payload: { reference?: string } }>(sql`SELECT payload FROM inbox_events WHERE provider = ${ctx.providerName} AND external_event_id = ${eventId}`)).rows[0];
  const reference = ev?.payload.reference;
  const op = reference
    ? (await ctx.db.execute<{ id: string; key: string }>(sql`SELECT id, idempotency_key AS key FROM settlement_operations WHERE provider = ${ctx.providerName} AND provider_reference = ${reference}`)).rows[0]
    : undefined;
  // Not linked yet (e.g. the provider answered after our call timed out): keep it; polling links it.
  if (!op) return { http: 202, result: "QUEUED" };
  const outcome = await ctx.provider.queryStatus({ idempotencyKey: op.key });
  const applied = await ctx.db.transaction(async (tx) => {
    const r = await applyOperationOutcome(tx, ctx.mode, op.id, outcome);
    await tx.execute(sql`UPDATE inbox_events SET processing_status = 'PROCESSED', processed_at = now() WHERE provider = ${ctx.providerName} AND external_event_id = ${eventId}`);
    return r;
  });
  // A finished settlement frees its market for the next match.
  if (applied === "FINALISED") await continueAfter(ctx, op.id);
  return { http: 200, result: "PROCESSED" };
}

/**
 * Worker job: query or replay open operations (docs/07 "Settlementpolling"),
 * then retry stored events that could not be linked before.
 */
export async function pollOpenOperations(ctx: PaymentsCtx, opts: { olderThanSeconds?: number; abandonAfterSeconds?: number } = {}): Promise<{ checked: number; finalised: number }> {
  const older = opts.olderThanSeconds ?? 10;
  const abandon = opts.abandonAfterSeconds ?? 15 * 60;
  const ops = (await ctx.db.execute<OpRow & { age: number }>(sql`
    SELECT id, type, execution_id, allocation_id, idempotency_key, provider_reference, amount_cents, status::text, user_id, financially_processed_at, created_at,
           extract(epoch FROM now() - created_at)::int AS age
      FROM settlement_operations
     WHERE type IN ('DEPOSIT','WITHDRAWAL','SECONDARY_SETTLEMENT','PRIMARY_SETTLEMENT') AND provider = ${ctx.providerName} AND financially_processed_at IS NULL
       AND status IN ('CREATED','SUBMITTED','PENDING','UNKNOWN') AND updated_at <= now() - make_interval(secs => ${older})
     ORDER BY updated_at LIMIT 50`)).rows;
  let finalised = 0;
  for (const op of ops) {
    await ctx.db.execute(sql`UPDATE settlement_operations SET updated_at = now() WHERE id = ${op.id}`);
    if (op.type === "WITHDRAWAL" && (op.status === "CREATED" || op.status === "UNKNOWN")) {
      const wd = (await ctx.db.execute<{ id: string }>(sql`SELECT id FROM withdrawals WHERE operation_id = ${op.id}`)).rows[0]!;
      const s = await submitWithdrawal(ctx, wd.id); // replay with the same key
      if (s === "PAID" || s === "FAILED") finalised++;
      continue;
    }
    if (op.type === "SECONDARY_SETTLEMENT" && (op.status === "CREATED" || op.status === "UNKNOWN")) {
      // Never submitted, or the answer was lost: replay with the same key.
      const s = await submitSettlement(ctx, op.execution_id!);
      if (s === "SETTLED" || s === "FAILED") {
        finalised++;
        await continueAfterOperation(ctx, op.id);
      }
      continue;
    }
    if (op.type === "PRIMARY_SETTLEMENT" && (op.status === "CREATED" || op.status === "UNKNOWN")) {
      const s = await submitAllocation(ctx, op.allocation_id!);
      if (s === "DELIVERED" || s === "FAILED") {
        finalised++;
        await continueAfterAllocationOperation(ctx, op.id);
      }
      continue;
    }
    const outcome = await ctx.provider.queryStatus({ idempotencyKey: op.idempotency_key });
    if (op.type === "DEPOSIT" && outcome.status === "UNKNOWN" && op.age > abandon) {
      // The provider never received this checkout request: no money moved.
      await ctx.db.transaction(async (tx) => {
        await applyOperationOutcome(tx, ctx.mode, op.id, { status: "FAILED", providerReference: null, reason: "Betaling kon niet worden gestart", definitive: true });
      });
      finalised++;
      continue;
    }
    const r = await ctx.db.transaction((tx) => applyOperationOutcome(tx, ctx.mode, op.id, outcome));
    if (r === "FINALISED") {
      finalised++;
      await continueAfter(ctx, op.id);
    }
  }
  // Events that arrived before their operation was linked.
  const waiting = (await ctx.db.execute<{ external_event_id: string; old: boolean }>(sql`
    SELECT external_event_id, received_at < now() - interval '1 day' AS old FROM inbox_events
     WHERE provider = ${ctx.providerName} AND processing_status = 'RECEIVED' AND received_at <= now() - make_interval(secs => ${older})
     ORDER BY received_at LIMIT 50`)).rows;
  for (const e of waiting) {
    const r = await processInboxEvent(ctx, e.external_event_id);
    if (r.result === "QUEUED" && e.old) {
      await ctx.db.execute(sql`UPDATE inbox_events SET processing_status = 'IGNORED', processed_at = now() WHERE provider = ${ctx.providerName} AND external_event_id = ${e.external_event_id}`);
    }
  }
  return { checked: ops.length, finalised };
}

/** A finished settlement frees its market (secondary) or its drop (primary) for the next step. */
async function continueAfter(ctx: PaymentsCtx, opId: string): Promise<void> {
  const t = (await ctx.db.execute<{ type: string }>(sql`SELECT type FROM settlement_operations WHERE id = ${opId}`)).rows[0]?.type;
  if (t === "SECONDARY_SETTLEMENT") await continueAfterOperation(ctx, opId);
  else if (t === "PRIMARY_SETTLEMENT") await continueAfterAllocationOperation(ctx, opId);
}

// ---------------------------------------------------------------------------
// Reads for the Betalingen screen
// ---------------------------------------------------------------------------
export type PaymentHistoryItem = {
  id: string;
  kind: "DEPOSIT" | "WITHDRAWAL";
  amountCents: number;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
  redirectUrl: string | null;
  isOpening: boolean;
};

export async function paymentHistory(db: Executor, userId: string, limit = 50): Promise<PaymentHistoryItem[]> {
  const r = await db.execute<{ id: string; kind: "DEPOSIT" | "WITHDRAWAL"; amount_cents: string; status: string; created_at: string; completed_at: string | null; failure_reason: string | null; redirect_url: string | null; is_opening: boolean }>(sql`
    SELECT * FROM (
      SELECT d.id, 'DEPOSIT' AS kind, d.amount_cents, d.status, d.created_at, d.confirmed_at AS completed_at, d.failure_reason, d.redirect_url,
             o.idempotency_key LIKE 'opening-%' AS is_opening
        FROM deposits d LEFT JOIN settlement_operations o ON o.id = d.operation_id WHERE d.user_id = ${userId}
      UNION ALL
      SELECT w.id, 'WITHDRAWAL', w.amount_cents, w.status, w.created_at, w.completed_at, w.failure_reason, NULL, false
        FROM withdrawals w WHERE w.user_id = ${userId}
    ) x ORDER BY created_at DESC LIMIT ${limit}`);
  return r.rows.map((x) => ({
    id: x.id, kind: x.kind, amountCents: Number(x.amount_cents), status: x.status, createdAt: new Date(x.created_at),
    completedAt: x.completed_at ? new Date(x.completed_at) : null, failureReason: x.failure_reason, redirectUrl: x.redirect_url, isOpening: x.is_opening,
  }));
}

export async function paymentAccountFor(db: Executor, userId: string, provider: string): Promise<{ status: string; displayRef: string | null } | null> {
  const r = (await db.execute<{ status: string; display_ref: string | null }>(sql`
    SELECT status, display_ref FROM payment_accounts WHERE user_id = ${userId} AND provider = ${provider} ORDER BY created_at LIMIT 1`)).rows[0];
  return r ? { status: r.status, displayRef: r.display_ref } : null;
}

// ---------------------------------------------------------------------------
// Adapter selection
// ---------------------------------------------------------------------------
/**
 * Build the payments context for the configured adapter. Only the demo
 * simulator exists until a payment partner is chosen (O-02); production
 * refuses the simulator at startup (env-check, AT-35).
 */
export function paymentsContext(db: Db, cfg: { mode: AppMode; adapters: { payment: string }; paymentWebhookSecret: string; dropSeedKey?: string }, opts: { scenario?: SimScenarioName } = {}): PaymentsCtx & { simulator: PaymentSimulator | null; seedKey: Buffer } {
  const seedKey = parseSeedKey(cfg.dropSeedKey ?? "");
  if (cfg.adapters.payment === "demo") {
    if (cfg.mode !== "demo") throw new Error("de betaalsimulator is alleen toegestaan in demo-modus");
    const simulator = createPaymentSimulator(db, { secret: cfg.paymentWebhookSecret, scenarioFor: () => opts.scenario ?? "SUCCESS" });
    return { db, provider: simulator, providerName: SIM_PROVIDER, mode: cfg.mode, simulator, seedKey };
  }
  throw new Error(`betaalpartner "${cfg.adapters.payment}" is nog niet aangesloten (O-02)`);
}

/** For the demo checkout page: whose payment is this, for how much. */
export async function depositByReference(db: Executor, reference: string): Promise<{ userId: string; amountCents: number; depositId: string; status: string } | null> {
  const r = (await db.execute<{ user_id: string; amount_cents: string; id: string; status: string }>(sql`
    SELECT d.user_id, d.amount_cents, d.id, d.status FROM deposits d JOIN settlement_operations o ON o.id = d.operation_id
     WHERE o.provider_reference = ${reference} AND o.type = 'DEPOSIT'`)).rows[0];
  return r ? { userId: r.user_id, amountCents: Number(r.amount_cents), depositId: r.id, status: r.status } : null;
}
