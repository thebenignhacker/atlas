import "server-only";
import { getReadDb, getMeta } from "@/lib/db";
import { computeSignals } from "@/lib/signals";
import { loadPublicSnapshot } from "@/lib/snapshot";
import { getLatestOutput } from "@/lib/ai/cache";
import type { ActivityEvent, Repo, RepoSignals, Todo } from "@/lib/types";

export interface RepoWithSignals extends Repo {
  signals: RepoSignals;
  openTodos: number;
}

/**
 * Public mode (ATLAS_MODE=public) reads a sanitized snapshot instead of the
 * local database. In this mode there is no SQLite, no todos, and no private
 * data on the host — the snapshot is the only data source.
 */
export function isPublicMode(): boolean {
  return process.env.ATLAS_MODE === "public";
}

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

/** Last AI summary for a repo. Reads the snapshot in public mode (no DB). */
export function getRepoSummary(slug: string): string | null {
  if (isPublicMode()) return loadPublicSnapshot().summaries[slug] ?? null;
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
  const db = getReadDb();
  try {
    return db
      .prepare("SELECT * FROM activity ORDER BY ts DESC LIMIT ?")
      .all(limit) as ActivityEvent[];
  } finally {
    db.close();
  }
}

export function getActivityForRepo(slug: string, limit = 30): ActivityEvent[] {
  if (isPublicMode())
    return loadPublicSnapshot()
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
