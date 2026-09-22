import type { Decision, DecisionSkip } from "@/lib/types";
import type { SectionFreshness } from "@/lib/freshness-shared";
import { parseDecisionContent } from "@/lib/scanners/decisions";

/**
 * Decision cards read from the forge at request time.
 *
 * The deployed owner view used to see cards only as of the last snapshot
 * deploy (nightly). This module reads `decisions/` from the todo repository's
 * GitHub API when an owner asks for the page, so a card pushed to the forge
 * shows within a minute with no deploy. The shape is pull, not push: Atlas
 * holds a READ-ONLY token scoped to that one repository; nothing on a laptop
 * pushes into Atlas.
 *
 * Cost is kept to one listing call plus one fetch per card that actually
 * changed: every card carries the git blob sha of its content (`blobSha`), the
 * forge lists the same sha for every file in the directory, so a card whose
 * sha matches the snapshot is reused from the snapshot and never fetched. The
 * merged result is cached in this module for a short TTL, and concurrent
 * requests share one in-flight read.
 *
 * Failure never renders an error page: when the forge cannot be read (no
 * token, network, rate limit, a non-200), the snapshot's cards are served with
 * a freshness of status `error` and a note that says so, which the page shows
 * loudly. The boundary is unchanged: any mode but `owner` gets an empty result
 * and the forge is never contacted.
 *
 * Next cache primitives are deliberately not used (test/auth/dynamic-pages
 * bans them under app/); this is the module-level cache idiom the rest of the
 * tree uses.
 */

export interface ForgeSource {
  /** `owner/repo` of the todo repository. */
  repo: string;
  branch: string;
  /** Directory of cards inside the repository. */
  path: string;
  /** Read-only token; null means the forge is not configured. */
  token: string | null;
  apiBase: string;
}

/**
 * Coordinates from the environment (names only are documented in .env.example):
 * ATLAS_FORGE_REPO (`owner/repo`, required), ATLAS_FORGE_BRANCH (default
 * `main`), ATLAS_FORGE_PATH (default `decisions`), ATLAS_FORGE_TOKEN (falls
 * back to GITHUB_TOKEN). Null when no repository is named.
 */
