import type { Metadata } from "next";
import { getActivity, getArtifactBuiltAt, getFreshness, getRepos } from "@/lib/queries";
import { getRequestMode } from "@/lib/request-mode";
import { PageHeader } from "@/components/PageHeader";
import { ActivityView } from "@/components/ActivityView";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";
const SUBTITLE = "Where your energy went, across every repo.";
export const metadata: Metadata = { title: "Activity", description: SUBTITLE };

export default async function ActivityPage() {
  const mode = await getRequestMode();
  let events;
  let repos;
  try {
    events = getActivity(mode, 1000);
    repos = getRepos(mode);
  } catch {
    return (
      <div className="px-5 py-8 pb-20 md:px-8">
        <EmptyState />
      </div>
    );
  }

  const repoMap = Object.fromEntries(repos.map((r) => [r.slug, r.name]));

  return (
    <div className="px-5 py-8 pb-20 md:px-8">
      <PageHeader
        title="Activity"
        subtitle={SUBTITLE}
        freshness={getFreshness(mode, "activity")}
        artifactBuiltAt={getArtifactBuiltAt(mode)}
      />
      <ActivityView events={events} repoMap={repoMap} />
    </div>
  );
}
