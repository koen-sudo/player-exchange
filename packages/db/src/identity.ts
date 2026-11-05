/**
 * Identity, authorisation and audit on the database (fase 2).
 *
 * - The session only carries the user id. Status, verification, country,
 *   roles and restrictions are always read from the database.
 * - Permissions come from roles (role_permissions); checks happen server-side.
 * - Administrative changes are written together with an audit event in one
 *   transaction; an admin cannot restrict or approve themselves.
 */
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { decideAll, DomainError, type AdmissionFacts, type ActionDecision, type RestrictionKind, type UserAction } from "@px/domain";
import type { Db, Executor } from "./client.ts";
import {
  admittedCountries,
  auditEvents,
  featureGates,
  rolePermissions,
  termsAcceptances,
  termsDocuments,
  userProfiles,
  userRestrictions,
  userRoles,
  users,
  RESTRICTION_TYPES,
  type RestrictionType,
} from "./schema.ts";

export type AppMode = "demo" | "sandbox" | "production";

export type Identity = {
  id: string;
  displayName: string;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  verified: boolean;
  residenceCountry: string | null;
  isTestAccount: boolean;
  roles: string[];
  permissions: Set<string>;
  actions: Record<UserAction, ActionDecision>;
};

export async function findUserIdByAuthSubject(db: Executor, subject: string): Promise<string | null> {
  const u = await db.query.users.findFirst({ where: eq(users.authSubject, subject), columns: { id: true } });
  return u?.id ?? null;
}

/** OIDC sign-in: create the user on first login (sandbox/production). */
export async function ensureUserForSubject(db: Db, subject: string, displayName: string | null): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(users).values({ authSubject: subject }).onConflictDoUpdate({ target: users.authSubject, set: { lastLoginAt: new Date() } }).returning({ id: users.id });
    await tx.insert(userProfiles).values({ userId: row!.id, displayName }).onConflictDoNothing();
    return row!.id;
  });
}

export async function recordLogin(db: Executor, userId: string): Promise<void> {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

export async function permissionsFor(db: Executor, userId: string): Promise<{ roles: string[]; permissions: Set<string> }> {
  const rows = await db
    .select({ role: userRoles.roleKey, permission: rolePermissions.permissionKey })
    .from(userRoles)
    .leftJoin(rolePermissions, eq(rolePermissions.roleKey, userRoles.roleKey))
    .where(eq(userRoles.userId, userId));
  return {
    roles: [...new Set(rows.map((r) => r.role))].sort(),
    permissions: new Set(rows.map((r) => r.permission).filter((p): p is string => !!p)),
  };
}

export async function admissionFacts(db: Executor, userId: string, mode: AppMode, now = new Date()): Promise<AdmissionFacts | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return null;
  const profile = await db.query.userProfiles.findFirst({ where: eq(userProfiles.userId, userId) });
  const countries = await db.select().from(admittedCountries);
  const current = await db.select().from(termsDocuments).where(eq(termsDocuments.isCurrent, true));
  const accepted = await db.select().from(termsAcceptances).where(eq(termsAcceptances.userId, userId));
  const restrictions = await db.select({ type: userRestrictions.type }).from(userRestrictions).where(and(
    eq(userRestrictions.userId, userId),
    lte(userRestrictions.startsAt, now),
    or(isNull(userRestrictions.endsAt), gt(userRestrictions.endsAt, now)),
  ));
  const openGates = await db.select({ key: featureGates.key }).from(featureGates).where(eq(featureGates.satisfied, false));
  return {
    accountStatus: user.status,
    identityVerified: profile?.verificationStatus === "VERIFIED",
    ageConfirmed: profile?.ageConfirmed ?? false,
    residenceCountry: profile?.residenceCountry ?? null,
    admittedCountries: new Set(countries.map((c) => c.countryCode)),
    missingTerms: current
      .filter((d) => !accepted.some((a) => a.documentKey === d.documentKey && a.documentVersion === d.documentVersion))
      .map((d) => d.documentKey),
    activeRestrictions: restrictions.map((r) => r.type as RestrictionKind),
    mode,
    productionGatesSatisfied: openGates.length === 0,
  };
}

