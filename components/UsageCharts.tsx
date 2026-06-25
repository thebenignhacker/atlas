"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UsageRollup } from "@/lib/usage/types";
import { CATEGORY_META } from "@/lib/usage/catalog-meta";

const INK = "#211c15";
const LINE = "#e7dcc6";
const CLAY = "#c75d3c";
const PROJECT_COLORS = ["#8b5cf6", "#1f8a7e", "#e8a317", "#3b82f6", "#c75d3c", "#b7ad9a"];

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

const tooltipStyle = {
  background: "#fffdf8",
  border: `1px solid ${LINE}`,
  borderRadius: 10,
  fontSize: 12,
  color: INK,
  boxShadow: "0 8px 24px -12px rgba(33,28,21,0.25)",
} as const;

/** Short day label for the trailing-30-day axis (every 5th tick). */
function dayTicks(len: number): { i: number; label: string }[] {
  const out: { i: number; label: string }[] = [];
  for (let i = 0; i < len; i++) {
    const back = len - 1 - i;
    out.push({ i, label: back === 0 ? "today" : `-${back}d` });
  }
  return out;
}

export function UsageCharts({ usage }: { usage: UsageRollup }) {
  const categories = usage.byCategory.map((c) => ({
    name: CATEGORY_META[c.category]?.label ?? c.category,
    value: c.count,
    fill: CATEGORY_META[c.category]?.color ?? "#9c9384",
  }));

  const ticks = dayTicks(usage.spark.length);
  const activity = usage.spark.map((v, i) => ({
    day: ticks[i]?.label ?? "",
    value: v,
  }));
  const peak = Math.max(0, ...usage.spark);

  const projects = usage.projects.map((p, i) => ({
    name: p.project,
    value: p.count,
    fill: PROJECT_COLORS[i % PROJECT_COLORS.length],
  }));

  return (
    <div className="mb-7 grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Panel title="By category" hint={`${categories.length} kinds`}>
        {categories.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={categories}
              layout="vertical"
              margin={{ top: 0, right: 16, bottom: 0, left: 4 }}
              barCategoryGap={5}
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
                contentStyle={tooltipStyle}
                formatter={(v) => [`${v} calls`, ""]}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={13}>
                {categories.map((d) => (
                  <Cell key={d.name} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Panel>

      <Panel title="Activity" hint={peak > 0 ? `peak ${peak}/day` : "last 30 days"}>
        {peak === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={activity}
              margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
              barCategoryGap={1}
            >
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                interval={4}
                tick={{ fill: "#9c9384", fontSize: 10 }}
              />
              <YAxis hide />
              <Tooltip
                cursor={{ fill: "rgba(33,28,21,0.04)" }}
                contentStyle={tooltipStyle}
                formatter={(v) => [`${v} calls`, ""]}
              />
              <Bar dataKey="value" radius={[2, 2, 0, 0]} fill={CLAY} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Panel>

      <Panel title="By project" hint={`${projects.length} shown`}>
        {projects.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={projects}
              layout="vertical"
              margin={{ top: 0, right: 16, bottom: 0, left: 4 }}
              barCategoryGap={5}
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
                contentStyle={tooltipStyle}
                formatter={(v) => [`${v} calls`, ""]}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={13}>
                {projects.map((d) => (
                  <Cell key={d.name} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Panel>
    </div>
  );
}

function Empty() {
  return (
    <div className="grid h-[200px] place-items-center text-xs text-faint">
      Not enough data yet. Run <code className="mx-1">npm run scan:usage</code>.
    </div>
  );
}
