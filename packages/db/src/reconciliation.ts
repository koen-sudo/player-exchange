/**
 * Reconciliation between the platform ledger and the payment provider
 * (docs/07 "Reconciliatie minimaal dagelijks", PRD-12).
 *
 * A run compares, per operation, the provider's report with our operations,
 * plus the totals and the ledger projection. Differences become breaks:
 * - MATERIAL breaks (money or a final status differs) block withdrawals for
 *   the user concerned, or for everyone when no user can be named. They are
 *   closed only by two people: one proposes the resolution, another approves
 *   ("Een beheerder kan een verschil niet alleen wegklikken").
 * - INFO breaks (a provider outcome not yet processed after the grace period)
 *   warn only, and close themselves when a later run no longer finds them.
 * A rerun never opens the same break twice (fingerprint).
 */
import { sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import type { PaymentProvider, ProviderReportLine } from "@px/integrations";
import type { Db, Executor } from "./client.ts";
import { requirePermission, writeAudit, type Identity } from "./identity.ts";

export type BreakKind = "AMOUNT" | "STATUS" | "MISSING_IN_LEDGER" | "MISSING_AT_PROVIDER" | "PROJECTION";
type Finding = { fingerprint: string; kind: BreakKind; severity: "INFO" | "MATERIAL"; userId: string | null; operationId: string | null; difference: number; detail: Record<string, unknown> };

const PROVIDER_FINAL: Record<string, "SUCCEEDED" | "FAILED" | undefined> = { SUCCEEDED: "SUCCEEDED", FAILED: "FAILED" };

export async function runReconciliation(
  db: Db,
  provider: PaymentProvider,
  providerName: string,
  opts: { graceSeconds?: number; now?: Date; scope?: string } = {},
): Promise<{ runId: string; outcome: "MATCHED" | "BREAKS_FOUND"; findings: number; opened: number; autoClosed: number }> {
  const now = opts.now ?? new Date();
  const grace = opts.graceSeconds ?? 600;
  const report = await provider.reconciliationReport({ since: new Date(0) });
  const byKey = new Map<string, ProviderReportLine>(report.map((l) => [l.idempotencyKey, l]));

  const ops = (await db.execute<{ id: string; type: string; idempotency_key: string; amount_cents: string; status: string; user_id: string | null; processed: boolean }>(sql`
    SELECT id, type, idempotency_key, amount_cents, status::text, user_id, financially_processed_at IS NOT NULL AS processed
      FROM settlement_operations WHERE provider = ${providerName} AND type IN ('DEPOSIT','WITHDRAWAL','SECONDARY_SETTLEMENT')`)).rows;

  const findings: Finding[] = [];
  const seen = new Set<string>();
  const inFlight = new Set<string>(); // final at the provider, not yet processed by us
  for (const op of ops) {
    seen.add(op.idempotency_key);
    const line = byKey.get(op.idempotency_key);
    const amount = Number(op.amount_cents);
    if (!line) {
      if (op.status === "SUCCEEDED") {
        findings.push({ fingerprint: `op:${op.id}:missing`, kind: "MISSING_AT_PROVIDER", severity: "MATERIAL", userId: op.user_id, operationId: op.id, difference: amount, detail: { type: op.type } });
      }
      continue;
    }
    if (line.amount !== amount) {
      findings.push({ fingerprint: `op:${op.id}:amount`, kind: "AMOUNT", severity: "MATERIAL", userId: op.user_id, operationId: op.id, difference: line.amount - amount, detail: { ours: amount, provider: line.amount } });
    }
    const providerFinal = PROVIDER_FINAL[line.status];
    if (!providerFinal) continue;
    if (!op.processed) inFlight.add(op.idempotency_key);
    if (op.processed && op.status !== providerFinal) {
      findings.push({ fingerprint: `op:${op.id}:status`, kind: "STATUS", severity: "MATERIAL", userId: op.user_id, operationId: op.id, difference: amount, detail: { ours: op.status, provider: line.status } });
    } else if (!op.processed && now.getTime() - new Date(line.createdAt).getTime() > grace * 1000) {
      findings.push({ fingerprint: `op:${op.id}:lag`, kind: "STATUS", severity: "INFO", userId: op.user_id, operationId: op.id, difference: 0, detail: { ours: op.status, provider: line.status, note: "Uitkomst bij betaalpartner nog niet verwerkt" } });
    }
  }
  for (const line of report) {
    if (seen.has(line.idempotencyKey) || line.status !== "SUCCEEDED" || (line.kind !== "DEPOSIT" && line.kind !== "PAYOUT")) continue;
    findings.push({ fingerprint: `provider:${line.providerReference}:missing`, kind: "MISSING_IN_LEDGER", severity: "MATERIAL", userId: null, operationId: null, difference: line.kind === "DEPOSIT" ? line.amount : -line.amount, detail: { reference: line.providerReference, kind: line.kind } });
  }

  // Totals: money the provider holds for us vs. what the ledger says it holds,
  // excluding announced-but-not-final incoming money and operations still in
  // flight (those are reported per operation above).
  const providerNet = report.filter((l) => l.status === "SUCCEEDED" && !inFlight.has(l.idempotencyKey)).reduce((n, l) => n + (l.kind === "DEPOSIT" ? l.amount : l.kind === "PAYOUT" ? -l.amount : 0), 0);
  const t = (await db.execute<{ psp: string; pending: string }>(sql`
    SELECT coalesce((SELECT balance_cents FROM ledger_accounts WHERE type = 'PSP_SETTLEMENT_ASSET' AND owner_user_id IS NULL), 0) AS psp,
           coalesce((SELECT sum(balance_cents) FROM ledger_accounts WHERE type = 'CUSTOMER_PENDING_INCOMING'), 0) AS pending`)).rows[0]!;
  const ledgerNet = Number(t.psp) - Number(t.pending);
  if (ledgerNet !== providerNet) {
    findings.push({ fingerprint: "totals:psp", kind: "AMOUNT", severity: "MATERIAL", userId: null, operationId: null, difference: providerNet - ledgerNet, detail: { ledger: ledgerNet, provider: providerNet } });
  }

  const proj = (await db.execute<{ account_id: string; owner_user_id: string | null; balance_cents: string; journal_balance: string }>(sql`SELECT account_id, owner_user_id, balance_cents, journal_balance FROM ledger_projection_mismatches`)).rows;
  for (const p of proj) {
    findings.push({ fingerprint: `projection:${p.account_id}`, kind: "PROJECTION", severity: "MATERIAL", userId: p.owner_user_id, operationId: null, difference: Number(p.journal_balance) - Number(p.balance_cents), detail: { accountId: p.account_id } });
  }

  return db.transaction(async (tx) => {
    const run = (await tx.execute<{ id: string }>(sql`INSERT INTO reconciliation_runs(scope, as_of, outcome) VALUES (${opts.scope ?? "payments"}, ${now.toISOString()}::timestamptz, 'RUNNING') RETURNING id`)).rows[0]!;
    let opened = 0;
    for (const f of findings) {
      const r = await tx.execute(sql`
        INSERT INTO reconciliation_breaks(run_id, difference_cents, severity, kind, user_id, operation_id, detail, fingerprint)
        VALUES (${run.id}, ${f.difference}, ${f.severity}, ${f.kind}, ${f.userId}, ${f.operationId}, ${JSON.stringify(f.detail)}::jsonb, ${f.fingerprint})
        ON CONFLICT (fingerprint) WHERE status <> 'RESOLVED' DO NOTHING RETURNING id`);
      opened += r.rows.length;
    }
    // Warnings that no longer reproduce close themselves; material ones never do.
    const current = findings.map((f) => f.fingerprint);
    const closed = await tx.execute(sql`
      UPDATE reconciliation_breaks SET status = 'RESOLVED', resolved_at = now(), resolution_note = ${`Niet meer aanwezig bij reconciliatie ${run.id}`}
       WHERE status <> 'RESOLVED' AND severity = 'INFO'
         AND NOT (fingerprint = ANY(${`{${current.map((c) => `"${c}"`).join(",")}}`}::text[]))
      RETURNING id`);
    const outcome = findings.length ? "BREAKS_FOUND" : "MATCHED";
    await tx.execute(sql`
      UPDATE reconciliation_runs SET outcome = ${outcome}, finished_at = now(),
             summary = ${JSON.stringify({ findings: findings.length, opened, autoClosed: closed.rows.length, providerNet, ledgerNet, operations: ops.length, providerLines: report.length })}::jsonb
       WHERE id = ${run.id}`);
    return { runId: run.id, outcome, findings: findings.length, opened, autoClosed: closed.rows.length };
  });
}

// ---------------------------------------------------------------------------
// Handling breaks (two people for material ones)
// ---------------------------------------------------------------------------
type Actor = Pick<Identity, "id" | "permissions">;

export async function proposeBreakResolution(db: Db, actor: Actor, input: { breakId: string; note: string }): Promise<void> {
  requirePermission(actor, "finance.reconcile");
  const note = input.note.trim();
  if (note.length < 10) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Beschrijf de oorzaak en oplossing in minimaal 10 tekens." });
  await db.transaction(async (tx) => {
    const b = (await tx.execute<{ status: string; severity: string }>(sql`SELECT status, severity FROM reconciliation_breaks WHERE id = ${input.breakId} FOR UPDATE`)).rows[0];
    if (!b || b.status === "RESOLVED") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Dit verschil is al afgehandeld." });
    const resolveNow = b.severity === "INFO";
    await tx.execute(sql`
      UPDATE reconciliation_breaks SET resolution_note = ${note}, resolved_by = ${actor.id}, approved_by = NULL,
             status = ${resolveNow ? "RESOLVED" : "INVESTIGATING"}, resolved_at = ${resolveNow ? sql`now()` : null}
       WHERE id = ${input.breakId}`);
    await writeAudit(tx, { actorId: actor.id, actorKind: "ADMIN", action: resolveNow ? "RECONCILIATION_BREAK_RESOLVED" : "RECONCILIATION_RESOLUTION_PROPOSED", reason: note, entityType: "reconciliation_break", entityId: input.breakId });
  });
}

export async function approveBreakResolution(db: Db, actor: Actor, input: { breakId: string; reason: string }): Promise<void> {
  requirePermission(actor, "approvals.decide");
  const reason = input.reason.trim();
  if (reason.length < 5) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Geef een reden van minimaal 5 tekens." });
  await db.transaction(async (tx) => {
    const b = (await tx.execute<{ status: string; resolved_by: string | null }>(sql`SELECT status, resolved_by FROM reconciliation_breaks WHERE id = ${input.breakId} FOR UPDATE`)).rows[0];
    if (!b || b.status !== "INVESTIGATING" || !b.resolved_by) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Er is nog geen voorstel om goed te keuren." });
    if (b.resolved_by === actor.id) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Je kunt je eigen voorstel niet goedkeuren." });
    await tx.execute(sql`UPDATE reconciliation_breaks SET approved_by = ${actor.id}, status = 'RESOLVED', resolved_at = now() WHERE id = ${input.breakId}`);
    await writeAudit(tx, { actorId: actor.id, actorKind: "ADMIN", action: "RECONCILIATION_BREAK_RESOLVED", reason, entityType: "reconciliation_break", entityId: input.breakId });
  });
}

// ---------------------------------------------------------------------------
// Reads for beheer
// ---------------------------------------------------------------------------
export type BreakRow = {
  id: string; kind: BreakKind; severity: "INFO" | "MATERIAL"; status: string; difference_cents: string; user_id: string | null; user_name: string | null;
  operation_id: string | null; detail: Record<string, unknown>; resolution_note: string | null; resolved_by: string | null; resolver: string | null; created_at: string;
};

export async function listBreaks(db: Executor, opts: { open?: boolean; limit?: number } = {}): Promise<BreakRow[]> {
  const filter = opts.open ? sql`WHERE b.status <> 'RESOLVED'` : sql``;
  return (await db.execute<BreakRow>(sql`
    SELECT b.id, b.kind, b.severity, b.status, b.difference_cents, b.user_id, up.display_name AS user_name, b.operation_id, b.detail,
           b.resolution_note, b.resolved_by, rp.display_name AS resolver, b.created_at::text
      FROM reconciliation_breaks b
      LEFT JOIN user_profiles up ON up.user_id = b.user_id
      LEFT JOIN user_profiles rp ON rp.user_id = b.resolved_by
      ${filter}
     ORDER BY (b.status = 'RESOLVED'), b.created_at DESC LIMIT ${opts.limit ?? 100}`)).rows;
}

export async function listReconciliationRuns(db: Executor, limit = 10) {
  return (await db.execute<{ id: string; outcome: string; as_of: string; finished_at: string | null; summary: Record<string, number> }>(sql`
    SELECT id, outcome, as_of::text, finished_at::text, summary FROM reconciliation_runs ORDER BY created_at DESC LIMIT ${limit}`)).rows;
}

/** Operations that need attention: unknown outcome, or pending for long. */
export async function listOpenOperations(db: Executor, limit = 50) {
  return (await db.execute<{ id: string; type: string; status: string; amount_cents: string; user_name: string | null; provider_reference: string | null; attempts: number; last_error: string | null; created_at: string }>(sql`
    SELECT o.id, o.type, o.status::text, o.amount_cents, up.display_name AS user_name, o.provider_reference, o.attempts, o.last_error, o.created_at::text
      FROM settlement_operations o LEFT JOIN user_profiles up ON up.user_id = o.user_id
     WHERE o.financially_processed_at IS NULL AND o.status IN ('CREATED','SUBMITTED','PENDING','UNKNOWN','MANUAL_REVIEW')
     ORDER BY o.created_at LIMIT ${limit}`)).rows;
}

/** Platform-wide money totals for the finance screen (integer cents). */
export async function ledgerTotals(db: Executor) {
  const r = (await db.execute<{ type: string; total: string }>(sql`
    SELECT type::text AS type, sum(balance_cents)::bigint AS total FROM ledger_accounts GROUP BY type`)).rows;
  const get = (t: string) => Number(r.find((x) => x.type === t)?.total ?? 0);
  return {
    pspAsset: get("PSP_SETTLEMENT_ASSET"),
    customerAvailable: get("CUSTOMER_AVAILABLE"),
    customerReserved: get("CUSTOMER_RESERVED"),
    pendingIncoming: get("CUSTOMER_PENDING_INCOMING"),
    pendingSettlement: get("PENDING_SETTLEMENT"),
    pendingWithdrawal: get("PENDING_WITHDRAWAL"),
    receivables: get("CUSTOMER_RECEIVABLE"),
    feeClearing: get("PLATFORM_FEE_CLEARING"),
    primaryRevenue: get("PRIMARY_REVENUE_CLEARING"),
  };
}
