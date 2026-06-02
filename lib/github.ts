import { execFileSync } from "node:child_process";
import { Octokit } from "@octokit/rest";

/**
 * Resolve a GitHub token: prefer GITHUB_TOKEN, else fall back to the `gh` CLI
 * (`gh auth token`) so the scan "just works" for the many devs who use gh.
 * Returns null when neither is available — the scan then runs offline.
 */
let cachedToken: string | null | undefined;
function resolveToken(): string | null {
  if (cachedToken !== undefined) return cachedToken;
  if (process.env.GITHUB_TOKEN) {
    cachedToken = process.env.GITHUB_TOKEN;
    return cachedToken;
  }
  try {
    const tok = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    cachedToken = tok || null;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
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
  return Boolean(resolveToken());
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
  const token = resolveToken();
  if (!token) {
    console.warn(
      "atlas: no GitHub token (GITHUB_TOKEN or `gh auth login`) — skipping enrichment (visibility, stars, forks). Local git facts still scanned."
    );
    return map;
  }
  const octokit = new Octokit({ auth: token });

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
