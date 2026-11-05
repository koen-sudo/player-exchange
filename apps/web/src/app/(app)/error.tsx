"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md rounded-xl border border-line bg-white p-8 text-center">
      <h1 className="text-xl font-semibold">Tijdelijk niet beschikbaar</h1>
      <p className="mt-2 text-muted">Deze pagina kon niet worden geladen. Er is niets gewijzigd.</p>
      {error.digest && <p className="mt-2 text-xs text-muted">Referentie: {error.digest}</p>}
      <button type="button" onClick={reset} className="mt-4 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white">Opnieuw proberen</button>
    </div>
  );
}
