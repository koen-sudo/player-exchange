/**
 * Security rules that do not depend on any framework (docs/10).
 */

/** RFC 8176 authentication method values that mean a second factor was used. */
const MFA_METHODS = new Set(["mfa", "otp", "hwk", "swk", "sms", "fpt", "face", "iris", "retina", "vbm"]);

/** Did the identity provider state that a second factor was used? We never run our own MFA. */
export function usedSecondFactor(amr: unknown): boolean {
  return Array.isArray(amr) && amr.some((m) => typeof m === "string" && MFA_METHODS.has(m));
}

/**
 * Admin permissions are only effective after a login with MFA, except in the
 * demo (fictitious accounts, no identity provider).
 */
export function effectivePermissions(mode: "demo" | "sandbox" | "production", permissions: ReadonlySet<string>, mfa: boolean): { permissions: Set<string>; mfaRequired: boolean } {
  const mfaRequired = mode !== "demo" && permissions.size > 0 && !mfa;
  return { permissions: mfaRequired ? new Set() : new Set(permissions), mfaRequired };
}
