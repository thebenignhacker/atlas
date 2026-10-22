import type { Metadata } from "next";
import { getArtifactBuiltAt, getFreshness, getRepos, getStats } from "@/lib/queries";
import { getRequestMode } from "@/lib/request-mode";
import { PageHeader } from "@/components/PageHeader";
import { PortfolioStats } from "@/components/PortfolioStats";
import { PortfolioView } from "@/components/PortfolioView";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";
const SUBTITLE = "Every project you're building, at a glance.";
// The root layout's title template does not reach the page in its own folder.
export const metadata: Metadata = {
  title: { absolute: "Portfolio · Atlas" },
  description: SUBTITLE,
};

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
        subtitle={SUBTITLE}
        freshness={getFreshness(mode, "repos")}
        artifactBuiltAt={getArtifactBuiltAt(mode)}
      />
      <PortfolioStats stats={stats} mode={mode} />
      <PortfolioView
        repos={repos}
        initialAttentionOnly={attentionOnly}
        publicView={mode === "public"}
      />
    </div>
  );
}
