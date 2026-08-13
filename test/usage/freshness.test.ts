import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";
import {
  freshnessLabel,
  freshnessTone,
  lagDays,
  liveSection,
} from "@/lib/freshness-shared";
import type { SectionFreshness } from "@/lib/freshness-shared";

/**
 * Regression cover for "the dashboard reported its own build time as the age of
 * the data". Each test below fails on the pre-fix code.
 *
 * The Node test runner isolates each test FILE in its own process, so
 * ATLAS_DATA_DIR, the chdir, and the module-level loadConfig cache are safe here.
 */

const work = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-fresh-work-"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-fresh-data-"));
const origCwd = process.cwd();

/** Mining ran three weeks ago; the snapshot is being built right now. */
const MINED_AT = "2026-07-22T19:31:01.259Z";
const NEWEST_EVENT = "2026-07-22T19:30:49.571Z";
/** The private card is written AFTER the public one, on purpose. */
const PUBLIC_CARD_AT = "2026-08-10T08:00:00.000Z";
const PRIVATE_CARD_AT = "2026-08-12T20:00:00.000Z";
/** A PRIVATE repo's commit time. The only published repo is deliberately left
 *  undated so the "no published timestamp" branch is actually reached. */
const PRIVATE_REPO_COMMIT_AT = "2026-08-11T17:45:31.913Z";

function seed(): void {
  const db = new Database(path.join(dataDir, "atlas.db"));
  initSchema(db);
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
    "usageScannedAt",
    MINED_AT
  );
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
    "lastScanAt",
    "2026-08-12T00:33:35.000Z"
  );
  db.prepare(
    "INSERT INTO tool_events (id, sessionId, ts, feature, category, project, howInvoked, paramKeys, cwd, gitBranch, scannedAt, sourceFile) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(
    "evt-1",
    "sess-1",
    NEWEST_EVENT,
    "Bash",
    "exec",
    "atlas",
    "direct",
    "[]",
    null,
    null,
    MINED_AT,
    "/x/sess-1.jsonl"
  );
  const repo = db.prepare(
    "INSERT INTO repos (slug, name, path, owner, visibility, isFork, lastCommitAt) VALUES (?,?,?,?,?,?,?)"
  );
  // The published repo carries NO commit date and the private one does. That is
  // what forces the "no published row has a timestamp" branch — with any dated
  // published row the branch is unreachable and a test of it measures nothing.
  repo.run("pub-repo", "pub-repo", "/x/pub-repo", "testorg", "public", 0, null);
  repo.run("priv-repo", "priv-repo", "/x/priv-repo", "testorg", "private", 0, PRIVATE_REPO_COMMIT_AT);

  // Two cards where the PRIVATE one is written LATER. A freshness clock taken
  // from the database-wide max would carry the private write time into the
  // public artifact; only a fixture ordered this way can catch that.
  const card = db.prepare(
    `INSERT INTO context_cards
       (id, project, repoSlug, subject, claim, derivedAt, lastVerifiedAt, freshness,
        status, visibility, sensitive, createdAt, updatedAt)
     VALUES (@id,@project,@repoSlug,@subject,@claim,@derivedAt,@lastVerifiedAt,@freshness,
        @status,@visibility,@sensitive,@createdAt,@updatedAt)`
  );
  const base = {
    project: "pub-repo",
    repoSlug: "pub-repo",
    derivedAt: PUBLIC_CARD_AT,
    lastVerifiedAt: PUBLIC_CARD_AT,
    freshness: "fresh",
    status: "active",
    sensitive: 0,
  };
  card.run({
    ...base,
    id: "pub:card",
    subject: "published fact",
    claim: "safe to publish",
    visibility: "public",
    createdAt: PUBLIC_CARD_AT,
    updatedAt: PUBLIC_CARD_AT,
  });
  // A PUBLISHED card with NO updatedAt. This is what makes the fallback branch
  // reachable: with every published card carrying a timestamp, the code path
  // that reaches for the database-wide clock is never taken, and a test that
  // never reaches it cannot fail when that clock leaks.
  card.run({
    ...base,
    id: "pub:card-no-timestamp",
    subject: "published, undated",
    claim: "safe to publish",
    visibility: "public",
    createdAt: PUBLIC_CARD_AT,
    updatedAt: null,
  });
  card.run({
    ...base,
    id: "priv:card",
    subject: "withheld fact",
    claim: "owner only",
    visibility: "private",
    createdAt: PRIVATE_CARD_AT,
    updatedAt: PRIVATE_CARD_AT,
  });
  db.close();
}

