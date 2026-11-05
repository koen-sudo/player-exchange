import { cents, formatEuro, formatEuroChange, type Cents } from "@px/domain";

export const TZ = "Europe/Amsterdam";

export const euro = (v: Cents | number | null | undefined) => formatEuro(v === null || v === undefined ? null : cents(v));
export const euroChange = (v: Cents | number | null | undefined) => formatEuroChange(v === null || v === undefined ? null : cents(v));
export const euroFromMinor = (s: string | null | undefined) => (s === null || s === undefined ? euro(null) : euro(Number(s)));

const dt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("nl-NL", { timeZone: TZ, ...opts });
export const dateTime = (d: Date | string) => dt({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
export const dateOnly = (d: Date | string) => dt({ day: "numeric", month: "short", year: "numeric" }).format(new Date(d));
export const weekdayTime = (d: Date | string) => dt({ weekday: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
export const timeOnly = (d: Date | string) => dt({ hour: "2-digit", minute: "2-digit" }).format(new Date(d));

/** Parse a Dutch euro input like "6,20", "6.20" or "€ 6" into an integer-cent string. */
export function euroInputToMinor(raw: string): string | null {
  const s = raw.replace(/[€\s]/g, "").replace(",", ".");
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return String(Number(whole) * 100 + Number((frac + "00").slice(0, 2)));
}
