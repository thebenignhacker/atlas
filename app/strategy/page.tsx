import { loadStrategyDocs } from "@/lib/strategy";
import { getRequestMode } from "@/lib/request-mode";
import { PageHeader, StatStrip } from "@/components/PageHeader";
import { StrategyBoard } from "@/components/StrategyBoard";
import { OwnerOnly } from "@/components/OwnerOnly";

export const dynamic = "force-dynamic";

export default async function StrategyPage() {
  const mode = await getRequestMode();
  // Strategy/fundraising is owner-only — never served to the public demo, and
  // (being read from the filesystem) never baked into the public snapshot.
  if (mode !== "local" && mode !== "owner") {
    return <OwnerOnly feature="Strategy" />;
  }

  const docs = loadStrategyDocs();
  const doc = docs[0];

  if (!doc || doc.totalTasks === 0) {
    return (
      <div className="px-5 py-8 pb-20 md:px-8">
        <PageHeader
          title="Strategy"
          subtitle="Strategy and fundraising work, tracked apart from coding and standards-filing todos."
        />
        <div className="rounded-[var(--radius-card)] border border-dashed border-line py-16 text-center text-sm text-faint">
          No strategy tasks found. Add a markdown doc with{" "}
          <code>#strategy</code>-tagged checkbox items to{" "}
          <code>strategyDocs</code> in <code>atlas.config.json</code>.
        </div>
      </div>
    );
  }

  const pct = doc.totalTasks
    ? Math.round((doc.doneTasks / doc.totalTasks) * 100)
    : 0;

  return (
    <div className="px-5 py-8 pb-20 md:px-8">
      <PageHeader
        title="Strategy"
        subtitle={
          doc.updated
            ? `${doc.title} · updated ${doc.updated}. Separate from coding and standards-filing todos.`
            : `${doc.title}. Separate from coding and standards-filing todos.`
        }
      />
      <StatStrip
        stats={[
          { label: "Tasks", value: doc.totalTasks },
          { label: "Done", value: doc.doneTasks, accent: "text-fresh" },
          { label: "Complete", value: `${pct}%` },
          {
            label: "Open P0",
            value: doc.openP0,
            accent: doc.openP0 ? "text-rose" : "text-text",
          },
          {
            label: "Open P1",
            value: doc.openP1,
            accent: doc.openP1 ? "text-amber" : "text-text",
          },
          { label: "Sections", value: doc.sections.length },
        ]}
      />
      <StrategyBoard docs={docs} />
    </div>
  );
}
