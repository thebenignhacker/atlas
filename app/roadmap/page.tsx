import { loadRoadmap } from "@/lib/roadmap";
import type { RoadmapItem } from "@/lib/roadmap-shared";
import { getArtifactBuiltAt, getFreshness } from "@/lib/queries";
import { liveSection } from "@/lib/freshness-shared";
import { loadOwnerSnapshot } from "@/lib/snapshot";
import { getRequestMode } from "@/lib/request-mode";
import { PageHeader, StatStrip } from "@/components/PageHeader";
import { RoadmapBoard } from "@/components/RoadmapBoard";
import { OwnerOnly } from "@/components/OwnerOnly";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function RoadmapPage() {
  const mode = await getRequestMode();
  if (mode === "public") return <OwnerOnly feature="Roadmap" />;

  // Local mode reads the live markdown files (editable). A deployed owner host
  // has no filesystem to read them from, so it serves the items baked into the
  // owner snapshot — and the board is read-only there (edits are local-only).
  const readOnly = mode !== "local";

  let items: RoadmapItem[];
  try {
    items = mode === "owner" ? loadOwnerSnapshot().roadmap ?? [] : loadRoadmap();
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

  // Local mode re-reads the markdown on every request, so its freshness IS the
  // request instant. A deployed owner host serves whatever was baked in, which
  // can be arbitrarily old — the distinction the badge exists to show.
  const freshness =
    mode === "local"
      ? liveSection(new Date().toISOString(), items.length)
      : getFreshness(mode, "roadmap");

  return (
    <div className="px-5 py-8 pb-20 md:px-8">
      <PageHeader
        title="Roadmap"
        subtitle={
          readOnly
            ? "Institutional Roadmap v2.2 — every build unit, in dependency order. Read-only here; edit from local Atlas."
            : "Institutional Roadmap v2.2 — every build unit, in dependency order. Check items off and log status as work lands."
        }
        freshness={freshness}
        artifactBuiltAt={getArtifactBuiltAt(mode)}
      />
      <StatStrip
        stats={[
          { label: "Items", value: items.length },
          { label: "Seeded", value: count("todo"), accent: "text-muted" },
          { label: "Blocked", value: count("blocked"), accent: "text-dormant" },
          { label: "Ready", value: count("ready"), accent: "text-teal" },
          {
            label: "In progress",
            value: count("in-progress"),
            accent: count("in-progress") ? "text-amber" : "text-text",
          },
          { label: "In review", value: count("in-review"), accent: "text-purple" },
          { label: "Done", value: count("done"), accent: "text-fresh" },
          { label: "Retired", value: count("retired"), accent: "text-clay" },
        ]}
      />
      <RoadmapBoard items={items} readOnly={readOnly} />
    </div>
  );
}
