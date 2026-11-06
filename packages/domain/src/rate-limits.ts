/**
 * Rate limits on sensitive actions (docs/10 "Rate limiting op gevoelige
 * endpoints"), per user and fixed time window. Generous enough for a person,
 * tight enough to stop a script hammering money or order endpoints.
 * Login attempts are limited by the identity provider (OIDC); the demo login
 * exists only in demo mode.
 */
export const RATE_LIMITS = {
  "order.preview": { limit: 60, windowSeconds: 60 },
  "order.place": { limit: 20, windowSeconds: 60 },
  "order.cancel": { limit: 30, windowSeconds: 60 },
  "drop.subscribe": { limit: 10, windowSeconds: 60 },
  "deposit.start": { limit: 10, windowSeconds: 3600 },
  "withdrawal.request": { limit: 5, windowSeconds: 3600 },
} as const satisfies Record<string, { limit: number; windowSeconds: number }>;

export type RateLimitedAction = keyof typeof RATE_LIMITS;
