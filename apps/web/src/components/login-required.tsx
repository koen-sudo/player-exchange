import Link from "next/link";

export function LoginRequired({ what }: { what: string }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-white p-8 text-center">
      <h1 className="text-xl font-semibold">Inloggen vereist</h1>
      <p className="mt-2 text-muted">Log in om {what} te bekijken.</p>
      <Link href="/login" className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2.5 font-semibold text-white">Inloggen</Link>
    </div>
  );
}

export function NotAllowed() {
  return (
    <div role="alert" className="mx-auto max-w-md rounded-xl border border-line bg-white p-8 text-center">
      <h1 className="text-xl font-semibold">Onvoldoende rechten</h1>
      <p className="mt-2 text-muted">Je account heeft geen toegang tot deze pagina.</p>
    </div>
  );
}
