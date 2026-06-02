import fs from "node:fs";
import path from "node:path";
import type { AtlasConfig } from "@/lib/config";
import type { Repo } from "@/lib/types";
import { readGitInfo, parseGitHubRemote } from "@/lib/git";
import { enrichRepos, type EnrichTarget } from "@/lib/github";
import { slugify } from "@/lib/util/format";

/** Find every git repo under a root, up to `maxDepth` levels deep. */
function findRepos(root: string, maxDepth: number, exclude: string[]): string[] {
  const found: string[] = [];
  if (!fs.existsSync(root)) {
    console.warn(`atlas: scan root does not exist: ${root}`);
    return found;
  }

  function walk(dir: string, depth: number) {
    // A directory containing .git is a repo; record it and stop descending.
    if (fs.existsSync(path.join(dir, ".git"))) {
      found.push(dir);
      return;
    }
    if (depth >= maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const name = entry.name;
      if (name.startsWith(".")) continue;
      if (exclude.some((ex) => name === ex || name.startsWith(ex))) continue;
      walk(path.join(dir, name), depth + 1);
    }
  }

  walk(root, 0);
  return found;
}

export interface RepoScanResult {
  repos: Repo[];
  /** Repo paths that resolved to a GitHub remote (for enrichment reporting). */
  githubTargets: number;
}

export async function scanRepos(config: AtlasConfig): Promise<RepoScanResult> {
  const scannedAt = new Date().toISOString();
  const repoPaths = new Set<string>();

  for (const root of config.scanRoots) {
    for (const p of findRepos(root, config.scanDepth, config.exclude)) {
      repoPaths.add(p);
    }
  }

  const repos: Repo[] = [];
  const enrichTargets: EnrichTarget[] = [];

  for (const repoPath of repoPaths) {
    const root = config.scanRoots.find((r) => repoPath.startsWith(r)) ?? "";
    const rel = path.relative(root, repoPath) || path.basename(repoPath);
    const segments = rel.split(path.sep);
    const name = segments[segments.length - 1];
    const groupName = segments.length > 1 ? segments[0] : path.basename(root);
    const slug = slugify(rel);

    const git = readGitInfo(repoPath);
    const gh = parseGitHubRemote(git.remoteUrl);
    if (gh) enrichTargets.push({ slug, owner: gh.owner, repo: gh.repo });

    repos.push({
      slug,
      name,
      path: repoPath,
      groupName,
      remoteUrl: git.remoteUrl,
      owner: gh?.owner ?? null,
      repoName: gh?.repo ?? null,
      branch: git.branch,
      lastCommitAt: git.lastCommitAt,
      lastCommitSha: git.lastCommitSha,
      lastCommitMsg: git.lastCommitMsg,
      commitCount30d: git.commitCount30d,
      dirty: git.dirty ? 1 : 0,
      ahead: git.ahead,
      behind: git.behind,
      visibility: "unknown",
      isFork: null,
      isArchived: null,
      language: null,
      stars: null,
      openIssues: null,
      openPrs: null,
      defaultBranch: null,
      pushedAt: null,
      description: null,
      scannedAt,
    });
  }

  // GitHub enrichment (no-op + warning when no token).
  const enrichment = await enrichRepos(enrichTargets);
  for (const repo of repos) {
    const e = enrichment.get(repo.slug);
    if (!e) continue;
    repo.visibility = e.visibility;
    repo.isFork = e.isFork ? 1 : 0;
    repo.isArchived = e.isArchived ? 1 : 0;
    repo.language = e.language;
    repo.stars = e.stars;
    repo.openIssues = e.openIssues;
    repo.openPrs = e.openPrs;
    repo.defaultBranch = e.defaultBranch;
    repo.pushedAt = e.pushedAt;
    repo.description = e.description;
  }

  return { repos, githubTargets: enrichTargets.length };
}
