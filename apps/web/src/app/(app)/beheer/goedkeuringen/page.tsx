import { APPROVAL_ACTIONS, getDb, listAllPlayersInternal, listApprovals, type ApprovalAction } from "@px/db";
import { Card, DisabledReason, PageTitle, Pill } from "@/components/ui";
import { Flash } from "@/components/flash";
import { NotAllowed } from "@/components/login-required";
import { currentUser, hasPermission } from "@/server/session";
import { dateTime, euro } from "@/lib/format";
import { decide } from "../actions";

export const metadata = { title: "Goedkeuringen" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, "green" | "grey" | "amber" | "blue" | "red"]> = {
  REQUESTED: ["Wacht op besluit", "amber"], APPROVED: ["Goedgekeurd", "blue"], REJECTED: ["Afgewezen", "red"], EXECUTED: ["Uitgevoerd", "green"], INVALIDATED: ["Vervallen", "grey"],
};

type SP = Promise<{ melding?: string; fout?: string }>;

export default async function ApprovalsPage({ searchParams }: { searchParams: SP }) {
  const user = (await currentUser())!;
  const canDecide = hasPermission(user, "approvals.decide");
  if (!canDecide && !hasPermission(user, "issuance.prepare")) return <NotAllowed />;
  const sp = await searchParams;
  const approvals = await listApprovals(getDb().db, { limit: 50 });
  const names = new Map((await listAllPlayersInternal(getDb().db)).map((p) => [p.id, p.display_name]));
  const open = approvals.filter((a) => a.status === "REQUESTED");
  const rest = approvals.filter((a) => a.status !== "REQUESTED");

  const describe = (a: (typeof approvals)[number]) => {
    const p = a.payload as Record<string, unknown>;
    if (a.action_type === "PUBLISH_PROGRAMME") return `Editie ${p.seasonKey}, versie ${p.version}: ${p.plannedTotal} kaarten`;
    if (a.action_type === "PUBLISH_DROP") return `${names.get(String(p.playerId)) ?? "Speler"}: ${p.quantity} kaarten à ${euro(Number(p.priceCents))}, inschrijving ${dateTime(String(p.opensAt))} – ${dateTime(String(p.closesAt))}`;
    if (a.action_type === "CHANGE_DROP_PRICE") return `Prijs van ${euro(Number(p.oldPriceCents))} naar ${euro(Number(p.newPriceCents))}`;
    return JSON.stringify(p);
  };

  return (
    <div className="space-y-5">
      <PageTitle title="Goedkeuringen" subtitle="Vier-ogenprincipe: wie iets aanvraagt, kan het niet zelf goedkeuren. De goedkeuring geldt alleen voor exact de aangevraagde inhoud." />
      <Flash melding={sp.melding} fout={sp.fout} />
      {!canDecide && <DisabledReason>Je rol kan goedkeuringen volgen maar niet beslissen.</DisabledReason>}
      <Card title={`Open (${open.length})`}>
        {open.length === 0 ? <p className="text-sm text-muted">Geen openstaande verzoeken.</p> : (
          <ul className="space-y-3">
            {open.map((a) => (
              <li key={a.id} className="rounded-lg border border-line p-3 text-sm">
                <p className="font-semibold">{APPROVAL_ACTIONS[a.action_type as ApprovalAction]?.label ?? a.action_type}</p>
                <p>{describe(a)}</p>
                <p className="text-muted">Aangevraagd door {a.requester} op {dateTime(a.created_at)}: {a.reason}</p>
                {canDecide && a.requested_by !== user.id && (
                  <form action={decide} className="mt-2 flex flex-wrap gap-2">
                    <input type="hidden" name="approvalId" value={a.id} />
                    <input name="reason" required minLength={5} placeholder="Toelichting bij je besluit" className="min-w-48 flex-1 rounded-lg border border-line px-2 py-1.5" />
                    <button name="decision" value="APPROVE" className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">Goedkeuren</button>
                    <button name="decision" value="REJECT" className="rounded-lg border border-slate-300 px-3 py-1.5">Afwijzen</button>
                  </form>
                )}
                {a.requested_by === user.id && <DisabledReason>Je eigen verzoek; een andere bevoegde persoon moet beslissen.</DisabledReason>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Geschiedenis">
        <ul className="divide-y divide-line text-sm">
          {rest.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{describe(a)}</span>
              <span className="flex items-center gap-2"><Pill tone={STATUS[a.status]![1]}>{STATUS[a.status]![0]}</Pill><span className="text-muted">{a.requester} → {a.approver ?? "—"}</span></span>
            </li>
          ))}
          {rest.length === 0 && <li className="py-2 text-muted">Nog geen afgehandelde verzoeken.</li>}
        </ul>
      </Card>
    </div>
  );
}
