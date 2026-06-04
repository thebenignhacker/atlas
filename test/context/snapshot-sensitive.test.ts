import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";

/**
 * End-to-end snapshot test for the SENSITIVE never-publish boundary and session
 * privacy. The Node test runner isolates each test FILE in its own process, so
 * setting ATLAS_DATA_DIR, chdir-ing to a temp config dir, and the module-level
 * loadConfig cache are all safe here and don't bleed into other test files.
 */

const work = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-snap-work-"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-snap-data-"));
const origCwd = process.cwd();

function seed(): void {
  const db = new Database(path.join(dataDir, "atlas.db"));
  initSchema(db);
  const repo = db.prepare(
    "INSERT INTO repos (slug, name, path, owner, visibility, isFork) VALUES (?,?,?,?,?,?)"
  );
  repo.run("pub-repo", "pub-repo", "/x/pub-repo", "testorg", "public", 0);
  repo.run("secret-repo", "secret-repo", "/x/secret-repo", "testorg", "public", 0);

  const now = "2026-01-01T00:00:00.000Z";
  const card = db.prepare(
    `INSERT INTO context_cards
       (id, project, repoSlug, subject, claim, derivedAt, lastVerifiedAt, freshness,
        status, visibility, sensitive, originSessionId)
     VALUES (@id,@project,@repoSlug,@subject,@claim,@derivedAt,@lastVerifiedAt,@freshness,
        @status,@visibility,@sensitive,@originSessionId)`
  );
  // Publishable, but its detail quotes a distinctive token that belongs to a
  // sensitive card — the snapshot must redact that token (HIGH-2).
  card.run({
    id: "pub:open-fact",
    project: "pub-repo",
    repoSlug: "pub-repo",
    subject: "open fact",
    claim: "safe to publish but mentions prod-db-pw-7f3a inline",
    derivedAt: now,
    lastVerifiedAt: now,
    freshness: "fresh",
    status: "active",
    visibility: "public",
    sensitive: 0,
    originSessionId: "sess-xyz-9999",
  });
  // Excluded: flagged sensitive (public repo, but never-publish).
  card.run({
    id: "pub:secret-fact",
    project: "pub-repo",
    repoSlug: "pub-repo",
    subject: "secret fact",
    claim: "INTERNAL ONLY do not leak distinctive-secret-string prod-db-pw-7f3a",
    derivedAt: now,
    lastVerifiedAt: now,
    freshness: "fresh",
    status: "active",
    visibility: "public",
    sensitive: 1,
    originSessionId: null,
  });
  // Excluded: under a sensitive repo (by repoSlug), not itself flagged.
  card.run({
    id: "under:secret-repo-card",
    project: "secret-repo",
    repoSlug: "secret-repo",
    subject: "under sensitive repo",
    claim: "also must not leak",
    derivedAt: now,
    lastVerifiedAt: now,
    freshness: "fresh",
    status: "active",
    visibility: "public",
    sensitive: 0,
    originSessionId: null,
  });
  // Excluded: private (pre-existing behavior).
  card.run({
    id: "pub:private-fact",
    project: "pub-repo",
    repoSlug: "pub-repo",
    subject: "private fact",
    claim: "owner only",
    derivedAt: now,
    lastVerifiedAt: now,
    freshness: "fresh",
    status: "active",
    visibility: "private",
    sensitive: 0,
    originSessionId: null,
  });

  db.prepare(
    "INSERT INTO sessions (id, startedAt, repos, branches, cardCount, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)"
  ).run("sess-xyz-9999", now, JSON.stringify(["pub-repo"]), JSON.stringify([]), 1, now, now);
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
      // Deliberately mixed-case to prove loadConfig canonicalizes to slug form
      // (a raw "Secret-Repo" must still match the stored slug "secret-repo").
      sensitiveRepos: ["Secret-Repo"],
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

test("public snapshot drops sensitive repos and their cards", async () => {
  const { generatePublicSnapshot } = await import("@/lib/snapshot");
  const snap = generatePublicSnapshot();

  const repoSlugs = snap.repos.map((r) => r.slug);
  assert.ok(repoSlugs.includes("pub-repo"), "public repo should be present");
  assert.ok(!repoSlugs.includes("secret-repo"), "sensitive repo must be dropped");

  const cardIds = snap.contextCards.map((c) => c.id);
  assert.deepEqual(cardIds, ["pub:open-fact"], "only the one publishable card survives");

  // Origin session id must be stripped from the public card.
  assert.equal(snap.contextCards[0].originSessionId, null);

  // Metrics describe exactly the published cards — no private/sensitive leakage.
  assert.equal(snap.contextMetrics.totalCards, 1);
  const freshnessSum = Object.values(snap.contextMetrics.freshness).reduce(
    (a, b) => a + b,
    0
  );
  assert.equal(freshnessSum, 1);

  // Hard string assertions: no sensitive identifiers anywhere in the payload.
  const json = JSON.stringify(snap);
  assert.ok(!json.includes("secret-repo"), "sensitive repo name must not appear");
  assert.ok(
    !json.includes("distinctive-secret-string"),
    "sensitive card claim text must not appear"
  );
  assert.ok(!json.includes("sess-xyz-9999"), "session id must not appear");
  // A distinctive token from a sensitive card, quoted inside a PUBLISHABLE card,
  // must be redacted (HIGH-2). The publishable card itself still ships.
  assert.ok(
    !json.includes("prod-db-pw-7f3a"),
    "sensitive token quoted in a public card must be redacted"
  );
  assert.equal(cardIds.length, 1, "the publishable card still ships");
});

test("owner snapshot retains sensitive cards and the session registry", async () => {
  const { generateOwnerSnapshot } = await import("@/lib/snapshot");
  const snap = generateOwnerSnapshot({ ok: false, reason: "test" });

  const ids = snap.contextCards.map((c) => c.id);
  assert.ok(ids.includes("pub:secret-fact"), "owner view keeps sensitive cards");
  assert.ok(ids.includes("under:secret-repo-card"));
  assert.ok(ids.includes("pub:private-fact"), "owner view keeps private cards");

  assert.equal(snap.sessions.length, 1);
  assert.equal(snap.sessions[0].id, "sess-xyz-9999");
});
