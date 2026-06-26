import { execFileSync } from "node:child_process";
import { Octokit } from "@octokit/rest";

export type TokenSource = "env" | "gh";
export interface TokenCandidate {
  token: string;
  source: TokenSource;
}

/**
 * Build the ordered list of token candidates to try. GITHUB_TOKEN comes first
 * (explicit override), then the `gh` CLI keyring token. Crucially, the keyring
 * candidate is kept even when GITHUB_TOKEN is set — so an invalid or expired
 * env token can fall back to a working `gh auth login` instead of silently
 * failing every enrichment call (the failure mode that left every repo's
 * visibility/isFork unset). Duplicate tokens are collapsed.
 *
 * Pure (no I/O) so it can be unit-tested; callers pass the resolved values.
 */
export function tokenCandidates(
  envToken: string | undefined,
  ghToken: string | null
): TokenCandidate[] {
  const out: TokenCandidate[] = [];
  if (envToken) out.push({ token: envToken, source: "env" });
  if (ghToken && ghToken !== envToken) out.push({ token: ghToken, source: "gh" });
  return out;
}

function ghAuthToken(): string | null {
  try {
    // `gh auth token` honors GITHUB_TOKEN/GH_TOKEN and would just echo them back
    // — so an invalid env token would shadow the real keyring login and defeat
    // the fallback. Strip them from the subprocess env to force the keyring.
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    const tok = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env,
    }).trim();
    return tok || null;
  } catch {
    return null;
  }
}

function candidates(): TokenCandidate[] {
  return tokenCandidates(process.env.GITHUB_TOKEN, ghAuthToken());
}

/**
 * Pick the first candidate token that actually authenticates. Each candidate is
 * verified with a cheap getAuthenticated() call, so a rejected env token
 * (401/403) falls back to the gh keyring instead of failing every per-repo
 * request. Returns null when no candidate works (scan then runs offline).
 * Result is cached for the process.
 */
let cachedOctokit: { octokit: Octokit | null } | undefined;
async function resolveOctokit(): Promise<Octokit | null> {
  if (cachedOctokit !== undefined) return cachedOctokit.octokit;
  const cands = candidates();
  for (const c of cands) {
    const octokit = new Octokit({ auth: c.token });
    try {
      await octokit.rest.users.getAuthenticated();
      cachedOctokit = { octokit };
      return octokit;
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      const label = c.source === "env" ? "GITHUB_TOKEN" : "gh auth";
      if (status === 401 || status === 403) {
        const more = c.source === "env" && cands.length > 1;
        console.warn(
          `atlas: GitHub token from ${label} was rejected (${status})` +
            (more ? " — falling back to gh keyring." : ".")
        );
        continue;
      }
      // Network/other fault: don't burn the remaining candidates on a transient.
      console.warn(`atlas: GitHub auth check via ${label} failed (${status ?? "error"}).`);
      break;
    }
  }
  cachedOctokit = { octokit: null };
  return null;
}

export interface RepoEnrichment {
  visibility: "public" | "private";
  isFork: boolean;
  isArchived: boolean;
  language: string | null;
  stars: number;
  openIssues: number;
  openPrs: number | null;
  defaultBranch: string;
  pushedAt: string | null;
  description: string | null;
}

export interface EnrichTarget {
  slug: string;
  owner: string;
  repo: string;
}

export function hasGitHubToken(): boolean {
  return candidates().length > 0;
}

/** Run async tasks with bounded concurrency to stay friendly to rate limits. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Enrich repos with GitHub facts. Returns an empty map (and a console note)
 * when no token is present, so a scan still succeeds fully offline.
 */
export async function enrichRepos(
  targets: EnrichTarget[]
): Promise<Map<string, RepoEnrichment>> {
  const map = new Map<string, RepoEnrichment>();
  if (targets.length === 0) return map;
  const octokit = await resolveOctokit();
  if (!octokit) {
    console.warn(
      "atlas: no working GitHub token (GITHUB_TOKEN or `gh auth login`) — skipping enrichment (visibility, stars, forks). Local git facts still scanned."
    );
    return map;
  }

  await pool(targets, 6, async (t) => {
    try {
      const { data } = await octokit.rest.repos.get({ owner: t.owner, repo: t.repo });
      // Best-effort open-PR count; tolerate failure (private/permission/rate).
      let openPrs: number | null = null;
      try {
        const prs = await octokit.rest.pulls.list({
          owner: t.owner,
          repo: t.repo,
          state: "open",
          per_page: 100,
        });
        openPrs = prs.data.length;
      } catch {
        openPrs = null;
      }
      const openIssuesTotal = data.open_issues_count ?? 0;
      map.set(t.slug, {
        visibility: data.private ? "private" : "public",
        isFork: Boolean(data.fork),
        isArchived: Boolean(data.archived),
        language: data.language ?? null,
        stars: data.stargazers_count ?? 0,
        // open_issues_count includes PRs; subtract to isolate true issues.
        openIssues: openPrs === null ? openIssuesTotal : Math.max(0, openIssuesTotal - openPrs),
        openPrs,
        defaultBranch: data.default_branch ?? "main",
        pushedAt: data.pushed_at ?? null,
        description: data.description ?? null,
      });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status !== 404) {
        console.warn(`atlas: GitHub enrichment failed for ${t.owner}/${t.repo} (${status ?? "error"})`);
      }
    }
  });

  return map;
}
