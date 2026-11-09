import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";

/**
 * The public snapshot publishes a repo's defaultBranch (GitHub's answer) and
 * withholds `branch`, the clone's checked-out branch: local working state named
 * by whoever last ran git checkout. The publish gate is not part of this
 * control and must keep refusing a hidden name carried inside a branch-shaped
 * token, so the last test pins its match.
 *
 * Same isolation as snapshot-sensitive.test.ts: the Node test runner runs each
 * test FILE in its own process, so ATLAS_DATA_DIR, the chdir to a temp config
 * dir and the module-level loadConfig cache stay inside this file. The
 * database is a temp file seeded below; no clone, no token.
 */

const work = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-branch-work-"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-branch-data-"));
const origCwd = process.cwd();

const HIDDEN = "fork-sdk";
const CHECKED_OUT = "fleet/T-1-sdk-fork-sdkversion";

function seed(): void {
  const db = new Database(path.join(dataDir, "atlas.db"));
  initSchema(db);
  const repo = db.prepare(
    "INSERT INTO repos (slug, name, path, owner, visibility, isFork, branch, defaultBranch) VALUES (?,?,?,?,?,?,?,?)"
  );
  // Public and not a fork: published, checked out on a non-default branch.
  repo.run("pub-repo", "pub-repo", "/x/pub-repo", "testorg", "public", 0, CHECKED_OUT, "main");
  // A public fork: in the gate's hidden set (private OR fork), never published.
  repo.run(HIDDEN, HIDDEN, "/x/fork-sdk", "testorg", "public", 1, null, null);
  db.close();
}

before(() => {
  fs.writeFileSync(
    path.join(work, "atlas.config.json"),
    JSON.stringify({
      scanRoots: [],
      scanDepth: 2,
      todoDirs: [],
      github: { user: "tester", orgs: [] },
      exclude: [],
      publicOwners: ["testorg"],
      sensitiveRepos: [],
    })
  );
  process.env.ATLAS_DATA_DIR = dataDir;
  process.chdir(work);
  seed();
});

after(() => {
  process.chdir(origCwd);
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("public snapshot withholds the clone's checked-out branch and publishes the default branch", async () => {
  const { generatePublicSnapshot } = await import("@/lib/snapshot");
  const snap = generatePublicSnapshot();
  const repo = snap.repos.find((r) => r.slug === "pub-repo");
  assert.ok(repo, "the public non-fork repo is published");
  assert.equal(repo.branch, null, "branch is local working state and is not published");
  assert.equal(repo.defaultBranch, "main", "defaultBranch is GitHub's answer and is published");
});

test("the publish gate's hidden-name match finds nothing in the public snapshot", async () => {
  const { generatePublicSnapshot, hiddenNameLeak } = await import("@/lib/snapshot");
  const snap = generatePublicSnapshot();
  // Non-vacuous: the snapshot carries the seeded public repo, so "nothing
  // found" is a statement about published text, not about an empty snapshot.
  assert.ok(snap.repos.some((r) => r.slug === "pub-repo"), "the public repo is published");
  assert.equal(hiddenNameLeak(HIDDEN, JSON.stringify(snap), new Set(["pub-repo"])), null);
});

test("the publish gate's hidden-name match still refuses a hidden name inside a branch token", async () => {
  const { hiddenNameLeak } = await import("@/lib/snapshot");
  assert.equal(hiddenNameLeak(HIDDEN, CHECKED_OUT, new Set()), "T-1-sdk-fork-sdkversion");
});
