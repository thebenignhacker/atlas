import fs from "node:fs";
import path from "node:path";
import { getReadDb, getMeta } from "@/lib/db";
import { loadConfig } from "@/lib/config";
import { computeSignals } from "@/lib/signals";
import { rowToCard, type CardRow } from "@/lib/context/store";
import { getMetrics } from "@/lib/context/metrics";
import type {
  ActivityEvent,
  ContextCard,
  ContextMetrics,
  Repo,
  Todo,
} from "@/lib/types";
import type { AtlasStats, RepoWithSignals } from "@/lib/queries";
// Type-only imports: erased at compile time, so this file never pulls the AI
// stack (or the Anthropic SDK) into the runtime bundle. Keeps the snapshot layer
// free of import cycles with lib/ai/*.
import type { DigestResult } from "@/lib/ai/digest";
import type { AICostSummary } from "@/lib/ai/cache";
import type { LearnedItem } from "@/lib/ai/learning";
import type { AIAvailability } from "@/lib/ai/provider";

export const SNAPSHOT_PATH = path.join(process.cwd(), "public-snapshot.json");
export const OWNER_SNAPSHOT_PATH = path.join(process.cwd(), "owner-snapshot.json");

export interface PublicSnapshot {
  generatedAt: string;
  stats: AtlasStats;
  repos: RepoWithSignals[];
  activity: ActivityEvent[];
  summaries: Record<string, string>;
  /** Only `public` cards, with provenance/verify/paths stripped and names redacted. */
  contextCards: ContextCard[];
  /** Aggregate counts only — safe to publish, leak nothing per-card. */
  contextMetrics: ContextMetrics;
}

/**
 * Strip everything machine- or command-specific from a context card before it
 * can appear in the public demo: source paths, the verify command, drift paths,
 * the origin session. Free text is redacted by the caller. What remains is the
 * claim, its freshness, and when it was verified — the showcase, not the guts.
 */
/** Blank absolute filesystem paths embedded in free text (e.g. a claim that
 *  mentions "/Users/me/proj/x"). The snapshot gate greps for these too and
 *  fails closed; stripping here makes the sanitizer self-sufficient so the gate
 *  is a second line of defense, not the only one. */
