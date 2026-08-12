import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * One resolver owns every data and artifact path.
 *
 * Two classes of defect are covered. The first is drift — five modules each
 * deriving a path from `process.cwd()`, agreeing only while every entry point
 * happened to run from the repo root. The second is silent creation: opening a
 * SQLite database creates it, so a caller that resolved the wrong directory got
 * a fresh empty store and wrote to it without error.
 */

const ENV_KEYS = ["ATLAS_DATA_DIR", "ATLAS_HOME", "ATLAS_ROOT", "OWNER_SNAPSHOT_PATH"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const tmpDirs: string[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-paths-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

process.on("exit", () => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// --- resolution order -------------------------------------------------------

test("ATLAS_ROOT anchors every path without moving anything", async () => {
  const root = tmp();
  process.env.ATLAS_ROOT = root;
  delete process.env.ATLAS_DATA_DIR;
  delete process.env.ATLAS_HOME;
  const p = await import("@/lib/paths");

  // Nothing has moved: data still lives beside the app, config and the public
  // artifact still live in the repo.
  assert.equal(p.dataDir(), path.join(root, "data"));
  assert.equal(p.dbPath(), path.join(root, "data", "atlas.db"));
  assert.equal(p.configPath(), path.join(root, "atlas.config.json"));
  assert.equal(p.publicSnapshotPath(), path.join(root, "public-snapshot.json"));
  assert.equal(p.ownerSnapshotPath(), path.join(root, "owner-snapshot.json"));
});

test("ATLAS_DATA_DIR wins over ATLAS_HOME, which wins over the root", async () => {
  const root = tmp();
  const home = tmp();
  const data = tmp();
  const p = await import("@/lib/paths");

  process.env.ATLAS_ROOT = root;
  delete process.env.ATLAS_HOME;
  delete process.env.ATLAS_DATA_DIR;
  assert.equal(p.dataDir(), path.join(root, "data"));

  process.env.ATLAS_HOME = home;
  assert.equal(p.dataDir(), path.join(home, "data"));

  process.env.ATLAS_DATA_DIR = data;
  assert.equal(p.dataDir(), data);
});

test("session state follows the data directory, not the repo", async () => {
  const root = tmp();
  const data = tmp();
  const p = await import("@/lib/paths");
  process.env.ATLAS_ROOT = root;
  process.env.ATLAS_DATA_DIR = data;

  // The original defect: the database was redirected while `.current-session`
  // stayed pinned to the repo, so card writes lost their session attribution
  // and nothing failed.
  assert.equal(p.sessionStateFile(), path.join(data, ".current-session"));
  assert.notEqual(p.sessionStateFile(), path.join(root, "data", ".current-session"));
});

test("paths are resolved per call, never frozen at module load", async () => {
  const a = tmp();
  const b = tmp();
  const p = await import("@/lib/paths");
  process.env.ATLAS_ROOT = a;
  const first = p.publicSnapshotPath();
  process.env.ATLAS_ROOT = b;
  // Module-load constants read one file and wrote another whenever an entry
  // point resolved its root after import.
  assert.notEqual(p.publicSnapshotPath(), first);
  assert.equal(p.publicSnapshotPath(), path.join(b, "public-snapshot.json"));
});

// --- the legacy session-state interlock -------------------------------------

test("a stale session-state file at the old location is reported, not guessed", async () => {
  const root = tmp();
  const data = tmp();
  const p = await import("@/lib/paths");
  process.env.ATLAS_ROOT = root;
  process.env.ATLAS_DATA_DIR = data;

  assert.equal(p.legacySessionStateFile(), null, "nothing stale yet");

  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", ".current-session"), "old-session-id\n");
  assert.equal(
    p.legacySessionStateFile(),
    path.join(root, "data", ".current-session"),
    "a leftover file at the old location must be surfaced"
  );
});

test("the legacy check does not fire when both locations are the same file", async () => {
  const root = tmp();
  const p = await import("@/lib/paths");
  process.env.ATLAS_ROOT = root;
  delete process.env.ATLAS_DATA_DIR;
  delete process.env.ATLAS_HOME;
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", ".current-session"), "id\n");
  // Nothing has moved, so the file we would read IS the file we found. Warning
  // here would fire on every normal install.
  assert.equal(p.legacySessionStateFile(), null);
});

// --- getDb refuses to create ------------------------------------------------

test("getDb refuses to create a database and leaves no file behind", async () => {
  const data = tmp();
  process.env.ATLAS_DATA_DIR = data;
  const { getDb } = await import("@/lib/db");

  assert.throws(() => getDb(), /refusing to create one here/);
  // The check must not have created it as a side effect of looking.
  assert.equal(
    fs.existsSync(path.join(data, "atlas.db")),
    false,
    "a failed getDb must not leave a half-made store behind"
  );
});

test("createDb is the one path that makes a database", async () => {
  const data = tmp();
  process.env.ATLAS_DATA_DIR = data;
  // Fresh module registry so the cached connection from the previous test does
  // not satisfy this one — otherwise it would pass without creating anything.
  const { createDb, initSchema } = await import(`@/lib/db?fresh=${data}`);
  const db = createDb();
  initSchema(db);
  assert.ok(fs.existsSync(path.join(data, "atlas.db")));
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[]
  ).map((t) => t.name);
  assert.ok(tables.includes("context_cards"));
  db.close();
});

test("a database created elsewhere is opened, not shadowed by a new one", async () => {
  const data = tmp();
  const seeded = new Database(path.join(data, "atlas.db"));
  seeded.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  seeded.prepare("INSERT INTO meta VALUES (?,?)").run("marker", "seeded");
  seeded.close();

  process.env.ATLAS_DATA_DIR = data;
  const { getDb } = await import(`@/lib/db?fresh=${data}`);
  const row = getDb().prepare("SELECT value FROM meta WHERE key='marker'").get() as
    | { value: string }
    | undefined;
  assert.equal(row?.value, "seeded", "must open the existing store, not replace it");
});
