import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";
import { addCard, getCard } from "@/lib/context/store";
import { getMetricsForCards } from "@/lib/context/metrics";
import { isCardPublishable, distinctiveTokens } from "@/lib/snapshot";
import type { ContextCard } from "@/lib/types";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function tmpFile(contents: string): string {
  const p = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "sens-")),
    "manifest.txt"
  );
  fs.writeFileSync(p, contents);
  return p;
}

/** Minimal card for predicate tests; overrides patch the fields under test. */
function card(over: Partial<ContextCard>): ContextCard {
  return {
    id: "p:s",
    project: "proj",
    repoSlug: null,
    subject: "s",
    claim: "c",
    detail: null,
    provenance: [],
    verifyCommand: null,
    verifyResult: null,
    verifyCheckedAt: null,
    confidence: "medium",
    derivedAt: "2026-01-01T00:00:00.000Z",
    lastVerifiedAt: "2026-01-01T00:00:00.000Z",
    staleAfterDays: null,
    freshness: "fresh",
    driftedPaths: [],
    tags: [],
    links: [],
    status: "active",
    supersededBy: null,
    visibility: "public",
    sensitive: false,
    originSessionId: null,
    createdAt: null,
    updatedAt: null,
    ...over,
  };
}

test("isCardPublishable: a public, active, non-sensitive card is publishable", () => {
  assert.equal(isCardPublishable(card({}), new Set()), true);
});

test("isCardPublishable: private or inactive cards are never publishable", () => {
  assert.equal(isCardPublishable(card({ visibility: "private" }), new Set()), false);
  assert.equal(isCardPublishable(card({ status: "superseded" }), new Set()), false);
  assert.equal(isCardPublishable(card({ status: "retired" }), new Set()), false);
});

test("isCardPublishable: the sensitive flag is a hard never-publish even when public", () => {
  assert.equal(
    isCardPublishable(card({ visibility: "public", sensitive: true }), new Set()),
    false
  );
});

test("isCardPublishable: a card under a sensitive repo (by repoSlug) is excluded", () => {
  const sensitive = new Set(["secret-repo"]);
  assert.equal(
    isCardPublishable(card({ repoSlug: "secret-repo" }), sensitive),
    false
  );
  assert.equal(
    isCardPublishable(card({ repoSlug: "other-repo" }), sensitive),
    true
  );
});

test("isCardPublishable: defensive — project name mapping to a sensitive slug is excluded", () => {
  const sensitive = new Set(["secret-repo"]);
  // No repoSlug set, but the project resolves to the sensitive slug.
  assert.equal(
    isCardPublishable(card({ project: "Secret Repo", repoSlug: null }), sensitive),
    false
  );
});

test("isCardPublishable: a mixed-case repoSlug still matches the normalized sensitive set", () => {
  // The config set is canonicalized to slug form (loadConfig); the card-side
  // value must be normalized too or the exclusion silently fails open.
  const sensitive = new Set(["secret-repo"]);
  assert.equal(
    isCardPublishable(card({ repoSlug: "Secret-Repo" }), sensitive),
    false
  );
});

test("distinctiveTokens keeps separator/long tokens, skips short common words", () => {
  const toks = distinctiveTokens("the prod-db-pw is set and auth works fine");
  assert.ok(toks.includes("prod-db-pw"), "hyphenated secret-ish token kept");
  assert.ok(!toks.includes("auth"), "short common word skipped");
  assert.ok(!toks.includes("the"), "tiny word skipped");
  // A long bare word (>=12) is distinctive even without a separator.
  assert.ok(distinctiveTokens("internalhostname12").includes("internalhostname12"));
  assert.deepEqual(distinctiveTokens(null), []);
});

test("addCard persists the sensitive flag and round-trips as a boolean", () => {
  const db = freshDb();
  const file = tmpFile("v1");
  const cwd = path.dirname(file);
  const created = addCard(db, {
    project: "p",
    subject: "secret",
    claim: "internal only",
    sourcePaths: ["manifest.txt"],
    visibility: "public",
    sensitive: true,
    cwd,
  });
  assert.equal(created.sensitive, true);
  assert.equal(getCard(db, created.id)!.sensitive, true);

  const benign = addCard(db, {
    project: "p",
    subject: "open",
    claim: "fine to publish",
    sourcePaths: ["manifest.txt"],
    visibility: "public",
    cwd,
  });
  assert.equal(benign.sensitive, false);
});

test("getMetricsForCards reports counts for EXACTLY the passed cards (no leakage)", () => {
  const db = freshDb();
  const cards = [
    card({ id: "a:1", freshness: "fresh" }),
    card({ id: "a:2", freshness: "drifted" }),
  ];
  const m = getMetricsForCards(db, cards);
  assert.equal(m.totalCards, 2);
  assert.equal(m.activeCards, 2);
  assert.equal(m.freshness.fresh, 1);
  assert.equal(m.freshness.drifted, 1);
  // Owner-usage stats are never published.
  assert.equal(m.reads, 0);
  assert.equal(m.tokensSavedEstimate, 0);
  // An empty published set discloses nothing.
  const empty = getMetricsForCards(db, []);
  assert.equal(empty.totalCards, 0);
  assert.equal(
    Object.values(empty.freshness).reduce((a, b) => a + b, 0),
    0
  );
});
