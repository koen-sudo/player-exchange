/**
 * Integrations evidence and operations (fase 8, docs/07, docs/10).
 *
 * - Contract test runs against the configured adapters, stored as evidence.
 * - Monitoring signals with an operational owner; alerts that stay open
 *   until the signal is healthy again, and can be acknowledged with a note.
 * - Ledger corrections only with a second person's approval.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import { CONTRACT_KEY_PREFIX, runFootballDataContract, runPaymentContract, type ContractResult, type FootballDataProvider } from "@px/integrations";
import type { Db, Executor } from "./client.ts";
import { consumeApproval, requestApproval } from "./approvals.ts";
import { requirePermission, writeAudit, type Identity } from "./identity.ts";
import { inventoryInvariants } from "./inventory.ts";
import { book, ledgerInvariants, postings } from "./ledger.ts";
import type { PaymentSimulator } from "./payment-simulator.ts";
import type { PaymentsCtx } from "./payments.ts";
import { tradingInvariants } from "./trading.ts";
import { issuanceInvariants } from "./drops.ts";

type Actor = Pick<Identity, "id" | "permissions">;

// ---------------------------------------------------------------------------
// Contract tests as evidence
// ---------------------------------------------------------------------------
/** Harness for the demo simulator. A sandbox adapter brings its own (test card, waiting). */
export function simulatorHarness(sim: PaymentSimulator, runId = randomUUID().slice(0, 8)) {
  return {
    provider: sim,
    accountRef: `${CONTRACT_KEY_PREFIX}account`,
    runId,
    completeDeposit: (reference: string) => sim.decideDeposit(reference, "SUCCESS"),
    settle: async () => undefined,
    async sampleWebhook() {
      const rawBody = JSON.stringify({ eventId: `evt_${CONTRACT_KEY_PREFIX}${runId}`, type: "deposit.succeeded", reference: "contract", amountCents: 100, at: new Date().toISOString() });
      return { headers: { "x-psp-signature": sim.sign(rawBody) }, rawBody };
    },
  };
}

async function storeRun(db: Executor, kind: "PAYMENT" | "FOOTBALL_DATA", adapter: string, environment: string, results: ContractResult[], actorId: string | null) {
  const count = (s: string) => results.filter((r) => r.status === s).length;
  const r = (await db.execute<{ id: string }>(sql`
    INSERT INTO adapter_contract_runs(kind, adapter, environment, results, passed, failed, blocked, ran_by)
    VALUES (${kind}, ${adapter}, ${environment}, ${JSON.stringify(results)}::jsonb, ${count("PASSED")}, ${count("FAILED")}, ${count("BLOCKED")}, ${actorId})
    RETURNING id`)).rows[0]!;
  return r.id;
}

/** Run the payment and football data contracts against the configured adapters and keep the results. */
export async function runContractTests(ctx: PaymentsCtx & { simulator: PaymentSimulator | null }, football: FootballDataProvider, actor: Actor | null) {
  if (actor) requirePermission(actor, "operations.view");
  const report = ctx.provider.capabilities();
  if (!ctx.simulator) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Voor deze betaalpartner is nog geen testharnas (sandbox) aangesloten." });
  const payment = await runPaymentContract(simulatorHarness(ctx.simulator));
  const data = await runFootballDataContract(football);
  const paymentRun = await storeRun(ctx.db, "PAYMENT", report.adapter, report.environment, payment, actor?.id ?? null);
  const dataRun = await storeRun(ctx.db, "FOOTBALL_DATA", football.name, "demo", data, actor?.id ?? null);
  if (actor) await writeAudit(ctx.db, { actorId: actor.id, actorKind: "ADMIN", action: "CONTRACT_TESTS_RUN", reason: "Contracttests uitgevoerd", entityType: "adapter_contract_run", entityId: paymentRun, related: { dataRun } });
  return { payment, data };
}

export async function latestContractRuns(db: Executor) {
  return (await db.execute<{ id: string; kind: string; adapter: string; environment: string; results: ContractResult[]; passed: number; failed: number; blocked: number; ran_at: string }>(sql`
    SELECT DISTINCT ON (kind) id, kind, adapter, environment, results, passed, failed, blocked, ran_at::text FROM adapter_contract_runs ORDER BY kind, ran_at DESC`)).rows;
}

export async function recordWebhookRejection(db: Executor, input: { provider: string; reason: string; bodySha256: string; bytes: number }) {
  await db.execute(sql`INSERT INTO webhook_rejections(provider, reason, body_sha256, body_bytes) VALUES (${input.provider}, ${input.reason}, ${input.bodySha256}, ${input.bytes})`);
}

