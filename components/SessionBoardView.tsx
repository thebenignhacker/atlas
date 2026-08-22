import type { BoardRepoSession, SessionBoard } from "@/lib/session-board-shared";

function days(n: number): string {
  return n < 1 ? "today" : `${Math.round(n)}d`;
}

function sid(id: string | null): string | null {
  return id ? id.slice(0, 8) : null;
}

function SessionLine({ s, holder }: { s: BoardRepoSession; holder: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className={holder ? "font-medium text-text" : "text-muted"}>{s.file}</span>
      {sid(s.sessionId) && (
        <span className="font-mono text-xs text-faint">{sid(s.sessionId)}</span>
      )}
      <span className="text-xs text-faint">{days(s.ageDays)}</span>
      <span className="text-xs text-faint">
        {s.claims.length} claim{s.claims.length === 1 ? "" : "s"}
      </span>
    </div>
  );
}

export function SessionBoardView({ board }: { board: SessionBoard }) {
  if (board.error) {
    return (
      <div className="mt-6 rounded-lg border border-rose/40 bg-surface-2 p-4 text-sm">
        <p className="font-medium text-rose">Session board unavailable</p>
        <p className="mt-1 text-muted">{board.error}</p>
        <p className="mt-2 text-xs text-faint">
          The board parses session files through the shared claim guard and has no
          fallback parser — fix the guard bridge, then rerun the scan.
        </p>
      </div>
    );
  }
  if (!board.trees.length) {
    return (
      <p className="mt-6 text-sm text-muted">
        No configured tree has a .claude-sessions directory.
      </p>
    );
  }
  return (
    <div className="mt-6 space-y-8">
      {board.trees.map((tree) => {
        const label = tree.tree.split("/").pop() ?? tree.tree;
        return (
          <section key={tree.tree}>
            <h2 className="font-display text-lg font-semibold text-text">{label}</h2>
            <p className="mt-0.5 text-xs text-faint">{tree.sessionsDir}</p>

            {tree.notes.map((n) => (
              <p key={n} className="mt-2 text-xs text-amber">
                {n}
              </p>
            ))}

            {tree.repos.length === 0 && tree.active.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No active sessions.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {tree.repos.map((repo) => (
                  <div
                    key={repo.repo}
                    className="rounded-lg border border-line bg-surface-1 p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-sm font-medium text-text">
                        {repo.repo}
                      </span>
                      <span className="text-xs text-faint">
                        {repo.holder ? "held" : "no active claim"}
                      </span>
                    </div>
                    {repo.sessions.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {repo.sessions.map((s) => (
                          <SessionLine
                            key={s.file}
                            s={s}
                            holder={repo.holder?.file === s.file}
                          />
                        ))}
                      </div>
                    )}
                    {repo.worktrees.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {repo.worktrees.map((w) => (
                          <div key={w.path} className="text-xs text-muted">
                            worktree <span className="font-mono">{w.path}</span>
                            {w.branch && <span className="text-faint"> [{w.branch}]</span>}
                            {w.matchedFiles.length > 0 && (
                              <span className="text-faint">
                                {" "}
                                — named by {w.matchedFiles.join(", ")}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {tree.unmatchedClaims.length > 0 && (
                  <div className="text-xs text-faint">
                    {tree.unmatchedClaims.map((u) => (
                      <p key={u.file}>
                        {u.file}: {u.claims.length} claim
                        {u.claims.length === 1 ? "" : "s"} outside any repo dir
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tree.staleActives.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber/40 bg-surface-1 p-3">
                <p className="text-sm font-medium text-amber">
                  {tree.staleActives.length} stale-active session file
                  {tree.staleActives.length === 1 ? "" : "s"} — set Status: done and
                  move to archive/
                </p>
                <div className="mt-2 space-y-0.5">
                  {tree.staleActives.map((s) => (
                    <div key={s.file} className="flex flex-wrap gap-x-2 text-xs">
                      <span className="text-muted">{s.file}</span>
                      {sid(s.sessionId) && (
                        <span className="font-mono text-faint">{sid(s.sessionId)}</span>
                      )}
                      <span className="text-faint">{days(s.ageDays)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
