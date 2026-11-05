import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getDb, listNotifications, markNotificationsRead } from "@px/db";
import { Card, PageTitle } from "@/components/ui";
import { LoginRequired } from "@/components/login-required";
import { currentUser } from "@/server/session";
import { dateTime, euro } from "@/lib/format";

export const metadata = { title: "Meldingen" };
export const dynamic = "force-dynamic";

type P = Record<string, unknown>;
const money = (p: P, k: string) => euro(Number(p[k] ?? 0));

/** Readable text per outbox template; unknown templates are shown generically. */
function describe(template: string, p: P): [string, string] {
  switch (template) {
    case "DEPOSIT_CONFIRMED": return [`Storting van ${money(p, "amountCents")} bijgeschreven`, "/betalingen"];
    case "DEPOSIT_FAILED": return [`Storting van ${money(p, "amountCents")} is niet gelukt`, "/betalingen"];
    case "WITHDRAWAL_PAID": return [`Opname van ${money(p, "amountCents")} uitbetaald`, "/betalingen"];
    case "WITHDRAWAL_FAILED": return [`Opname van ${money(p, "amountCents")} geweigerd; het bedrag staat weer beschikbaar`, "/betalingen"];
    case "TRADE_BOUGHT": return [`Kaart gekocht voor ${money(p, "priceCents")}`, "/transacties"];
    case "TRADE_SOLD": return [`Kaart verkocht voor ${money(p, "priceCents")} (commissie ${money(p, "feeCents")})`, "/transacties"];
    case "CARD_DELIVERED": return [`Kaart uit een uitgifte geleverd voor ${money(p, "priceCents")}`, "/portefeuille"];
    case "SUBSCRIPTION_NOT_ALLOCATED": return ["Geen kaart toegewezen in een uitgifte; je reservering is vrijgegeven", "/uitgiftes?tab=mijn"];
    case "SUBSCRIPTION_LATE": return ["Je inschrijving werd te laat bevestigd en doet niet mee; de reservering is vrijgegeven", "/uitgiftes?tab=mijn"];
    default: return ["Nieuwe melding", "/"];
  }
}

export default async function NotificationsPage() {
  const user = await currentUser();
  if (!user) return <LoginRequired what="je meldingen" />;
  const items = await listNotifications(getDb().db, user.id);
  async function readAll() {
    "use server";
    const u = await currentUser();
    if (u) await markNotificationsRead(getDb().db, u.id);
    revalidatePath("/", "layout");
  }
  const unread = items.filter((i) => !i.read_at).length;
  return (
    <div className="space-y-5">
      <PageTitle title="Meldingen" subtitle="Uitkomsten van betalingen, transacties en uitgiftes. E-mail en pushmeldingen volgen later." />
      <Card title={`Meldingen (${unread} ongelezen)`} action={unread ? <form action={readAll}><button className="text-sm text-primary underline">Alles gelezen</button></form> : undefined}>
        {items.length === 0 ? <p className="text-sm text-muted">Nog geen meldingen.</p> : (
          <ul className="divide-y divide-line text-sm">
            {items.map((n) => {
              const [text, href] = describe(n.template, n.payload);
              return (
                <li key={n.id} className="flex items-start justify-between gap-3 py-2.5">
                  <Link href={href} className={`hover:underline ${n.read_at ? "" : "font-semibold"}`}>{!n.read_at && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-primary" aria-label="Ongelezen" />}{text}</Link>
                  <span className="whitespace-nowrap text-xs text-muted">{dateTime(n.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
