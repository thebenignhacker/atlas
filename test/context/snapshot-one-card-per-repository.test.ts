import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";

/**
 * The scan records each directory it finds holding a .git as a repo of its
 * own, so a second clone of a GitHub repository (a worktree or scratch checkout
 * beside the clone named after it) is a second row with the same owner and
 * repoName. The public snapshot publishes one card per GitHub repository, on
 * the row whose directory name is the repository's name, else the row with the
 * newest lastCommitAt, else the row with the smallest slug. The card shows the
 * last commit of the clone with the newest lastCommitAt, and the feed files the
 * events of each clone under the card. A row without a repoName is in no group
 * and is published.
 *
 * Same isolation as snapshot-branch-withheld.test.ts: the Node test runner runs
 * each test FILE in its own process, so ATLAS_DATA_DIR, the chdir to a temp
 * config dir and the module-level loadConfig cache stay inside this file. The
 * databases are temp files seeded below; no clone, no token.
 */

const work = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-onecard-work-"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-onecard-data-"));
const caseDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-onecard-case-"));
const newestDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-onecard-newest-"));
const origCwd = process.cwd();

interface SeedRow {
  slug: string;
  name: string;
  repoName: string | null;
  lastCommitAt: string | null;
  owner?: string;
  lastCommitMsg?: string;
  commitCount30d?: number;
  // The clone's commits, recorded as the scan records them: an id hashed from
  // the clone's slug and the sha, and a meta naming the sha and the clone's
  // directory. A commit without a sha gets a meta naming the directory alone,
  // which the scan does not write. A row without commits gets one event with
  // no meta.
  commits?: { sha?: string; title: string; ts: string }[];
}

// The id the scan gives a commit event (lib/scanners/activity.ts).
const eventId = (slug: string, sha: string): string =>
  createHash("md5").update(`${slug}:${sha}`).digest("hex");

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

// A card that would show an older clone than the newest one, in both ways, and
// a commit two clones hold. testorg/open: the clone in the named directory has
// the older last commit. testorg/other: no clone in the named directory, and
// the clone whose time is the greater as text is the older one:
// 2026-03-02T01:00:00+00:00 is 01:00 UTC, 2026-03-01T23:30:00-07:00 is 06:30
// UTC. testorg/shared: both clones hold the commit "shared base".
const NEWEST: SeedRow[] = [
  {
    slug: "testorg-open", name: "open", repoName: "open",
    lastCommitAt: "2026-01-01T00:00:00+00:00", lastCommitMsg: "january commit", commitCount30d: 1,
    commits: [{ sha: "aaaa0001", title: "january commit", ts: "2026-01-01T00:00:00+00:00" }],
  },
  {
    slug: "testorg-open-copy", name: "open-copy", repoName: "open",
    lastCommitAt: "2026-02-01T00:00:00+00:00", lastCommitMsg: "february commit", commitCount30d: 2,
    commits: [
      { sha: "bbbb0002", title: "february commit", ts: "2026-02-01T00:00:00+00:00" },
      { title: "a commit with no sha", ts: "2026-01-15T00:00:00+00:00" },
    ],
  },
  {
    slug: "testorg-other-utc", name: "other-utc", repoName: "other",
    lastCommitAt: "2026-03-02T01:00:00+00:00", lastCommitMsg: "utc commit", commitCount30d: 3,
    commits: [{ sha: "cccc0003", title: "utc commit", ts: "2026-03-02T01:00:00+00:00" }],
  },
  {
    slug: "testorg-other-mst", name: "other-mst", repoName: "other",
    lastCommitAt: "2026-03-01T23:30:00-07:00", lastCommitMsg: "mst commit", commitCount30d: 4,
    commits: [{ sha: "dddd0004", title: "mst commit", ts: "2026-03-01T23:30:00-07:00" }],
  },
  {
    slug: "testorg-shared", name: "shared", repoName: "shared",
    lastCommitAt: "2026-04-02T00:00:00+00:00", lastCommitMsg: "fix in shared", commitCount30d: 2,
    commits: [
      { sha: "eeee0005", title: "fix in shared", ts: "2026-04-02T00:00:00+00:00" },
      { sha: "ffff0006", title: "shared base", ts: "2026-04-01T00:00:00+00:00" },
    ],
  },
  {
    slug: "testorg-shared-wt", name: "shared-wt", repoName: "shared",
    lastCommitAt: "2026-04-03T00:00:00+00:00", lastCommitMsg: "feature in worktree", commitCount30d: 2,
    commits: [
      { sha: "99990007", title: "feature in worktree", ts: "2026-04-03T00:00:00+00:00" },
      { sha: "ffff0006", title: "shared base", ts: "2026-04-01T00:00:00+00:00" },
    ],
  },
];

