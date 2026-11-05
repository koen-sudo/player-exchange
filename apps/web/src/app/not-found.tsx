import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="max-w-md rounded-xl border border-line bg-white p-8 text-center">
        <h1 className="text-xl font-semibold">Niet gevonden</h1>
        <p className="mt-2 text-muted">Deze pagina of speler bestaat niet.</p>
        <Link href="/markt" className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2.5 font-semibold text-white">Naar de markt</Link>
      </div>
    </div>
  );
}
