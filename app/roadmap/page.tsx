import { loadRoadmap } from "@/lib/roadmap";
import { isPublicMode } from "@/lib/mode";
import { PageHeader, StatStrip } from "@/components/PageHeader";
import { RoadmapBoard } from "@/components/RoadmapBoard";
import { OwnerOnly } from "@/components/OwnerOnly";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default function RoadmapPage() {
  // The roadmap reads markdown files on the owner machine; the public snapshot
  // has no filesystem to read them from.
  if (isPublicMode()) return <OwnerOnly feature="Roadmap" />;

  let items;
  try {
    items = loadRoadmap();
  } catch {
    return (
      <div className="px-5 py-8 pb-20 md:px-8">
        <EmptyState />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="px-5 py-8 pb-20 md:px-8">
        <PageHeader
          title="Roadmap"
          subtitle="Institutional Roadmap v2.2 — every build unit, in dependency order."
        />
        <div className="rounded-[var(--radius-card)] border border-dashed border-line py-16 text-center text-sm text-faint">
          No roadmap items found in <code>&lt;todoDir&gt;/roadmap/</code>.
        </div>
      </div>
    );
  }

  const count = (s: string) => items.filter((i) => i.status === s).length;

  return (
    <div className="px-5 py-8 pb-20 md:px-8">
      <PageHeader
        title="Roadmap"
        subtitle="Institutional Roadmap v2.2 — every build unit, in dependency order. Check items off and log status as work lands."
      />
      <StatStrip
        stats={[
          { label: "Items", value: items.length },
          { label: "Blocked", value: count("blocked"), accent: "text-dormant" },
          { label: "Ready", value: count("ready"), accent: "text-teal" },
          {
            label: "In progress",
            value: count("in-progress"),
            accent: count("in-progress") ? "text-amber" : "text-text",
          },
          { label: "In review", value: count("in-review"), accent: "text-purple" },
          { label: "Done", value: count("done"), accent: "text-fresh" },
        ]}
      />
      <RoadmapBoard items={items} />
    </div>
  );
}
