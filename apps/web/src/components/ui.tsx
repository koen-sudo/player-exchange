import type { ReactNode } from "react";
import { euro, euroChange } from "@/lib/format";

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-white ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function DarkCardHeader({ children }: { children: ReactNode }) {
  return <div className="rounded-t-xl bg-navy px-4 py-3 text-base font-semibold text-white">{children}</div>;
}

export function Money({ cents, className = "" }: { cents: number | null | undefined; className?: string }) {
  return <span className={`num ${className}`}>{euro(cents)}</span>;
}

/** Positive/negative change: colour plus sign plus text, never colour alone (docs/02). */
export function Change({ cents }: { cents: number | null | undefined }) {
  if (cents === null || cents === undefined) return <span className="text-muted">Niet beschikbaar</span>;
  const tone = cents > 0 ? "text-up" : cents < 0 ? "text-down" : "text-muted";
  const word = cents > 0 ? "gestegen" : cents < 0 ? "gedaald" : "gelijk";
  return (
    <span className={`num ${tone}`}>
      {euroChange(cents)} <span className="sr-only">({word})</span>
    </span>
  );
}

export function Avatar({ initials, size = "md" }: { initials: string; size?: "sm" | "md" | "lg" }) {
  const s = size === "lg" ? "h-16 w-16 text-2xl" : size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-semibold text-navy ${s}`}>
      {initials}
    </span>
  );
}

type Tone = "green" | "blue" | "grey" | "amber" | "red";
const TONES: Record<Tone, string> = {
  green: "bg-primary-soft text-primary-dark",
  blue: "bg-sky-50 text-sky-800",
  grey: "bg-slate-100 text-slate-700",
  amber: "bg-warn-soft text-amber-900",
  red: "bg-danger-soft text-down",
};
export function Pill({ tone = "grey", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{children}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 text-sm text-muted">
      <span aria-hidden className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-muted text-[10px]">i</span>
      <span>{children}</span>
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-white p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorState({ title = "Tijdelijk niet beschikbaar", children }: { title?: string; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-down/30 bg-danger-soft p-4 text-sm">
      <p className="font-medium text-down">{title}</p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

export function DisabledReason({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs text-muted">{children}</p>;
}

export function DataQualityBadge({ quality }: { quality: "OK" | "PARTIAL" | "STALE" | "MISSING" }) {
  if (quality === "OK") return null;
  const label = quality === "PARTIAL" ? "Gedeeltelijke data" : quality === "STALE" ? "Verouderde data" : "Onvoldoende data";
  return <Pill tone="amber">{label}</Pill>;
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export const buttonPrimary =
  "inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50";
export const buttonSecondary =
  "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-medium text-ink hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
