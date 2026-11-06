/**
 * Deterministic payment-provider simulator (fase 4, O-02). Demo only.
 *
 * It plays the external payment partner: it keeps its own records in the
 * `psp_sim` schema, answers with idempotency keys, and sends HMAC-signed
 * webhooks that the platform must verify, deduplicate and process once.
 *
 * Scenarios (docs/11 fase 4: success, delay, duplicate messages, failure,
 * unknown outcome):
 *   SUCCESS             succeeded + one webhook
 *   DELAYED             pending now, succeeded later (webhook at both moments)
 *   DUPLICATE_WEBHOOKS  succeeded + the same webhook three times (two event ids)
 *   FAIL                definitive failure + webhook
 *   UNKNOWN_THEN_SUCCESS the call "times out" for the caller, but the money did
 *                       move; the success webhook arrives late
 *   NO_WEBHOOK          succeeded, but no webhook is ever sent: only status
 *                       polling or reconciliation can find it
 * A checkout that nobody pays expires after an hour (failed, nothing moved).
 *
 * Production refuses the demo adapter (env-check, AT-35).
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { CapabilityReport, PaymentCapability, PaymentProvider, ProviderOutcome, ProviderReportLine } from "@px/integrations";
import type { Db, Executor } from "./client.ts";

export const SIM_PROVIDER = "demo";
export const SIM_SCENARIOS = ["SUCCESS", "DELAYED", "DUPLICATE_WEBHOOKS", "FAIL", "UNKNOWN_THEN_SUCCESS", "NO_WEBHOOK"] as const;
export type SimScenario = (typeof SIM_SCENARIOS)[number];
type Kind = "DEPOSIT" | "HOLD" | "RELEASE" | "SETTLE" | "PAYOUT";

export type SimEvent = { eventId: string; type: string; reference: string; amountCents: number; at: string };

export class SimulatedTimeout extends Error {
  constructor() {
    super("payment provider did not answer in time");
    this.name = "SimulatedTimeout";
  }
}

const EVENT_TYPE: Record<Kind, string> = { DEPOSIT: "deposit", HOLD: "hold", RELEASE: "release", SETTLE: "settlement", PAYOUT: "payout" };

export type SimOptions = { secret: string; delaySeconds?: number; checkoutExpirySeconds?: number; scenarioFor?: (kind: Kind, amountCents: number) => SimScenario };

export function createPaymentSimulator(db: Db, opts: SimOptions): PaymentProvider & {
  decideDeposit(reference: string, scenario: SimScenario): Promise<void>;
  deliverDue(deliver: (headers: Record<string, string>, rawBody: string) => Promise<void>, now?: Date): Promise<number>;
  sign(rawBody: string): string;
  operation(reference: string): Promise<{ status: string; amount_cents: string; kind: string; account_ref: string } | undefined>;
} {
  const delay = opts.delaySeconds ?? 20;
  const checkoutExpiry = opts.checkoutExpirySeconds ?? 3600;
  const scenarioFor = opts.scenarioFor ?? (() => "SUCCESS" as SimScenario);
  const sign = (raw: string) => createHmac("sha256", opts.secret).update(raw).digest("hex");

  async function schedule(tx: Executor, reference: string, kind: Kind, status: "pending" | "succeeded" | "failed", amount: number, inSeconds = 0, eventId = `evt_${randomUUID()}`) {
    const event: SimEvent = { eventId, type: `${EVENT_TYPE[kind]}.${status}`, reference, amountCents: amount, at: new Date().toISOString() };
    await tx.execute(sql`
      INSERT INTO psp_sim.events(event_id, reference, payload, deliver_after)
      VALUES (${eventId}, ${reference}, ${JSON.stringify(event)}::jsonb, now() + make_interval(secs => ${inSeconds}))`);
  }

  /** Apply a scenario to an operation: status now, webhooks now or later. */
  async function apply(tx: Executor, reference: string, kind: Kind, amount: number, scenario: SimScenario) {
    switch (scenario) {
      case "SUCCESS":
        await tx.execute(sql`UPDATE psp_sim.operations SET status = 'SUCCEEDED', resolved_at = now(), scenario = ${scenario} WHERE reference = ${reference}`);
        await schedule(tx, reference, kind, "succeeded", amount);
        break;
      case "DUPLICATE_WEBHOOKS": {
        await tx.execute(sql`UPDATE psp_sim.operations SET status = 'SUCCEEDED', resolved_at = now(), scenario = ${scenario} WHERE reference = ${reference}`);
        const id = `evt_${randomUUID()}`;
        await schedule(tx, reference, kind, "succeeded", amount, 0, id);
        await schedule(tx, reference, kind, "succeeded", amount, 1, id); // same event again
        await schedule(tx, reference, kind, "succeeded", amount, 2); // same fact, new event id
        break;
      }
      case "DELAYED":
        await tx.execute(sql`UPDATE psp_sim.operations SET status = 'PENDING', resolve_after = now() + make_interval(secs => ${delay}), scenario = ${scenario} WHERE reference = ${reference}`);
        await schedule(tx, reference, kind, "pending", amount);
        await schedule(tx, reference, kind, "succeeded", amount, delay);
        break;
      case "FAIL":
        await tx.execute(sql`UPDATE psp_sim.operations SET status = 'FAILED', resolved_at = now(), failure_reason = 'Geweigerd door de bank (simulatie)', scenario = ${scenario} WHERE reference = ${reference}`);
        await schedule(tx, reference, kind, "failed", amount);
        break;
      case "UNKNOWN_THEN_SUCCESS":
        await tx.execute(sql`UPDATE psp_sim.operations SET status = 'SUCCEEDED', resolved_at = now(), scenario = ${scenario} WHERE reference = ${reference}`);
        await schedule(tx, reference, kind, "succeeded", amount, delay);
        break;
      case "NO_WEBHOOK":
        await tx.execute(sql`UPDATE psp_sim.operations SET status = 'SUCCEEDED', resolved_at = now(), scenario = ${scenario} WHERE reference = ${reference}`);
        break;
    }
  }

  async function op(idempotencyKey: string, kind: Kind, accountRef: string, amount: number, initial: "AWAITING_CUSTOMER" | "PENDING") {
    const reference = `sim_${kind.toLowerCase()}_${randomUUID().slice(0, 12)}`;
    const ins = await db.execute<{ reference: string; created: boolean }>(sql`
      INSERT INTO psp_sim.operations(idempotency_key, reference, kind, account_ref, amount_cents, status, scenario)
      VALUES (${idempotencyKey}, ${reference}, ${kind}, ${accountRef}, ${amount}, ${initial}, 'PENDING_DECISION')
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING reference, true AS created`);
    if (ins.rows[0]) return { reference: ins.rows[0].reference, created: true };
    const existing = await db.execute<{ reference: string; kind: string; amount_cents: string }>(sql`SELECT reference, kind, amount_cents FROM psp_sim.operations WHERE idempotency_key = ${idempotencyKey}`);
    const row = existing.rows[0]!;
    // Same key with different content is a client error at a real provider too.
    if (row.kind !== kind || Number(row.amount_cents) !== amount) throw new Error("idempotency key reused with different content");
    return { reference: row.reference, created: false };
  }

  async function outcome(reference: string): Promise<ProviderOutcome> {
    // Resolve delayed operations whose time has come; checkouts nobody paid expire.
    await db.execute(sql`UPDATE psp_sim.operations SET status = 'SUCCEEDED', resolved_at = now() WHERE reference = ${reference} AND status = 'PENDING' AND resolve_after <= now()`);
    await db.execute(sql`
      UPDATE psp_sim.operations SET status = 'FAILED', resolved_at = now(), failure_reason = 'Betaling verlopen', scenario = 'EXPIRED'
       WHERE reference = ${reference} AND status = 'AWAITING_CUSTOMER' AND created_at <= now() - make_interval(secs => ${checkoutExpiry})`);
    const r = (await db.execute<{ status: string; failure_reason: string | null }>(sql`SELECT status, failure_reason FROM psp_sim.operations WHERE reference = ${reference}`)).rows[0];
    if (!r) return { status: "UNKNOWN", providerReference: null };
    if (r.status === "SUCCEEDED") return { status: "SUCCEEDED", providerReference: reference };
    if (r.status === "FAILED") return { status: "FAILED", providerReference: reference, reason: r.failure_reason ?? "failed", definitive: true };
    return { status: "PENDING", providerReference: reference, stage: r.status === "AWAITING_CUSTOMER" ? "AWAITING_CUSTOMER" : "PROCESSING" };
  }

  /** Synchronous provider call with a scenario chosen per kind/amount. */
  async function call(kind: Kind, idempotencyKey: string, accountRef: string, amount: number): Promise<ProviderOutcome> {
    const { reference, created } = await op(idempotencyKey, kind, accountRef, amount, "PENDING");
    if (created) {
      const scenario = scenarioFor(kind, amount);
      await db.transaction((tx) => apply(tx, reference, kind, amount, scenario));
      if (scenario === "UNKNOWN_THEN_SUCCESS") throw new SimulatedTimeout();
    }
    return outcome(reference);
  }

  const report: CapabilityReport<PaymentCapability> = {
    adapter: "payment-simulator",
    environment: "demo",
    supported: new Set<PaymentCapability>(["HOLD_FUNDS", "RELEASE_HOLD", "SETTLE_INTERNAL_SALE", "SPLIT_COMMISSION", "QUERY_STATUS", "PAYOUT", "DEPOSIT", "RECONCILIATION_REPORT"]),
  };

  return {
    capabilities: () => report,
    sign,
    async startDeposit({ idempotencyKey, userAccountRef, amount, returnUrl }) {
      const { reference } = await op(idempotencyKey, "DEPOSIT", userAccountRef, amount, "AWAITING_CUSTOMER");
      const redirectUrl = `/demo-betaalpagina?ref=${encodeURIComponent(reference)}&terug=${encodeURIComponent(returnUrl)}`;
      return { status: "PENDING", providerReference: reference, redirectUrl };
    },
    /** The customer's choice on the demo checkout page. */
    async decideDeposit(reference, scenario) {
      await db.transaction(async (tx) => {
        const r = (await tx.execute<{ status: string; amount_cents: string }>(sql`SELECT status, amount_cents FROM psp_sim.operations WHERE reference = ${reference} AND kind = 'DEPOSIT' FOR UPDATE`)).rows[0];
        if (!r || r.status !== "AWAITING_CUSTOMER") return; // a second click changes nothing
        await apply(tx, reference, "DEPOSIT", Number(r.amount_cents), scenario);
      });
    },
    holdFunds: ({ idempotencyKey, userAccountRef, amount }) => call("HOLD", idempotencyKey, userAccountRef, amount),
    releaseHold: ({ idempotencyKey, holdReference, amount }) => call("RELEASE", idempotencyKey, holdReference, amount),
    async settleSale({ idempotencyKey, buyerAccountRef, gross, sellerNet, platformFee }) {
      // A provider splits exactly what it is given: the parts must add up to the gross amount.
      if (![gross, sellerNet, platformFee].every((n) => Number.isSafeInteger(n) && n >= 0) || sellerNet + platformFee !== gross) {
        return { status: "FAILED", providerReference: null, reason: "Ongeldige verdeling: netto + commissie ≠ bruto", definitive: true } as const;
      }
      return call("SETTLE", idempotencyKey, buyerAccountRef, gross);
    },
    payout: ({ idempotencyKey, userAccountRef, amount }) => call("PAYOUT", idempotencyKey, userAccountRef, amount),
    async queryStatus({ idempotencyKey }) {
      const r = (await db.execute<{ reference: string }>(sql`SELECT reference FROM psp_sim.operations WHERE idempotency_key = ${idempotencyKey}`)).rows[0];
      return r ? outcome(r.reference) : { status: "UNKNOWN", providerReference: null };
    },
    verifyWebhook({ headers, rawBody }) {
      const given = headers["x-psp-signature"] ?? headers["X-Psp-Signature"] ?? "";
      const expected = sign(rawBody);
      const valid = given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
      let eventId: string | null = null;
      try {
        eventId = (JSON.parse(rawBody) as SimEvent).eventId ?? null;
      } catch {
        eventId = null;
      }
      return { valid, eventId: valid ? eventId : null };
    },
    async reconciliationReport({ since }) {
      // Delayed operations whose time has come are final at the provider.
      await db.execute(sql`UPDATE psp_sim.operations SET status = 'SUCCEEDED', resolved_at = now() WHERE status = 'PENDING' AND resolve_after <= now()`);
      const r = await db.execute<{ idempotency_key: string; reference: string; kind: ProviderReportLine["kind"]; amount_cents: string; status: ProviderReportLine["status"]; created_at: string }>(sql`
        SELECT idempotency_key, reference, kind, amount_cents, status, created_at::text FROM psp_sim.operations WHERE created_at >= ${since.toISOString()}::timestamptz ORDER BY created_at`);
      return r.rows.map((x) => ({ idempotencyKey: x.idempotency_key, providerReference: x.reference, kind: x.kind, amount: Number(x.amount_cents), status: x.status, createdAt: x.created_at }));
    },
    async deliverDue(deliver, now = new Date()) {
      const due = await db.execute<{ id: string; payload: SimEvent }>(sql`
        SELECT id, payload FROM psp_sim.events WHERE delivered_at IS NULL AND deliver_after <= ${now.toISOString()}::timestamptz ORDER BY id LIMIT 50`);
      let n = 0;
      for (const e of due.rows) {
        const raw = JSON.stringify(e.payload);
        try {
          await deliver({ "content-type": "application/json", "x-psp-signature": sign(raw) }, raw);
          await db.execute(sql`UPDATE psp_sim.events SET delivered_at = now(), attempts = attempts + 1 WHERE id = ${e.id}`);
          n++;
        } catch {
          await db.execute(sql`UPDATE psp_sim.events SET attempts = attempts + 1, deliver_after = now() + interval '5 seconds' WHERE id = ${e.id}`);
        }
      }
      return n;
    },
    async operation(reference) {
      return (await db.execute<{ status: string; amount_cents: string; kind: string; account_ref: string }>(sql`SELECT status, amount_cents, kind, account_ref FROM psp_sim.operations WHERE reference = ${reference}`)).rows[0];
    },
  };
}

export type PaymentSimulator = ReturnType<typeof createPaymentSimulator>;
