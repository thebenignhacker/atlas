/**
 * Session-board types, dependency-free so UI components can import them without
 * dragging better-sqlite3 or child_process toward the client bundle (same split
 * as lib/freshness-shared.ts).
 *
 * The board answers "who holds what, live, with staleness surfaced" across the
 * trees Atlas is configured for. It is OWNER-ONLY: session files name
 * unpublished work and internal defects, so nothing here may reach the public
 * snapshot — same boundary as private todos.
 */

/** One .claude-sessions/*.md file, as parsed by the claim guard's own parser. */
export interface BoardSessionFile {
  file: string;
  sessionId: string | null;
  /** Days since last modification, per the file's mtime. */
  ageDays: number;
  title: string | null;
  /** Claimed paths (tree-relative, e.g. "hackmyagent/src/x.ts"). */
  claims: string[];
}

/** A session holding claims inside one repo. */
export interface BoardRepoSession {
  file: string;
  sessionId: string | null;
  ageDays: number;
  /** The subset of the session's claims that fall inside this repo. */
  claims: string[];
}

export interface BoardWorktree {
  path: string;
  branch: string | null;
  /** Active session files whose text names this worktree. */
  matchedFiles: string[];
}

export interface BoardRepo {
  repo: string;
  /**
   * The longest-standing non-stale active session with a claim in this repo —
   * the presumed holder of the primary checkout. Everyone else builds in a
   * worktree or coordinates with this session first.
   */
  holder: BoardRepoSession | null;
  /** Every non-stale active session with claims here, holder first. */
  sessions: BoardRepoSession[];
  worktrees: BoardWorktree[];
}

/** An active session file older than the guard's staleness window. */
export interface BoardStaleActive {
  file: string;
  sessionId: string | null;
  ageDays: number;
}

export interface BoardTree {
  /** Tree root (e.g. ~/workspace/opena2a-org), as an absolute path. */
  tree: string;
  sessionsDir: string;
  /** Repos with at least one active claim or an extra worktree. */
  repos: BoardRepo[];
  /** Non-stale active sessions in this tree (the live board). */
  active: BoardSessionFile[];
  /**
   * `Status: active` files past the guard's mtime window. The guard skips these
   * silently when enforcing; the board lists them as hygiene debt — each entry
   * names a file to archive.
   */
  staleActives: BoardStaleActive[];
  /** Active claims whose first path segment is not a repo in this tree. */
  unmatchedClaims: { file: string; claims: string[] }[];
  /** Non-fatal collection problems (e.g. one repo's worktree listing failed). */
  notes: string[];
}

export interface SessionBoard {
  generatedAt: string;
  /** The claim-guard file the parse was delegated to (null when unavailable). */
  guardPath: string | null;
  trees: BoardTree[];
  /**
   * Set when the board could not be derived at all (guard missing, python3
   * absent, bridge failed). The board is then UNAVAILABLE — degraded and loud,
   * never silently re-parsed by a second implementation.
   */
  error?: string;
}
