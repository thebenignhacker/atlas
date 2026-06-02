import fs from "node:fs";
import path from "node:path";
import { getReadDb } from "@/lib/db";
import { loadConfig } from "@/lib/config";
import { computeSignals } from "@/lib/signals";
import type { ActivityEvent, Repo } from "@/lib/types";
import type { AtlasStats, RepoWithSignals } from "@/lib/queries";

export const SNAPSHOT_PATH = path.join(process.cwd(), "public-snapshot.json");

export interface PublicSnapshot {
  generatedAt: string;
  stats: AtlasStats;
  repos: RepoWithSignals[];
  activity: ActivityEvent[];
  summaries: Record<string, string>;
}

/**
 * Sanitize a repo for public display. Removes everything tied to the local
 * machine or private working state:
 *  - absolute file path (reveals username / machine layout)
 *  - dirty / ahead / behind (local, unpublished working state)
 *  - linked todo count (todos are hidden from the public entirely)
 * Keeps only facts that are already public on GitHub.
 */
function sanitizeRepo(repo: RepoWithSignals): RepoWithSignals {
  const cleaned: Repo = {
    ...repo,
    path: "",
    dirty: 0,
    ahead: 0,
    behind: 0,
  };
  return {
    ...cleaned,
    signals: computeSignals(cleaned),
    openTodos: 0,
  };
}

/**
 * Build the public snapshot from the full local database. Includes ONLY public,
 * non-fork repos. Private repos, forks, todos, and local paths never appear.
 * Run locally via `npm run snapshot`; the result is safe to commit and deploy.
 */
export function generatePublicSnapshot(): PublicSnapshot {
  const db = getReadDb();
  try {
    const allow = loadConfig().publicOwners;
    const rows = db.prepare("SELECT * FROM repos").all() as Repo[];
    const publicRepos = rows.filter(
      (r) =>
        r.visibility === "public" &&
        r.isFork !== 1 &&
        (allow.length === 0 || (r.owner !== null && allow.includes(r.owner)))
    );
    const slugs = new Set(publicRepos.map((r) => r.slug));

    const repos: RepoWithSignals[] = publicRepos
      .map((r) => sanitizeRepo({ ...r, signals: computeSignals(r), openTodos: 0 }))
      .sort((a, b) => (b.lastCommitAt ?? "").localeCompare(a.lastCommitAt ?? ""));

    const activity = (
      db.prepare("SELECT * FROM activity ORDER BY ts DESC LIMIT 4000").all() as ActivityEvent[]
    ).filter((e) => e.repoSlug && slugs.has(e.repoSlug));

    // AI summaries only for public repos.
    const summaries: Record<string, string> = {};
    const sumRows = db
      .prepare("SELECT entityId, output FROM ai_outputs WHERE entityType = 'repo' AND task = 'summary'")
      .all() as { entityId: string; output: string }[];
    for (const s of sumRows) {
      if (slugs.has(s.entityId)) summaries[s.entityId] = s.output;
    }

    const stats: AtlasStats = {
      lastScanAt: new Date().toISOString(),
      repoCount: repos.length,
      todoCount: 0,
      activityCount: activity.length,
      publicCount: repos.length,
      privateCount: 0,
      forkCount: 0,
      needsAttention: repos.filter((r) => r.signals.attention.length > 0).length,
      openP0: 0,
    };

    return {
      generatedAt: new Date().toISOString(),
      stats,
      repos,
      activity,
      summaries,
    };
  } finally {
    db.close();
  }
}

let snapshotCache: PublicSnapshot | null = null;

/** Load the deployed public snapshot (used when ATLAS_MODE=public). */
export function loadPublicSnapshot(): PublicSnapshot {
  if (snapshotCache) return snapshotCache;
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(
      "atlas: public-snapshot.json not found. Run `npm run snapshot` to generate it."
    );
  }
  snapshotCache = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as PublicSnapshot;
  return snapshotCache;
}
