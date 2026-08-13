import fs from "node:fs";
import { getReadDb, getMeta } from "@/lib/db";
import { ownerSnapshotPath, publicSnapshotPath } from "@/lib/paths";
import { loadConfig } from "@/lib/config";
import { computeSignals } from "@/lib/signals";
import { rowToCard, slug, getSessions, type CardRow } from "@/lib/context/store";
import { getMetrics, getMetricsForCards } from "@/lib/context/metrics";
import type {
  ActivityEvent,
  ContextCard,
  ContextMetrics,
  Repo,
  Session,
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
import { computeFreshness } from "@/lib/freshness";
import { liveSection } from "@/lib/freshness-shared";
import type { SectionFreshness, SnapshotFreshness } from "@/lib/freshness-shared";
import { getToolEvents } from "@/lib/usage/store";
import { rollupEvents } from "@/lib/usage/rollup";
import { DEFAULT_PUBLIC_USAGE_PROJECTS } from "@/lib/usage/catalog-meta";
import type { UsageRollup } from "@/lib/usage/types";
import { loadRoadmap } from "@/lib/roadmap";
import type { RoadmapItem } from "@/lib/roadmap-shared";
import { loadStrategyDocs } from "@/lib/strategy";
import type { StrategyDoc } from "@/lib/strategy-shared";

// Were module-load constants off process.cwd(): frozen at import time, so any
// entry point that resolved its cwd differently read one file and wrote
// another. Functions now, resolved through the single resolver at call time.
export const snapshotPath = publicSnapshotPath;
export const ownerSnapshotFile = ownerSnapshotPath;

/**
 * Whether a context card may appear in the PUBLIC snapshot. Pure (no I/O) so the
 * exclusion rule is unit-testable in isolation. A card is publishable only when
 * it is public + active AND not sensitive in any of three ways:
 *   - flagged `sensitive` directly (hard never-publish),
 *   - attached to a sensitive repo via repoSlug,
 *   - (defensive) its project name maps to a sensitive repo slug even without a
 *     repoSlug set.
 * `sensitiveSlugs` is the configured `sensitiveRepos` set.
 */
export function isCardPublishable(
  card: ContextCard,
  sensitiveSlugs: Set<string>
): boolean {
  // Normalize both comparison inputs to the same slug form the config set is
  // canonicalized to (see loadConfig) — never compare a raw, possibly mixed-case
  // value against the normalized set, or the exclusion can silently fail open.
  return (
    card.visibility === "public" &&
    card.status === "active" &&
    !card.sensitive &&
    !(card.repoSlug != null && sensitiveSlugs.has(slug(card.repoSlug))) &&
    !sensitiveSlugs.has(slug(card.project))
  );
}

/**
 * Whether a hidden (private or fork) repo name actually leaks into published
 * text, and if so as what. Returns the offending token, or null when the name
 * is absent or appears only inside identifiers that are themselves published.
 *
 * A plain `\b${name}\b` test does not work here: `\b` treats `-` as a boundary,
 * so a private `crypto-census` matches inside the PUBLIC `crypto-census-data`
 * and blocks every publish on a repo whose name is already public. Repo names
 * contain `-` and `_`, so the token — not the word — is the right unit.
 *
 * Deliberately NOT weakened into "ignore any hyphenated extension": an
 * unpublished compound like `crypto-census-secrets` still leaks, and only an
 * exact match against something this snapshot publishes on purpose clears it.
 *
 * Pure (no I/O) so the boundary can be tested in both directions — that a real
 * mention is caught matters as much as that a public name is not.
 */
export function hiddenNameLeak(
  hiddenName: string,
  text: string,
  publicIdentifiers: Set<string>
): string | null {
  const esc = hiddenName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokens =
    text.match(new RegExp(`(?<![\\w-])[\\w-]*${esc}[\\w-]*(?![\\w-])`, "gi")) ?? [];
  return tokens.find((t) => !publicIdentifiers.has(t.toLowerCase())) ?? null;
}

/**
 * Distinctive tokens to scrub from public free text when they originate in
 * sensitive content (a sensitive card's subject/claim/detail). A token counts
 * as distinctive — and therefore redactable/assertable — when it's long enough
 * or carries a separator (`-_./`), e.g. `prod-db-pw`, an internal hostname, a
 * key name. Short common words ("auth", "prod") are skipped so the public demo
 * isn't redacted to noise; the same heuristic governs repo-name redaction.
 * Exported so the snapshot gate re-derives the identical set independently.
 */
export function distinctiveTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const tok of text.split(/[^\w.\-/]+/)) {
    if (!tok) continue;
    if (tok.length >= 5 && (tok.length >= 12 || /[-_./]/.test(tok))) out.push(tok);
  }
  return out;
}

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
  /**
   * Claude Code feature-usage rollup. Aggregates only — no raw events, no
   * cwd/branch/paramKeys, projects bucketed to the allowlist. Built from the
   * mined tool_events but deliberately omits every owner-only field.
   */
  usage: UsageRollup;
  /**
   * Per-section data age. Carries the COLLECTION time of each section, which is
   * not the same clock as `generatedAt` above (the build time) — conflating the
   * two is exactly how a dead collector rendered as "scanned just now". Absent
   * on artifacts built before this existed; readers must render that as
   * unavailable rather than assume freshness. See lib/freshness.ts.
   */
  freshness: SnapshotFreshness;
}

