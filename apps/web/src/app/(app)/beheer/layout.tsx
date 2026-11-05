import { AdminTabs } from "@/components/admin-tabs";
import { currentUser, hasAdminRole, hasPermission } from "@/server/session";
import { LoginRequired, NotAllowed } from "@/components/login-required";

/** Every admin page is authorised on the server for every request (UX-11). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) return <LoginRequired what="beheer" />;
  if (!hasAdminRole(user)) return <NotAllowed />;
  const links: [string, string, boolean][] = [
    ["/beheer", "Overzicht", true],
    ["/beheer/catalogus", "Catalogus", hasPermission(user, "catalog.view")],
    ["/beheer/spelers", "Spelers", hasPermission(user, "catalog.view")],
    ["/beheer/voorraad", "Voorraad", hasPermission(user, "catalog.view")],
    ["/beheer/goedkeuringen", "Goedkeuringen", hasPermission(user, "approvals.decide") || hasPermission(user, "issuance.prepare")],
    ["/beheer/handel", "Handel", hasPermission(user, "trading.view")],
    ["/beheer/betalingen", "Betalingen", hasPermission(user, "finance.operate") || hasPermission(user, "finance.reconcile") || hasPermission(user, "approvals.decide")],
    ["/beheer/gebruikers", "Gebruikers", hasPermission(user, "users.view")],
    ["/beheer/audit", "Auditlog", hasPermission(user, "audit.view")],
  ];
  return (
    <div>
      <AdminTabs links={links.filter(([, , ok]) => ok).map(([href, label]) => ({ href, label }))} />
      {children}
    </div>
  );
}
