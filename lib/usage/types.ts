/**
 * Claude Code feature-usage tracking. Atlas mines the local Claude Code session
 * transcripts (~/.claude/projects/<encoded-cwd>/<session>.jsonl) for `tool_use`
 * events and turns them into a measured picture of which harness features the
 * owner actually uses, how often, and when last.
 *
 * Privacy is by construction, not by redaction-after-the-fact:
 *  - We store ONLY metadata — tool name, timestamp, the input KEY NAMES (never
 *    values), and the cwd/branch context. No command strings, prompts, file
 *    contents, or parameter values ever enter the database.
 *  - cwd / gitBranch / paramKeys are OWNER-ONLY. The PUBLIC rollup is computed
 *    from the events but never serializes those fields, so they cannot leak into
 *    the public snapshot even in principle (you can't expose a field you never
 *    write out). The snapshot gate re-asserts this independently, fail-closed.
 */

/** Coarse grouping for display and category breakdowns. */
export type UsageCategory =
  | "file" // Read / Write / Edit / NotebookEdit
  | "exec" // Bash
  | "search" // Grep / Glob / ToolSearch
  | "orchestration" // Workflow / Agent / Task*
  | "skill" // Skill:<name>
  | "mcp" // mcp__<server>__<tool>
  | "web" // WebSearch / WebFetch
  | "command" // /slash-commands
  | "other";

/**
 * One mined tool invocation. The owner-only fields (cwd, gitBranch, paramKeys)
 * are present in the local DB and the owner snapshot; the public rollup is built
 * from these rows but drops them.
 */
export interface ToolEvent {
  id: string; // toolUseId, or `${sessionId}:${lineIndex}` for events without one
  sessionId: string | null;
  ts: string | null; // ISO 8601
  feature: string; // normalized key, e.g. "Skill:pre-push-review"
  category: UsageCategory;
  project: string | null; // derived from cwd; owner-only
  howInvoked: string; // direct | subagent | workflow (v1: always "direct")
  // Input key NAMES only — never values. Owner-only (never in the public rollup).
  // Caveat: a tool using dynamic keys would store the key string itself; key
  // names are assumed non-secret. Safe because this field never leaves the owner
  // snapshot / local DB.
  paramKeys: string[];
  cwd: string | null; // owner-only
  gitBranch: string | null; // owner-only
}

/** Per-feature aggregate. Safe to publish — counts and timestamps, no params. */
export interface FeatureUsage {
  feature: string;
  category: UsageCategory;
  /** Human label from the static catalog, falling back to the raw key. */
  displayName: string;
  /** What the feature does + when to reach for it (from the leverage playbook). */
  description: string | null;
  whenToUse: string | null;
  count: number;
  /** ISO timestamp (public: day-bucketed to date-only; owner: full precision). */
  firstUsed: string | null;
  lastUsed: string | null;
  /** Daily counts for the trailing 30 days, oldest → newest. */
  spark: number[];
  /** True when the catalog recommends this feature but usage is low/zero. */
  underused: boolean;
}

/** A project (org/dir) attribution bucket. Public buckets non-allowlisted → "other". */
export interface ProjectUsage {
  project: string;
  count: number;
}

/** Suggested automation kind for a mined routine. */
export type RoutineKind = "skill" | "loop" | "workflow" | "manual";

/**
 * A recurring tool-sequence ("motif") mined from per-session usage. Evidence-
 * backed: `support` and `occurrences` are real counts, never inferred. `steps`
 * are denoised, sanitized salient tokens (consecutive file/shell/search calls
 * collapse to a single `·code` step; skill/agent/command/mcp names are
 * allowlist-sanitized in public mode exactly like feature keys).
 */
export interface Routine {
  steps: string[];
  /** Distinct sessions the motif appears in (the real "you keep doing this" signal). */
  support: number;
  /** Total occurrences across all sessions. */
  occurrences: number;
  /** Most recent occurrence (public: date-only). */
  lastSeen: string | null;
  kind: RoutineKind;
  /** A concrete automation scaffold/tip — a STARTING POINT to adapt, not a finished workflow. */
  scaffold: string;
}

/**
 * The full rollup rendered by the dashboard. The SAME shape powers the public
 * and owner views; `recentEvents` is owner-only (carries cwd/branch) and is
 * simply absent from the public rollup.
 */
export interface UsageRollup {
  generatedAt: string;
  totals: {
    events: number;
    features: number;
    sessions: number;
    activeDays: number;
    workflowsRun: number;
  };
  /** Daily total tool calls for the trailing 30 days, oldest → newest. */
  spark: number[];
  byCategory: { category: UsageCategory; count: number }[];
  features: FeatureUsage[];
  projects: ProjectUsage[];
  /** Recurring tool-sequences you could automate (evidence-backed, sanitized). */
  routines: Routine[];
  /** Owner-only: last N raw events with cwd/branch. Never set on the public rollup. */
  recentEvents?: ToolEvent[];
}

export const EMPTY_USAGE: UsageRollup = {
  generatedAt: "",
  totals: { events: 0, features: 0, sessions: 0, activeDays: 0, workflowsRun: 0 },
  spark: [],
  byCategory: [],
  features: [],
  projects: [],
  routines: [],
};
