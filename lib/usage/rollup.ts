import type {
  FeatureUsage,
  ProjectUsage,
  ToolEvent,
  UsageCategory,
  UsageRollup,
} from "@/lib/usage/types";
import { featureMeta, publicFeatureKey } from "@/lib/usage/catalog-meta";

/**
 * Pure aggregation of mined tool events into a dashboard rollup. The SAME
 * function powers the public and owner views; `opts.public` toggles the
 * sanitization that makes the result safe to commit to public-snapshot.json:
 *
 *  - cwd / gitBranch / paramKeys are never carried into the rollup (they live
 *    only on the raw events and the owner-only `recentEvents`).
 *  - project attribution is bucketed to an allowlist; everything else → "other",
 *    so the public view can't disclose a private client/project by name.
 *  - timestamps are truncated to date-only (no time-of-day fingerprint).
 *  - feature names that match a redaction token (private repo / sensitive name)
 *    collapse to a "(private)" family bucket.
 *
 * Because the public rollup OMITS the sensitive fields entirely, they cannot
 * leak even if a downstream bug forgot to redact — you can't serialize a field
 * you never set. The snapshot gate re-asserts this independently, fail-closed.
 */
export interface RollupOptions {
  public: boolean;
  /** Project names allowed to be attributed by name in public mode. */
  publicProjects?: string[];
  /** Tokens (private repo / sensitive names) to scrub from feature names. */
  redactNames?: string[];
  /** Reference "now" for the trailing-30-day windows. */
  now: Date;
  /** Owner-only: how many recent raw events to attach. 0/omitted in public. */
  recentLimit?: number;
}

const DAY_MS = 86_400_000;
const WINDOW = 30;

function dayKey(ts: string | null): string | null {
  return ts ? ts.slice(0, 10) : null;
}

function dayOffset(dk: string, todayUTC: number): number {
  const [y, m, d] = dk.split("-").map(Number);
  if (!y || !m || !d) return -1;
  return Math.round((todayUTC - Date.UTC(y, m - 1, d)) / DAY_MS);
}

function blankSpark(): number[] {
  return new Array(WINDOW).fill(0);
}

interface Acc {
  count: number;
  category: UsageCategory;
  first: string | null;
  last: string | null;
  spark: number[];
}

export function rollupEvents(events: ToolEvent[], opts: RollupOptions): UsageRollup {
  const isPublic = opts.public;
  const allow = new Set(opts.publicProjects ?? []);
  const todayUTC = Date.UTC(
    opts.now.getUTCFullYear(),
    opts.now.getUTCMonth(),
    opts.now.getUTCDate()
  );

  // In public mode, sanitize the feature key to an allowlist: known generic
  // skill/agent/command/mcp names show by name; anything else (incl. all
  // user-authored workflow names) collapses to a "(other)"/"(custom)" bucket so
  // a private client/project name can never ride into the public snapshot via a
  // feature key. Owner/local mode keeps the real key. `redactNames` is no longer
  // load-bearing for this (allowlist supersedes blocklist) but is accepted for
  // backward compatibility.
  const safeFeature = (feature: string): string =>
    isPublic ? publicFeatureKey(feature) : feature;

  const byFeature = new Map<string, Acc>();
  const byCategory = new Map<UsageCategory, number>();
  const byProject = new Map<string, number>();
  const sessions = new Set<string>();
  const activeDays = new Set<string>();
  const overall = blankSpark();
  let workflowsRun = 0;

  for (const e of events) {
    const feature = safeFeature(e.feature);
    let acc = byFeature.get(feature);
    if (!acc) {
      acc = { count: 0, category: e.category, first: e.ts, last: e.ts, spark: blankSpark() };
      byFeature.set(feature, acc);
    }
    acc.count++;
    if (e.ts && (!acc.first || e.ts < acc.first)) acc.first = e.ts;
    if (e.ts && (!acc.last || e.ts > acc.last)) acc.last = e.ts;

    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
    if (e.sessionId) sessions.add(e.sessionId);
    if (feature.startsWith("Workflow:")) workflowsRun++;

    const dk = dayKey(e.ts);
    if (dk) {
      activeDays.add(dk);
      const off = dayOffset(dk, todayUTC);
      if (off >= 0 && off < WINDOW) {
        acc.spark[WINDOW - 1 - off]++;
        overall[WINDOW - 1 - off]++;
      }
    }

    // Project attribution. Public: allowlist or "other". Owner: real name / "unknown".
    let proj: string;
    if (isPublic) proj = e.project && allow.has(e.project) ? e.project : "other";
    else proj = e.project ?? "unknown";
    byProject.set(proj, (byProject.get(proj) ?? 0) + 1);
  }

  // Seed recommended-but-unused features so the "underused" prompt is meaningful
  // even when a high-value feature was never invoked.
  for (const seed of ["Workflow", "Agent"]) {
    if (!byFeature.has(seed) && featureMeta(seed)?.recommended) {
      const meta = featureMeta(seed)!;
      byFeature.set(seed, {
        count: 0,
        category: meta.category,
        first: null,
        last: null,
        spark: blankSpark(),
      });
    }
  }

  const trim = (ts: string | null): string | null =>
    ts ? (isPublic ? ts.slice(0, 10) : ts) : null;

  const features: FeatureUsage[] = Array.from(byFeature.entries())
    .map(([feature, a]) => {
      const meta = featureMeta(feature);
      const recommended = meta?.recommended ?? false;
      return {
        feature,
        category: a.category,
        displayName: displayName(feature, meta?.displayName),
        description: meta?.description ?? null,
        whenToUse: meta?.whenToUse ?? null,
        count: a.count,
        firstUsed: trim(a.first),
        lastUsed: trim(a.last),
        spark: a.spark,
        underused: recommended && a.count < 3,
      };
    })
    .sort((x, y) => y.count - x.count);

  const projects: ProjectUsage[] = Array.from(byProject.entries())
    .map(([project, count]) => ({ project, count }))
    .sort((a, b) => b.count - a.count);

  const categories = Array.from(byCategory.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const rollup: UsageRollup = {
    generatedAt: opts.now.toISOString(),
    totals: {
      events: events.length,
      features: features.filter((f) => f.count > 0).length,
      sessions: sessions.size,
      activeDays: activeDays.size,
      workflowsRun,
    },
    spark: overall,
    byCategory: categories,
    features,
    projects,
  };

  // Owner-only: attach the most recent raw events (with cwd/branch) for the
  // drill-down timeline. NEVER set in public mode.
  if (!isPublic && opts.recentLimit && opts.recentLimit > 0) {
    rollup.recentEvents = [...events]
      .filter((e) => e.ts)
      .sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""))
      .slice(0, opts.recentLimit);
  }

  return rollup;
}

/** Human label for a feature key, e.g. "Skill:pre-push-review" → "pre-push-review". */
function displayName(feature: string, metaLabel?: string): string {
  const sep = feature.search(/[:.]/);
  if (sep < 0) return metaLabel ?? feature;
  const tail = feature.slice(sep + 1);
  // For named families, show the specific name (it's the showcase); for the
  // generic catalog label use metaLabel.
  return tail || metaLabel || feature;
}