export function forgeSourceFromEnv(
  env: Record<string, string | undefined> = process.env
): ForgeSource | null {
  const repo = (env.ATLAS_FORGE_REPO ?? "").trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  const token = (env.ATLAS_FORGE_TOKEN ?? env.GITHUB_TOKEN ?? "").trim() || null;
  return {
    repo,
    branch: (env.ATLAS_FORGE_BRANCH ?? "").trim() || "main",
    path: (env.ATLAS_FORGE_PATH ?? "").trim().replace(/^\/+|\/+$/g, "") || "decisions",
    token,
    apiBase: (env.ATLAS_FORGE_API ?? "").trim() || "https://api.github.com",
  };
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** What the forge read starts from: the deployed owner snapshot's decision sections. */
export interface DecisionSnapshot {
  decisions: Decision[];
  decisionSkips: DecisionSkip[];
  /** When the snapshot was built; null when unknown. */
  generatedAt: string | null;
}

export interface LiveDecisions {
  decisions: Decision[];
  skips: DecisionSkip[];
  /** Where the cards came from this time. */
  source: "forge" | "snapshot";
  /** Cards fetched from the forge on this read (0 when nothing changed). */
  changed: number;
  /** ISO time the forge answered; null when it did not. */
  fetchedAt: string | null;
  /** Why the forge was not used; null when it was. */
  error: string | null;
  freshness: SectionFreshness;
}

interface ForgeEntry {
  name: string;
  sha: string;
  type: string;
}

/** Per-request budget of card fetches; beyond it the rest waits for the next read. */
export const MAX_FETCHES_PER_READ = 40;
export const DEFAULT_TTL_MS = 60_000;
/** Card fetches in flight at once. */
export const FETCH_CONCURRENCY = 8;

/**
 * Run `fn` for the i-th item so that at most `width` items are in flight:
 * item i starts after item i-width has settled. A slot-based limiter with no
 * shared queue, enough for a few dozen requests.
 */
const slots = new Map<number, Promise<unknown>>();
function limitAt<T>(i: number, width: number, fn: () => Promise<T>): Promise<T> {
  const prior = slots.get(i - width) ?? Promise.resolve();
  const p = prior.then(fn, fn);
  slots.set(i, p);
  p.finally(() => {
    if (slots.get(i) === p) slots.delete(i);
  }).catch(() => undefined);
  return p;
}

interface CacheEntry {
  key: string;
  at: number;
  value: LiveDecisions;
}
let cache: CacheEntry | null = null;
let inFlight: { key: string; promise: Promise<LiveDecisions> } | null = null;

/** Test hook: forget the cached read and any in-flight one. */
export function resetForgeCache(): void {
  cache = null;
  inFlight = null;
}

export interface ReadOptions {
  source?: ForgeSource | null;
  snapshot: () => DecisionSnapshot;
  fetch?: Fetcher;
  now?: () => Date;
  ttlMs?: number;
}

function newest(cards: Decision[]): string | null {
  let best: string | null = null;
  for (const c of cards) {
    const t = c.modifiedAt || c.date;
    if (t && (!best || t > best)) best = t;
  }
  return best;
}

function fromSnapshot(
  snap: DecisionSnapshot,
  nowIso: string,
  error: string
): LiveDecisions {
  return {
    decisions: snap.decisions,
    skips: snap.decisionSkips,
    source: "snapshot",
    changed: 0,
    fetchedAt: null,
    error,
    freshness: {
      dataAt: newest(snap.decisions),
      collectedAt: snap.generatedAt,
      builtAt: nowIso,
      status: "error",
      count: snap.decisions.length,
      note: `${error}; showing the snapshot built ${snap.generatedAt ?? "at an unknown time"}`,
    },
  };
}

async function readForge(opts: Required<Pick<ReadOptions, "snapshot" | "fetch" | "now">> & { source: ForgeSource }): Promise<LiveDecisions> {
  const { source, snapshot } = opts;
  const snap = snapshot();
  const nowIso = opts.now().toISOString();
  if (!source.token) return fromSnapshot(snap, nowIso, "forge token not configured");

  const headers = {
    Authorization: `Bearer ${source.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "atlas-decisions-forge",
  };
  const listingUrl = `${source.apiBase}/repos/${source.repo}/contents/${source.path}?ref=${encodeURIComponent(source.branch)}`;
  let entries: ForgeEntry[];
  try {
    const res = await opts.fetch(listingUrl, { headers });
    if (!res.ok) return fromSnapshot(snap, nowIso, `forge listing answered HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return fromSnapshot(snap, nowIso, "forge listing is not a directory");
    entries = body as ForgeEntry[];
  } catch (err) {
    return fromSnapshot(snap, nowIso, `forge unreachable (${(err as Error)?.message ?? "error"})`);
  }

  const knownCards = new Map(snap.decisions.map((d) => [d.filename, d]));
  const knownSkips = new Map(snap.decisionSkips.map((k) => [k.filename, k]));
  const decisions: Decision[] = [];
  const skips: DecisionSkip[] = [];
  const toFetch: ForgeEntry[] = [];
  for (const e of entries) {
    if (e.type !== "file") continue;
    const lower = e.name.toLowerCase();
    if (!lower.endsWith(".md") || lower === "readme.md") continue;
    const card = knownCards.get(e.name);
    if (card && card.blobSha === e.sha) {
      decisions.push(card);
      continue;
    }
    const skip = knownSkips.get(e.name);
    if (skip && skip.blobSha === e.sha) {
      skips.push(skip);
      continue;
    }
    toFetch.push(e);
  }
  // Newest names first, so a burst of changes shows the latest cards inside
  // the budget and the rest on the next read.
  toFetch.sort((a, b) => b.name.localeCompare(a.name));
  const deferred = toFetch.splice(MAX_FETCHES_PER_READ);

  // Fetch the changed cards a few at a time: one request per card, bounded so
  // a burst neither serialises into seconds nor floods the API.
  const fetched = await Promise.all(
    toFetch.map((e, i) =>
      limitAt(i, FETCH_CONCURRENCY, async (): Promise<{ e: ForgeEntry; content: string } | { e: ForgeEntry; failure: string }> => {
        const url = `${source.apiBase}/repos/${source.repo}/contents/${source.path}/${encodeURIComponent(e.name)}?ref=${encodeURIComponent(source.branch)}`;
        try {
          const res = await opts.fetch(url, {
            headers: { ...headers, Accept: "application/vnd.github.raw+json" },
          });
          if (!res.ok) return { e, failure: `forge card fetch answered HTTP ${res.status}` };
          return { e, content: await res.text() };
        } catch (err) {
          return { e, failure: `forge unreachable (${(err as Error)?.message ?? "error"})` };
        }
      })
    )
  );
  let changed = 0;
  for (const f of fetched) {
    if ("failure" in f) return fromSnapshot(snap, nowIso, f.failure);
    changed += 1;
    const r = parseDecisionContent(f.e.name, f.content, {
      path: `${source.repo}/${source.path}/${f.e.name}`,
      modifiedAt: nowIso,
      scannedAt: nowIso,
      quiet: true,
    });
    if (r.kind === "card") decisions.push(r.card);
    else if (r.kind === "skip") skips.push(r.skip);
  }
  // A card the budget deferred keeps its snapshot copy for this read rather
  // than vanishing; it is fetched on a later read.
  for (const e of deferred) {
    const card = knownCards.get(e.name);
    if (card) decisions.push(card);
    const skip = knownSkips.get(e.name);
    if (skip) skips.push(skip);
  }

  decisions.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  skips.sort((a, b) => b.filename.localeCompare(a.filename));
  const notes: string[] = [];
  if (changed) notes.push(`${changed} card${changed === 1 ? "" : "s"} read live from the forge`);
  else notes.push("no card changed since the snapshot");
  if (deferred.length)
    notes.push(`${deferred.length} more changed card${deferred.length === 1 ? "" : "s"} deferred to the next read`);
  return {
    decisions,
    skips,
    source: "forge",
    changed,
    fetchedAt: nowIso,
    error: null,
    freshness: {
      dataAt: newest(decisions),
      collectedAt: nowIso,
      builtAt: nowIso,
      status: decisions.length ? "ok" : "empty",
      count: decisions.length,
      note: notes.join("; "),
    },
  };
}

/**
 * Decision cards for `mode`. Only the owner mode reaches the forge; every
 * other mode gets an empty result without any network call, which is the
 * boundary the public view depends on. Reads are cached for `ttlMs` and
 * shared while in flight.
 */
export async function getLiveDecisions(
  mode: "public" | "owner" | "local",
  opts: ReadOptions
): Promise<LiveDecisions> {
  const now = opts.now ?? (() => new Date());
  if (mode !== "owner") {
    const nowIso = now().toISOString();
    return {
      decisions: [],
      skips: [],
      source: "snapshot",
      changed: 0,
      fetchedAt: null,
      error: null,
      freshness: { dataAt: null, collectedAt: null, builtAt: nowIso, status: "empty", count: 0, note: null },
    };
  }
  const source = opts.source === undefined ? forgeSourceFromEnv() : opts.source;
  if (!source) return fromSnapshot(opts.snapshot(), now().toISOString(), "forge not configured (ATLAS_FORGE_REPO unset)");
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const key = `${source.apiBase} ${source.repo}@${source.branch}/${source.path}`;
  const t = now().getTime();
  if (cache && cache.key === key && t - cache.at < ttl) return cache.value;
  if (inFlight && inFlight.key === key) return inFlight.promise;
  const promise = readForge({
    source,
    snapshot: opts.snapshot,
    fetch: opts.fetch ?? ((url, init) => fetch(url, init)),
    now,
  }).then((value) => {
    cache = { key, at: now().getTime(), value };
    return value;
  }).finally(() => {
    if (inFlight && inFlight.promise === promise) inFlight = null;
  });
  inFlight = { key, promise };
  return promise;
}
