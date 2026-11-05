import Link from "next/link";
import { demoWorld } from "@px/demo";
import { isDemoLoginAllowed, loadConfig } from "@px/integrations/env";
import { signIn } from "@/auth";
import { Logo } from "@/components/icons";

export const metadata = { title: "Inloggen" };

const DESCRIPTIONS: Record<string, string> = {
  anna: "Toegelaten handelaar met kaarten, saldo en een open order",
  bram: "Geregistreerd, nog niet geverifieerd: handelen geblokkeerd",
  beheer: "Beheerder: catalogus, uitgifte, waardering en financiën",
  approver: "Goedkeurder voor gevoelige beheeracties",
};

export default function LoginPage() {
  const cfg = loadConfig(process.env);
  const demo = isDemoLoginAllowed(cfg);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-navy p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6">
        <div className="-mx-6 -mt-6 mb-5 rounded-t-2xl bg-navy px-6 py-4"><Logo /></div>
        <h1 className="text-xl font-bold">Inloggen</h1>
        {demo ? (
          <>
            <p className="mt-1 text-sm text-muted">Demo-modus: kies een fictief testaccount. Er is geen wachtwoord en er zijn geen echte gegevens.</p>
            <ul className="mt-4 space-y-2">
              {demoWorld().users.map((u) => (
                <li key={u.id}>
                  <form
                    action={async () => {
                      "use server";
                      await signIn("demo", { login: u.login, redirectTo: "/portefeuille" });
                    }}
                  >
                    <button className="w-full rounded-lg border border-line p-3 text-left hover:border-primary hover:bg-primary-soft">
                      <span className="block font-semibold">{u.displayName}</span>
                      <span className="block text-sm text-muted">{DESCRIPTIONS[u.login]}</span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <form
            action={async () => {
              "use server";
              await signIn("oidc", { redirectTo: "/portefeuille" });
            }}
          >
            <button className="mt-4 w-full rounded-lg bg-primary py-3 font-semibold text-white">Inloggen via identiteitsprovider</button>
          </form>
        )}
        <Link href="/markt" className="mt-4 block text-center text-sm text-primary hover:underline">Verder zonder inloggen</Link>
      </div>
    </div>
  );
}
