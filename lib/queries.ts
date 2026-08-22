import "server-only";
import { getReadDb, getMeta } from "@/lib/db";
import { computeSignals } from "@/lib/signals";
import { loadPublicSnapshot, loadOwnerSnapshot } from "@/lib/snapshot";
import { getLatestOutput } from "@/lib/ai/cache";
import { isPublicMode, isOwnerMode } from "@/lib/mode";
import type { ResolvedMode } from "@/lib/mode";
import { getCards, getSessions as getSessionsFromDb } from "@/lib/context/store";
import { getMetrics } from "@/lib/context/metrics";
import { computeFreshness } from "@/lib/freshness";
import type { SectionFreshness } from "@/lib/freshness-shared";
import { getToolEvents } from "@/lib/usage/store";
import { rollupEvents } from "@/lib/usage/rollup";
import type { SessionBoard } from "@/lib/session-board-shared";
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

// Re-exported for the few non-page importers that still check the env mode.
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

/**
 * Every query takes an explicit, already-RESOLVED mode (from getRequestMode()) as
 * its FIRST argument. Owner data is returned ONLY for mode === "owner". This is
 * the hard boundary: threading the mode as a required argument means a page
 * physically cannot read private data without first resolving it (and the
 * resolver only returns "owner" for a verified session). "public" → sanitized
 * snapshot; "local" → SQLite DB.
 */

