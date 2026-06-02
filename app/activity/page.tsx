import { getActivity, getRepos, getStats } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { ActivityView } from "@/components/ActivityView";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default function ActivityPage() {
  let events;
  let repos;
  let stats;
  try {
    events = getActivity(1000);
    repos = getRepos();
    stats = getStats();
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
        subtitle="Where your energy went, across every repo."
        lastScanAt={stats.lastScanAt}
      />
      <ActivityView events={events} repoMap={repoMap} />
    </div>
  );
}
