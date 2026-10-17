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
