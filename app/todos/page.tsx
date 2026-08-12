import { getArtifactBuiltAt, getFreshness, getRepos, getTodos } from "@/lib/queries";
import { getRequestMode } from "@/lib/request-mode";
import { PageHeader, StatStrip } from "@/components/PageHeader";
import { TodoView } from "@/components/TodoView";
import { EmptyState } from "@/components/EmptyState";
import { OwnerOnly } from "@/components/OwnerOnly";

export const dynamic = "force-dynamic";

export default async function TodosPage() {
  const mode = await getRequestMode();
  if (mode === "public") return <OwnerOnly feature="Todos" />;
  let todos;
  let repos;
  try {
    todos = getTodos(mode);
    repos = getRepos(mode);
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
        freshness={getFreshness(mode, "todos")}
        artifactBuiltAt={getArtifactBuiltAt(mode)}
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
