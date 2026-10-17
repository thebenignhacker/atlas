import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GIT_ENV, git, gitEnv } from "./git-fixture";

/**
 * The census tests build their repositories with git-fixture.ts. Git exports
 * GIT_DIR to a hook that runs from a linked worktree, so `npm test` in a
 * pre-push hook hands it to the tests. The fixture must still build in its temp
 * directory and leave the repository GIT_DIR names exactly as it was.
 */

const REPO = path.resolve(__dirname, "..", "..");
const FIXTURE = path.join(__dirname, "git-fixture.ts");

/** Every file under `dirs`, as path -> sha256 of its content. */
function snapshot(...dirs: string[]): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else files[p] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  dirs.forEach(walk);
  return files;
}

test("a fixture built under an inherited GIT_DIR leaves that repository unchanged", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-git-fixture-"));
  // The developer's repository: a checkout with one commit and a linked worktree.
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "README.md"), "# repo\n");
  git(repo, "add", "--", "README.md");
  git(repo, "commit", "-q", "-m", "base");
  const linked = path.join(root, "repo-worktree");
  git(repo, "worktree", "add", "-q", "-b", "topic", linked);
  const linkedGitDir = git(linked, "rev-parse", "--absolute-git-dir");
  const before = snapshot(repo, linked);

  // The same fixture calls the census tests make, in a process that inherits GIT_DIR.
  // The process loads the fixture with require: tsx loads it as CommonJS, and on
  // Node 22 an ES module that imports it sees none of its named exports.
  const work = path.join(root, "fixture");
  fs.mkdirSync(work);
  const build = `
    const fs = require("node:fs");
    const path = require("node:path");
    const { bareOrigin, git, publish, writeUnit } = require(${JSON.stringify(FIXTURE)});
    const work = ${JSON.stringify(work)};
    const origin = bareOrigin(path.join(work, "origin.git"));
    const seed = path.join(work, "seed");
    fs.mkdirSync(seed);
    writeUnit(seed, "u1.md", "ready");
    publish(seed, origin, ["roadmap"]);
    git(work, "clone", "-q", origin, path.join(work, "clone"));
  `;
  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=commonjs", "--eval", build], {
    cwd: REPO,
    env: { ...GIT_ENV, GIT_DIR: linkedGitDir },
    encoding: "utf8",
  });

  const after = snapshot(repo, linked);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((p) => before[p] !== after[p])
    .map((p) => path.relative(root, p));
  assert.deepEqual(changed, [], "the repository GIT_DIR names is unchanged, file for file");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(path.join(work, "origin.git"), "ls-tree", "-r", "--name-only", "main"), "roadmap/u1.md");
  assert.equal(git(path.join(work, "clone"), "ls-files"), "roadmap/u1.md");
});

test("the fixture passes on none of the variables that point git at a repository", () => {
  const names = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
  ];
  const env = gitEnv({
    ...process.env,
    CENSUS_TEST_KEPT: "1",
    ...Object.fromEntries(names.map((n) => [n, "/elsewhere"])),
  });
  assert.deepEqual(names.filter((n) => n in env), []);
  assert.equal(env.CENSUS_TEST_KEPT, "1", "every other variable is kept");
  assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
});
