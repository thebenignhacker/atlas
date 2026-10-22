import type { AtlasStats } from "@/lib/queries";
import type { ResolvedMode } from "@/lib/mode";
import { StatStrip } from "@/components/PageHeader";

/**
 * The portfolio's stat tiles. The public snapshot carries only public repos
 * that are not forks, and no todos, so its private, fork and open P0 counts
 * are zero whatever the portfolio holds. The public view leaves those three
 * tiles out instead of showing a zero that was never measured.
 */
export function PortfolioStats({ stats, mode }: { stats: AtlasStats; mode: ResolvedMode }) {
  const publicView = mode === "public";
  return (
    <StatStrip
      stats={[
        { label: "Repos", value: stats.repoCount },
        { label: "Public", value: stats.publicCount, accent: "text-teal" },
        ...(publicView
          ? []
          : [
              { label: "Private", value: stats.privateCount },
              { label: "Forks", value: stats.forkCount },
            ]),
        {
          label: "Need attention",
          value: stats.needsAttention,
          accent: stats.needsAttention ? "text-amber" : "text-text",
          // The tile answers "which ones?" by opening the filtered list; with
          // none flagged that list would be empty, so the tile stays plain.
          href: stats.needsAttention ? "/?attention=1#repos" : undefined,
          linkLabel:
            stats.needsAttention === 1
              ? "1 repository needs attention. Show it."
              : `${stats.needsAttention} repositories need attention. Show them.`,
        },
        ...(publicView
          ? []
          : [
              {
                label: "Open P0",
                value: stats.openP0,
                accent: stats.openP0 ? "text-rose" : "text-text",
              },
            ]),
      ]}
    />
  );
}
