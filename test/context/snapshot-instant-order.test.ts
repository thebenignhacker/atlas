import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";
import { ACTIVITY_NEWEST_FIRST, newestFirst } from "@/lib/util/date";

/**
 * The scan records commit times with the committer's UTC offset (git log
 * --format=%cI), so text order and time order can disagree:
 * 2026-03-02T01:00:00+00:00 is 01:00 UTC and 2026-03-01T23:30:00-07:00 is
 * 06:30 UTC, five and a half hours later, yet it is the smaller as text. The
 * public snapshot's cards and its activity feed are ordered by instant.
 *
 * Same isolation as snapshot-one-card-per-repository.test.ts: the Node test
 * runner runs each test FILE in its own process, so ATLAS_DATA_DIR, the chdir
 * to a temp config dir and the module-level loadConfig cache stay inside this
 * file. The database is a temp file seeded below; no clone, no token.
 */

const work = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-order-work-"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-order-data-"));
const origCwd = process.cwd();

const ALPHA_AT = "2026-03-02T01:00:00+00:00";
const BETA_AT = "2026-03-01T23:30:00-07:00";
// Between the two as an instant (03:00 UTC), and greater than both as text.
const GAMMA_AT = "2026-03-02T03:00:00Z";

const ROWS = [
  { slug: "testorg-alpha", name: "alpha", lastCommitAt: ALPHA_AT },
  { slug: "testorg-beta", name: "beta", lastCommitAt: BETA_AT },
  { slug: "testorg-gamma", name: "gamma", lastCommitAt: GAMMA_AT },
  { slug: "testorg-undated", name: "undated", lastCommitAt: null },
];

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
  const db = new Database(path.join(dataDir, "atlas.db"));
  initSchema(db);
  const repo = db.prepare(
    "INSERT INTO repos (slug, name, path, owner, repoName, visibility, isFork, lastCommitAt) VALUES (?,?,?,?,?,?,?,?)"
  );
  const event = db.prepare(
    "INSERT INTO activity (id, repoSlug, type, title, ts, meta) VALUES (?,?,?,?,?,?)"
  );
  for (const r of ROWS) {
    repo.run(r.slug, r.name, `/x/${r.name}`, "testorg", r.name, "public", 0, r.lastCommitAt);
    if (r.lastCommitAt !== null) {
      event.run(`commit-${r.slug}`, r.slug, "commit", `${r.name} commit`, r.lastCommitAt, null);
    }
  }
  db.close();
});

after(() => {
  process.chdir(origCwd);
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function snapshot() {
  process.env.ATLAS_DATA_DIR = dataDir;
  const { generatePublicSnapshot } = await import("@/lib/snapshot");
  return generatePublicSnapshot();
}

test("the public snapshot lists cards by last-commit instant, latest first, an undated card last", async () => {
  const snap = await snapshot();
  assert.deepEqual(
    snap.repos.map((r) => r.slug),
    ["testorg-beta", "testorg-gamma", "testorg-alpha", "testorg-undated"]
  );
});

test("the public snapshot's activity feed is ordered by event instant, latest first", async () => {
  const snap = await snapshot();
  assert.deepEqual(
    snap.activity.map((e) => e.title),
    ["beta commit", "gamma commit", "alpha commit"]
  );
});

test("the public snapshot's freshness dataAt is the latest commit instant, not the text maximum", async () => {
  const snap = await snapshot();
  assert.equal(snap.freshness.repos.dataAt, BETA_AT);
  assert.equal(snap.freshness.activity.dataAt, BETA_AT);
});

test("the owner snapshot's freshness dataAt is the latest commit instant, not the text maximum", async () => {
  process.env.ATLAS_DATA_DIR = dataDir;
  const { generateOwnerSnapshot } = await import("@/lib/snapshot");
  const snap = generateOwnerSnapshot({ ok: false, reason: "test" });
  assert.equal(snap.freshness.repos.dataAt, BETA_AT);
  assert.equal(snap.freshness.activity.dataAt, BETA_AT);
});

test("newestFirst orders times written with different UTC offsets by instant", () => {
  assert.deepEqual(
    [ALPHA_AT, null, GAMMA_AT, BETA_AT, "not a time"].sort(newestFirst),
    [BETA_AT, GAMMA_AT, ALPHA_AT, null, "not a time"]
  );
  // The same instant in two offsets compares equal.
  assert.equal(newestFirst("2026-03-02T01:00:00+00:00", "2026-03-01T18:00:00-07:00"), 0);
});

test("ACTIVITY_NEWEST_FIRST orders a query's rows by instant and puts an unparseable ts last", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE activity (id TEXT PRIMARY KEY, ts TEXT)");
    const ins = db.prepare("INSERT INTO activity (id, ts) VALUES (?, ?)");
    ins.run("alpha", ALPHA_AT);
    ins.run("bad", "not a time");
    ins.run("beta", BETA_AT);
    ins.run("gamma", GAMMA_AT);
    const ids = (
      db.prepare(`SELECT id FROM activity ORDER BY ${ACTIVITY_NEWEST_FIRST} LIMIT 3`).all() as {
        id: string;
      }[]
    ).map((r) => r.id);
    assert.deepEqual(ids, ["beta", "gamma", "alpha"]);
  } finally {
    db.close();
  }
});
