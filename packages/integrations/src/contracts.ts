/**
 * Supplier-neutral adapter contracts (docs/07-integrations.md).
 * Each adapter reports which capabilities it really supports; a missing
 * required capability keeps that money flow blocked in production.
 *
 * Amounts are integer euro cents. Every mutating call takes a stable
 * idempotency key that the caller reuses on every retry.
 */

export type Cents = number;

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------
export const PAYMENT_CAPABILITIES = [
  "HOLD_FUNDS",
  "RELEASE_HOLD",
  "SETTLE_INTERNAL_SALE",
  "SPLIT_COMMISSION",
  "QUERY_STATUS",
  "PAYOUT",
  "DEPOSIT",
  "RECONCILIATION_REPORT",
] as const;
export type PaymentCapability = (typeof PAYMENT_CAPABILITIES)[number];

export type CapabilityReport<C extends string> = {
  readonly adapter: string;
  readonly environment: "demo" | "sandbox" | "production";
  readonly supported: ReadonlySet<C>;
};

/** Required capabilities per money flow. Missing ones block that flow. */
export const REQUIRED_PAYMENT_CAPABILITIES: Record<string, readonly PaymentCapability[]> = {
  deposit: ["DEPOSIT", "QUERY_STATUS"],
  buyOrder: ["HOLD_FUNDS", "RELEASE_HOLD", "QUERY_STATUS"],
  secondarySettlement: ["SETTLE_INTERNAL_SALE", "SPLIT_COMMISSION", "QUERY_STATUS"],
  primarySubscription: ["HOLD_FUNDS", "RELEASE_HOLD", "QUERY_STATUS"],
  withdrawal: ["PAYOUT", "QUERY_STATUS"],
  reconciliation: ["RECONCILIATION_REPORT"],
};

export function blockedFlows(report: CapabilityReport<PaymentCapability>): { flow: string; missing: PaymentCapability[] }[] {
  return Object.entries(REQUIRED_PAYMENT_CAPABILITIES)
    .map(([flow, req]) => ({ flow, missing: req.filter((c) => !report.supported.has(c)) }))
    .filter((r) => r.missing.length > 0);
}

// ---------------------------------------------------------------------------
// Outcomes: an unknown outcome is never treated as failure (docs/07)
// ---------------------------------------------------------------------------
export type ProviderOutcome =
  | { readonly status: "SUCCEEDED"; readonly providerReference: string }
  | { readonly status: "PENDING"; readonly providerReference: string }
  | { readonly status: "FAILED"; readonly providerReference: string | null; readonly reason: string; readonly definitive: true }
  | { readonly status: "UNKNOWN"; readonly providerReference: string | null };

// ---------------------------------------------------------------------------
// Payment provider
// ---------------------------------------------------------------------------
export interface PaymentProvider {
  capabilities(): CapabilityReport<PaymentCapability>;
  startDeposit(input: { idempotencyKey: string; userAccountRef: string; amount: Cents; returnUrl: string }): Promise<ProviderOutcome & { redirectUrl?: string }>;
  holdFunds(input: { idempotencyKey: string; userAccountRef: string; amount: Cents }): Promise<ProviderOutcome>;
  releaseHold(input: { idempotencyKey: string; holdReference: string; amount: Cents }): Promise<ProviderOutcome>;
  settleSale(input: {
    idempotencyKey: string;
    buyerHoldReference: string;
    buyerAccountRef: string;
    sellerAccountRef: string;
    gross: Cents;
    sellerNet: Cents;
    platformFee: Cents;
  }): Promise<ProviderOutcome>;
  payout(input: { idempotencyKey: string; userAccountRef: string; amount: Cents; destinationRef: string }): Promise<ProviderOutcome>;
  queryStatus(input: { idempotencyKey: string }): Promise<ProviderOutcome>;
  /** Verifies a webhook per the provider contract. Browser cookies are never an authentication means. */
  verifyWebhook(input: { headers: Readonly<Record<string, string>>; rawBody: string }): { valid: boolean; eventId: string | null };
}

// ---------------------------------------------------------------------------
// Football data
// ---------------------------------------------------------------------------
export type ProviderCompetition = { externalId: string; name: string; countryCode: string; seasonExternalId: string; seasonStartsOn?: string; seasonEndsOn?: string };
export type ProviderTeam = { externalId: string; name: string; shortName?: string; competitionExternalId: string };
export type ProviderPlayer = {
  externalId: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  birthDate?: string; // ISO date
  nationality?: string;
  teamExternalId: string;
  membershipType: "FIRST_TEAM" | "LOAN" | "YOUTH" | "RESERVE";
  /** Platform role key (GOALKEEPER, CENTRE_BACK, …) when the provider position maps to one. */
  role?: string;
};
/**
 * One page of provider data. `isCompleteSnapshot` on the last page (nextCursor
 * null) states that the full collection was delivered; only then may the
 * import close memberships of entities that are missing (docs/07).
 */
export type Page<T> = { items: T[]; nextCursor: string | null; sourceVersion: string; isCompleteSnapshot?: boolean };

export interface FootballDataProvider {
  readonly name: string;
  competitions(): Promise<ProviderCompetition[]>;
  teams(competitionExternalId: string, cursor?: string): Promise<Page<ProviderTeam>>;
  squad(teamExternalId: string, cursor?: string): Promise<Page<ProviderPlayer>>;
  fixtures(competitionExternalId: string, sinceIso: string, cursor?: string): Promise<Page<{ externalId: string; homeTeamExternalId: string; awayTeamExternalId: string; kickoffAt: string; status: string }>>;
  playerMatchStats(fixtureExternalId: string): Promise<{ playerExternalId: string; minutes: number | null; stats: Record<string, number>; version: number; asOf: string }[]>;
}

export interface ExternalValuationProvider {
  readonly name: string;
  valuations(sinceIso: string): Promise<{ playerExternalId: string; amount: Cents; currency: "EUR"; asOf: string; knownAt: string }[]>;
}

export interface IdentityProvider {
  readonly name: string;
  startVerification(input: { idempotencyKey: string; userId: string; returnUrl: string }): Promise<{ redirectUrl: string; reference: string }>;
  status(reference: string): Promise<{ status: "PENDING" | "VERIFIED" | "REJECTED"; ageConfirmed: boolean; residenceCountry: string | null }>;
  verifyWebhook(input: { headers: Readonly<Record<string, string>>; rawBody: string }): { valid: boolean; eventId: string | null };
}

export interface NotificationProvider {
  readonly name: string;
  send(input: { dedupeKey: string; to: string; template: string; data: Record<string, unknown> }): Promise<{ status: "SENT" | "FAILED"; providerReference: string | null }>;
}

export interface ObjectStorageProvider {
  readonly name: string;
  put(input: { key: string; body: Uint8Array; contentType: string; retentionDays: number }): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}
