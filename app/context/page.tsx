import { getArtifactBuiltAt, getContextCards, getContextMetrics, getFreshness } from "@/lib/queries";
import { getRequestMode } from "@/lib/request-mode";
import { PageHeader } from "@/components/PageHeader";
import { ContextMetrics } from "@/components/ContextMetrics";
import { ContextView } from "@/components/ContextView";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function ContextPage() {
  const mode = await getRequestMode();
  let cards;
  let metrics;
  try {
    cards = getContextCards(mode);
    metrics = getContextMetrics(mode);
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
        freshness={getFreshness(mode, "context")}
        artifactBuiltAt={getArtifactBuiltAt(mode)}
      />
      <ContextMetrics m={metrics} />
      <ContextView cards={cards} />
    </div>
  );
}
