import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";
import {
  addCard,
  getCards,
  getCard,
  verifyCards,
} from "@/lib/context/store";
import { getMetrics } from "@/lib/context/metrics";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function tmpFile(contents: string): string {
  const p = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "ctx-")),
    "manifest.txt"
  );
  fs.writeFileSync(p, contents);
  return p;
}

function caughtEvents(db: Database.Database): number {
  return (
    db
      .prepare("SELECT count(*) n FROM context_events WHERE kind='caught_stale'")
      .get() as { n: number }
  ).n;
}

test("born-checkable rule: uncheckable card is rejected", () => {
  const db = freshDb();
  assert.throws(
    () => addCard(db, { project: "p", subject: "s", claim: "c" }),
    /uncheckable/
  );
});

test("provenance card: add fresh, drift on source change, caught exactly once", () => {
  const db = freshDb();
  const file = tmpFile("v1");
  const cwd = path.dirname(file);

  const card = addCard(db, {
    project: "demo",
    subject: "manifest version",
    claim: "manifest is v1",
    sourcePaths: ["manifest.txt"],
    cwd,
  });
  assert.equal(card.freshness, "fresh");
  assert.equal(caughtEvents(db), 0);

  // Mutate the source: the next read must catch it.
  fs.writeFileSync(file, "v2");
  const [drifted] = getCards(db, { project: "demo" }, { recomputeDrift: true, cwd });
  assert.equal(drifted.freshness, "drifted");
  assert.deepEqual(drifted.driftedPaths, [file]);
  assert.equal(caughtEvents(db), 1, "one catch logged on fresh->drifted");

  // Reading again while still drifted must NOT double-count.
  getCards(db, { project: "demo" }, { recomputeDrift: true, cwd });
  assert.equal(caughtEvents(db), 1, "no double counting on repeat read");

  assert.equal(getMetrics(db).staleCaught, 1);
});

test("provenance card stays fresh while sources are stable, ignoring TTL", () => {
  const db = freshDb();
  const file = tmpFile("v1");
  const cwd = path.dirname(file);
  addCard(db, {
    project: "demo",
    subject: "stable fact",
    claim: "still true",
    sourcePaths: ["manifest.txt"],
    staleAfterDays: 0, // would expire by time, but stable sources keep it fresh
    cwd,
  });
  const [c] = getCards(db, { project: "demo" }, { recomputeDrift: true, cwd });
  assert.equal(c.freshness, "fresh");
  assert.equal(caughtEvents(db), 0);
});

test("verify-only card expires past TTL, then re-verify clears it", () => {
  const db = freshDb();
  // A card backed only by a passing command, derived 40 days ago, TTL 30.
  addCard(db, {
    project: "svc",
    subject: "health",
    claim: "service responds",
    verifyCommand: "true",
    staleAfterDays: 30,
  });
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  db.prepare("UPDATE context_cards SET lastVerifiedAt=? WHERE id=?").run(
    old,
    "svc:health"
  );

  // Passive read does not re-run the command -> TTL bites -> expired (caught).
  const [expired] = getCards(db, { project: "svc" }, { recomputeDrift: true });
  assert.equal(expired.freshness, "expired");
  assert.equal(caughtEvents(db), 1);

  // Explicit verify re-runs 'true' (passes) -> confirmed now -> fresh again.
  const { results } = verifyCards(db, { id: "svc:health" });
  assert.equal(results[0].freshness, "fresh");
  // The catch count is sticky (a real catch happened); it does not decrement.
  assert.equal(getMetrics(db).staleCaught, 1);
});

test("verify failure flips a fresh card to stale and is caught", () => {
  const db = freshDb();
  addCard(db, {
    project: "svc",
    subject: "endpoint",
    claim: "returns 200",
    verifyCommand: "true",
  });
  assert.equal(getCard(db, "svc:endpoint")!.freshness, "fresh");

  // Point the command at a failing check and verify.
  db.prepare("UPDATE context_cards SET verifyCommand='false' WHERE id=?").run(
    "svc:endpoint"
  );
  const { results, caught } = verifyCards(db, { id: "svc:endpoint" });
  assert.equal(results[0].freshness, "stale");
  assert.equal(caught, 1);
  assert.equal(getMetrics(db).staleCaught, 1);
});

test("freshOnly filter hides flagged cards", () => {
  const db = freshDb();
  const file = tmpFile("v1");
  const cwd = path.dirname(file);
  addCard(db, {
    project: "demo",
    subject: "good",
    claim: "ok",
    sourcePaths: ["manifest.txt"],
    cwd,
  });
  addCard(db, {
    project: "demo",
    subject: "weak",
    claim: "maybe",
    confidence: "unverified",
  });
  const all = getCards(db, { project: "demo" }, { recomputeDrift: true, cwd });
  const fresh = getCards(
    db,
    { project: "demo", freshOnly: true },
    { recomputeDrift: true, cwd }
  );
  assert.equal(all.length, 2);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].subject, "good");
});
