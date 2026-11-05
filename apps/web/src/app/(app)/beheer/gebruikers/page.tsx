import { getDb, listUsersForAdmin } from "@px/db";
import { Card, DisabledReason, PageTitle, Pill } from "@/components/ui";
import { Flash } from "@/components/flash";
import { NotAllowed } from "@/components/login-required";
import { currentUser, hasPermission } from "@/server/session";
import { dateTime } from "@/lib/format";
import { liftRestriction, restrictUser } from "../actions";

export const metadata = { title: "Gebruikers" };
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  TRADING_STOP: "Handelsstop",
  SUBSCRIPTION_STOP: "Inschrijfstop",
  DEPOSIT_STOP: "Stortingsstop",
  WITHDRAWAL_STOP: "Opnamestop",
  FULL_STOP: "Volledige stop",
};

type SP = Promise<{ melding?: string; fout?: string }>;

export default async function UsersAdminPage({ searchParams }: { searchParams: SP }) {
  const me = (await currentUser())!;
  if (!hasPermission(me, "users.view")) return <NotAllowed />;
  const sp = await searchParams;
  const users = await listUsersForAdmin(getDb().db);
  const canRestrict = hasPermission(me, "users.restrict");

  return (
    <div className="space-y-5">
      <PageTitle title="Gebruikers en beperkingen" subtitle="Beperkingen gelden per bevoegdheid. Een handelsstop laat annuleren en opnemen toe." />
      <Flash melding={sp.melding} fout={sp.fout} />
      {!canRestrict && <DisabledReason>Je rol kan gebruikers bekijken maar geen beperkingen instellen.</DisabledReason>}
      <div className="space-y-4">
        {users.map((u) => (
          <Card key={u.id} title={<span className="flex flex-wrap items-center gap-2">{u.displayName}{u.isTestAccount && <Pill tone="grey">Testaccount</Pill>}{u.roles.map((r) => <Pill key={r} tone="blue">{r}</Pill>)}</span>}>
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div><dt className="text-muted">Status</dt><dd>{u.status === "ACTIVE" ? "Actief" : u.status}</dd></div>
              <div><dt className="text-muted">Verificatie</dt><dd>{u.verification === "VERIFIED" ? <Pill tone="green">Bevestigd</Pill> : <Pill tone="amber">Niet bevestigd</Pill>}</dd></div>
              <div><dt className="text-muted">Woonland</dt><dd>{u.residenceCountry ?? "Onbekend"}</dd></div>
            </dl>

            <div className="mt-3">
              <p className="text-sm font-medium">Actieve beperkingen</p>
              {u.restrictions.length === 0 ? <p className="text-sm text-muted">Geen.</p> : (
                <ul className="mt-1 space-y-2">
                  {u.restrictions.map((r) => (
                    <li key={r.id} className="rounded-lg border border-line p-3 text-sm">
                      <p><Pill tone="red">{TYPE_LABEL[r.type] ?? r.type}</Pill> <span className="ml-2 text-muted">sinds {dateTime(r.starts_at)}</span></p>
                      <p className="mt-1">{r.reason}</p>
                      {canRestrict && u.id !== me.id && (
                        <form action={liftRestriction} className="mt-2 flex flex-wrap gap-2">
                          <input type="hidden" name="restrictionId" value={r.id} />
                          <input name="reason" aria-label="Reden voor beëindigen" placeholder="Reden voor beëindigen" className="min-w-48 flex-1 rounded-lg border border-line px-3 py-1.5" />
                          <button className="rounded-lg border border-slate-300 px-3 py-1.5">Beëindigen</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {canRestrict && u.id !== me.id && (
              <form action={restrictUser} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                <input type="hidden" name="userId" value={u.id} />
                <label className="text-sm">
                  <span className="block text-xs text-muted">Beperking</span>
                  <select name="type" className="mt-1 rounded-lg border border-line px-3 py-1.5">
                    {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="min-w-48 flex-1 text-sm">
                  <span className="block text-xs text-muted">Reden (verplicht)</span>
                  <input name="reason" required minLength={5} className="mt-1 w-full rounded-lg border border-line px-3 py-1.5" />
                </label>
                <button className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white">Instellen</button>
              </form>
            )}
            {u.id === me.id && <DisabledReason>Je kunt je eigen account niet beperken.</DisabledReason>}
          </Card>
        ))}
      </div>
    </div>
  );
}
