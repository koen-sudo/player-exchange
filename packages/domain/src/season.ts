/**
 * Platform season (BR-02, addendum V1.1).
 *
 * Half-open interval: from 1 July 00:00 Europe/Amsterdam up to, but not
 * including, 1 July 00:00 of the next year in the same zone. Both bounds are
 * converted to UTC separately. Season key format: "2026-2027".
 */
import { DomainError } from "./errors.ts";

export const PLATFORM_TIME_ZONE = "Europe/Amsterdam";

export type SeasonKey = `${number}-${number}`;

/** Offset in minutes of `zone` relative to UTC at the given instant. */
export function zoneOffsetMinutes(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * UTC instant for a wall-clock time in `zone`. Resolves the offset in two
 * passes so it is correct around DST transitions for times that exist.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: string = PLATFORM_TIME_ZONE,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const first = naive - zoneOffsetMinutes(new Date(naive), zone) * 60_000;
  const second = naive - zoneOffsetMinutes(new Date(first), zone) * 60_000;
  return new Date(second);
}

export function seasonStartUtc(startYear: number): Date {
  return zonedWallTimeToUtc(startYear, 7, 1, 0, 0, PLATFORM_TIME_ZONE);
}

export function seasonKey(startYear: number): SeasonKey {
  return `${startYear}-${startYear + 1}` as SeasonKey;
}

export function parseSeasonKey(key: string): { startYear: number; key: SeasonKey } {
  const m = /^(\d{4})-(\d{4})$/.exec(key);
  if (!m || Number(m[2]) !== Number(m[1]) + 1) {
    throw new DomainError("INVARIANT_VIOLATION", { detail: `invalid season key ${key}` });
  }
  return { startYear: Number(m[1]), key: key as SeasonKey };
}

/** [startUtc, endUtc) for a season key. */
export function seasonBounds(key: string): { startUtc: Date; endUtcExclusive: Date } {
  const { startYear } = parseSeasonKey(key);
  return { startUtc: seasonStartUtc(startYear), endUtcExclusive: seasonStartUtc(startYear + 1) };
}

/** Season key containing an instant. An instant exactly on 1 July 00:00 belongs to the new season. */
export function seasonKeyFor(instant: Date): SeasonKey {
  // Candidate based on the UTC year, then correct with exact local bounds.
  const y = instant.getUTCFullYear();
  for (const startYear of [y, y - 1, y + 1]) {
    const start = seasonStartUtc(startYear).getTime();
    const end = seasonStartUtc(startYear + 1).getTime();
    const t = instant.getTime();
    if (t >= start && t < end) return seasonKey(startYear);
  }
  throw new DomainError("INVARIANT_VIOLATION", { detail: "season not resolvable" });
}
