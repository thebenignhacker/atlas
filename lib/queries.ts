import "server-only";
import { getReadDb, getMeta } from "@/lib/db";
import { computeSignals } from "@/lib/signals";
import { loadPublicSnapshot, loadOwnerSnapshot } from "@/lib/snapshot";
import { getLatestOutput } from "@/lib/ai/cache";
import { isPublicMode, isOwnerMode } from "@/lib/mode";
import { getCards, getSessions as getSessionsFromDb } from "@/lib/context/store";
import { getMetrics } from "@/lib/context/metrics";
import { getToolEvents } from "@/lib/usage/store";
import { rollupEvents } from "@/lib/usage/rollup";
import { EMPTY_USAGE, type UsageRollup } from "@/lib/usage/types";
import { DEFAULT_PUBLIC_USAGE_PROJECTS } from "@/lib/usage/catalog-meta";
import { loadConfig } from "@/lib/config";
import type {
  ActivityEvent,
  ContextCard,
  ContextMetrics,
  Repo,
  RepoSignals,
  Session,
  Todo,
} from "@/lib/types";

export interface RepoWithSignals extends Repo {
  signals: RepoSignals;
  openTodos: number;
}

// Mode helpers live in lib/mode.ts (dependency-free). Re-exported here so the
// many call sites that already import { isPublicMode } from "@/lib/queries"
// keep working, and so isOwnerMode is reachable from the same place.
export { isPublicMode, isOwnerMode };

export interface AtlasStats {
  lastScanAt: string | null;
  repoCount: number;
  todoCount: number;
  activityCount: number;
  publicCount: number;
  privateCount: number;
  forkCount: number;
  needsAttention: number;
  openP0: number;
}

export function getStats(): AtlasStats {
  if (isPublicMode()) return loadPublicSnapshot().stats;
  if (isOwnerMode()) return loadOwnerSnapshot().stats;
  const db = getReadDb();
  try {
    const repos = getRepos();
    return {
      lastScanAt: getMeta(db, "lastScanAt"),
      repoCount: repos.length,
      todoCount: Number(getMeta(db, "todoCount") ?? 0),
      activityCount: Number(getMeta(db, "activityCount") ?? 0),
      publicCount: repos.filter((r) => r.visibility === "public").length,
      privateCount: repos.filter((r) => r.visibility === "private").length,
      forkCount: repos.filter((r) => r.isFork === 1).length,
      needsAttention: repos.filter((r) => r.signals.attention.length > 0).length,
      openP0: (
        db
          .prepare("SELECT count(*) n FROM todos WHERE priority = 'P0' AND status = 'open'")
          .get() as { n: number }
      ).n,
    };
  } finally {
    db.close();
  }
}

let repoCache: RepoWithSignals[] | null = null;

export function getRepos(): RepoWithSignals[] {
  if (isPublicMode()) return loadPublicSnapshot().repos;
  if (isOwnerMode()) return loadOwnerSnapshot().repos;
  if (repoCache) return repoCache;
  const db = getReadDb();
  try {
    const rows = db.prepare("SELECT * FROM repos").all() as Repo[];
    const todoCounts = db
      .prepare(
        "SELECT repoSlug, count(*) n FROM todos WHERE status = 'open' AND repoSlug IS NOT NULL GROUP BY repoSlug"
      )
      .all() as { repoSlug: string; n: number }[];
    const todoMap = new Map(todoCounts.map((r) => [r.repoSlug, r.n]));
    const result = rows
      .map((r) => ({
        ...r,
        signals: computeSignals(r),
        openTodos: todoMap.get(r.slug) ?? 0,
      }))
      .sort((a, b) => (b.lastCommitAt ?? "").localeCompare(a.lastCommitAt ?? ""));
    repoCache = result;
    return result;
  } finally {
    db.close();
  }
}

export function getRepo(slug: string): RepoWithSignals | null {
  return getRepos().find((r) => r.slug === slug) ?? null;
}

/** Last AI summary for a repo. Reads the snapshot in deployed modes (no DB). */
export function getRepoSummary(slug: string): string | null {
  if (isPublicMode()) return loadPublicSnapshot().summaries[slug] ?? null;
  if (isOwnerMode()) return loadOwnerSnapshot().summaries[slug] ?? null;
  return getLatestOutput("repo", slug, "summary")?.output ?? null;
}

export interface TodoFilters {
  priority?: string;
  status?: string;
  repoSlug?: string;
  kind?: string;
}

export function getTodos(filters: TodoFilters = {}): Todo[] {
  if (isPublicMode()) return []; // todos are never exposed publicly
  if (isOwnerMode()) {
    return loadOwnerSnapshot().todos.filter(
      (t) =>
        (!filters.priority || t.priority === filters.priority) &&
        (!filters.status || t.status === filters.status) &&
        (!filters.repoSlug || t.repoSlug === filters.repoSlug) &&
        (!filters.kind || t.kind === filters.kind)
    );
  }
  const db = getReadDb();
  try {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (filters.priority) {
      where.push("priority = @priority");
      params.priority = filters.priority;
    }
    if (filters.status) {
      where.push("status = @status");
      params.status = filters.status;
    }
    if (filters.repoSlug) {
      where.push("repoSlug = @repoSlug");
      params.repoSlug = filters.repoSlug;
    }
    if (filters.kind) {
      where.push("kind = @kind");
      params.kind = filters.kind;
    }
    const sql =
      "SELECT * FROM todos" +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      " ORDER BY createdAt DESC";
    return db.prepare(sql).all(params) as Todo[];
  } finally {
    db.close();
  }
}

