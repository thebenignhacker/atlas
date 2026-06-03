"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ActivityEvent } from "@/lib/types";
import { relativeTime } from "@/lib/util/date";

const WEEKS = 13;

export function ActivityView({
  events,
  repoMap,
}: {
  events: ActivityEvent[];
  repoMap: Record<string, string>;
}) {
  const [repo, setRepo] = useState("all");

  const repos = useMemo(
    () =>
      Array.from(new Set(events.map((e) => e.repoSlug).filter(Boolean) as string[]))
        .map((slug) => ({ slug, name: repoMap[slug] ?? slug }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [events, repoMap]
  );

  const filtered = useMemo(
    () => (repo === "all" ? events : events.filter((e) => e.repoSlug === repo)),
    [events, repo]
  );

  const { weeks, max, total } = useMemo(() => buildHeatmap(filtered), [filtered]);

  const trend = useMemo(
    () =>
      weeks.map((week) => ({
        label: week[0]?.date.slice(5) ?? "",
        commits: week.reduce((s, d) => s + (d.count > 0 ? d.count : 0), 0),
      })),
    [weeks]
  );

  const byDay = useMemo(() => {
    const groups = new Map<string, ActivityEvent[]>();
    for (const e of filtered) {
      const key = (e.ts ?? "").slice(0, 10);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-muted focus:border-teal focus:outline-none"
        >
          <option value="all">All repos</option>
          {repos.map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-faint">
          {total} commits in the last {WEEKS} weeks
        </span>
      </div>

      <div className="rounded-[var(--radius-card)] border border-line bg-surface-1 p-4">
        <h3 className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint">
          Commits per week
        </h3>
        <ResponsiveContainer width="100%" height={130}>
          <AreaChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="atlasTrend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e8a317" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#e8a317" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#9b9182", fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "#fffdf8",
                border: "1px solid #e7dcc6",
                borderRadius: 10,
                fontSize: 12,
                color: "#211c15",
              }}
              labelFormatter={(l) => `Week of ${l}`}
              formatter={(v) => [`${v} commits`, ""]}
            />
            <Area
              type="monotone"
              dataKey="commits"
              stroke="#c75d3c"
              strokeWidth={2}
              fill="url(#atlasTrend)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface-1 p-4">
        <h3 className="mb-3 text-[10.5px] font-medium uppercase tracking-[0.12em] text-faint">
          Daily heatmap · last {WEEKS} weeks
        </h3>
        <div className="flex gap-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1">
              {week.map((day) => (
                <span
                  key={day.date}
                  title={`${day.date}: ${day.count} commit(s)`}
                  className="h-3 w-3 rounded-sm"
                  style={{ background: heatColor(day.count, max) }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        {byDay.slice(0, 30).map(([date, items]) => (
          <div key={date} className="flex gap-4">
            <div className="w-24 shrink-0 pt-0.5 text-right text-xs text-faint">
              {relativeTime(date + "T12:00:00Z")}
            </div>
            <div className="flex-1 space-y-1.5 border-l border-line pl-4">
              {items.slice(0, 20).map((e) => (
                <div key={e.id} className="flex items-baseline gap-2">
                  <span className="truncate text-sm text-text">{e.title}</span>
                  {e.repoSlug && (
                    <span className="shrink-0 font-mono text-[11px] text-faint">
                      {repoMap[e.repoSlug] ?? e.repoSlug}
                    </span>
                  )}
                </div>
              ))}
              {items.length > 20 && (
                <div className="text-[11px] text-faint">+{items.length - 20} more</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface Day {
  date: string;
  count: number;
}

function buildHeatmap(events: ActivityEvent[]): {
  weeks: Day[][];
  max: number;
  total: number;
} {
  const counts = new Map<string, number>();
  for (const e of events) {
    const key = (e.ts ?? "").slice(0, 10);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Start on the Sunday WEEKS*7 days before today.
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (WEEKS * 7 - 1));
  start.setDate(start.getDate() - start.getDay()); // back to Sunday

  const weeks: Day[][] = [];
  let max = 0;
  let total = 0;
  const cursor = new Date(start);
  for (let w = 0; w < WEEKS + 1; w++) {
    const week: Day[] = [];
    for (let d = 0; d < 7; d++) {
      const key = cursor.toISOString().slice(0, 10);
      const count = cursor <= today ? counts.get(key) ?? 0 : -1;
      if (count > 0) {
        max = Math.max(max, count);
        total += count;
      }
      week.push({ date: key, count });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return { weeks, max, total };
}

function heatColor(count: number, max: number): string {
  if (count < 0) return "transparent"; // future day
  if (count === 0) return "var(--color-surface-3)";
  const t = max <= 1 ? 1 : Math.min(1, 0.28 + (count / max) * 0.72);
  return `color-mix(in srgb, var(--color-marigold) ${Math.round(t * 100)}%, var(--color-surface-2))`;
}
