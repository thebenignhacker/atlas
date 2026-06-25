import { getSessions, getContextCards, getStats } from "@/lib/queries";
import { getRequestMode } from "@/lib/request-mode";
import { PageHeader } from "@/components/PageHeader";
import { SessionsView } from "@/components/SessionsView";
import { EmptyState } from "@/components/EmptyState";
import { OwnerOnly } from "@/components/OwnerOnly";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  // Sessions carry harness ids and internal repo/branch state — owner-only, never
  // part of the public demo.
  const mode = await getRequestMode();
  if (mode === "public") return <OwnerOnly feature="Sessions" />;
  let sessions;
  let cards;
  let stats;
  try {
    sessions = getSessions(mode);
    cards = getContextCards(mode);
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
        title="Sessions"
        subtitle="The Claude sessions that established your context cards — trace a fact back to the session that set it and jump back into it."
        lastScanAt={stats.lastScanAt}
      />
      <SessionsView sessions={sessions} cards={cards} />
    </div>
  );
}
