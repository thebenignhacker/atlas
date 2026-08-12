import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";

/**
 * Migration cover for databases that already exist.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op against a table that is already there,
 * so a column added to the SCHEMA string never appears on an existing database —
 * and any `CREATE INDEX` on that column inside the same string fails outright,
 * taking `npm run setup-db` down with it. A fresh-database test cannot see this:
 * it creates the table WITH the column and the index succeeds.
 *
 * Every one of these builds the old table shape by hand and then migrates it.
 */

const dirs: string[] = [];

function legacyDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-migrate-"));
  dirs.push(dir);
  const db = new Database(path.join(dir, "atlas.db"));
  // The tool_events shape as it existed before per-file mining tracking, plus
  // the indexes that shipped with it.
  db.exec(`
    CREATE TABLE tool_events (
      id TEXT PRIMARY KEY, sessionId TEXT, ts TEXT, feature TEXT NOT NULL,
      category TEXT, project TEXT, howInvoked TEXT, paramKeys TEXT,
      cwd TEXT, gitBranch TEXT, scannedAt TEXT
    );
    CREATE INDEX idx_tool_events_feature ON tool_events(feature);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  db.prepare(
    "INSERT INTO tool_events (id, sessionId, ts, feature, category, howInvoked, paramKeys, scannedAt) VALUES (?,?,?,?,?,?,?,?)"
  ).run("evt-old", "sess-old", "2026-07-22T19:30:49Z", "Bash", "exec", "direct", "[]", "2026-07-22T19:31:01Z");
  return db;
}

after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const cols = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name
  );

test("initSchema migrates a pre-sourceFile tool_events table without throwing", () => {
  const db = legacyDb();
  assert.ok(!cols(db, "tool_events").includes("sourceFile"), "precondition");

  // The bug: this threw `SqliteError: no such column: sourceFile`, so setup-db
  // could not run at all against any existing database.
  assert.doesNotThrow(() => initSchema(db));

  assert.ok(cols(db, "tool_events").includes("sourceFile"));
  db.close();
});

test("the sourceFile index exists after migrating an existing database", () => {
  const db = legacyDb();
  initSchema(db);
  const idx = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
    .get("idx_tool_events_source");
  assert.ok(idx, "index must be created after the column, not inside SCHEMA");
  db.close();
});

test("migrating preserves existing rows and leaves them re-minable", () => {
  const db = legacyDb();
  initSchema(db);
  const rows = db.prepare("SELECT id, sourceFile FROM tool_events").all() as {
    id: string;
    sourceFile: string | null;
  }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "evt-old");
  // NULL rather than a guessed path: the collector keys its one-time re-mine off
  // exactly this, and inventing a source here would strand the row instead.
  assert.equal(rows[0].sourceFile, null);
  db.close();
});

test("the mining ledger and run log are created on an existing database", () => {
  const db = legacyDb();
  initSchema(db);
  for (const t of ["usage_files", "scan_runs"]) {
    assert.ok(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t),
      `${t} missing after migration`
    );
  }
  db.close();
});

test("initSchema is idempotent — a second run changes nothing and does not throw", () => {
  const db = legacyDb();
  initSchema(db);
  const before = cols(db, "tool_events").join(",");
  assert.doesNotThrow(() => initSchema(db));
  assert.equal(cols(db, "tool_events").join(","), before);
  db.close();
});
