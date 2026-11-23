import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";

/**
 * The scan records each directory it finds holding a .git as a repo of its
 * own, so a second clone of a GitHub repository (a worktree or scratch checkout
 * beside the clone named after it) is a second row with the same owner and
 * repoName. The public snapshot publishes one card per GitHub repository: the
 * row whose directory name is the repository's name, else the row with the
 * greatest lastCommitAt, else the row with the smallest slug. A row without a
 * repoName is in no group and is published.
 *
 * Same isolation as snapshot-branch-withheld.test.ts: the Node test runner runs
 * each test FILE in its own process, so ATLAS_DATA_DIR, the chdir to a temp
 * config dir and the module-level loadConfig cache stay inside this file. The
 * databases are temp files seeded below; no clone, no token.
 */

const work = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-onecard-work-"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-onecard-data-"));
const caseDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-onecard-case-"));
const origCwd = process.cwd();

interface SeedRow {
  slug: string;
  name: string;
  repoName: string | null;
  lastCommitAt: string | null;
  owner?: string;
}

// Three clones of testorg/tool, two of testorg/other, one row without a
// GitHub name. Every row is public, not a fork, and owned by testorg.
const CLONES: SeedRow[] = [
  { slug: "testorg-tool", name: "tool", repoName: "tool", lastCommitAt: "2026-01-01T00:00:00.000Z" },
  { slug: "testorg-tool-scratch", name: "tool-scratch", repoName: "tool", lastCommitAt: "2026-03-01T00:00:00.000Z" },
  { slug: "testorg-tool-copy-7", name: "tool-copy-7", repoName: "tool", lastCommitAt: "2026-02-01T00:00:00.000Z" },
  { slug: "testorg-other-a", name: "other-a", repoName: "other", lastCommitAt: "2026-01-05T00:00:00.000Z" },
  { slug: "testorg-other-b", name: "other-b", repoName: "other", lastCommitAt: "2026-02-05T00:00:00.000Z" },
  { slug: "testorg-loose", name: "loose", repoName: null, lastCommitAt: "2026-01-01T00:00:00.000Z" },
];
const KEPT = ["testorg-loose", "testorg-other-b", "testorg-tool"];
const DROPPED = ["testorg-tool-scratch", "testorg-tool-copy-7", "testorg-other-a"];

// The letter case of the group key and of the directory-name rule, a null
// lastCommitAt, and a tie on lastCommitAt. The tie's larger slug is inserted
// first, so the first row seen is not the row the rule keeps.
const EDGES: SeedRow[] = [
  { slug: "testorg-mixed", name: "mixed", owner: "TestOrg", repoName: "Mixed", lastCommitAt: "2026-01-01T00:00:00.000Z" },
  { slug: "testorg-mixed-copy", name: "mixed-copy", repoName: "mixed", lastCommitAt: "2026-04-01T00:00:00.000Z" },
  { slug: "testorg-same-b", name: "same-b", repoName: "same", lastCommitAt: "2026-01-01T00:00:00.000Z" },
  { slug: "testorg-same-a", name: "same-a", repoName: "same", lastCommitAt: "2026-01-01T00:00:00.000Z" },
  { slug: "testorg-dated-copy", name: "dated-copy", repoName: "dated", lastCommitAt: "2026-01-01T00:00:00.000Z" },
  { slug: "testorg-a-undated", name: "a-undated", repoName: "dated", lastCommitAt: null },
];

function seed(dir: string, rows: SeedRow[]): void {
  const db = new Database(path.join(dir, "atlas.db"));
  initSchema(db);
  const repo = db.prepare(
    "INSERT INTO repos (slug, name, path, owner, repoName, visibility, isFork, lastCommitAt) VALUES (?,?,?,?,?,?,?,?)"
  );
  const event = db.prepare(
    "INSERT INTO activity (id, repoSlug, type, title, ts) VALUES (?,?,?,?,?)"
  );
  for (const r of rows) {
    repo.run(r.slug, r.name, `/x/${r.name}`, r.owner ?? "testorg", r.repoName, "public", 0, r.lastCommitAt);
    event.run(`commit-${r.slug}`, r.slug, "commit", `a commit in ${r.name}`, r.lastCommitAt ?? "2026-01-01T00:00:00.000Z");
  }
  db.close();
}

async function snapshotOf(dir: string) {
  process.env.ATLAS_DATA_DIR = dir;
  const { generatePublicSnapshot } = await import("@/lib/snapshot");
  return generatePublicSnapshot();
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
  process.chdir(work);
  seed(dataDir, CLONES);
  seed(caseDir, EDGES);
});

after(() => {
  process.chdir(origCwd);
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(caseDir, { recursive: true, force: true });
});

test("the public snapshot carries one card per GitHub repository", async () => {
  const snap = await snapshotOf(dataDir);
  // The named directory wins over a newer clone; without a named directory the
  // newest commit wins; a row without a GitHub name is kept.
  assert.deepEqual(snap.repos.map((r) => r.slug).sort(), KEPT);
});

test("the repo counts count GitHub repositories, not clones", async () => {
  const snap = await snapshotOf(dataDir);
  assert.equal(snap.stats.repoCount, 3);
  assert.equal(snap.stats.publicCount, 3);
});

test("activity of a clone that is not published is not published", async () => {
  const snap = await snapshotOf(dataDir);
  for (const s of DROPPED) {
    assert.ok(
      !snap.activity.some((e) => e.repoSlug === s),
      `an activity event of the unpublished clone ${s} is published`
    );
  }
  // Non-vacuous: the published cards keep their own activity.
  assert.deepEqual(snap.activity.map((e) => e.repoSlug).sort(), KEPT);
});

test("owner, repoName and the directory name compare in lower case; a null lastCommitAt ranks lowest; a tie goes to the smallest slug", async () => {
  const snap = await snapshotOf(caseDir);
  assert.deepEqual(snap.repos.map((r) => r.slug).sort(), [
    "testorg-dated-copy",
    "testorg-mixed",
    "testorg-same-a",
  ]);
});
