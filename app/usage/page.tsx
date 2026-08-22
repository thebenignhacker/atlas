import { getArtifactBuiltAt, getFreshness, getUsage } from "@/lib/queries";
import { PageHeader, StatStrip } from "@/components/PageHeader";
import { UsageCharts } from "@/components/UsageCharts";
import { Sparkline } from "@/components/Sparkline";
import { EmptyState } from "@/components/EmptyState";
import { getRequestMode } from "@/lib/request-mode";
import { CATEGORY_META } from "@/lib/usage/catalog-meta";
import type { FeatureUsage, Routine, RoutineKind } from "@/lib/usage/types";
import { relativeTime } from "@/lib/util/date";

export const dynamic = "force-dynamic";

const KIND_META: Record<RoutineKind, { label: string; color: string }> = {
  skill: { label: "skill", color: "#1f8a7e" },
  loop: { label: "loop", color: "#c75d3c" },
  workflow: { label: "workflow", color: "#8b5cf6" },
  manual: { label: "manual", color: "#b7ad9a" },
};

function StepChain({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {steps.map((s, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <code
            className={`rounded bg-surface-2 px-1.5 py-0.5 text-[11px] ${
              s === "·code" || s === "·web" ? "text-muted" : "text-text"
            }`}
          >
            {s}
          </code>
          {i < steps.length - 1 && <span className="text-faint">→</span>}
        </span>
      ))}
    </div>
  );
}

function RoutineCard({ r }: { r: Routine }) {
  const meta = KIND_META[r.kind];
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <StepChain steps={r.steps} />
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
          style={{ background: `${meta.color}1a`, color: meta.color }}
        >
          {meta.label}
        </span>
      </div>
      <div className="mt-2 text-[11px] text-faint tnum">
        {r.support} sessions · {r.occurrences} times
        {r.lastSeen ? ` · last ${relativeTime(r.lastSeen)}` : ""}
      </div>
      <details className="mt-3 group">
        <summary className="cursor-pointer text-[12px] font-medium text-clay hover:underline">
          Automation scaffold
        </summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-[var(--radius-card)] border border-line bg-surface-2/50 p-3 text-[11.5px] leading-relaxed text-muted">
          {r.scaffold}
        </pre>
      </details>
    </div>
  );
}

function CategoryChip({ category }: { category: FeatureUsage["category"] }) {
  const meta = CATEGORY_META[category];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
      style={{ background: `${meta.color}1a`, color: meta.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

function FeatureCard({ f }: { f: FeatureUsage }) {
  return (
    <div className="flex flex-col rounded-[var(--radius-card)] border border-line bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-[15px] font-semibold text-text">
            {f.displayName}
          </div>
          <div className="mt-1">
            <CategoryChip category={f.category} />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-2xl font-semibold leading-none tnum text-text">
            {f.count.toLocaleString()}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-faint">
            calls
          </div>
        </div>
      </div>

      {f.description && (
        <p className="mt-2.5 line-clamp-3 text-[12.5px] leading-relaxed text-muted">
          {f.description}
        </p>
      )}

      <div className="mt-auto flex items-end justify-between gap-2 pt-3">
        <span className="text-[11px] text-faint">
          {f.lastUsed ? `last ${relativeTime(f.lastUsed)}` : "never used"}
        </span>
        <Sparkline data={f.spark} />
      </div>
    </div>
  );
}

export default async function UsagePage() {
  const mode = await getRequestMode();
  let usage;
  let freshness = null;
  let builtAt: string | null = null;
  try {
    usage = getUsage(mode);
    freshness = getFreshness(mode, "usage");
    builtAt = getArtifactBuiltAt(mode);
  } catch {
    return (
      <div className="px-5 py-8 pb-20 md:px-8">
        <EmptyState />
      </div>
    );
  }

  const used = usage.features.filter((f) => f.count > 0);
  const underused = usage.features.filter((f) => f.underused);
  const routines = usage.routines ?? [];
  const topKind = usage.byCategory[0]
    ? CATEGORY_META[usage.byCategory[0].category]?.label ?? "—"
    : "—";

  const stats = [
    { label: "Tool calls", value: usage.totals.events.toLocaleString() },
    { label: "Features", value: usage.totals.features },
    { label: "Workflows", value: usage.totals.workflowsRun, accent: "text-purple" },
    { label: "Sessions", value: usage.totals.sessions },
    { label: "Active days", value: usage.totals.activeDays },
    { label: "Top kind", value: topKind },
  ];

  return (
    <div className="px-5 py-8 pb-20 md:px-8">
      <PageHeader
        title="Usage"
        subtitle="Which Claude Code features this work actually leans on — mined from session transcripts. Metadata only: tool names and timing, never commands or content."
        freshness={freshness}
        artifactBuiltAt={builtAt}
      />

      {usage.totals.events === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-surface-1 p-8 text-center text-sm text-muted">
          No usage mined yet. Run <code className="mx-1">npm run scan:usage</code> to
          read your local Claude Code transcripts.
        </div>
      ) : (
        <>
          <StatStrip stats={stats} />
          <UsageCharts usage={usage} />

          {underused.length > 0 && (
            <section className="mb-7 rounded-[var(--radius-card)] border border-clay/30 bg-clay/[0.04] p-4">
              <h3 className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-clay">
                Recommended, but rarely used
              </h3>
              <p className="mt-1 text-[12.5px] text-muted">
                High-leverage features the playbook flags that this work barely touches.
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {underused.map((f) => (
                  <li key={f.feature} className="text-[12.5px]">
                    <span className="font-medium text-text">{f.displayName}</span>
                    {f.whenToUse && (
                      <span className="text-muted"> — {f.whenToUse}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {routines.length > 0 && (
            <section className="mb-8">
              <div className="mb-1 flex items-baseline justify-between">
                <h2 className="font-display text-lg font-semibold text-text">
                  Routines you could automate
                </h2>
                <span className="text-xs text-faint tnum">{routines.length} found</span>
              </div>
              <p className="mb-3 text-[12.5px] text-muted">
                Tool-sequences this work repeats by hand, mined from session history.
                Each scaffold is a starting point to adapt, not a finished workflow.
              </p>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {routines.map((r, i) => (
                  <RoutineCard key={i} r={r} />
                ))}
              </div>
            </section>
          )}

          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold text-text">Features</h2>
            <span className="text-xs text-faint tnum">{used.length} used</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {used.map((f) => (
              <FeatureCard key={f.feature} f={f} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