function stripPaths(s: string | null): string | null {
  if (!s) return s;
  return s.replace(
    /(?:\/(?:Users|home|root|var|tmp|opt|mnt|private|srv)\/[^\s)'"]+)/g,
    "[path]"
  );
}

function sanitizeCard(
  card: ContextCard,
  redact: (s: string | null) => string | null
): ContextCard {
  const clean = (s: string | null) => stripPaths(redact(s));
  return {
    ...card,
    claim: clean(card.claim) ?? "",
    detail: clean(card.detail),
    subject: clean(card.subject) ?? card.subject,
    provenance: [],
    verifyCommand: null,
    verifyCheckedAt: null,
    driftedPaths: [],
    originSessionId: null,
    repoSlug: null,
  };
}

/**
 * The owner snapshot is a SUPERSET of the public snapshot: full unsanitized data
 * (all repos with paths, private repos, forks), plus todos, the cached AI digest,
 * usage cost, and recorded feedback. It is NEVER committed (gitignored); it ships
 * to the login-gated owner deployment via the Vercel CLI upload, never via git.
 */
export interface OwnerSnapshot {
  generatedAt: string;
  stats: AtlasStats;
  repos: RepoWithSignals[];
  activity: ActivityEvent[];
  summaries: Record<string, string>;
  todos: Todo[];
  /** Latest cached portfolio digest, or null if none was ever generated. */
  digest: DigestResult | null;
  cost: AICostSummary;
  feedback: LearnedItem[];
  /** AI availability captured at generation time (the host has no API key). */
  ai: AIAvailability;
  /** All context cards, unredacted (owner deployment is OAuth-gated). */
  contextCards: ContextCard[];
  contextMetrics: ContextMetrics;
}

/**
 * Sanitize a repo for public display. Removes everything tied to the local
 * machine or private working state:
 *  - absolute file path (reveals username / machine layout)
 *  - remoteUrl (may carry an SSH host alias or an embedded token; the UI
 *    rebuilds the GitHub link from owner/repoName instead)
 *  - lastCommitSha (not shown publicly; avoids leaking internal refs)
 *  - dirty / ahead / behind (local, unpublished working state)
 *  - linked todo count (todos are hidden from the public entirely)
 * Keeps only facts that are already public on GitHub.
 */
function sanitizeRepo(repo: RepoWithSignals): RepoWithSignals {
  const cleaned: Repo = {
    ...repo,
    path: "",
    remoteUrl: null,
    lastCommitSha: null,
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
    if (allow.length === 0) {
      console.warn(
        "atlas: publicOwners is empty — ALL public repos will be published. Set publicOwners in atlas.config.json to scope the demo to specific orgs/users."
      );
    }
    const rows = db.prepare("SELECT * FROM repos").all() as Repo[];
    const publicRepos = rows.filter(
      (r) =>
        r.visibility === "public" &&
        r.isFork !== 1 &&
        (allow.length === 0 || (r.owner !== null && allow.includes(r.owner)))
    );
    const slugs = new Set(publicRepos.map((r) => r.slug));

    // Redact distinctive private/fork repo names from free text. Public commit
    // messages occasionally reference private repos by name (e.g. "import from
    // aim-roadmap"); Atlas must not surface those names even though git history
    // already does. Generic short names are skipped (they collide with English).
    const hidden = db
      .prepare("SELECT name FROM repos WHERE visibility != 'public' OR isFork = 1")
      .all() as { name: string }[];
    const publicNameSet = new Set(publicRepos.map((r) => r.name));
    const redactNames = hidden
      .map((h) => h.name)
      .filter(
        (n) =>
          !publicNameSet.has(n) &&
          n.length >= 5 &&
          (n.length >= 12 || /[-_]/.test(n))
      );
    const redactRes = redactNames.map(
      (n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")
    );
    const redact = (s: string | null): string | null => {
      if (!s) return s;
      let out = s;
      for (const re of redactRes) out = out.replace(re, "[private]");
      return out;
    };

    const repos: RepoWithSignals[] = publicRepos
      .map((r) =>
        sanitizeRepo({
          ...r,
          lastCommitMsg: redact(r.lastCommitMsg),
          description: redact(r.description),
          signals: computeSignals(r),
          openTodos: 0,
        })
      )
      .sort((a, b) => (b.lastCommitAt ?? "").localeCompare(a.lastCommitAt ?? ""));

    const activity = (
      db.prepare("SELECT * FROM activity ORDER BY ts DESC LIMIT 4000").all() as ActivityEvent[]
    )
      .filter((e) => e.repoSlug && slugs.has(e.repoSlug))
      .map((e) => ({ ...e, title: redact(e.title) ?? "", meta: redact(e.meta) }));

    // AI summaries only for public repos (redacted as well).
    const summaries: Record<string, string> = {};
    const sumRows = db
      .prepare("SELECT entityId, output FROM ai_outputs WHERE entityType = 'repo' AND task = 'summary'")
      .all() as { entityId: string; output: string }[];
    for (const s of sumRows) {
      if (slugs.has(s.entityId)) summaries[s.entityId] = redact(s.output) ?? "";
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

    // Only public, active cards reach the demo, fully sanitized + redacted.
    const cardRows = db
      .prepare(
        "SELECT * FROM context_cards WHERE visibility = 'public' AND status = 'active'"
      )
      .all() as CardRow[];
    const contextCards = cardRows
      .map(rowToCard)
      .map((c) => sanitizeCard(c, redact));
    // Metrics scoped to PUBLIC cards only — the public snapshot must not
    // disclose the count, freshness, or read activity of private cards.
    const contextMetrics = getMetrics(db, { publicOnly: true });

    return {
      generatedAt: new Date().toISOString(),
      stats,
      repos,
      activity,
      summaries,
      contextCards,
      contextMetrics,
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

/**
 * Build the FULL owner snapshot from the local database. Unlike the public
 * snapshot, nothing is sanitized or redacted; this is the owner's complete view
 * (all repos, paths, private repos, todos, digest, feedback). Run locally via
 * `npm run snapshot:owner`; the result is gitignored and uploaded only to the
 * login-gated owner deployment.
 *
 * The AI availability cannot be derived on the read-only host (no API key there),
 * so the caller captures it locally at generation time and passes it in.
 */
export function generateOwnerSnapshot(ai: AIAvailability): OwnerSnapshot {
  const db = getReadDb();
  try {
    const repoRows = db.prepare("SELECT * FROM repos").all() as Repo[];
    const todoCounts = db
      .prepare(
        "SELECT repoSlug, count(*) n FROM todos WHERE status = 'open' AND repoSlug IS NOT NULL GROUP BY repoSlug"
      )
      .all() as { repoSlug: string; n: number }[];
    const todoMap = new Map(todoCounts.map((r) => [r.repoSlug, r.n]));
    const repos: RepoWithSignals[] = repoRows
      .map((r) => ({
        ...r,
        signals: computeSignals(r),
        openTodos: todoMap.get(r.slug) ?? 0,
      }))
      .sort((a, b) => (b.lastCommitAt ?? "").localeCompare(a.lastCommitAt ?? ""));

    const todos = db
      .prepare("SELECT * FROM todos ORDER BY createdAt DESC")
      .all() as Todo[];

    const activity = db
      .prepare("SELECT * FROM activity ORDER BY ts DESC LIMIT 4000")
      .all() as ActivityEvent[];

    const summaries: Record<string, string> = {};
    const sumRows = db
      .prepare(
        "SELECT entityId, output FROM ai_outputs WHERE entityType = 'repo' AND task = 'summary'"
      )
      .all() as { entityId: string; output: string }[];
    for (const s of sumRows) summaries[s.entityId] = s.output;

    // Latest cached portfolio digest (most recently generated row). Stored
    // content-hash isn't needed here: the owner deployment cannot regenerate
    // (read-only host), so it always shows the last digest the owner produced.
    const digestRow = db
      .prepare(
        "SELECT output, model, generatedAt, promptTokens, completionTokens FROM ai_outputs WHERE entityType = 'portfolio' AND task = 'digest' ORDER BY generatedAt DESC LIMIT 1"
      )
      .get() as
      | {
          output: string;
          model: string;
          generatedAt: string;
          promptTokens: number;
          completionTokens: number;
        }
      | undefined;
    const digest: DigestResult | null = digestRow
      ? {
          text: digestRow.output,
          model: digestRow.model,
          generatedAt: digestRow.generatedAt,
          promptTokens: digestRow.promptTokens,
          completionTokens: digestRow.completionTokens,
          cached: true,
          reposIncluded: repos.length,
          reposExcluded: 0,
        }
      : null;

    const cost = db
      .prepare(
        "SELECT count(*) calls, COALESCE(SUM(promptTokens),0) promptTokens, COALESCE(SUM(completionTokens),0) completionTokens FROM ai_outputs"
      )
      .get() as AICostSummary;

    const feedback = db
      .prepare(
        "SELECT field, aiValue, correctedValue, note, entityId, createdAt FROM feedback ORDER BY createdAt DESC LIMIT 200"
      )
      .all() as LearnedItem[];

    const stats: AtlasStats = {
      lastScanAt: getMeta(db, "lastScanAt"),
      repoCount: repos.length,
      todoCount: Number(getMeta(db, "todoCount") ?? todos.length),
      activityCount: Number(getMeta(db, "activityCount") ?? activity.length),
      publicCount: repos.filter((r) => r.visibility === "public").length,
      privateCount: repos.filter((r) => r.visibility === "private").length,
      forkCount: repos.filter((r) => r.isFork === 1).length,
      needsAttention: repos.filter((r) => r.signals.attention.length > 0).length,
      openP0: todos.filter((t) => t.priority === "P0" && t.status === "open").length,
    };

    const contextCards = (
      db
        .prepare("SELECT * FROM context_cards WHERE status = 'active'")
        .all() as CardRow[]
    ).map(rowToCard);
    const contextMetrics = getMetrics(db);

    return {
      generatedAt: new Date().toISOString(),
      stats,
      repos,
      activity,
      summaries,
      todos,
      digest,
      cost,
      feedback,
      ai,
      contextCards,
      contextMetrics,
    };
  } finally {
    db.close();
  }
}

let ownerSnapshotCache: OwnerSnapshot | null = null;

/** Load the deployed owner snapshot (used when ATLAS_MODE=owner). */
export function loadOwnerSnapshot(): OwnerSnapshot {
  if (ownerSnapshotCache) return ownerSnapshotCache;
  if (!fs.existsSync(OWNER_SNAPSHOT_PATH)) {
    throw new Error(
      "atlas: owner-snapshot.json not found. Run `npm run snapshot:owner` to generate it."
    );
  }
  ownerSnapshotCache = JSON.parse(
    fs.readFileSync(OWNER_SNAPSHOT_PATH, "utf8")
  ) as OwnerSnapshot;
  return ownerSnapshotCache;
}
