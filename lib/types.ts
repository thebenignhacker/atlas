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

// ---------------------------------------------------------------------------
// Context Store
// ---------------------------------------------------------------------------

/**
 * Computed trust state of a card, worst-wins:
 *   fresh       — provenance hashes match, not past TTL, verify (if any) passed
 *   drifted     — at least one provenance file changed since derivation
 *   expired     — past staleAfterDays since lastVerifiedAt
 *   stale       — verifyCommand last ran and failed
 *   unverified  — no provenance and no verify ever confirmed it
 * Anything other than `fresh` is surfaced flagged, never as trusted truth.
 */
export type Freshness = "fresh" | "drifted" | "expired" | "stale" | "unverified";

export type Confidence = "high" | "medium" | "low" | "unverified";
export type CardStatus = "active" | "superseded" | "retired";
export type CardVisibility = "private" | "public";

/** One source file a card was derived from, fingerprinted at derivation time. */
export interface Provenance {
  /** Absolute path on the owner machine (stripped from public snapshots). */
  path: string;
  /** Content hash of the file at capture time. */
  hash: string;
  hashAlgo: "sha256" | "git-blob";
  capturedAt: string;
}

export interface ContextCard {
  id: string;
  project: string;
  repoSlug: string | null;
  subject: string;
  claim: string;
  detail: string | null;
  /** Parsed from the JSON `provenance` column. */
  provenance: Provenance[];
  verifyCommand: string | null;
  verifyResult: "pass" | "fail" | "unknown" | null;
  verifyCheckedAt: string | null;
  confidence: Confidence;
  derivedAt: string;
  lastVerifiedAt: string;
  staleAfterDays: number | null;
  freshness: Freshness;
  driftedPaths: string[];
  tags: string[];
  links: string[];
  status: CardStatus;
  supersededBy: string | null;
  visibility: CardVisibility;
  originSessionId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type ContextEventKind =
  | "added"
  | "read"
  | "caught_stale"
  | "reverified"
  | "superseded"
  | "retired";

export interface ContextEvent {
  id: number;
  cardId: string | null;
  kind: ContextEventKind;
  fromState: string | null;
  toState: string | null;
  detail: string | null;
  ts: string;
}

/** Aggregate metrics for the dashboard + README. All measured, none estimated
 *  except `tokensSaved`, which is explicitly an estimate (see metrics.ts). */
export interface ContextMetrics {
  totalCards: number;
  activeCards: number;
  /** HERO: number of times the store flagged a stale fact before it misled. */
  staleCaught: number;
  freshness: Record<Freshness, number>;
  /** Estimate — labeled as such everywhere it is shown. */
  tokensSavedEstimate: number;
  reads: number;
}
