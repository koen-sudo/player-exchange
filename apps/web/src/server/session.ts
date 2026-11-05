/**
 * The single place where pages and API routes learn who the user is.
 * Roles, verification and permissions always come from server-side state,
 * never from the session token or the request.
 */
import "server-only";
import { auth } from "@/auth";
import { demoWorld, type DemoUser } from "@px/demo";

export type SessionUser = DemoUser & {
  canTrade: boolean;
  tradeBlockReason: string | null;
};

export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const user = demoWorld().users.find((u) => u.id === id);
  if (!user) return null;
  const tradeBlockReason = !user.verified
    ? "Rond eerst je verificatie af om te handelen."
    : user.residenceCountry !== "NL"
      ? "Handelen is in je woonland nog niet beschikbaar."
      : null;
  return { ...user, canTrade: tradeBlockReason === null, tradeBlockReason };
}

export function hasAdminRole(user: SessionUser | null, role?: string): boolean {
  if (!user || user.role !== "ADMIN") return false;
  return role ? user.adminRoles.includes(role) || user.adminRoles.includes("SUPERADMIN") : true;
}
