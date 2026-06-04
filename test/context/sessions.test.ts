import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";
import {
  addCard,
  registerSession,
  updateSession,
  getSession,
  getSessions,
} from "@/lib/context/store";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function tmpFile(contents: string): string {
  const p = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "sess-")),
    "manifest.txt"
  );
  fs.writeFileSync(p, contents);
  return p;
}

test("registerSession is idempotent and preserves startedAt", () => {
  const db = freshDb();
  const first = registerSession(db, { id: "sid-1", startedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(first.id, "sid-1");
  assert.equal(first.startedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(first.cardCount, 0);

  // A second register must not move startedAt or reset accumulated state.
  const again = registerSession(db, { id: "sid-1", startedAt: "2026-02-02T00:00:00.000Z" });
  assert.equal(again.startedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(getSessions(db).length, 1);
});

test("adding a card under a session attributes it and accumulates repos + count", () => {
  const db = freshDb();
  const file = tmpFile("v1");
  const cwd = path.dirname(file);

  const c1 = addCard(db, {
    project: "alpha",
    subject: "fact one",
    claim: "x",
    sourcePaths: ["manifest.txt"],
    originSessionId: "sid-2",
    repoSlug: "alpha-repo",
    cwd,
  });
  assert.equal(c1.originSessionId, "sid-2");

  // Session auto-registered by the add, repo + project recorded, count = 1.
  const s = getSession(db, "sid-2")!;
  assert.ok(s, "session should be auto-registered");
  assert.equal(s.cardCount, 1);
  assert.ok(s.repos.includes("alpha"));
  assert.ok(s.repos.includes("alpha-repo"));

  // A second distinct card bumps the count and unions repos (deduped).
  addCard(db, {
    project: "beta",
    subject: "fact two",
    claim: "y",
    sourcePaths: ["manifest.txt"],
    originSessionId: "sid-2",
    cwd,
  });
  const s2 = getSession(db, "sid-2")!;
  assert.equal(s2.cardCount, 2);
  assert.ok(s2.repos.includes("beta"));

  // Re-adding the SAME subject (an update, not a new card) must not double-count.
  addCard(db, {
    project: "alpha",
    subject: "fact one",
    claim: "x updated",
    sourcePaths: ["manifest.txt"],
    originSessionId: "sid-2",
    repoSlug: "alpha-repo",
    cwd,
  });
  assert.equal(getSession(db, "sid-2")!.cardCount, 2);
});

test("updateSession sets summary and branches", () => {
  const db = freshDb();
  registerSession(db, { id: "sid-3" });
  const s = updateSession(db, "sid-3", {
    summary: "shipped the sensitive flag",
    branches: ["feat/x", "feat/y"],
  })!;
  assert.equal(s.summary, "shipped the sensitive flag");
  assert.deepEqual(s.branches, ["feat/x", "feat/y"]);
});

test("getSessions returns most-recent-first", () => {
  const db = freshDb();
  registerSession(db, { id: "old", startedAt: "2026-01-01T00:00:00.000Z" });
  registerSession(db, { id: "new", startedAt: "2026-03-03T00:00:00.000Z" });
  const ids = getSessions(db).map((s) => s.id);
  assert.deepEqual(ids, ["new", "old"]);
});
