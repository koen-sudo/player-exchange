import Link from "next/link";
import { NavLink } from "@/components/nav-link";
import { IconBell, IconHome, IconLayers, IconMarket, IconSearch, IconSwap, IconUser, IconWallet, IconShield, Logo } from "@/components/icons";
import { currentUser, hasAdminRole } from "@/server/session";
import { signOut } from "@/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <div className="min-h-dvh">
      {/* Demo banner: the demo is never presented as a live service (docs/10). */}
      <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
        Demo · fictieve spelers en testgeld · geen live service en geen echte betalingen
      </div>

      <header className="sticky top-0 z-30 flex h-16 items-center gap-4 bg-navy px-4 md:px-6">
        <Link href="/" aria-label="Player Exchange, naar overzicht">
          <Logo />
        </Link>
        <form action="/markt" className="mx-auto hidden w-full max-w-md md:block" role="search">
          <label className="relative block">
            <span className="sr-only">Zoek een speler</span>
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
            <input name="q" placeholder="Zoek een speler" className="w-full rounded-lg bg-white py-2 pl-10 pr-3 text-ink placeholder:text-muted" />
          </label>
        </form>
        <div className="ml-auto flex items-center gap-3 text-white">
          <span title="Meldingen worden in een volgende fase aangesloten" className="opacity-60">
            <IconBell className="h-6 w-6" />
            <span className="sr-only">Meldingen (nog niet beschikbaar)</span>
          </span>
          {user ? (
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 hover:bg-white/10">
                <IconUser className="h-6 w-6" />
                <span className="hidden text-sm md:inline">{user.displayName}</span>
              </summary>
              <div className="absolute right-0 mt-2 w-56 rounded-lg border border-line bg-white p-2 text-ink shadow-lg">
                <Link href="/account" className="block rounded px-3 py-2 hover:bg-slate-50">Account</Link>
                <Link href="/betalingen" className="block rounded px-3 py-2 hover:bg-slate-50">Betalingen</Link>
                {hasAdminRole(user) && <Link href="/beheer" className="block rounded px-3 py-2 hover:bg-slate-50">Beheer</Link>}
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/markt" });
                  }}
                >
                  <button className="w-full rounded px-3 py-2 text-left hover:bg-slate-50">Uitloggen</button>
                </form>
              </div>
            </details>
          ) : (
            <Link href="/login" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold">Inloggen</Link>
          )}
        </div>
      </header>

      <div className="flex">
        <div className="hidden w-56 shrink-0 bg-navy md:block">
        <nav aria-label="Hoofdnavigatie" className="sticky top-16 flex flex-col gap-1 p-3">
          <NavLink href="/" variant="side"><IconHome />Overzicht</NavLink>
          <NavLink href="/markt" variant="side"><IconMarket />Markt</NavLink>
          <NavLink href="/uitgiftes" variant="side"><IconLayers />Uitgiftes</NavLink>
          <NavLink href="/portefeuille" variant="side"><IconWallet />Portefeuille</NavLink>
          <NavLink href="/transacties" variant="side"><IconSwap />Transacties</NavLink>
          <NavLink href="/account" variant="side"><IconUser />Account</NavLink>
          {hasAdminRole(user) && <NavLink href="/beheer" variant="side"><IconShield />Beheer</NavLink>}
        </nav>
        </div>
        <main className="min-w-0 flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10">{children}</main>
      </div>

      <nav aria-label="Hoofdnavigatie mobiel" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-white md:hidden">
        <NavLink href="/markt" variant="bottom"><IconMarket />Markt</NavLink>
        <NavLink href="/uitgiftes" variant="bottom"><IconLayers />Uitgiftes</NavLink>
        <NavLink href="/portefeuille" variant="bottom"><IconWallet />Portefeuille</NavLink>
        <NavLink href="/account" variant="bottom"><IconUser />Account</NavLink>
      </nav>
    </div>
  );
}