function seed(dir: string, rows: SeedRow[]): void {
  const db = new Database(path.join(dir, "atlas.db"));
  initSchema(db);
  const repo = db.prepare(
    "INSERT INTO repos (slug, name, path, owner, repoName, visibility, isFork, lastCommitAt, lastCommitMsg, commitCount30d) VALUES (?,?,?,?,?,?,?,?,?,?)"
  );
  const event = db.prepare(
    "INSERT INTO activity (id, repoSlug, type, title, ts, meta) VALUES (?,?,?,?,?,?)"
  );
  for (const r of rows) {
    repo.run(
      r.slug, r.name, `/x/${r.name}`, r.owner ?? "testorg", r.repoName, "public", 0,
      r.lastCommitAt, r.lastCommitMsg ?? null, r.commitCount30d ?? 0
    );
    if (r.commits === undefined) {
      event.run(`commit-${r.slug}`, r.slug, "commit", `a commit in ${r.name}`, r.lastCommitAt ?? "2026-01-01T00:00:00.000Z", null);
      continue;
    }
    for (const c of r.commits) {
      const meta = c.sha === undefined ? { repo: r.name } : { sha: c.sha, repo: r.name };
      event.run(eventId(r.slug, c.sha ?? c.title), r.slug, "commit", c.title, c.ts, JSON.stringify(meta));
    }
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
  seed(newestDir, NEWEST);
});

after(() => {
  process.chdir(origCwd);
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(caseDir, { recursive: true, force: true });
  fs.rmSync(newestDir, { recursive: true, force: true });
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

test("activity of a clone that is not a card is published under its repository's card", async () => {
  const snap = await snapshotOf(dataDir);
  for (const s of DROPPED) {
    assert.ok(
      !snap.activity.some((e) => e.repoSlug === s),
      `an activity event is published under ${s}, which is not a card`
    );
  }
  // Each seeded row has one event of its own, a different commit in each: the
  // three tool clones' events go to testorg-tool, the two other clones' events
  // to testorg-other-b.
  assert.deepEqual(snap.activity.map((e) => e.repoSlug).sort(), [
    "testorg-loose",
    "testorg-other-b",
    "testorg-other-b",
    "testorg-tool",
    "testorg-tool",
    "testorg-tool",
  ]);
});

test("owner, repoName and the directory name compare in lower case; a null lastCommitAt ranks lowest; a tie goes to the smallest slug", async () => {
  const snap = await snapshotOf(caseDir);
  assert.deepEqual(snap.repos.map((r) => r.slug).sort(), [
    "testorg-dated-copy",
    "testorg-mixed",
    "testorg-same-a",
  ]);
});

test("a card shows the newest last commit among its repository's published clones", async () => {
  const snap = await snapshotOf(newestDir);
  // The clone in the named directory gives the card its slug and name; the
  // clone with the newer commit gives it its last commit and 30-day count.
  assert.deepEqual(
    snap.repos
      .filter((r) => r.repoName === "open")
      .map((r) => [r.slug, r.name, r.lastCommitAt, r.lastCommitMsg, r.commitCount30d]),
    [["testorg-open", "open", "2026-02-01T00:00:00+00:00", "february commit", 2]]
  );
});

test("the last-commit times of two clones compare as instants, not as text", async () => {
  const snap = await snapshotOf(newestDir);
  assert.deepEqual(
    snap.repos
      .filter((r) => r.repoName === "other")
      .map((r) => [r.slug, r.lastCommitAt, r.lastCommitMsg, r.commitCount30d]),
    [["testorg-other-mst", "2026-03-01T23:30:00-07:00", "mst commit", 4]]
  );
});

test("the feed carries each published clone's events under its repository's card, and a commit two clones hold once", async () => {
  const snap = await snapshotOf(newestDir);
  const titles = (card: string): string[] =>
    snap.activity
      .filter((e) => e.repoSlug === card)
      .map((e) => e.title)
      .sort();
  assert.deepEqual(titles("testorg-open"), ["a commit with no sha", "february commit", "january commit"]);
  assert.deepEqual(titles("testorg-other-mst"), ["mst commit", "utc commit"]);
  assert.deepEqual(titles("testorg-shared"), ["feature in worktree", "fix in shared", "shared base"]);
  assert.equal(snap.activity.length, 8);
  assert.equal(snap.stats.activityCount, 8);
  // The copy of the shared commit that is published is the card's own clone's.
  assert.deepEqual(
    snap.activity.filter((e) => e.title === "shared base").map((e) => e.id),
    [eventId("testorg-shared", "ffff0006")]
  );
});

test("an event from another clone names the card in its meta, not that clone's directory", async () => {
  const snap = await snapshotOf(newestDir);
  const meta = (title: string): unknown =>
    JSON.parse(snap.activity.find((e) => e.title === title)?.meta ?? "null");
  assert.deepEqual(meta("february commit"), { sha: "bbbb0002", repo: "open" });
  assert.deepEqual(meta("utc commit"), { sha: "cccc0003", repo: "other-mst" });
  assert.deepEqual(meta("feature in worktree"), { sha: "99990007", repo: "shared" });
  // A meta that records no sha is not passed on: it named the clone's directory.
  assert.equal(meta("a commit with no sha"), null);
  const json = JSON.stringify(snap);
  for (const dir of ["open-copy", "other-utc", "shared-wt"]) {
    assert.ok(!json.includes(dir), `${dir}, the directory of a clone that is not a card, is published`);
  }
});
