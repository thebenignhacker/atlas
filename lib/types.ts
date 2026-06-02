// Shared domain types. These mirror the SQLite schema in lib/db.ts.
// Convention: all fields camelCase (per org JSON naming standard).

export type Visibility = "public" | "private" | "unknown";
export type Priority = "P0" | "P1" | "P2" | "P3";
export type TodoStatus = "open" | "done" | "archived" | "unknown";
export type TodoKind = "dated" | "index" | "handoff" | "other";
export type StalenessBucket = "fresh" | "recent" | "aging" | "stale" | "dormant";

export interface Repo {
  slug: string;
  name: string;
  path: string;
  groupName: string | null;
  remoteUrl: string | null;
  owner: string | null;
  repoName: string | null;
  branch: string | null;
  lastCommitAt: string | null;
  lastCommitSha: string | null;
  lastCommitMsg: string | null;
  commitCount30d: number;
  dirty: number;
  ahead: number;
  behind: number;
  // GitHub enrichment (null when offline / no token).
  visibility: Visibility;
  isFork: number | null;
  isArchived: number | null;
  language: string | null;
  stars: number | null;
  openIssues: number | null;
  openPrs: number | null;
  defaultBranch: string | null;
  pushedAt: string | null;
  description: string | null;
  scannedAt: string;
}

/** Derived, machine-computed signals (not stored — computed on read). */
export interface RepoSignals {
  staleness: StalenessBucket;
  daysSinceCommit: number | null;
  /** Human-readable reasons this repo wants attention. Empty = healthy. */
  attention: string[];
}

export interface Todo {
  id: string;
  path: string;
  filename: string;
  title: string;
  createdAt: string | null;
  modifiedAt: string | null;
  priority: Priority | null;
  status: TodoStatus;
  repoSlug: string | null;
  repoGuess: string | null;
  triggerPhrase: string | null;
  kind: TodoKind;
  excerpt: string;
  source: string;
  checksum: string;
  scannedAt: string;
}

export interface ActivityEvent {
  id: string;
  repoSlug: string | null;
  type: "commit" | "pr" | "issue" | "release";
  title: string;
  ts: string;
  meta: string | null;
  scannedAt: string;
}
