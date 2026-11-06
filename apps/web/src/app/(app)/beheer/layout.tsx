import { AdminTabs } from "@/components/admin-tabs";
import { currentUser, hasAdminRole, hasPermission } from "@/server/session";
import { LoginRequired, NotAllowed } from "@/components/login-required";

/** Every admin page is authorised on the server for every request (UX-11). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) return <LoginRequired what="beheer" />;
  if (user.adminMfaRequired) return <NotAllowed reason="Beheer vraagt een login met tweestapsverificatie (MFA). Log opnieuw in via de identiteitsprovider met je tweede factor." />;
  if (!hasAdminRole(user)) return <NotAllowed />;
  const links: [string, string, boolean][] = [
    ["/beheer", "Overzicht", true],
    ["/beheer/catalogus", "Catalogus", hasPermission(user, "catalog.view")],
    ["/beheer/spelers", "Spelers", hasPermission(user, "catalog.view")],
    ["/beheer/voorraad", "Voorraad", hasPermission(user, "catalog.view")],
    ["/beheer/uitgiftes", "Uitgiftes", hasPermission(user, "issuance.prepare") || hasPermission(user, "catalog.view")],
    ["/beheer/waardering", "Waardering", hasPermission(user, "valuation.prepare") || hasPermission(user, "approvals.decide")],
    ["/beheer/goedkeuringen", "Goedkeuringen", hasPermission(user, "approvals.decide") || hasPermission(user, "issuance.prepare")],
    ["/beheer/handel", "Handel", hasPermission(user, "trading.view")],
    ["/beheer/betalingen", "Betalingen", hasPermission(user, "finance.operate") || hasPermission(user, "finance.reconcile") || hasPermission(user, "approvals.decide")],
    ["/beheer/bewaking", "Bewaking", hasPermission(user, "operations.view") || hasPermission(user, "finance.reconcile")],
    ["/beheer/koppelingen", "Koppelingen", hasPermission(user, "operations.view") || hasPermission(user, "catalog.view")],
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