before(() => {
  fs.writeFileSync(
    path.join(work, "atlas.config.json"),
    JSON.stringify({
      scanRoots: [],
      todoDirs: [],
      github: { user: "tester", orgs: [] },
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

// ---------------------------------------------------------------------------
// The defect itself
// ---------------------------------------------------------------------------

test("snapshot reports the MINING clock as usage data age, not the build time", async () => {
  const { generatePublicSnapshot } = await import("@/lib/snapshot");
  const snap = generatePublicSnapshot();
  const usage = snap.freshness.usage;

  // The pre-fix read path returned `usage.generatedAt`, which rollup sets to the
  // build instant — so this assertion is the whole bug in one line.
  assert.notEqual(
    usage.collectedAt,
    snap.generatedAt.slice(0, 10),
    "usage freshness must not be the snapshot build time"
  );
  assert.equal(usage.collectedAt, MINED_AT.slice(0, 10));
  assert.equal(usage.dataAt, NEWEST_EVENT.slice(0, 10));
  // ...and the build clock is still recorded, separately, so a stale artifact
  // can be identified as stale rather than inferred to be current.
  assert.equal(usage.builtAt, snap.generatedAt);
  assert.notEqual(usage.collectedAt, usage.builtAt);
});

test("every published section carries its own age, all stamped one build instant", async () => {
  const { generatePublicSnapshot } = await import("@/lib/snapshot");
  const snap = generatePublicSnapshot();
  for (const name of ["repos", "activity", "usage", "context"]) {
    assert.ok(snap.freshness[name], `section ${name} missing from freshness`);
    assert.equal(
      snap.freshness[name].builtAt,
      snap.generatedAt,
      `${name}.builtAt must equal the snapshot's own generatedAt`
    );
  }
});

test("public freshness omits owner-only sections entirely", async () => {
  const { generatePublicSnapshot } = await import("@/lib/snapshot");
  const snap = generatePublicSnapshot();
  // Presence alone would disclose that private todos/sessions exist and when
  // they were last touched, so absence is asserted, not emptiness.
  for (const ownerOnly of ["todos", "sessions", "roadmap", "strategy"]) {
    assert.equal(
      snap.freshness[ownerOnly],
      undefined,
      `owner-only section ${ownerOnly} leaked into the public freshness`
    );
  }
});

test("public context freshness never discloses private card write timing", async () => {
  const { generatePublicSnapshot } = await import("@/lib/snapshot");
  const snap = generatePublicSnapshot();
  const ctx = snap.freshness.context;
  // Only one card is publishable in this fixture; the private one is newer.
  // Both clocks must come from the published card, or the timestamp itself
  // reports that something private was touched afterwards.
  assert.equal(ctx.count, snap.contextCards.length);
  assert.equal(
    ctx.collectedAt,
    ctx.dataAt,
    "context has no separate collector; a differing clock can only come from unpublished rows"
  );
  const publishedMax = snap.contextCards
    .map((c) => c.updatedAt)
    .filter(Boolean)
    .sort()
    .pop();
  assert.equal(ctx.dataAt, publishedMax ?? null);
});

test("with no published timestamp, dataAt is null rather than a private row's clock", async () => {
  const { generatePublicSnapshot } = await import("@/lib/snapshot");
  const snap = generatePublicSnapshot();

  // Precondition, asserted rather than assumed: if a published repo ever gains a
  // commit date this fixture stops reaching the branch, and this test would go
  // green while measuring nothing.
  assert.deepEqual(
    snap.repos.map((r) => r.lastCommitAt),
    [null],
    "fixture must publish exactly one repo with no commit date"
  );
  assert.equal(
    snap.freshness.repos.dataAt,
    null,
    "no published row carries a timestamp, so there is no honest dataAt"
  );
  assert.equal(
    JSON.stringify(snap).includes(PRIVATE_REPO_COMMIT_AT),
    false,
    "a private repo's commit time leaked into the public snapshot"
  );
  assert.equal(
    JSON.stringify(snap).includes(PRIVATE_CARD_AT),
    false,
    "a private card's write time leaked into the public snapshot"
  );
});

test("public usage clocks are date-only, matching the rollup's own precision", async () => {
  const { generatePublicSnapshot } = await import("@/lib/snapshot");
  const usage = generatePublicSnapshot().freshness.usage;
  assert.match(usage.collectedAt ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.match(usage.dataAt ?? "", /^\d{4}-\d{2}-\d{2}$/);
});

// ---------------------------------------------------------------------------
// Rendering: a stale section must not be able to look current
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-12T21:00:00.000Z");

function section(over: Partial<SectionFreshness> = {}): SectionFreshness {
  return {
    dataAt: "2026-08-12T09:00:00.000Z",
    collectedAt: "2026-08-12T09:00:00.000Z",
    builtAt: "2026-08-12T21:00:00.000Z",
    status: "ok",
    count: 10,
    note: null,
    ...over,
  };
}

test("a section collected 21 days ago renders degraded however new the build is", () => {
  const stale = section({ dataAt: NEWEST_EVENT, collectedAt: MINED_AT });
  assert.equal(freshnessTone(stale, NOW), "degraded");
  // Rebuilding the artifact must not improve the tone — the pre-fix page got
  // "fresh" purely because someone re-ran the snapshot.
  const rebuilt = section({
    dataAt: NEWEST_EVENT,
    collectedAt: MINED_AT,
    builtAt: NOW.toISOString(),
  });
  assert.equal(freshnessTone(rebuilt, NOW), "degraded");
});

test("tone tracks the collection clock across the staleness scale", () => {
  assert.equal(freshnessTone(section(), NOW), "fresh");
  assert.equal(
    freshnessTone(section({ collectedAt: "2026-08-08T09:00:00.000Z" }), NOW),
    "ok"
  );
  assert.equal(
    freshnessTone(section({ collectedAt: "2026-07-01T09:00:00.000Z" }), NOW),
    "degraded"
  );
});

test("missing freshness is 'unavailable', never quietly treated as fresh", () => {
  assert.equal(freshnessTone(null, NOW), "unknown");
  assert.equal(freshnessTone(undefined, NOW), "unknown");
  assert.equal(freshnessLabel(null, NOW), "freshness unavailable");
});

test("did-not-run, ran-and-found-nothing and ran-and-errored read differently", () => {
  const never = freshnessLabel(
    section({ status: "never", collectedAt: null, dataAt: null, count: 0 }),
    NOW
  );
  const empty = freshnessLabel(section({ status: "empty", count: 0 }), NOW);
  const errored = freshnessLabel(section({ status: "error" }), NOW);

  assert.equal(never, "never collected");
  assert.match(empty, /found nothing/);
  assert.match(errored, /failed/);
  // The point of the requirement: three distinct strings, not one.
  assert.equal(new Set([never, empty, errored]).size, 3);
});

test("a large gap between collection and newest datum is surfaced in the label", () => {
  const dead = section({ dataAt: NEWEST_EVENT, collectedAt: NOW.toISOString() });
  assert.equal(lagDays(dead), 21);
  // A collector that runs every 10 minutes over frozen events keeps its own
  // clock fresh; the label must still say what the data actually covers.
  assert.match(freshnessLabel(dead, NOW), /data through .* · checked/);
});

test("liveSection marks build-time reads as collected at build time", () => {
  const live = liveSection("2026-08-12T21:00:00.000Z", 18);
  assert.equal(live.dataAt, live.collectedAt);
  assert.equal(live.collectedAt, live.builtAt);
  assert.equal(live.status, "ok");
  assert.equal(liveSection("2026-08-12T21:00:00.000Z", 0).status, "empty");
});
