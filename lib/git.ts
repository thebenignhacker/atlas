import { execFileSync } from "node:child_process";

/** Run a git command in `cwd`, returning trimmed stdout or null on failure. */
function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1024 * 1024 * 8,
    }).trim();
  } catch {
    return null;
  }
}

export interface LocalGitInfo {
  branch: string | null;
  remoteUrl: string | null;
  lastCommitAt: string | null; // ISO 8601
  lastCommitSha: string | null;
  lastCommitMsg: string | null;
  commitCount30d: number;
  dirty: boolean;
  ahead: number;
  behind: number;
}

export function readGitInfo(repoPath: string): LocalGitInfo {
  const branch = git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const remoteUrl = git(repoPath, ["config", "--get", "remote.origin.url"]);

  // Last commit: ISO date, sha, subject — null-byte separated to be safe.
  const lastLine = git(repoPath, ["log", "-1", "--format=%cI%x00%H%x00%s"]);
  let lastCommitAt: string | null = null;
  let lastCommitSha: string | null = null;
  let lastCommitMsg: string | null = null;
  if (lastLine) {
    const [iso, sha, msg] = lastLine.split("\0");
    lastCommitAt = iso || null;
    lastCommitSha = sha || null;
    lastCommitMsg = msg || null;
  }

  const count30 = git(repoPath, [
    "rev-list",
    "--count",
    "--since=30.days",
    "HEAD",
  ]);
  const commitCount30d = count30 ? parseInt(count30, 10) || 0 : 0;

  const status = git(repoPath, ["status", "--porcelain"]);
  const dirty = status !== null && status.length > 0;

  // ahead/behind vs upstream, if an upstream is configured.
  let ahead = 0;
  let behind = 0;
  const counts = git(repoPath, [
    "rev-list",
    "--left-right",
    "--count",
    "@{u}...HEAD",
  ]);
  if (counts) {
    const [b, a] = counts.split(/\s+/);
    behind = parseInt(b, 10) || 0;
    ahead = parseInt(a, 10) || 0;
  }

  return {
    branch,
    remoteUrl,
    lastCommitAt,
    lastCommitSha,
    lastCommitMsg,
    commitCount30d,
    dirty,
    ahead,
    behind,
  };
}

/** Recent commits for the activity feed. */
export interface RecentCommit {
  sha: string;
  at: string;
  subject: string;
}

export function readRecentCommits(repoPath: string, sinceDays = 30): RecentCommit[] {
  const out = git(repoPath, [
    "log",
    `--since=${sinceDays}.days`,
    "--format=%H%x00%cI%x00%s",
    "--max-count=100",
  ]);
  if (!out) return [];
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, at, subject] = line.split("\0");
      return { sha, at, subject };
    });
}

/** Parse `owner` and `repo` out of an https or ssh GitHub remote URL. */
export function parseGitHubRemote(
  remoteUrl: string | null
): { owner: string; repo: string } | null {
  if (!remoteUrl) return null;
  // git@github.com:owner/repo.git  OR  https://github.com/owner/repo(.git)
  const m = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}
