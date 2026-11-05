/**
 * Two-person approval for sensitive actions (docs/10 "Gevoelige acties").
 *
 * 1. A requester records the exact action and payload. The database computes
 *    the payload hash and refuses any later change to the payload (AT-34).
 * 2. A different user with `approvals.decide` approves or rejects.
 * 3. The action is executed inside its own transaction, which locks the
 *    approval, checks it is APPROVED for exactly this action and payload,
 *    and marks it EXECUTED, so it can only be used once.
 */
import { sql } from "drizzle-orm";
import { DomainError } from "@px/domain";
import type { Db, Executor } from "./client.ts";
import { requirePermission, writeAudit, type Identity } from "./identity.ts";

export const APPROVAL_ACTIONS = {
  PUBLISH_PROGRAMME: { requestPermission: "issuance.prepare", label: "Uitgifteprogramma publiceren" },
} as const;
export type ApprovalAction = keyof typeof APPROVAL_ACTIONS;

type Actor = Pick<Identity, "id" | "permissions">;

export type ApprovalRow = {
  id: string;
  action_type: ApprovalAction;
  payload: Record<string, unknown>;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "EXECUTED" | "INVALIDATED";
  requested_by: string;
  approved_by: string | null;
  reason: string;
  created_at: string;
};

export async function requestApproval(
  db: Executor,
  actor: Actor,
  input: { action: ApprovalAction; payload: Record<string, unknown>; reason: string },
): Promise<string> {
  requirePermission(actor, APPROVAL_ACTIONS[input.action].requestPermission);
  const reason = input.reason.trim();
  if (reason.length < 5) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Geef een reden van minimaal 5 tekens." });
  const payload = JSON.stringify(input.payload);
  const res = await db.execute<{ id: string }>(sql`
    INSERT INTO admin_approvals(action_type, payload, payload_hash, requested_by, reason)
    VALUES (${input.action}, ${payload}::jsonb,
            encode(digest(${input.action} || '|' || ${payload}::jsonb::text, 'sha256'), 'hex'),
            ${actor.id}, ${reason})
    RETURNING id`);
  const id = res.rows[0]!.id;
  await writeAudit(db, { actorId: actor.id, actorKind: "ADMIN", action: "APPROVAL_REQUESTED", reason, entityType: "admin_approval", entityId: id, related: { action: input.action, payload: input.payload } });
  return id;
}

export async function decideApproval(db: Db, actor: Actor, input: { approvalId: string; decision: "APPROVE" | "REJECT"; reason: string }): Promise<void> {
  requirePermission(actor, "approvals.decide");
  const reason = input.reason.trim();
  if (reason.length < 5) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Geef een reden van minimaal 5 tekens." });
  await db.transaction(async (tx) => {
    const row = (await tx.execute<ApprovalRow>(sql`SELECT * FROM admin_approvals WHERE id = ${input.approvalId} FOR UPDATE`)).rows[0];
    if (!row || row.status !== "REQUESTED") throw new DomainError("ACTION_NOT_ALLOWED", { detail: "not open" });
    if (row.requested_by === actor.id) throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "Je kunt je eigen verzoek niet goedkeuren." });
    await tx.execute(sql`
      UPDATE admin_approvals SET status = ${input.decision === "APPROVE" ? "APPROVED" : "REJECTED"},
             approved_by = ${actor.id}, decided_at = now()
       WHERE id = ${row.id}`);
    await writeAudit(tx, {
      actorId: actor.id, actorKind: "ADMIN", action: input.decision === "APPROVE" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED",
      reason, entityType: "admin_approval", entityId: row.id, related: { action: row.action_type },
    });
  });
}

/** Consume an approval inside the caller's transaction; throws unless it matches exactly. */
export async function consumeApproval(tx: Executor, executorId: string, approvalId: string, action: ApprovalAction, payload: Record<string, unknown>): Promise<void> {
  const row = (await tx.execute<ApprovalRow & { matches: boolean }>(sql`
    SELECT *, (payload = ${JSON.stringify(payload)}::jsonb) AS matches
      FROM admin_approvals WHERE id = ${approvalId} FOR UPDATE`)).rows[0];
  if (!row) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "unknown approval" });
  if (row.status !== "APPROVED") throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: row.status === "REQUESTED" ? "Deze handeling is nog niet goedgekeurd." : "Deze goedkeuring is niet (meer) bruikbaar." });
  if (row.action_type !== action || !row.matches) {
    // The thing being executed is not what was approved (AT-34).
    throw new DomainError("ACTION_NOT_ALLOWED", { userMessage: "De goedkeuring hoort niet bij deze (gewijzigde) handeling. Vraag opnieuw goedkeuring aan." });
  }
  await tx.execute(sql`UPDATE admin_approvals SET status = 'EXECUTED', executed_by = ${executorId}, executed_at = now() WHERE id = ${row.id}`);
}

/** Invalidate open approvals for an object whose content changed. */
export async function invalidateApprovals(tx: Executor, action: ApprovalAction, key: string, value: string): Promise<void> {
  await tx.execute(sql`
    UPDATE admin_approvals SET status = 'INVALIDATED', decided_at = now()
     WHERE action_type = ${action} AND status IN ('REQUESTED','APPROVED') AND payload ->> ${key} = ${value}`);
}

export async function listApprovals(db: Executor, opts: { status?: string; limit?: number } = {}) {
  const filter = opts.status ? sql`WHERE a.status = ${opts.status}` : sql``;
  const res = await db.execute<ApprovalRow & { requester: string | null; approver: string | null }>(sql`
    SELECT a.*, rq.display_name AS requester, ap.display_name AS approver
      FROM admin_approvals a
      LEFT JOIN user_profiles rq ON rq.user_id = a.requested_by
      LEFT JOIN user_profiles ap ON ap.user_id = a.approved_by
      ${filter}
     ORDER BY a.created_at DESC LIMIT ${opts.limit ?? 50}`);
  return res.rows;
}

