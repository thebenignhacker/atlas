import { aiAvailability } from "@/lib/ai/provider";
import { getLastDigest } from "@/lib/ai/digest";
import { getStats, isPublicMode } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";
import { DigestView } from "@/components/DigestView";
import { EmptyState } from "@/components/EmptyState";
import { OwnerOnly } from "@/components/OwnerOnly";

export const dynamic = "force-dynamic";

export default function DigestPage() {
  if (isPublicMode()) return <OwnerOnly feature="AI Digest" />;
  let stats;
  try {
    stats = getStats();
  } catch {
    return (
      <div className="px-5 py-8 pb-20 md:px-8">
        <EmptyState />
      </div>
    );
  }

  const avail = aiAvailability();
  let initial = null;
  try {
    initial = avail.ok ? getLastDigest() : null;
  } catch {
    initial = null;
  }

  return (
    <div className="px-5 py-8 pb-20 md:px-8">
      <PageHeader
        title="AI Digest"
        subtitle="A grounded briefing on what moved and what's next."
        lastScanAt={stats.lastScanAt}
      />
      <DigestView
        available={avail.ok}
        reason={avail.ok ? undefined : avail.reason}
        initial={initial}
      />
    </div>
  );
}
