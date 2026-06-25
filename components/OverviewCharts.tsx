"use client";

import { useMemo } from "react";
import type { RepoWithSignals } from "@/lib/queries";
import { languageColor } from "@/lib/display";
import type { StalenessBucket } from "@/lib/types";
import { ChartPanel, Donut, RankBar, type Slice } from "@/components/Charts";

const MARIGOLD = "#e8a317";
const CLAY = "#c75d3c";

const STALE_ORDER: StalenessBucket[] = ["fresh", "recent", "aging", "stale", "dormant"];
const STALE_META: Record<StalenessBucket, { label: string; color: string }> = {
  fresh: { label: "Active today", color: "#2f6b4a" },
  recent: { label: "This week", color: "#1f8a7e" },
  aging: { label: "This month", color: "#e8a317" },
  stale: { label: "Stale", color: "#c75d3c" },
  dormant: { label: "Dormant", color: "#b7ad9a" },
};

export function OverviewCharts({ repos }: { repos: RepoWithSignals[] }) {
  const languages = useMemo<Slice[]>(() => {
    const counts = new Map<string, number>();
    for (const r of repos) if (r.language) counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value, color: languageColor(name) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7);
  }, [repos]);

  const health = useMemo<Slice[]>(() => {
    const counts = new Map<StalenessBucket, number>();
    for (const r of repos)
      counts.set(r.signals.staleness, (counts.get(r.signals.staleness) ?? 0) + 1);
    return STALE_ORDER.map((k) => ({
      name: STALE_META[k].label,
      value: counts.get(k) ?? 0,
      color: STALE_META[k].color,
    })).filter((d) => d.value > 0);
  }, [repos]);

  const visibility = useMemo<Slice[]>(() => {
    let pub = 0,
      priv = 0,
      fork = 0,
      arch = 0;
    for (const r of repos) {
      if (r.isArchived === 1) arch++;
      else if (r.isFork === 1) fork++;
      else if (r.visibility === "private") priv++;
      else if (r.visibility === "public") pub++;
    }
    return [
      { name: "Public", value: pub, color: "#1f8a7e" },
      { name: "Private", value: priv, color: "#211c15" },
      { name: "Forks", value: fork, color: "#b7ad9a" },
      { name: "Archived", value: arch, color: "#d8cdb5" },
    ].filter((d) => d.value > 0);
  }, [repos]);

  const active = useMemo(
    () =>
      repos
        .filter((r) => r.commitCount30d > 0)
        .sort((a, b) => b.commitCount30d - a.commitCount30d)
        .slice(0, 7)
        .map((r) => ({ name: r.name, value: r.commitCount30d }))
        .reverse(),
    [repos]
  );

  const byWorkspace = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of repos) {
      const k = r.groupName || "Ungrouped";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7)
      .reverse();
  }, [repos]);

  const totalCommits = useMemo(
    () => repos.reduce((s, r) => s + (r.commitCount30d ?? 0), 0),
    [repos]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="font-display text-lg font-semibold tracking-tight text-text">
          At a glance
        </h2>
        <span className="text-xs text-faint">{repos.length} repos</span>
      </div>

      {/* Composition — three donuts */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ChartPanel title="Languages" hint={`${languages.length} shown`}>
          <Donut data={languages} unit="repos" />
        </ChartPanel>
        <ChartPanel title="Health" hint="by activity">
          <Donut data={health} unit="repos" />
        </ChartPanel>
        <ChartPanel title="Visibility" hint="public / private">
          <Donut data={visibility} unit="repos" />
        </ChartPanel>
      </div>

      {/* Ranking — two bars */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartPanel title="Most active" hint={`${totalCommits} commits / 30d`}>
          <RankBar data={active} unit="commits" fill={MARIGOLD} width={108} />
        </ChartPanel>
        <ChartPanel title="By workspace" hint={`${byWorkspace.length} shown`}>
          <RankBar data={byWorkspace} unit="repos" fill={CLAY} width={108} />
        </ChartPanel>
      </div>
    </div>
  );
}
