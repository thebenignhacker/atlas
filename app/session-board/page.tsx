import { getArtifactBuiltAt, getFreshness, getSessionBoard } from "@/lib/queries";
import { getRequestMode } from "@/lib/request-mode";
import { PageHeader, StatStrip } from "@/components/PageHeader";
import { SessionBoardView } from "@/components/SessionBoardView";
import { EmptyState } from "@/components/EmptyState";
import { OwnerOnly } from "@/components/OwnerOnly";

export const dynamic = "force-dynamic";

export default async function SessionBoardPage() {
  const mode = await getRequestMode();
  if (mode === "public") return <OwnerOnly feature="Session board" />;
  let board;
  try {
    board = getSessionBoard(mode);
  } catch {
    return (
      <div className="px-5 py-8 pb-20 md:px-8">
        <EmptyState />
      </div>
    );
  }

  const trees = board?.trees ?? [];
  const active = trees.reduce((n, t) => n + t.active.length, 0);
  const held = trees.reduce((n, t) => n + t.repos.filter((r) => r.holder).length, 0);
  const stale = trees.reduce((n, t) => n + t.staleActives.length, 0);
  const worktrees = trees.reduce(
    (n, t) => n + t.repos.reduce((m, r) => m + r.worktrees.length, 0),
    0
  );

  return (
    <div className="px-5 py-8 pb-20 md:px-8">
      <PageHeader
        title="Session board"
        subtitle="Who holds what across the shared trees, from .claude-sessions files."
        freshness={getFreshness(mode, "sessionBoard")}
        artifactBuiltAt={getArtifactBuiltAt(mode)}
      />
      <StatStrip
        stats={[
          { label: "Trees", value: trees.length },
          { label: "Active sessions", value: active },
          { label: "Held repos", value: held },
          {
            label: "Stale-active",
            value: stale,
            accent: stale ? "text-amber" : "text-text",
          },
          { label: "Worktrees", value: worktrees },
        ]}
      />
      {board ? (
        <SessionBoardView board={board} />
      ) : (
        <p className="mt-6 text-sm text-muted">
          No session board yet — run <span className="font-mono">npm run scan</span>.
        </p>
      )}
    </div>
  );
}
