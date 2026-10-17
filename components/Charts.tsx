"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

// Shared chart primitives so every page's "at a glance" section looks the same:
// a labeled panel, a composition donut (with a centered total + value legend),
// and a horizontal ranking bar (HTML rows, so names are never cut by an axis).
// All in Atlas's warm palette.

const INK = "#211c15";
const LINE = "#e7dcc6";

export const CHART_TOOLTIP = {
  background: "#fffdf8",
  border: `1px solid ${LINE}`,
  borderRadius: 10,
  fontSize: 12,
  color: INK,
  boxShadow: "0 8px 24px -12px rgba(33,28,21,0.25)",
} as const;

export interface Slice {
  name: string;
  value: number;
  color: string;
}

export function ChartPanel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface-1 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint">
          {title}
        </h3>
        {hint && <span className="text-[11px] text-faint tnum">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function ChartEmpty() {
  return (
    <div className="grid h-[160px] place-items-center text-xs text-faint">
      Not enough data yet.
    </div>
  );
}

/** Composition donut with a centered total and a value legend. */
export function Donut({ data, unit }: { data: Slice[]; unit: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <ChartEmpty />;
  return (
    <div className="flex items-center gap-3">
      {/* Fixed-width donut column so the ring's outerRadius always sits inside it
          with margin — a percentage width can shrink below the diameter and clip. */}
      <div className="relative h-[150px] w-[136px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={40}
              outerRadius={58}
              paddingAngle={2}
              startAngle={90}
              endAngle={-270}
              stroke="#fffdf8"
              strokeWidth={2}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v, n) => [`${v} ${unit}`, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-semibold leading-none tnum text-text">
            {total}
          </span>
          <span className="mt-0.5 text-[9.5px] uppercase tracking-[0.1em] text-faint">
            {unit}
          </span>
        </div>
      </div>
      <ul className="flex-1 space-y-1 overflow-hidden text-[11.5px]">
        {data.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-muted">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
              <span className="truncate">{d.name}</span>
            </span>
            <span className="tnum text-text">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Horizontal ranking bar, one row per datum in data order. Each datum may carry
 * its own `fill`. Names are never cut: repositories that share a long prefix
 * differ only in their suffix. In a panel at least 24rem wide the name column is
 * as wide as the longest name (up to 60%, then it wraps) and the bars share one
 * start line; in a narrower panel each name sits on its own line above its bar,
 * with the panel's full width to wrap in. The value sits to the right of the bar.
 */
export function RankBar({
  data,
  unit,
  fill,
}: {
  data: { name: string; value: number; fill?: string }[];
  unit: string;
  fill: string;
}) {
  if (data.length === 0) return <ChartEmpty />;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="@container flex min-h-[160px] flex-col justify-center">
      <ol className="flex flex-col gap-2 @sm:grid @sm:grid-cols-[fit-content(60%)_minmax(0,1fr)_auto] @sm:items-center @sm:gap-x-2.5 @sm:gap-y-2.5">
        {data.map((d, i) => (
          <li
            key={`${d.name}-${i}`}
            className="min-w-0 @sm:col-span-3 @sm:grid @sm:grid-cols-subgrid @sm:items-center"
            title={`${d.name}: ${d.value} ${unit}`}
          >
            <div className="text-[11px] leading-[13px] text-text [overflow-wrap:anywhere] @sm:leading-4">
              {d.name}
            </div>
            <div className="mt-[2px] flex items-center gap-2 @sm:contents">
              <div className="h-[10px] min-w-0 flex-1 @sm:h-[13px]" aria-hidden="true">
                <div
                  className="h-full min-w-[2px] rounded-r-[4px]"
                  style={{ width: `${(d.value / max) * 100}%`, background: d.fill ?? fill }}
                />
              </div>
              <span className="shrink-0 text-right text-[11px] leading-[13px] tnum text-muted">
                {d.value}
                <span className="sr-only"> {unit}</span>
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
