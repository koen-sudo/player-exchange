import { getDb, listAuditEvents } from "@px/db";
import { Card, PageTitle } from "@/components/ui";
import { NotAllowed } from "@/components/login-required";
import { currentUser, hasPermission } from "@/server/session";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Auditlog" };
export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  CATALOG_IMPORT_QUEUED: "Catalogusimport ingepland",
  USER_RESTRICTION_ADDED: "Beperking ingesteld",
  USER_RESTRICTION_ENDED: "Beperking beëindigd",
  PAUSE_MARKET: "Markt gepauzeerd",
};

export default async function AuditPage() {
  const user = (await currentUser())!;
  if (!hasPermission(user, "audit.view")) return <NotAllowed />;
  const events = await listAuditEvents(getDb().db);
  return (
    <div className="space-y-5">
      <PageTitle title="Auditlog" subtitle="Onveranderlijk: gebeurtenissen kunnen niet worden gewijzigd of verwijderd." />
      <Card>
        {events.length === 0 ? <p className="text-sm text-muted">Nog geen gebeurtenissen.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted"><tr><th className="px-2 py-1 font-medium">Tijdstip</th><th className="px-2 py-1 font-medium">Actor</th><th className="px-2 py-1 font-medium">Handeling</th><th className="px-2 py-1 font-medium">Object</th><th className="px-2 py-1 font-medium">Reden</th></tr></thead>
              <tbody className="divide-y divide-line">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-2 py-2">{dateTime(e.occurred_at)}</td>
                    <td className="px-2 py-2">{e.actor_name ?? e.actor_kind}</td>
                    <td className="px-2 py-2">{ACTION_LABEL[e.action] ?? e.action}</td>
                    <td className="px-2 py-2 text-muted">{e.entity_type} {e.entity_id.slice(0, 8)}</td>
                    <td className="px-2 py-2">{e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