export async function loadIdentity(db: Executor, userId: string, mode: AppMode, now = new Date()): Promise<Identity | null> {
  const facts = await admissionFacts(db, userId, mode, now);
  if (!facts) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const profile = await db.query.userProfiles.findFirst({ where: eq(userProfiles.userId, userId) });
  const { roles, permissions } = await permissionsFor(db, userId);
  return {
    id: userId,
    displayName: profile?.displayName ?? "Gebruiker",
    status: user!.status,
    verified: facts.identityVerified && facts.ageConfirmed,
    residenceCountry: facts.residenceCountry,
    isTestAccount: user!.isTestAccount,
    roles,
    permissions,
    actions: decideAll(facts),
  };
}

export function requirePermission(identity: Pick<Identity, "permissions"> | null, permission: string): void {
  if (!identity) throw new DomainError("AUTH_REQUIRED");
  if (!identity.permissions.has(permission)) throw new DomainError("ACTION_NOT_ALLOWED", { permission });
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export type AuditInput = {
  actorId: string | null;
  actorKind: "USER" | "ADMIN" | "SYSTEM" | "PROVIDER";
  action: string;
  reason?: string | null;
  entityType: string;
  entityId: string;
  related?: Record<string, unknown>;
  requestId?: string | null;
};

export async function writeAudit(tx: Executor, a: AuditInput): Promise<void> {
  await tx.insert(auditEvents).values({
    actorId: a.actorId,
    actorKind: a.actorKind,
    action: a.action,
    reason: a.reason ?? null,
    entityType: a.entityType,
    entityId: a.entityId,
    related: a.related ?? {},
    requestId: a.requestId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Restrictions (per capability, BR-07)
// ---------------------------------------------------------------------------
export async function addRestriction(
  db: Db,
  actor: Pick<Identity, "id" | "permissions">,
  input: { userId: string; type: RestrictionType; reason: string; endsAt?: Date | null; requestId?: string },
): Promise<string> {
  requirePermission(actor, "users.restrict");
  if (actor.id === input.userId) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "self-restriction by admin" });
  if (!(RESTRICTION_TYPES as readonly string[]).includes(input.type)) throw new DomainError("ACTION_NOT_ALLOWED", { type: input.type });
  const reason = input.reason.trim();
  if (reason.length < 5) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "reason required" });
  return db.transaction(async (tx) => {
    const [r] = await tx.insert(userRestrictions).values({
      userId: input.userId, type: input.type, reason, endsAt: input.endsAt ?? null, actorId: actor.id,
    }).returning({ id: userRestrictions.id });
    await writeAudit(tx, {
      actorId: actor.id, actorKind: "ADMIN", action: "USER_RESTRICTION_ADDED", reason,
      entityType: "user", entityId: input.userId, related: { restrictionId: r!.id, type: input.type }, requestId: input.requestId ?? null,
    });
    return r!.id;
  });
}

export async function endRestriction(db: Db, actor: Pick<Identity, "id" | "permissions">, input: { restrictionId: string; reason: string; requestId?: string }): Promise<void> {
  requirePermission(actor, "users.restrict");
  const reason = input.reason.trim();
  if (reason.length < 5) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "reason required" });
  await db.transaction(async (tx) => {
    const r = await tx.query.userRestrictions.findFirst({ where: eq(userRestrictions.id, input.restrictionId) });
    if (!r) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "unknown restriction" });
    if (r.userId === actor.id) throw new DomainError("ACTION_NOT_ALLOWED", { detail: "self" });
    await tx.update(userRestrictions).set({ endsAt: sql`greatest(now(), ${userRestrictions.startsAt} + interval '1 second')` }).where(and(eq(userRestrictions.id, r.id), or(isNull(userRestrictions.endsAt), gt(userRestrictions.endsAt, new Date()))));
    await writeAudit(tx, {
      actorId: actor.id, actorKind: "ADMIN", action: "USER_RESTRICTION_ENDED", reason,
      entityType: "user", entityId: r.userId, related: { restrictionId: r.id, type: r.type }, requestId: input.requestId ?? null,
    });
  });
}