/** Resolve the public usage-project allowlist (config override or default). */
function usageProjects(configList: string[]): string[] {
  return configList.length ? configList : DEFAULT_PUBLIC_USAGE_PROJECTS;
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
  /** Claude session registry — owner-only, never in the public snapshot. */
  sessions: Session[];
  /** Feature-usage rollup, full detail (real project names, recent raw events). */
  usage: UsageRollup;
  /** Per-section data age — see PublicSnapshot.freshness and lib/freshness.ts. */
  freshness: SnapshotFreshness;
  /**
   * Roadmap items parsed from the local `<todoDir>/roadmap/*.md` files. Owner-only
   * (never in the public snapshot) — the host has no filesystem to read them from,
   * so they are baked in here. On the deployed host the board is read-only; edits
   * write markdown files and are local-mode only (see app/api/roadmap/route.ts).
   */
  roadmap: RoadmapItem[];
  /**
   * Strategy docs parsed from the `strategyDocs` markdown files. Owner-only
   * (fundraising content — never in the public snapshot), baked in for the same
   * reason as roadmap: the deployed host has no filesystem to read them from.
   */
  strategy: StrategyDoc[];
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
    const config = loadConfig();
    const allow = config.publicOwners;
    if (allow.length === 0) {
      console.warn(
        "atlas: publicOwners is empty — ALL public repos will be published. Set publicOwners in atlas.config.json to scope the demo to specific orgs/users."
      );
    }
    // SENSITIVE repos are a hard never-publish: dropped here even when the repo
    // is GitHub-public. We also resolve their names so cards/text that reference
    // them by slug OR name can be excluded/redacted below. Fail-closed: the
    // snapshot gate (scripts/snapshot.ts) re-derives this set and aborts if any
    // sensitive identifier survives into the output.
    const sensitiveSlugs = new Set(config.sensitiveRepos);
    const rows = db.prepare("SELECT * FROM repos").all() as Repo[];
    const sensitiveRepoNames = rows
      .filter((r) => sensitiveSlugs.has(r.slug))
      .map((r) => r.name);
    const publicRepos = rows.filter(
      (r) =>
        r.visibility === "public" &&
        r.isFork !== 1 &&
        !sensitiveSlugs.has(r.slug) &&
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
    // Distinctive tokens from SENSITIVE cards' own text. A sensitive card never
    // ships, but its claim could be quoted verbatim inside a publishable card
    // (the owner authors both); scrub those tokens so the secret can't leak by
    // cross-reference. The gate re-derives the same set and fails closed.
    const isSensitiveCard = (c: ContextCard): boolean =>
      c.sensitive ||
      (c.repoSlug != null && sensitiveSlugs.has(slug(c.repoSlug))) ||
      sensitiveSlugs.has(slug(c.project));
    const sensitiveCardRows = (
      db
        .prepare("SELECT * FROM context_cards WHERE status = 'active'")
        .all() as CardRow[]
    )
      .map(rowToCard)
      .filter(isSensitiveCard);
    const sensitiveCardTokens = sensitiveCardRows.flatMap((c) => [
      ...distinctiveTokens(c.subject),
      ...distinctiveTokens(c.claim),
      ...distinctiveTokens(c.detail),
    ]);
    // Redact hidden (private/fork) repo names AND sensitive repo names. A
    // sensitive repo may be GitHub-public, so it won't appear in `hidden`; add
    // its name explicitly so any cross-reference in another repo's text is
    // scrubbed. Sensitive names are redacted regardless of the distinctiveness
    // heuristic — they are an explicit never-publish.
    const redactNames = Array.from(
      new Set([
        ...hidden
          .map((h) => h.name)
          .filter(
            (n) =>
              !publicNameSet.has(n) &&
              n.length >= 5 &&
              (n.length >= 12 || /[-_]/.test(n))
          ),
        ...sensitiveRepoNames.filter((n) => n && !publicNameSet.has(n)),
        ...sensitiveCardTokens.filter((t) => !publicNameSet.has(t)),
      ])
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

    // Only public, active, NON-sensitive cards reach the demo. The sensitive
    // exclusion is enforced in code (not just SQL): drop cards flagged
    // sensitive, cards under a sensitive repo (by slug), and — defensively —
    // cards whose project name maps to a sensitive repo slug even without a
    // repoSlug set. Fail-closed: the snapshot gate re-checks this independently.
    const eligible = (db
      .prepare(
        "SELECT * FROM context_cards WHERE visibility = 'public' AND status = 'active'"
      )
      .all() as CardRow[])
      .map(rowToCard)
      .filter((c) => isCardPublishable(c, sensitiveSlugs));
    const contextCards = eligible.map((c) => sanitizeCard(c, redact));
    // Metrics derived from EXACTLY the published cards, so the counts can never
    // disclose the existence of a private or sensitive card filtered out above
    // (and the gate's count-match assertion holds by construction).
    const contextMetrics = getMetricsForCards(db, eligible);

    // Feature usage: PUBLIC rollup. Built from the mined events but the public
    // path drops cwd/branch/paramKeys (never serialized), buckets non-allowlisted
    // projects into "other", truncates timestamps to date-only, and reuses the
    // same `redactNames` set to scrub private identifiers from feature names.
    const usage = rollupEvents(getToolEvents(db), {
      public: true,
      publicProjects: usageProjects(config.publicUsageProjects),
      redactNames,
      now: new Date(),
    });

    // One instant for the whole artifact: `generatedAt` and every section's
    // `builtAt` must be the same clock reading, or comparing them later reports
    // drift that is really just two `new Date()` calls.
    const builtAt = new Date().toISOString();

    // Freshness for the PUBLIC artifact is re-derived from the published arrays,
    // never taken from the database totals. `max(updatedAt)` over every card, or
    // over private repos, would disclose activity on rows this snapshot exists to
    // withhold — a freshness block is still a side channel.
    const base = computeFreshness(db, builtAt, { owner: false });
    const freshness: SnapshotFreshness = {
      repos: publishedSection(base.repos, repos.map((r) => r.lastCommitAt), repos.length),
      activity: publishedSection(base.activity, activity.map((a) => a.ts), activity.length),
      // Context has no separate collector — the last card write IS the last
      // collection — so its `collectedAt` must be re-derived from the PUBLISHED
      // cards too. Left at the database-wide max it would disclose the minute a
      // private card was last touched, which is precisely what withholding the
      // card is meant to prevent.
      context: sameClock(
        publishedSection(
          base.context,
          contextCards.map((c) => c.updatedAt),
          contextCards.length
        )
      ),
      // Derived from the dates the rollup ITSELF publishes
      // (`features[].lastUsed`, already date-only) rather than from a fallback
      // to the collector's clock.
      //
      // Honest about what this does and does not buy: the public rollup
      // aggregates EVERY event, bucketing non-allowlisted projects into "other",
      // so this max equals the database-wide max date either way. It discloses
      // nothing new — that same date already ships as `features[].lastUsed` —
      // and the point here is structural: no section reaches for a clock derived
      // from rows it did not publish, so the pattern cannot rot into a leak the
      // way the fallback did for repos, activity and context.
      //
      // toDateOnly still applies, because `collectedAt` comes from the mining
      // clock at full precision and the rollup gave that precision up.
      usage: toDateOnly(
        publishedSection(
          base.usage,
          usage.features.map((f) => f.lastUsed),
          usage.totals.events
        )
      ),
    };

    return {
      generatedAt: builtAt,
      stats,
      repos,
      activity,
      summaries,
      contextCards,
      contextMetrics,
      usage,
      freshness,
    };
  } finally {
    db.close();
  }
}

/**
 * Re-key a section's data age and size to what actually got published, and DROP
 * the collector's note.
 *
 * `note` is free text a collector composes from whatever it was looking at —
 * scan roots, transcript roots, and counts taken over the WHOLE database
 * (including private repos and private projects). It is the only published field
 * that never passes through `redact()`, and path-stripping it is not enough: the
 * sanitizer's root alphabet and the gate's differ, so `/Volumes/...`,
 * `/data/...` and `/media/...` escape both. Rather than keep two alphabets in
 * sync forever, the public artifact carries no note at all — status and the
 * clocks are what a public reader needs, and the operational prose stays owner-
 * side where it is useful.
 */
function publishedSection(
  base: SectionFreshness,
  timestamps: (string | null)[],
  count: number
): SectionFreshness {
  const present = timestamps.filter((t): t is string => !!t);
  return {
    ...base,
    // No fallback to the collector's database-wide clock. When no PUBLISHED row
    // carries a timestamp the honest answer is "none", not the write time of
    // whichever private or sensitive row happened to be newest.
    dataAt: count === 0 || !present.length ? null : present.reduce((a, b) => (a > b ? a : b)),
    count,
    status: count === 0 && base.status === "ok" ? "empty" : base.status,
    note: null,
  };
}

/**
 * Collapse a collector-less section's two clocks onto the published one. Only
 * valid where the write IS the collection (context cards): there is no separate
 * "looking" step whose age could differ, so keeping a second, database-wide
 * value would add no information and disclose private write timing.
 */
function sameClock(f: SectionFreshness): SectionFreshness {
  return { ...f, collectedAt: f.dataAt };
}

/** Truncate a section's clocks to date-only, matching public rollup precision. */
function toDateOnly(f: SectionFreshness): SectionFreshness {
  const day = (s: string | null) => (s ? s.slice(0, 10) : null);
  return { ...f, dataAt: day(f.dataAt), collectedAt: day(f.collectedAt) };
}

let snapshotCache: PublicSnapshot | null = null;

/** Load the deployed public snapshot (used when ATLAS_MODE=public). */
export function loadPublicSnapshot(): PublicSnapshot {
  if (snapshotCache) return snapshotCache;
  if (!fs.existsSync(publicSnapshotPath())) {
    throw new Error(
      "atlas: public-snapshot.json not found. Run `npm run snapshot` to generate it."
    );
  }
  snapshotCache = JSON.parse(fs.readFileSync(publicSnapshotPath(), "utf8")) as PublicSnapshot;
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
    const sessions = getSessions(db);

    // Feature usage: OWNER rollup. Full detail — real project names, full-
    // precision timestamps, and the last 80 raw events (with cwd/branch) for the
    // drill-down timeline. Gitignored owner snapshot only; never committed.
    const usage = rollupEvents(getToolEvents(db), {
      public: false,
      now: new Date(),
      recentLimit: 80,
    });

    const builtAt = new Date().toISOString();
    // Roadmap and strategy markdown live on the owner machine; read them here
    // so the deployed host (which has no filesystem) can still render them.
    const roadmap = loadRoadmap();
    const strategy = loadStrategyDocs();

    return {
      generatedAt: builtAt,
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
      sessions,
      usage,
      roadmap,
      strategy,
      freshness: {
        ...computeFreshness(db, builtAt, { owner: true }),
        // Read straight off disk in the line above, so the build instant IS the
        // collection instant. Not a file mtime — that records a checkout.
        roadmap: liveSection(builtAt, roadmap.length),
        strategy: liveSection(builtAt, strategy.length),
      },
    };
  } finally {
    db.close();
  }
}

let ownerSnapshotCache: OwnerSnapshot | null = null;

/** Load the deployed owner snapshot (used when ATLAS_MODE=owner). */
export function loadOwnerSnapshot(): OwnerSnapshot {
  if (ownerSnapshotCache) return ownerSnapshotCache;
  if (!fs.existsSync(ownerSnapshotPath())) {
    throw new Error(
      "atlas: owner-snapshot.json not found. Run `npm run snapshot:owner` to generate it."
    );
  }
  ownerSnapshotCache = JSON.parse(
    fs.readFileSync(ownerSnapshotPath(), "utf8")
  ) as OwnerSnapshot;
  return ownerSnapshotCache;
}
