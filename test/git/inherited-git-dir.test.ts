import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GIT_ENV } from "./env";
import { bareOrigin, publish, writeUnit } from "../roadmap/git-fixture";

/**
 * Git exports GIT_DIR to a hook that runs from a linked worktree, so `npm test`
 * in a pre-push hook hands it to every test file. The files that run git must
 * still pass there, and leave the repository GIT_DIR names as it was: its HEAD,
 * core.bare, config, refs, worktrees and every other file.
 */

const REPO = path.resolve(__dirname, "..", "..");
const CENSUS = path.join(REPO, "scripts", "roadmap-census.py");

/** Every test file that runs git, itself or through the census script. */
const GIT_TEST_FILES = [
  "test/decisions/parse.test.ts",
  "test/roadmap/census-origin.test.ts",
  "test/roadmap/census-parity.test.ts",
  "test/roadmap/git-fixture.test.ts",
  "test/session-board/board.test.ts",
];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * A developer's repository: a checkout of an origin with a linked worktree on
 * its own branch, which is where a pre-push hook runs. `gitDir` is that
 * worktree's git directory, the GIT_DIR the hook exports.
 */
function developerRepo(root: string): { repo: string; linked: string; gitDir: string } {
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "# repo\n");
  publish(repo, bareOrigin(path.join(root, "repo-origin.git")), ["README.md"]);
  const linked = path.join(root, "repo-worktree");
  git(repo, "worktree", "add", "-q", "-b", "topic", linked);
  return { repo, linked, gitDir: git(linked, "rev-parse", "--absolute-git-dir") };
}

/** Every file under `dirs`, as path -> sha256 of its content. */
function files(...dirs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else out[p] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  dirs.forEach(walk);
  return out;
}

/** What a run must leave as it was. Read-only git commands, so reading it changes nothing. */
function snapshot(repo: string, linked: string) {
  return {
    git: {
      head: git(repo, "rev-parse", "HEAD"),
      worktreeHead: git(linked, "rev-parse", "HEAD"),
      coreBare: git(repo, "config", "--get", "core.bare"),
      config: fs.readFileSync(path.join(repo, ".git", "config"), "utf8"),
      refs: git(repo, "for-each-ref", "--format=%(refname) %(objectname)"),
      worktrees: git(repo, "worktree", "list", "--porcelain"),
    },
    files: files(repo, linked),
  };
}

function assertUnchanged(root: string, before: ReturnType<typeof snapshot>, after: ReturnType<typeof snapshot>): void {
  assert.deepEqual(after.git, before.git, "HEAD, core.bare, config, refs and worktrees are as they were");
  const changed = Object.keys({ ...before.files, ...after.files })
    .filter((p) => before.files[p] !== after.files[p])
    .map((p) => path.relative(root, p));
  assert.deepEqual(changed, [], "no file of the repository changed");
}

test("the test files that run git pass under an inherited GIT_DIR and leave that repository as it was", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-git-dir-"));
  const { repo, linked, gitDir } = developerRepo(root);
  const before = snapshot(repo, linked);

  const env: NodeJS.ProcessEnv = { ...GIT_ENV, GIT_DIR: gitDir };
  // The runner marks the processes it starts with NODE_TEST_CONTEXT; a nested
  // run that inherits it runs no file and still exits 0.
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", ...GIT_TEST_FILES],
    { cwd: REPO, env, encoding: "utf8", timeout: 300_000 }
  );

  assertUnchanged(root, before, snapshot(repo, linked));
  const output = `${run.stdout}\n${run.stderr}`;
  assert.equal(run.status, 0, output.slice(-4000));
  assert.ok(Number(/^# tests (\d+)$/m.exec(run.stdout)?.[1] ?? 0) > 0, output.slice(-4000));
});

test("the census reads each tree's own origin/main under an inherited GIT_DIR and leaves that repository as it was", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-git-dir-"));
  const { repo, linked, gitDir } = developerRepo(root);
  const tree = path.join(root, "tree");
  fs.mkdirSync(tree);
  writeUnit(tree, "u1.md", "ready");
  const origin = bareOrigin(path.join(root, "tree-origin.git"));
  publish(tree, origin, ["roadmap"]);
  const cfg = path.join(root, "atlas.config.json");
  fs.writeFileSync(cfg, JSON.stringify({ todoDirs: [tree] }));
  const before = snapshot(repo, linked);

  const out = execFileSync("python3", [CENSUS, "--json", "--config", cfg], {
    encoding: "utf8",
    env: { ...GIT_ENV, GIT_DIR: gitDir },
  });

  assertUnchanged(root, before, snapshot(repo, linked));
  const rows = out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { file: string; status: string; sha: string });
  assert.deepEqual(
    rows.map((r) => [r.file, r.status, r.sha]),
    [["u1.md", "ready", git(origin, "rev-parse", "main")]],
    "the one unit of the tree's origin/main, read at that sha"
  );
});
