/**
 * Domain error codes. Mirrors the API error catalogue in docs/06-api.md.
 * Messages shown to users are Dutch; codes and identifiers stay English.
 */
export const ERROR_CODES = [
  "AUTH_REQUIRED",
  "ACTION_NOT_ALLOWED",
  "VERIFICATION_REQUIRED",
  "COUNTRY_NOT_SUPPORTED",
  "MARKET_NOT_OPEN",
  "PRICE_INVALID",
  "INSUFFICIENT_AVAILABLE_FUNDS",
  "CARD_UNAVAILABLE",
  "POSITION_LIMIT_EXCEEDED",
  "PREVIEW_EXPIRED",
  "IDEMPOTENCY_CONFLICT",
  "DROP_NOT_OPEN",
  "SUBSCRIPTION_EXISTS",
  "PAYMENT_PENDING",
  "RECONCILIATION_HOLD",
  // Additional domain codes (registered in docs/12-decisions.md)
  "QUANTITY_INVALID",
  "TIME_IN_FORCE_INVALID",
  "SELF_TRADE_REJECTED",
  "EDITION_CAP_EXCEEDED",
  "INVARIANT_VIOLATION",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const USER_MESSAGES_NL: Record<ErrorCode, string> = {
  AUTH_REQUIRED: "Log in om verder te gaan.",
  ACTION_NOT_ALLOWED: "Je hebt geen toestemming voor deze handeling.",
  VERIFICATION_REQUIRED: "Rond eerst je verificatie af.",
  COUNTRY_NOT_SUPPORTED: "Handelen is in je woonland nog niet beschikbaar.",
  MARKET_NOT_OPEN: "Handel in deze speler is op dit moment gesloten.",
  PRICE_INVALID: "Deze prijs valt buiten de toegestane grenzen.",
  INSUFFICIENT_AVAILABLE_FUNDS: "Je beschikbare saldo is onvoldoende.",
  CARD_UNAVAILABLE: "Deze kaart is al gereserveerd of niet in je bezit.",
  POSITION_LIMIT_EXCEEDED: "Hiermee kom je boven de bezitslimiet voor deze speler.",
  PREVIEW_EXPIRED: "De controle is verlopen. Open het controlevenster opnieuw.",
  IDEMPOTENCY_CONFLICT: "Dit verzoek is al met andere inhoud verstuurd.",
  DROP_NOT_OPEN: "Inschrijven voor deze uitgifte is nu niet mogelijk.",
  SUBSCRIPTION_EXISTS: "Je bent al ingeschreven voor deze uitgifte.",
  PAYMENT_PENDING: "De uitkomst van de betaling is nog niet vastgesteld.",
  RECONCILIATION_HOLD: "Deze handeling is tijdelijk geblokkeerd voor onderzoek.",
  QUANTITY_INVALID: "Kies een geldig aantal hele kaarten.",
  TIME_IN_FORCE_INVALID: "Kies een orderduur van 1, 7 of 30 dagen.",
  SELF_TRADE_REJECTED: "Deze order zou met je eigen order handelen en is afgewezen.",
  EDITION_CAP_EXCEEDED: "Het seizoensmaximum voor deze speler is bereikt.",
  INVARIANT_VIOLATION: "Er ging iets mis bij de verwerking. Probeer het later opnieuw.",
};

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }

  /** A specific Dutch explanation (details.userMessage) or the generic one for the code. */
  get userMessage(): string {
    const specific = this.details?.userMessage;
    return typeof specific === "string" && specific.length > 0 ? specific : USER_MESSAGES_NL[this.code];
  }
}

export function invariant(condition: unknown, detail: string): asserts condition {
  if (!condition) {
    throw new DomainError("INVARIANT_VIOLATION", { detail });
  }
}
