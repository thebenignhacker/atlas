import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readGitInfo, readRecentCommits, repoGitEnv } from "@/lib/git";
import { GIT_ENV } from "./env";

/**
 * Git exports GIT_DIR to a hook that runs from a linked worktree, and git obeys
 * it over the directory a command runs in. A scan started from such a hook must
 * still read each configured repository from its own directory.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function repo(dir: string, branch: string, subject: string): void {
  fs.mkdirSync(dir);
  git(dir, "init", "-q", "-b", branch);
  git(dir, "remote", "add", "origin", `https://github.com/example/${path.basename(dir)}.git`);
  git(dir, "commit", "-q", "--allow-empty", "-m", subject);
}

/** Run `fn` with GIT_DIR set in this process's environment, restoring it after. */
function withGitDir<T>(gitDir: string, fn: () => T): T {
  const prev = process.env.GIT_DIR;
  process.env.GIT_DIR = gitDir;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = prev;
  }
}

test("readGitInfo and readRecentCommits read the repository they are given under an inherited GIT_DIR", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "atlas-repo-env-")));
  const a = path.join(root, "a");
  const b = path.join(root, "b");
  repo(a, "branch-A", "commit in A");
  repo(b, "main", "commit in B");
  const linked = path.join(root, "b-linked");
  git(b, "worktree", "add", "-q", "-b", "wtB", linked);
  const gitDir = git(linked, "rev-parse", "--absolute-git-dir");

  const [info, commits] = withGitDir(gitDir, () => [readGitInfo(a), readRecentCommits(a)] as const);
  assert.equal(info.branch, "branch-A");
  assert.equal(info.remoteUrl, "https://github.com/example/a.git");
  assert.equal(info.lastCommitMsg, "commit in A");
  assert.equal(info.lastCommitSha, git(a, "rev-parse", "HEAD"));
  assert.deepEqual(
    commits.map((c) => c.subject),
    ["commit in A"]
  );
});

test("repoGitEnv drops every variable git names as repository-local, and GIT_NAMESPACE", () => {
  const local = git(process.cwd(), "rev-parse", "--local-env-vars").split("\n").filter(Boolean);
  assert.ok(local.includes("GIT_DIR"), local.join(" "));
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: "/usr/bin", HOME: "/home/x", GIT_NAMESPACE: "ns" };
  for (const name of local) env[name] = "x";

  const out = repoGitEnv(env);
  const kept = local.filter((name) => name in out);
  assert.deepEqual(kept, ["GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"].filter((n) => local.includes(n)));
  assert.equal(out.GIT_NAMESPACE, undefined);
  assert.equal(out.PATH, "/usr/bin");
  assert.equal(out.HOME, "/home/x");
});
