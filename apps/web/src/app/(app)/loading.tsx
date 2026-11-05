export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">Laden…</span>
      <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
      <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
    </div>
  );
}
