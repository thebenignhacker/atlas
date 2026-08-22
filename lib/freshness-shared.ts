import { daysSince, relativeTime, stalenessBucket } from "@/lib/util/date";

/**
 * Per-section freshness. The reason this module exists: a dashboard that renders
 * one timestamp cannot tell you whether the number in front of you is current,
 * and Atlas was rendering the WRONG one — `PageHeader lastScanAt` on /usage was
 * fed the snapshot's build time, so a 21-day-dead mining step read as "scanned
 * just now" the moment a snapshot was rebuilt.
 *
 * Three clocks are genuinely distinct and all three are needed to answer "is
 * this current?". Collapsing them is what produced the lie:
 *
 *   dataAt      the newest datum the section actually contains
 *               ("the data goes up to here")
 *   collectedAt when the collector that feeds the section last RAN
 *               ("this is when we last looked")
 *   builtAt     when the section was serialized into the artifact you are
 *               reading ("this is when the page was baked")
 *
 * They agree only when the pipeline is healthy, and it is precisely their
 * DISAGREEMENT that carries the signal. A build every 10 minutes over frozen
 * events keeps `builtAt` and `collectedAt` fresh while `dataAt` rots; that is
 * the failure automation would otherwise make permanent and silent.
 */

/**
 * What the collector's last run actually did. `did-not-run`,
 * `ran-and-found-nothing` and `ran-and-errored` are three states, not one — the
 * scanners used to report all three as success.
 */
export type SectionStatus =
  /** Collected data successfully. */
  | "ok"
  /** The collector ran to completion and legitimately found nothing. */
  | "empty"
  /** The collector failed, or its output collapsed against the prior run. */
  | "error"
  /** The collector has never run. Distinct from "ran and found nothing". */
  | "never";

export interface SectionFreshness {
  /** ISO time of the newest datum in the section; null when it holds none. */
  dataAt: string | null;
  /** ISO time the feeding collector last ran; null when it never has. */
  collectedAt: string | null;
  /** ISO time this section was written into the artifact. */
  builtAt: string;
  status: SectionStatus;
  /** Item count as published. Bounds are applied before this is taken. */
  count: number;
  /** Why the section is not plainly `ok`. Surfaced in the UI, never swallowed. */
  note: string | null;
}

/** Keyed by section name (`usage`, `repos`, `context`, …). */
export type SnapshotFreshness = Record<string, SectionFreshness>;

/**
 * Render tone. `unknown` is a real state, not a fallback for "we didn't check":
 * an artifact that carries no freshness block cannot be described as fresh, so
 * it must say so rather than inherit the page's default styling.
 */
export type FreshnessTone = "fresh" | "ok" | "degraded" | "unknown";

/**
 * Degradation keys on `collectedAt` — how long since we looked — because that is
 * the unambiguous signal. A lagging `dataAt` is NOT treated as a fault: "no new
 * events for 9 days" is equally consistent with a dead collector and with a
 * quiet fortnight, and inventing a verdict from an ambiguous signal is how a
 * dashboard starts lying in the other direction. The lag is surfaced in the
 * label instead, where a human can read it.
 *
 * Buckets are `stalenessBucket`'s, reused deliberately rather than invented
 * here, so freshness on this page means the same thing it already means on the
 * repo cards.
 */
export function freshnessTone(
  f: SectionFreshness | null | undefined,
  now = new Date()
): FreshnessTone {
  if (!f) return "unknown";
  if (f.status === "never") return "unknown";
  if (f.status === "error") return "degraded";
  const bucket = stalenessBucket(daysSince(f.collectedAt, now));
  if (bucket === "fresh") return "fresh";
  if (bucket === "recent") return "ok";
  return "degraded";
}

/**
 * One line a human can act on. Always states what the data covers AND when we
 * last looked, because either one alone is the bug this module exists to fix.
 */
export function freshnessLabel(
  f: SectionFreshness | null | undefined,
  now = new Date()
): string {
  if (!f) return "freshness unavailable";
  if (f.status === "never") return "never collected";
  if (f.status === "error")
    return `collection failed — showing data through ${relativeTime(f.dataAt, now)}`;
  if (f.status === "empty")
    return `checked ${relativeTime(f.collectedAt, now)} — found nothing`;

  const collected = relativeTime(f.collectedAt, now);
  const through = relativeTime(f.dataAt, now);
  // Only mention the lag when it is big enough to matter; below the "recent"
  // bucket the two clocks are effectively the same instant and saying both
  // twice is noise.
  const lag = lagDays(f);
  if (lag !== null && lag > 7) return `data through ${through} · checked ${collected}`;
  return `data through ${through}`;
}

/** Days by which the newest datum trails the last collection, or null. */
export function lagDays(f: SectionFreshness): number | null {
  if (!f.dataAt || !f.collectedAt) return null;
  const d = new Date(f.dataAt).getTime();
  const c = new Date(f.collectedAt).getTime();
  if (Number.isNaN(d) || Number.isNaN(c)) return null;
  return Math.floor((c - d) / 86_400_000);
}

/** Age in days of the artifact itself, or null when it carries no build time. */
export function artifactAgeDays(
  generatedAt: string | null | undefined,
  now = new Date()
): number | null {
  return daysSince(generatedAt ?? null, now);
}

/**
 * Freshness for a section read live from markdown at build time. Both clocks
 * are the build instant because the files ARE read then — there is no collector
 * in between that could have stalled. Stated explicitly so nobody later "fixes"
 * it into a file mtime.
 */
export function liveSection(
  builtAt: string,
  itemCount: number
): SectionFreshness {
  return {
    dataAt: builtAt,
    collectedAt: builtAt,
    builtAt,
    status: itemCount === 0 ? "empty" : "ok",
    count: itemCount,
    note: itemCount === 0 ? "no files matched at build time" : null,
  };
}