// ---------------------------------------------------------------------------
// Monitoring signals (docs/10 "Monitoring")
// ---------------------------------------------------------------------------
export type Signal = { key: string; label: string; owner: string; status: "OK" | "WARNING" | "CRITICAL"; value: number; detail: string; runbook: string };

export async function evaluateSignals(db: Executor): Promise<Signal[]> {
  const q = (await db.execute<Record<string, number | null>>(sql`
    SELECT
      (SELECT extract(epoch FROM now() - max(finished_at)) / 3600 FROM import_runs WHERE status = 'COMPLETED')::float AS import_age_h,
      (SELECT count(*) FROM import_runs WHERE status = 'FAILED' AND created_at > now() - interval '24 hours')::int AS import_failed,
      (SELECT count(*) FROM import_runs WHERE status IN ('QUEUED','RUNNING') AND created_at < now() - interval '10 minutes')::int AS queue_backlog,
      (SELECT extract(epoch FROM now() - max(published_at)) / 86400 FROM valuation_runs WHERE status = 'PUBLISHED')::float AS reference_age_d,
      (SELECT count(*) FROM settlement_operations WHERE financially_processed_at IS NULL AND status IN ('CREATED','SUBMITTED','PENDING','UNKNOWN','MANUAL_REVIEW') AND created_at < now() - interval '15 minutes')::int AS pending_15,
      (SELECT count(*) FROM settlement_operations WHERE financially_processed_at IS NULL AND status IN ('CREATED','SUBMITTED','PENDING','UNKNOWN','MANUAL_REVIEW') AND created_at < now() - interval '60 minutes')::int AS pending_60,
      (SELECT count(*) FROM settlement_operations WHERE status = 'FAILED' AND type IN ('SECONDARY_SETTLEMENT','PRIMARY_SETTLEMENT') AND updated_at > now() - interval '24 hours')::int AS failed_settlements,
      (SELECT count(*) FROM reconciliation_breaks WHERE status <> 'RESOLVED' AND severity = 'MATERIAL')::int AS breaks,
      (SELECT extract(epoch FROM now() - max(created_at)) / 3600 FROM reconciliation_runs)::float AS recon_age_h,
      (SELECT count(*) FROM webhook_rejections WHERE received_at > now() - interval '24 hours')::int AS webhook_rejections,
      (SELECT count(*) FROM withdrawals WHERE (status NOT IN ('PAID','FAILED') AND created_at < now() - interval '1 hour') OR (status = 'FAILED' AND completed_at > now() - interval '24 hours'))::int AS payout_problems`)).rows[0]!;
  const [ledger, inventory, trading, issuance] = await Promise.all([ledgerInvariants(db), inventoryInvariants(db), tradingInvariants(db), issuanceInvariants(db)]);
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const n = (k: string) => Number(q[k] ?? 0);
  const s: Signal[] = [];
  const add = (key: string, label: string, owner: string, value: number, warn: boolean, crit: boolean, detail: string, runbook: string) =>
    s.push({ key, label, owner, value: Math.round(value * 10) / 10, status: crit ? "CRITICAL" : warn ? "WARNING" : "OK", detail, runbook });

  const importAge = q.import_age_h === null ? Infinity : n("import_age_h");
  add("import.delay", "Importvertraging", "CATALOG_MANAGER", Number.isFinite(importAge) ? importAge : -1, importAge > 26 || n("import_failed") > 0, importAge > 72,
    Number.isFinite(importAge) ? `Laatste geslaagde import ${Math.round(importAge)} uur geleden; ${n("import_failed")} mislukt in 24 uur` : "Nog geen geslaagde import", "docs/runbooks/import-vertraagd.md");
  add("queue.backlog", "Queueachterstand", "CATALOG_MANAGER", n("queue_backlog"), n("queue_backlog") > 0, n("queue_backlog") > 3, `${n("queue_backlog")} importtaken wachten langer dan 10 minuten`, "docs/runbooks/import-vertraagd.md");
  const refAge = q.reference_age_d === null ? Infinity : n("reference_age_d");
  add("valuation.stale", "Verouderde referenties", "VALUATION_ANALYST", Number.isFinite(refAge) ? refAge : -1, refAge > 8, refAge > 15,
    Number.isFinite(refAge) ? `Laatste publicatie ${Math.round(refAge)} dagen geleden` : "Nog niets gepubliceerd", "docs/runbooks/waardering-niet-gepubliceerd.md");
  add("settlement.pending", "Openstaande afwikkelingen", "FINANCE_OPERATOR", n("pending_15"), n("pending_15") > 0, n("pending_60") > 0,
    `${n("pending_15")} operaties langer dan 15 minuten open, waarvan ${n("pending_60")} langer dan een uur`, "docs/runbooks/afwikkeling-blijft-open.md");
  add("provider.failed", "Gefaalde provideroperaties", "FINANCE_OPERATOR", n("failed_settlements"), n("failed_settlements") > 0, n("failed_settlements") > 5,
    `${n("failed_settlements")} afwikkelingen definitief mislukt in 24 uur`, "docs/runbooks/afwikkeling-blijft-open.md");
  const reconAge = q.recon_age_h === null ? Infinity : n("recon_age_h");
  add("reconciliation.breaks", "Reconciliatieverschillen", "FINANCE_OPERATOR", n("breaks"), reconAge > 26, n("breaks") > 0,
    `${n("breaks")} materiële verschillen open; laatste run ${Number.isFinite(reconAge) ? `${Math.round(reconAge)} uur` : "nog nooit"} geleden`, "docs/runbooks/reconciliatieverschil.md");
  add("ledger.coverage", "Dekking van reserveringen", "FINANCE_OPERATOR", sum(ledger), false, sum(ledger) > 0,
    `Ongebalanceerd ${ledger.unbalancedEntries} · saldo ≠ journaal ${ledger.projectionMismatches} · negatief ${ledger.negativeCustomerBalances} · reservering ≠ holds ${ledger.reservedNotMatchingHolds}`, "docs/runbooks/invariant-geschonden.md");
  const inv = sum(inventory) + sum(trading) + sum(issuance);
  add("inventory.diffs", "Voorraadverschillen", "ISSUANCE_OPERATOR", inv, false, inv > 0, inv ? `Voorraad ${sum(inventory)} · handel ${sum(trading)} · uitgifte ${sum(issuance)}` : "Alle voorraad-, handels- en uitgifte-invarianten in orde", "docs/runbooks/invariant-geschonden.md");
  add("webhook.rejected", "Webhookverificatiefouten", "FINANCE_OPERATOR", n("webhook_rejections"), n("webhook_rejections") > 0, n("webhook_rejections") > 20,
    `${n("webhook_rejections")} afgewezen berichten in 24 uur`, "docs/runbooks/webhook-afgewezen.md");
  add("payout.problems", "Uitbetalingsproblemen", "FINANCE_OPERATOR", n("payout_problems"), n("payout_problems") > 0, n("payout_problems") > 5,
    `${n("payout_problems")} opnames langer dan een uur open of mislukt in 24 uur`, "docs/runbooks/uitbetaling-probleem.md");
  return s;
}