export function getActivity(limit = 300): ActivityEvent[] {
  if (isPublicMode()) return loadPublicSnapshot().activity.slice(0, limit);
  if (isOwnerMode()) return loadOwnerSnapshot().activity.slice(0, limit);
  const db = getReadDb();
  try {
    return db
      .prepare("SELECT * FROM activity ORDER BY ts DESC LIMIT ?")
      .all(limit) as ActivityEvent[];
  } finally {
    db.close();
  }
}

/**
 * Context cards for the dashboard. Read-only: the UI shows the CACHED freshness
 * (the atlas-context CLI recomputes drift on the owner machine where the source
 * files live). In the public demo only `public` cards are exposed.
 */
export function getContextCards(project?: string): ContextCard[] {
  if (isPublicMode())
    return (loadPublicSnapshot().contextCards ?? []).filter(
      (c) => !project || c.project === project
    );
  if (isOwnerMode())
    return (loadOwnerSnapshot().contextCards ?? []).filter(
      (c) => !project || c.project === project
    );
  const db = getReadDb();
  try {
    // recomputeDrift/logRead would write; the read-only UI must not. Cached
    // freshness is shown with its age so it stays honest.
    return getCards(db, { project }, { recomputeDrift: false, logRead: false });
  } finally {
    db.close();
  }
}

const EMPTY_METRICS: ContextMetrics = {
  totalCards: 0,
  activeCards: 0,
  staleCaught: 0,
  freshness: { fresh: 0, drifted: 0, expired: 0, stale: 0, unverified: 0 },
  tokensSavedEstimate: 0,
  reads: 0,
};

export function getContextMetrics(): ContextMetrics {
  if (isPublicMode()) return loadPublicSnapshot().contextMetrics ?? EMPTY_METRICS;
  if (isOwnerMode()) return loadOwnerSnapshot().contextMetrics ?? EMPTY_METRICS;
  const db = getReadDb();
  try {
    return getMetrics(db);
  } finally {
    db.close();
  }
}

/**
 * Claude session registry. Owner/local only — sessions are never written to the
 * public snapshot (they carry harness ids and internal repo/branch state), so
 * the public demo always sees an empty list. The owner snapshot carries them for
 * the login-gated owner deployment.
 */
export function getSessions(): Session[] {
  if (isPublicMode()) return [];
  if (isOwnerMode()) return loadOwnerSnapshot().sessions ?? [];
  const db = getReadDb();
  try {
    return getSessionsFromDb(db);
  } finally {
    db.close();
  }
}

export function getActivityForRepo(slug: string, limit = 30): ActivityEvent[] {
  if (isPublicMode())
    return loadPublicSnapshot()
      .activity.filter((e) => e.repoSlug === slug)
      .slice(0, limit);
  if (isOwnerMode())
    return loadOwnerSnapshot()
      .activity.filter((e) => e.repoSlug === slug)
      .slice(0, limit);
  const db = getReadDb();
  try {
    return db
      .prepare("SELECT * FROM activity WHERE repoSlug = ? ORDER BY ts DESC LIMIT ?")
      .all(slug, limit) as ActivityEvent[];
  } finally {
    db.close();
  }
}

/**
 * Claude Code feature-usage rollup. In the public demo this is the sanitized
 * aggregate from the snapshot (no raw events, projects bucketed). Locally / in
 * the owner view it's the full rollup with real project names and the recent
 * raw-event timeline.
 */
export function getUsage(): UsageRollup {
  if (isPublicMode()) return loadPublicSnapshot().usage ?? EMPTY_USAGE;
  if (isOwnerMode()) return loadOwnerSnapshot().usage ?? EMPTY_USAGE;
  const db = getReadDb();
  try {
    const cfg = loadConfig().publicUsageProjects;
    return rollupEvents(getToolEvents(db), {
      public: false,
      publicProjects: cfg.length ? cfg : DEFAULT_PUBLIC_USAGE_PROJECTS,
      now: new Date(),
      recentLimit: 80,
    });
  } finally {
    db.close();
  }
}

/** When the usage data was last mined from transcripts (null if never). */
export function getUsageScannedAt(): string | null {
  if (isPublicMode()) return loadPublicSnapshot().usage?.generatedAt ?? null;
  if (isOwnerMode()) return loadOwnerSnapshot().usage?.generatedAt ?? null;
  const db = getReadDb();
  try {
    return getMeta(db, "usageScannedAt");
  } finally {
    db.close();
  }
}
