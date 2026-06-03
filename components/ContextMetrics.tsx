import { ShieldCheck } from "lucide-react";
import type { ContextMetrics, Freshness } from "@/lib/types";

/**
 * The Context Store metrics panel. Hero = stale facts caught (measured, from the
 * event log). Secondaries: tokens saved (a labeled estimate) and a freshness
 * coverage bar. Server-rendered; no client JS.
 */

const SEGMENTS: { key: Freshness; label: string; color: string }[] = [
  { key: "fresh", label: "fresh", color: "var(--color-fresh)" },
  { key: "drifted", label: "drifted", color: "var(--color-marigold)" },
  { key: "expired", label: "expired", color: "var(--color-amber)" },
  { key: "stale", label: "stale", color: "var(--color-clay)" },
  { key: "unverified", label: "unverified", color: "var(--color-faint)" },
];

export function ContextMetrics({ m }: { m: ContextMetrics }) {
  const total = SEGMENTS.reduce((n, s) => n + m.freshness[s.key], 0) || 1;

  return (
    <div className="mb-7 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line lg:grid-cols-[1.4fr_1fr]">
      {/* Hero: stale facts caught */}
      <div className="bg-surface-1 px-6 py-7">
        <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald" strokeWidth={2.2} />
          stale facts caught
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="font-display text-[3.5rem] font-semibold leading-none tnum text-text">
            {m.staleCaught}
          </span>
          <span className="text-sm leading-snug text-muted">
            stale {m.staleCaught === 1 ? "fact" : "facts"} flagged
            <br />before they could mislead a session
          </span>
        </div>
        <p className="mt-4 max-w-md text-[12px] leading-relaxed text-faint">
          Counted from the event log the moment a card&apos;s sources drift or its
          check fails — measured, not estimated.
        </p>
      </div>

      {/* Secondary tiles */}
      <div className="grid grid-cols-2 gap-px bg-line">
        <Tile
          value={`~${formatK(m.tokensSavedEstimate)}`}
          label="tokens saved"
          hint="estimate"
        />
        <Tile value={m.activeCards} label="active cards" />
        <Tile value={m.reads} label="reads served" />
        <Tile
          value={m.freshness.fresh}
          label="verified fresh"
          accent="text-emerald"
        />
      </div>

      {/* Freshness coverage bar (full width) */}
      <div className="bg-surface-1 px-6 py-5 lg:col-span-2">
        <div className="mb-2 flex items-center justify-between text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint">
          <span>freshness coverage</span>
          <span>{m.activeCards} cards</span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-3">
          {SEGMENTS.map((s) =>
            m.freshness[s.key] > 0 ? (
              <div
                key={s.key}
                style={{
                  width: `${(m.freshness[s.key] / total) * 100}%`,
                  background: s.color,
                }}
                title={`${s.label}: ${m.freshness[s.key]}`}
              />
            ) : null
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          {SEGMENTS.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: s.color }}
              />
              {m.freshness[s.key]} {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Tile({
  value,
  label,
  hint,
  accent = "text-text",
}: {
  value: string | number;
  label: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="bg-surface-1 px-5 py-4">
      <div className={`font-display text-[1.75rem] font-semibold leading-none tnum ${accent}`}>
        {value}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint">
        {label}
        {hint && (
          <span className="rounded bg-surface-3 px-1 py-px text-[9px] normal-case tracking-normal text-muted">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}
