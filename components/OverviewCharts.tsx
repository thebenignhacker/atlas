"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RepoWithSignals } from "@/lib/queries";
import { languageColor } from "@/lib/display";
import type { StalenessBucket } from "@/lib/types";

const INK = "#211c15";
const LINE = "#e7dcc6";
const MARIGOLD = "#e8a317";

const STALE_ORDER: StalenessBucket[] = ["fresh", "recent", "aging", "stale", "dormant"];
const STALE_META: Record<StalenessBucket, { label: string; color: string }> = {
  fresh: { label: "Active today", color: "#2f6b4a" },
  recent: { label: "This week", color: "#1f8a7e" },
  aging: { label: "This month", color: "#e8a317" },
  stale: { label: "Stale", color: "#c75d3c" },
  dormant: { label: "Dormant", color: "#b7ad9a" },
};

function Panel({
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

function tooltipStyle() {
  return {
    background: "#fffdf8",
    border: `1px solid ${LINE}`,
    borderRadius: 10,
    fontSize: 12,
    color: INK,
    boxShadow: "0 8px 24px -12px rgba(33,28,21,0.25)",
  } as const;
}

export function OverviewCharts({ repos }: { repos: RepoWithSignals[] }) {
  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of repos) {
      if (!r.language) continue;
      counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value, fill: languageColor(name) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7);
  }, [repos]);

  const freshness = useMemo(() => {
    const counts = new Map<StalenessBucket, number>();
    for (const r of repos)
      counts.set(r.signals.staleness, (counts.get(r.signals.staleness) ?? 0) + 1);
    return STALE_ORDER.map((k) => ({
      key: k,
      name: STALE_META[k].label,
      value: counts.get(k) ?? 0,
      color: STALE_META[k].color,
    })).filter((d) => d.value > 0);
  }, [repos]);

  const active = useMemo(
    () =>
      repos
        .filter((r) => r.commitCount30d > 0)
        .sort((a, b) => b.commitCount30d - a.commitCount30d)
        .slice(0, 6)
        .map((r) => ({ name: r.name, value: r.commitCount30d }))
        .reverse(),
    [repos]
  );

  const liveCount = freshness
    .filter((d) => d.key === "fresh" || d.key === "recent")
    .reduce((s, d) => s + d.value, 0);

  return (
    <div className="mb-7 grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Panel title="Languages" hint={`${languages.length} shown`}>
        {languages.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={languages}
              layout="vertical"
              margin={{ top: 0, right: 16, bottom: 0, left: 4 }}
              barCategoryGap={6}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={78}
                tickLine={false}
                axisLine={false}
                tick={{ fill: INK, fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: "rgba(33,28,21,0.04)" }}
                contentStyle={tooltipStyle()}
                formatter={(v) => [`${v} repos`, ""]}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
                {languages.map((d) => (
                  <Cell key={d.name} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Panel>

      <Panel title="Freshness" hint={`${liveCount} live`}>
        {freshness.length === 0 ? (
          <Empty />
        ) : (
          <div className="flex items-center gap-3">
            <ResponsiveContainer width="55%" height={180}>
              <PieChart>
                <Pie
                  data={freshness}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={42}
                  outerRadius={70}
                  paddingAngle={2}
                  stroke="#fffdf8"
                  strokeWidth={2}
                >
                  {freshness.map((d) => (
                    <Cell key={d.key} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle()}
                  formatter={(v, n) => [`${v} repos`, n]}
                />
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex-1 space-y-1.5 text-[11.5px]">
              {freshness.map((d) => (
                <li key={d.key} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-muted">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: d.color }}
                    />
                    {d.name}
                  </span>
                  <span className="tnum text-text">{d.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <Panel title="Most active" hint="commits / 30d">
        {active.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={active}
              layout="vertical"
              margin={{ top: 0, right: 16, bottom: 0, left: 4 }}
              barCategoryGap={6}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={92}
                tickLine={false}
                axisLine={false}
                tick={{ fill: INK, fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: "rgba(33,28,21,0.04)" }}
                contentStyle={tooltipStyle()}
                formatter={(v) => [`${v} commits`, ""]}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14} fill={MARIGOLD} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Panel>
    </div>
  );
}

function Empty() {
  return (
    <div className="grid h-[180px] place-items-center text-xs text-faint">
      Not enough data yet.
    </div>
  );
}
