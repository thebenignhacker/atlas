import { relativeTime } from "@/lib/util/date";
import { freshnessLabel, freshnessTone } from "@/lib/freshness-shared";
import type { FreshnessTone, SectionFreshness } from "@/lib/freshness-shared";

const TONE_STYLE: Record<FreshnessTone, { dot: string; text: string }> = {
  fresh: { dot: "bg-fresh/70", text: "text-faint" },
  ok: { dot: "bg-recent/70", text: "text-faint" },
  // Degraded reads as attention, not alarm: a stale section is a pipeline that
  // needs a run, not a failure to shame anyone with.
  degraded: { dot: "bg-aging", text: "text-aging" },
  unknown: { dot: "bg-dormant", text: "text-dormant" },
};

/**
 * States a section's real data age. Deliberately renders BOTH the collection
 * clock and the artifact's build clock: the defect this replaces was a single
 * timestamp that silently switched from one to the other in deployed modes, so
 * a section nobody had collected in three weeks read as current.
 *
 * `freshness == null` is a first-class state ("unavailable"), never a reason to
 * fall back to some other timestamp that happens to be at hand.
 */
export function FreshnessBadge({
  freshness,
  artifactBuiltAt,
}: {
  freshness?: SectionFreshness | null;
  artifactBuiltAt?: string | null;
}) {
  const tone = freshnessTone(freshness);
  const style = TONE_STYLE[tone];
  const detail = [
    freshness?.dataAt ? `newest datum: ${freshness.dataAt}` : "no data",
    freshness?.collectedAt ? `collected: ${freshness.collectedAt}` : "never collected",
    artifactBuiltAt ? `page built: ${artifactBuiltAt}` : null,
    freshness?.note,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${style.text}`}
      title={detail}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
      {freshnessLabel(freshness)}
      {/* The artifact's own age was previously rendered nowhere at all, which is
          why a month-old bundle looked like a live page. */}
      {artifactBuiltAt && (
        <span className="text-dormant"> · built {relativeTime(artifactBuiltAt)}</span>
      )}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  lastScanAt,
  freshness,
  artifactBuiltAt,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Legacy single-clock display. Prefer `freshness`, which cannot conflate. */
  lastScanAt?: string | null;
  freshness?: SectionFreshness | null;
  artifactBuiltAt?: string | null;
  children?: React.ReactNode;
}) {
  const showFreshness = freshness !== undefined || artifactBuiltAt !== undefined;
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-5">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-text md:text-[2.5rem] md:leading-[1.05]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {children}
        {showFreshness ? (
          <FreshnessBadge freshness={freshness} artifactBuiltAt={artifactBuiltAt} />
        ) : (
          lastScanAt !== undefined && (
            <span className="inline-flex items-center gap-1.5 text-xs text-faint">
              <span className="h-1.5 w-1.5 rounded-full bg-fresh/70" />
              scanned {relativeTime(lastScanAt ?? null)}
            </span>
          )
        )}
      </div>
    </header>
  );
}

export function StatStrip({
  stats,
}: {
  stats: { label: string; value: string | number; accent?: string }[];
}) {
  return (
    <div className="mb-7 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line shadow-[0_1px_0_rgba(33,28,21,0.03)] sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((s, i) => (
        <div
          key={s.label}
          className="atlas-stagger bg-surface-1 px-4 py-4"
          style={{ ["--i" as string]: i }}
        >
          <div
            className={`font-display text-[2rem] font-semibold leading-none tnum ${s.accent ?? "text-text"}`}
          >
            {s.value}
          </div>
          <div className="mt-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint">
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}
