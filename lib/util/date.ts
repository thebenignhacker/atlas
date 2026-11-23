import type { StalenessBucket } from "@/lib/types";

export function daysSince(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

/** Buckets last-activity age into a calm→dormant scale (drives card color). */
export function stalenessBucket(days: number | null): StalenessBucket {
  if (days === null) return "dormant";
  if (days <= 2) return "fresh";
  if (days <= 7) return "recent";
  if (days <= 30) return "aging";
  if (days <= 90) return "stale";
  return "dormant";
}

export function relativeTime(iso: string | null, now = new Date()): string {
  const d = daysSince(iso, now);
  if (d === null) return "never";
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  // Weeks through 90 days: 30-day months would read 50 and 59 days alike as
  // "1mo ago", understating age in the range where it decides whether a
  // picture is still current.
  if (d <= 90) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/**
 * An ISO time as milliseconds since the epoch, for ordering two of them. The
 * scan records commit times with the committer's UTC offset (git log
 * --format=%cI), so two times written with different offsets need not sort as
 * text in the order they happened: 2026-03-02T01:00:00+00:00 sorts after
 * 2026-03-01T23:30:00-07:00 as text, yet is five and a half hours earlier. A
 * null or unparseable time is -Infinity, below each parsed one.
 */
export function instantOf(iso: string | null | undefined): number {
  const ms = iso == null ? NaN : Date.parse(iso);
  return Number.isNaN(ms) ? -Infinity : ms;
}

/**
 * A sort comparator putting the later instant first (instantOf), a null or
 * unparseable time last. Two equal instants compare as 0.
 */
export function newestFirst(a: string | null | undefined, b: string | null | undefined): number {
  const x = instantOf(a);
  const y = instantOf(b);
  return x === y ? 0 : y > x ? 1 : -1;
}

/**
 * SQL ordering an activity query by its ts column as an instant, latest first.
 * SQLite's julianday() applies a +HH:MM / -HH:MM / Z suffix; a ts it cannot
 * parse is NULL and sorts after each parsed one. The text of ts breaks a tie.
 */
export const ACTIVITY_NEWEST_FIRST = "julianday(ts) DESC, ts DESC";

/** The UTC calendar day (YYYY-MM-DD) of an ISO time, or null when unparseable. */
export function utcDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/** Extract a YYYY-MM-DD date prefix from a todo filename, if present. */
export function dateFromFilename(filename: string): string | null {
  const m = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