/** Open, update or resolve one alert per signal (worker job). */
export async function syncAlerts(db: Db): Promise<{ open: number; resolved: number }> {
  const signals = await evaluateSignals(db);
  let open = 0;
  let resolved = 0;
  for (const sg of signals) {
    if (sg.status === "OK") {
      const r = await db.execute(sql`UPDATE monitoring_alerts SET status = 'RESOLVED', resolved_at = now() WHERE signal_key = ${sg.key} AND status <> 'RESOLVED' RETURNING id`);
      resolved += r.rows.length;
      continue;
    }
    open++;
    await db.execute(sql`
      INSERT INTO monitoring_alerts(signal_key, owner_role, severity, value, detail) VALUES (${sg.key}, ${sg.owner}, ${sg.status}, ${sg.value}, ${sg.detail})
      ON CONFLICT (signal_key) WHERE status <> 'RESOLVED'
      DO UPDATE SET last_seen_at = now(), value = EXCLUDED.value, detail = EXCLUDED.detail,
                    severity = CASE WHEN EXCLUDED.severity = 'CRITICAL' THEN 'CRITICAL' ELSE monitoring_alerts.severity END`);
  }
  return { open, resolved };
}

export async function listAlerts(db: Executor) {
  return (await db.execute<{ id: string; signal_key: string; owner_role: string; severity: string; status: string; value: string; detail: string; first_seen_at: string; last_seen_at: string; note: string | null; acknowledger: string | null }>(sql`
    SELECT a.id, a.signal_key, a.owner_role, a.severity, a.status, a.value::text, a.detail, a.first_seen_at::text, a.last_seen_at::text, a.note, up.display_name AS acknowledger
      FROM monitoring_alerts a LEFT JOIN user_profiles up ON up.user_id = a.acknowledged_by
     ORDER BY (a.status = 'RESOLVED'), a.severity = 'CRITICAL' DESC, a.last_seen_at DESC LIMIT 50`)).rows;
}

