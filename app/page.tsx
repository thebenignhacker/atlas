import { getArtifactBuiltAt, getFreshness, getRepos, getStats } from "@/lib/queries";
import { getRequestMode } from "@/lib/request-mode";
import { PageHeader, StatStrip } from "@/components/PageHeader";
import { PortfolioView } from "@/components/PortfolioView";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ attention?: string | string[] }>;
}) {
  const mode = await getRequestMode();
  const attentionOnly = (await searchParams).attention === "1";
  let repos;
  let stats;
  try {
    repos = getRepos(mode);
    stats = getStats(mode);
  } catch {
    return (
      <div className="px-5 py-8 pb-20 md:px-8">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="px-5 py-8 pb-20 md:px-8">
      <PageHeader
        title="Portfolio"
        subtitle="Every project you're building, at a glance."
        freshness={getFreshness(mode, "repos")}
        artifactBuiltAt={getArtifactBuiltAt(mode)}
      />
      <StatStrip
        stats={[
          { label: "Repos", value: stats.repoCount },
          { label: "Public", value: stats.publicCount, accent: "text-teal" },
          { label: "Private", value: stats.privateCount },
          { label: "Forks", value: stats.forkCount },
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
          {
            label: "Open P0",
            value: stats.openP0,
            accent: stats.openP0 ? "text-rose" : "text-text",
          },
        ]}
      />
      <PortfolioView repos={repos} initialAttentionOnly={attentionOnly} />
    </div>
  );
}
