import { getContextCards, getContextMetrics, getStats } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { ContextMetrics } from "@/components/ContextMetrics";
import { ContextView } from "@/components/ContextView";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default function ContextPage() {
  let cards;
  let metrics;
  let stats;
  try {
    cards = getContextCards();
    metrics = getContextMetrics();
    stats = getStats();
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
        title="Context"
        subtitle="Verified facts about your projects — each pinned to its sources and a re-check command, so stale context flags itself instead of misleading you."
        lastScanAt={stats.lastScanAt}
      />
      <ContextMetrics m={metrics} />
      <ContextView cards={cards} />
    </div>
  );
}