export async function acknowledgeAlert(db: Db, actor: Actor, input: { alertId: string; note: string }) {
  requirePermission(actor, "operations.view");
  const note = input.note.trim();
  if (note.length < 5) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Beschrijf in minimaal 5 tekens wat je doet." });
  const r = await db.execute(sql`
    UPDATE monitoring_alerts SET status = 'ACKNOWLEDGED', acknowledged_by = ${actor.id}, acknowledged_at = now(), note = ${note}
     WHERE id = ${input.alertId} AND status = 'OPEN' RETURNING id`);
  if (!r.rows.length) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Deze melding is al opgepakt of opgelost." });
  await writeAudit(db, { actorId: actor.id, actorKind: "ADMIN", action: "ALERT_ACKNOWLEDGED", reason: note, entityType: "monitoring_alert", entityId: input.alertId });
}

// ---------------------------------------------------------------------------
// Ledger corrections (docs/10 "Financiële correctie": four-eyes)
// ---------------------------------------------------------------------------
export type CorrectionPayload = { userId: string; amountCents: number; direction: "CREDIT" | "DEBIT"; breakId: string | null };

export async function requestLedgerCorrection(db: Db, actor: Actor, input: CorrectionPayload & { reason: string }): Promise<string> {
  requirePermission(actor, "finance.correct");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 1_000_000) throw new DomainError("AMOUNT_INVALID", { userMessage: "Kies een bedrag tussen €0,01 en €10.000." });
  const exists = (await db.execute(sql`SELECT 1 FROM users WHERE id = ${input.userId}`)).rows.length;
  if (!exists) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Onbekende gebruiker." });
  const payload: CorrectionPayload = { userId: input.userId, amountCents: input.amountCents, direction: input.direction, breakId: input.breakId ?? null };
  return requestApproval(db, actor, { action: "LEDGER_CORRECTION", payload, reason: input.reason });
}

/**
 * Book an approved correction once (the approval is consumed; the journal
 * entry is keyed on it). CREDIT gives the customer money from the platform's
 * loss account; DEBIT takes it back and cannot make the balance negative.
 */
export async function executeLedgerCorrection(db: Db, actor: Actor, input: { approvalId: string; payload: CorrectionPayload }): Promise<void> {
  requirePermission(actor, "finance.correct");
  await db.transaction(async (tx) => {
    await consumeApproval(tx, actor.id, input.approvalId, "LEDGER_CORRECTION", input.payload);
    await book(tx, "demo", "operations", postings.correction(input.payload.userId, input.approvalId, input.payload.amountCents, input.payload.direction));
    if (input.payload.breakId) {
      await tx.execute(sql`UPDATE reconciliation_breaks SET detail = detail || ${JSON.stringify({ correctionApprovalId: input.approvalId })}::jsonb WHERE id = ${input.payload.breakId}`);
    }
    await writeAudit(tx, { actorId: actor.id, actorKind: "ADMIN", action: "LEDGER_CORRECTION_BOOKED", reason: `Correctie met goedkeuring ${input.approvalId}`, entityType: "user", entityId: input.payload.userId, related: { ...input.payload } });
  });
}

/** Approved corrections waiting to be booked. */
export async function pendingCorrections(db: Executor) {
  return (await db.execute<{ id: string; payload: CorrectionPayload; reason: string; requester: string | null; approver: string | null; user_name: string | null }>(sql`
    SELECT a.id, a.payload, a.reason, ru.display_name AS requester, du.display_name AS approver, up.display_name AS user_name
      FROM admin_approvals a
      LEFT JOIN user_profiles ru ON ru.user_id = a.requested_by LEFT JOIN user_profiles du ON du.user_id = a.approved_by
      LEFT JOIN user_profiles up ON up.user_id = (a.payload->>'userId')::uuid
     WHERE a.action_type = 'LEDGER_CORRECTION' AND a.status = 'APPROVED' ORDER BY a.created_at`)).rows;
}

/** Users for the correction form (finance staff only see display names). */
export async function correctionTargets(db: Executor) {
  return (await db.execute<{ id: string; display_name: string }>(sql`
    SELECT u.id, coalesce(up.display_name, 'Onbekend') AS display_name FROM users u JOIN user_profiles up ON up.user_id = u.id ORDER BY up.display_name LIMIT 200`)).rows;
}

/** Production gates with their state (evidence and approval are required by the database). */
export async function listGates(db: Executor) {
  return (await db.execute<{ key: string; satisfied: boolean; evidence_ref: string | null }>(sql`SELECT key, satisfied, evidence_ref FROM feature_gates ORDER BY key`)).rows;
}
