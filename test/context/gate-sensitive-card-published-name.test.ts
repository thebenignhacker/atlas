import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";

/**
 * A distinctive token of a sensitive context card that is the name of a
 * published repository. lib/snapshot leaves that name as written, and the
 * artifact carries it as the published card's own name, so a gate that refused
 * the token would stop every snapshot while the sensitive card exists.
 *
 * Every test runs the real publish gate against a seeded database and asserts
 * on its exit status, the violations it prints and the artifact it writes.
 */

const repoRoot = process.cwd();
const dirs: string[] = [];

after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

interface Card {
  id: string;
  project: string;
  subject: string;
  claim: string;
  visibility: "public" | "private";
  sensitive: 0 | 1;
}

/** The private card flagged sensitive, with the given claim. */
const hosting = (claim: string): Card => ({
  id: "tooling:hosting",
  project: "tooling",
  subject: "hosting",
  claim,
  visibility: "private",
  sensitive: 1,
});

/** Seed otherorg/docs-site (public, in the directory docs-site) and
 *  testorg/other (private, listed in sensitiveRepos), the given cards, and the
 *  given commit titles on otherorg/docs-site; run the real publish gate; and
 *  return its exit status, its violations and its artifact. */
function runGate(opts: { cards: Card[]; commits?: string[] }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-gate-card-"));
  const dataDir = path.join(work, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  dirs.push(work);

  fs.writeFileSync(
    path.join(work, "atlas.config.json"),
    JSON.stringify({
      scanRoots: [],
      todoDirs: [],
      github: { user: "tester", orgs: [] },
      publicOwners: ["otherorg"],
      sensitiveRepos: ["testorg-other"],
    })
  );

  const at = "2026-01-10T00:00:00.000Z";
  const db = new Database(path.join(dataDir, "atlas.db"));
  initSchema(db);
  const repo = db.prepare(
    "INSERT INTO repos (slug, name, path, owner, repoName, visibility, isFork, lastCommitAt) VALUES (?,?,?,?,?,?,?,?)"
  );
  repo.run("otherorg-docs-site", "docs-site", "/x/docs-site", "otherorg", "docs-site", "public", 0, at);
  repo.run("testorg-other", "other", "/x/other", "testorg", "other", "private", 0, at);
  const event = db.prepare(
    "INSERT INTO activity (id, repoSlug, type, title, ts) VALUES (?,?,?,?,?)"
  );
  for (const title of opts.commits ?? []) {
    // A hash, as the scan makes an event id (lib/scanners/activity.ts).
    const id = createHash("md5").update(`otherorg-docs-site:${title}`).digest("hex");
    event.run(id, "otherorg-docs-site", "commit", title, at);
  }
  const card = db.prepare(
    `INSERT INTO context_cards (id, project, repoSlug, subject, claim, derivedAt, lastVerifiedAt,
       freshness, status, visibility, sensitive, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  for (const c of opts.cards)
    card.run(c.id, c.project, null, c.subject, c.claim, at, at, "fresh", "active", c.visibility, c.sensitive, at, at);
  db.close();

  // Run from the repo root (tsconfig `@/` aliases resolve against cwd) with the
  // config, database and output path taken from ATLAS_ROOT and ATLAS_DATA_DIR.
  const r = spawnSync("npx", ["tsx", "scripts/snapshot.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ATLAS_ROOT: work, ATLAS_DATA_DIR: dataDir },
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const file = path.join(work, "public-snapshot.json");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  return {
    status: r.status ?? -1,
    out,
    // The gate prints each violation on a line of its own, after "  - ".
    violations: out
      .split("\n")
      .filter((l) => l.startsWith("  - "))
      .map((l) => l.slice(4)),
    text,
    snapshot:
      text === null
        ? null
        : (JSON.parse(text) as {
            repos: { slug: string }[];
            activity: { title: string }[];
            contextCards: { id: string }[];
          }),
  };
}

test("a sensitive card that names a published repository does not stop the snapshot", () => {
  // The card's one distinctive token, docs-site, is the name of the published
  // otherorg/docs-site.
  const r = runGate({
    cards: [hosting("the docs-site moves to the new host")],
    commits: ["fix the docs-site build", "release docs-site-v2"],
  });
  assert.equal(r.status, 0, `the gate must write the snapshot; got:\n${r.out}`);
  assert.ok(r.snapshot && r.text !== null, "the artifact must be written");
  assert.deepEqual(r.snapshot.repos.map((x) => x.slug), ["otherorg-docs-site"]);
  // The sensitive card stays withheld.
  assert.deepEqual(r.snapshot.contextCards.map((c) => c.id), []);
  assert.ok(!r.text.includes("tooling:hosting"), "the sensitive card's id must not appear");
  assert.ok(!r.text.includes("moves to the new host"), "the sensitive card's claim must not appear");
  // lib/snapshot redacts neither the published name nor a token extending it,
  // and the gate writes them.
  assert.deepEqual(r.snapshot.activity.map((e) => e.title).sort(), [
    "fix the docs-site build",
    "release docs-site-v2",
  ]);
});

test("a sensitive card that names a published repository in another letter case does not stop the snapshot", () => {
  const r = runGate({
    cards: [hosting("the Docs-Site moves to the new host")],
    commits: ["fix the docs-site build"],
  });
  assert.equal(r.status, 0, `the gate must write the snapshot; got:\n${r.out}`);
  assert.ok(r.snapshot, "the artifact must be written");
  assert.deepEqual(r.snapshot.contextCards.map((c) => c.id), []);
  // lib/snapshot keeps a token that is a published card's name in any letter case.
  assert.deepEqual(r.snapshot.activity.map((e) => e.title), ["fix the docs-site build"]);
});

test("the gate still refuses the other distinctive tokens of a sensitive card that names a published repository", () => {
  // sanitizeCard redacts a published card's subject, claim and detail, not its
  // project, so the gate is the check between new-edge-host and the artifact.
  const r = runGate({
    cards: [
      hosting("the docs-site moves to new-edge-host"),
      {
        id: "tooling:edge",
        project: "new-edge-host",
        subject: "edge",
        claim: "a published card",
        visibility: "public",
        sensitive: 0,
      },
    ],
  });
  assert.notEqual(r.status, 0, `the gate must refuse; got:\n${r.out}`);
  assert.equal(r.text, null, "no artifact may be written when the gate refuses");
  assert.deepEqual(r.violations, [
    'distinctive sensitive token "new-edge-host" (from card "tooling:hosting") present in snapshot text',
  ]);
});

test("the gate still refuses the claim of a sensitive card that names a published repository, quoted whole", () => {
  // lib/snapshot redacts no token of this claim, as its one distinctive token
  // is a published name, so a published card quoting it publishes it whole.
  const r = runGate({
    cards: [
      hosting("the docs-site moves to the new host"),
      {
        id: "tooling:notes",
        project: "tooling",
        subject: "notes",
        claim: "the docs-site moves to the new host",
        visibility: "public",
        sensitive: 0,
      },
    ],
  });
  assert.notEqual(r.status, 0, `the gate must refuse; got:\n${r.out}`);
  assert.equal(r.text, null, "no artifact may be written when the gate refuses");
  assert.deepEqual(r.violations, ['sensitive card text from "tooling:hosting" present in snapshot']);
});
