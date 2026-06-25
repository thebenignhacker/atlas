import { aiAvailability } from "@/lib/ai/provider";
import { getLastDigest } from "@/lib/ai/digest";
import { getStats } from "@/lib/queries";
import { getRequestMode } from "@/lib/request-mode";
import { PageHeader } from "@/components/PageHeader";
import { DigestView } from "@/components/DigestView";
import { EmptyState } from "@/components/EmptyState";
import { OwnerOnly } from "@/components/OwnerOnly";

export const dynamic = "force-dynamic";

export default async function DigestPage() {
  const mode = await getRequestMode();
  if (mode === "public") return <OwnerOnly feature="AI Digest" />;
  const owner = mode === "owner";
  let stats;
  try {
    stats = getStats(mode);
  } catch {
    return (
      <div className="px-5 py-8 pb-20 md:px-8">
        <EmptyState />
      </div>
    );
  }

  const avail = aiAvailability(mode);
  let initial = null;
  try {
    // Owner deployment can't generate, but always shows the digest baked into
    // the snapshot regardless of host AI availability.
    initial = avail.ok || owner ? getLastDigest(mode) : null;
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
        available={avail.ok || owner}
        reason={avail.ok ? undefined : avail.reason}
        initial={initial}
        readOnly={owner}
      />
    </div>
  );
}
