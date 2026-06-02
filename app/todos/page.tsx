import { getRepos, getStats, getTodos } from "@/lib/queries";
import { PageHeader, StatStrip } from "@/components/PageHeader";
import { TodoView } from "@/components/TodoView";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default function TodosPage() {
  let todos;
  let repos;
  let stats;
  try {
    todos = getTodos();
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
  const open = todos.filter((t) => t.status === "open");
  const byP = (p: string) => open.filter((t) => t.priority === p).length;
  const unlinked = todos.filter((t) => !t.repoSlug).length;

  return (
    <div className="px-5 py-8 pb-20 md:px-8">
      <PageHeader
        title="Todos"
        subtitle="Every scattered note, unified and triageable."
        lastScanAt={stats.lastScanAt}
      />
      <StatStrip
        stats={[
          { label: "Total", value: todos.length },
          { label: "Open", value: open.length },
          { label: "Open P0", value: byP("P0"), accent: byP("P0") ? "text-rose" : "text-text" },
          { label: "Open P1", value: byP("P1"), accent: byP("P1") ? "text-amber" : "text-text" },
          { label: "Done", value: todos.filter((t) => t.status === "done").length, accent: "text-fresh" },
          { label: "Unlinked", value: unlinked },
        ]}
      />
      <TodoView todos={todos} repoMap={repoMap} />
    </div>
  );
}
