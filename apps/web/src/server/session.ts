/**
 * The single place where pages and API routes learn who the user is.
 * The session token carries only the user id; status, verification, roles,
 * permissions and restrictions are read from the database on every request.
 */
import "server-only";
import { cache } from "react";
import { auth } from "@/auth";
import { getDb, loadIdentity, type Identity } from "@px/db";
import { loadConfig } from "@px/integrations/env";
import { effectivePermissions } from "@px/domain";

export type SessionUser = {
  id: string;
  displayName: string;
  verified: boolean;
  residenceCountry: string | null;
  roles: string[];
  permissions: Set<string>;
  actions: Identity["actions"];
  canTrade: boolean;
  tradeBlockReason: string | null;
  canSubscribe: boolean;
  subscribeBlockReason: string | null;
  /** Set when admin roles are held but disabled because the login had no second factor. */
  adminMfaRequired: boolean;
};

const reasonOf = (d: Identity["actions"][keyof Identity["actions"]]) => (d.allowed ? null : d.reason);

/** Cached per request so a page and its components share one lookup. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const sessionUser = session?.user as { id?: string; mfa?: boolean } | undefined;
  const id = sessionUser?.id;
  if (!id) return null;
  const { mode } = loadConfig(process.env);
  const identity = await loadIdentity(getDb().db, id, mode);
  if (!identity || identity.status === "CLOSED") return null;
  // docs/10: outside the demo, admin permissions need a login with MFA.
  const { permissions, mfaRequired: adminMfaRequired } = effectivePermissions(mode, identity.permissions, sessionUser?.mfa === true);
  return {
    id: identity.id,
    displayName: identity.displayName,
    verified: identity.verified,
    residenceCountry: identity.residenceCountry,
    roles: identity.roles,
    permissions,
    actions: identity.actions,
    canTrade: identity.actions.TRADE.allowed,
    tradeBlockReason: reasonOf(identity.actions.TRADE),
    canSubscribe: identity.actions.SUBSCRIBE.allowed,
    subscribeBlockReason: reasonOf(identity.actions.SUBSCRIBE),
    adminMfaRequired,
  };
});

export function hasPermission(user: SessionUser | null, permission: string): boolean {
  return !!user && user.permissions.has(permission);
}

/** Admin area access is itself a permission (docs/02 UX-11). */
export function hasAdminRole(user: SessionUser | null): boolean {
  return hasPermission(user, "admin.access");
}
