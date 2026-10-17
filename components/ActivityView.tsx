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
import { ChartPanel, Donut, RankBar, type Slice } from "@/components/Charts";
import { ShowMore } from "@/components/ShowMore";

const WEEKS = 13;
// The day list opens on 7 days or 60 events, whichever fills first; each "Show more"
// press adds another page of the same size.
const PAGE_DAYS = 7;
const PAGE_EVENTS = 60;

const TYPE_META: Record<string, { label: string; color: string }> = {
  commit: { label: "Commits", color: "#e8a317" },
  pr: { label: "Pull requests", color: "#8b5cf6" },
  issue: { label: "Issues", color: "#1f8a7e" },
  release: { label: "Releases", color: "#c75d3c" },
};

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

  const byDay = useMemo<DayGroup[]>(() => {
    const groups = new Map<string, ActivityEvent[]>();
    for (const e of filtered) {
      const key = (e.ts ?? "").slice(0, 10);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const pageEnds = useMemo(() => dayPageEnds(byDay), [byDay]);

  const topRepos = useMemo(() => {
    const c = new Map<string, number>();
    for (const e of filtered) if (e.repoSlug) c.set(e.repoSlug, (c.get(e.repoSlug) ?? 0) + 1);
    return Array.from(c.entries())
      .map(([slug, value]) => ({ name: repoMap[slug] ?? slug, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7)
      .reverse();
  }, [filtered, repoMap]);

  const byType = useMemo<Slice[]>(() => {
    const c = new Map<string, number>();
    for (const e of filtered) c.set(e.type, (c.get(e.type) ?? 0) + 1);
    return Object.entries(TYPE_META)
      .map(([k, m]) => ({ name: m.label, value: c.get(k) ?? 0, color: m.color }))
      .filter((d) => d.value > 0);
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

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartPanel title="Most active repos" hint={`${topRepos.length} shown`}>
          <RankBar data={topRepos} unit="events" fill="#e8a317" />
        </ChartPanel>
        <ChartPanel title="By type" hint="events">
          <Donut data={byType} unit="events" />
        </ChartPanel>
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

      <ShowMore
        key={repo}
        total={filtered.length}
        initial={pageEnds[0] ?? 0}
        step={(shown) => pageEnds.find((end) => end > shown) ?? filtered.length}
        noun="events"
      >
        {(shown) => (
          <div className="space-y-5">
            {firstEvents(byDay, shown).map(([date, items]) => (
              <div key={date} className="flex flex-col gap-1.5 sm:flex-row sm:gap-4">
                <div className="shrink-0 pt-0.5 text-xs text-faint sm:w-24 sm:text-right">
                  {relativeTime(date + "T12:00:00Z")}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5 border-l border-line pl-4">
                  {items.map((e) => (
                    <div key={e.id} className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
                      <span title={e.title} className="min-w-0 truncate text-sm text-text">
                        {e.title}
                      </span>
                      {e.repoSlug && (
                        <span className="shrink-0 font-mono text-[11px] text-faint">
                          {repoMap[e.repoSlug] ?? e.repoSlug}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </ShowMore>
    </div>
  );
}

type DayGroup = [date: string, items: ActivityEvent[]];

/**
 * Event counts at which each page of the day list ends. A page holds PAGE_DAYS days or
 * PAGE_EVENTS events, whichever fills first; a day that does not fit continues on the next page.
 */
function dayPageEnds(days: DayGroup[]): number[] {
  const ends: number[] = [];
  let shown = 0;
  let day = 0;
  let offset = 0; // events of days[day] already placed on an earlier page
  while (day < days.length) {
    let pageDays = 0;
    let pageEvents = 0;
    while (day < days.length && pageDays < PAGE_DAYS && pageEvents < PAGE_EVENTS) {
      const size = days[day][1].length;
      const take = Math.min(size - offset, PAGE_EVENTS - pageEvents);
      pageEvents += take;
      offset += take;
      if (offset < size) break;
      day++;
      offset = 0;
      pageDays++;
    }
    shown += pageEvents;
    ends.push(shown);
  }
  return ends;
}

/** The leading days of the list, cut so they hold `count` events in total. */
function firstEvents(days: DayGroup[], count: number): DayGroup[] {
  const out: DayGroup[] = [];
  let left = count;
  for (const [date, items] of days) {
    if (left <= 0) break;
    out.push([date, items.slice(0, left)]);
    left -= items.length;
  }
  return out;
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