export function getStats(mode: ResolvedMode): AtlasStats {
  if (mode === "public") return loadPublicSnapshot().stats;
  if (mode === "owner") return loadOwnerSnapshot().stats;
  const db = getReadDb();
  try {
    const repos = getRepos("local");
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

export function getRepos(mode: ResolvedMode): RepoWithSignals[] {
  if (mode === "public") return loadPublicSnapshot().repos;
  if (mode === "owner") return loadOwnerSnapshot().repos;
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

export function getRepo(mode: ResolvedMode, slug: string): RepoWithSignals | null {
  return getRepos(mode).find((r) => r.slug === slug) ?? null;
}

/** Last AI summary for a repo. Reads the snapshot in deployed modes (no DB). */
export function getRepoSummary(mode: ResolvedMode, slug: string): string | null {
  if (mode === "public") return loadPublicSnapshot().summaries[slug] ?? null;
  if (mode === "owner") return loadOwnerSnapshot().summaries[slug] ?? null;
  return getLatestOutput("repo", slug, "summary")?.output ?? null;
}

export interface TodoFilters {
  priority?: string;
  status?: string;
  repoSlug?: string;
  kind?: string;
}

export function getTodos(mode: ResolvedMode, filters: TodoFilters = {}): Todo[] {
  if (mode === "public") return []; // todos are never exposed publicly
  if (mode === "owner") {
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

export function getActivity(mode: ResolvedMode, limit = 300): ActivityEvent[] {
  if (mode === "public") return loadPublicSnapshot().activity.slice(0, limit);
  if (mode === "owner") return loadOwnerSnapshot().activity.slice(0, limit);
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
 * Context cards for the dashboard. Read-only: the UI shows the CACHED freshness.
 * In public mode only `public` cards are exposed.
 */
export function getContextCards(mode: ResolvedMode, project?: string): ContextCard[] {
  if (mode === "public")
    return (loadPublicSnapshot().contextCards ?? []).filter(
      (c) => !project || c.project === project
    );
  if (mode === "owner")
    return (loadOwnerSnapshot().contextCards ?? []).filter(
      (c) => !project || c.project === project
    );
  const db = getReadDb();
  try {
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

export function getContextMetrics(mode: ResolvedMode): ContextMetrics {
  if (mode === "public") return loadPublicSnapshot().contextMetrics ?? EMPTY_METRICS;
  if (mode === "owner") return loadOwnerSnapshot().contextMetrics ?? EMPTY_METRICS;
  const db = getReadDb();
  try {
    return getMetrics(db);
  } finally {
    db.close();
  }
}

/**
 * Claude session registry. Never written to the public snapshot (they carry
 * harness ids and internal repo/branch state), so public requests see an empty
 * list. Owner requests get them from the owner snapshot.
 */
export function getSessions(mode: ResolvedMode): Session[] {
  if (mode === "public") return [];
  if (mode === "owner") return loadOwnerSnapshot().sessions ?? [];
  const db = getReadDb();
  try {
    return getSessionsFromDb(db);
  } finally {
    db.close();
  }
}

/**
 * Session board — who holds what across the configured trees. Owner-only:
 * session files name unpublished work, so public requests get null (the page
 * shows the OwnerOnly gate before ever calling this).
 */
export function getSessionBoard(mode: ResolvedMode): SessionBoard | null {
  if (mode === "public") return null;
  if (mode === "owner") return loadOwnerSnapshot().sessionBoard ?? null;
  const db = getReadDb();
  try {
    const raw = getMeta(db, "sessionBoard");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionBoard;
    } catch {
      return null;
    }
  } finally {
    db.close();
  }
}

export function getActivityForRepo(
  mode: ResolvedMode,
  slug: string,
  limit = 30
): ActivityEvent[] {
  if (mode === "public")
    return loadPublicSnapshot()
      .activity.filter((e) => e.repoSlug === slug)
      .slice(0, limit);
  if (mode === "owner")
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
 * Claude Code feature-usage rollup. Public requests get the sanitized aggregate;
 * owner/local get the full rollup with real project names and the recent timeline.
 */
export function getUsage(mode: ResolvedMode): UsageRollup {
  if (mode === "public") return loadPublicSnapshot().usage ?? EMPTY_USAGE;
  if (mode === "owner") return loadOwnerSnapshot().usage ?? EMPTY_USAGE;
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

/**
 * When the usage data was last mined from transcripts (null if never).
 *
 * Deployed modes used to return `usage.generatedAt`, which `lib/usage/rollup.ts`
 * sets to the SNAPSHOT BUILD TIME — so the page rendered "scanned <build age>"
 * over events that could be arbitrarily old. They agreed only by coincidence,
 * because nothing had rebuilt the snapshot since the last mine. Read the mining
 * clock out of the freshness block instead, and return null (rendered
 * "unavailable") for an artifact built before that block existed, rather than
 * falling back to the value that caused the defect.
 */
export function getUsageScannedAt(mode: ResolvedMode): string | null {
  if (mode === "public" || mode === "owner")
    return getFreshness(mode, "usage")?.collectedAt ?? null;
  const db = getReadDb();
  try {
    return getMeta(db, "usageScannedAt");
  } finally {
    db.close();
  }
}

/**
 * Freshness for one section, in whatever mode the request resolved to.
 *
 * Returns null — meaning "unavailable", which the UI must render as such — when
 * the artifact predates the freshness block or the section is unknown. Never
 * substitutes a different clock: a wrong timestamp reads as authoritative,
 * while a missing one reads as missing.
 */
export function getFreshness(
  mode: ResolvedMode,
  section: string
): SectionFreshness | null {
  if (mode === "public") return loadPublicSnapshot().freshness?.[section] ?? null;
  if (mode === "owner") return loadOwnerSnapshot().freshness?.[section] ?? null;
  const db = getReadDb();
  try {
    return (
      computeFreshness(db, new Date().toISOString(), { owner: true })[section] ??
      null
    );
  } finally {
    db.close();
  }
}

/**
 * When the artifact being read was built. Null in local mode, where pages read
 * the database directly and there is no artifact standing between them and it.
 */
export function getArtifactBuiltAt(mode: ResolvedMode): string | null {
  if (mode === "public") return loadPublicSnapshot().generatedAt ?? null;
  if (mode === "owner") return loadOwnerSnapshot().generatedAt ?? null;
  return null;
}
