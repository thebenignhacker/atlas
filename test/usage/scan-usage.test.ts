import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

/**
 * End-to-end cover for the usage collector. Drives the REAL script in a child
 * process against a fake home directory rather than stubbing the filesystem —
 * the defects under test (truncate-before-rebuild, zero-reported-as-success)
 * live in the script's control flow, and a stubbed miner would step straight
 * over them.
 *
 * `os.homedir()` reads $HOME on POSIX, which is what makes the transcript root
 * redirectable without a seam in the script.
 *
 * Fails on the pre-fix collector at every assertion marked REGRESSION.
 */

const repoRoot = process.cwd();
const home = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-scan-home-"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-scan-data-"));
const projects = path.join(home, ".claude", "projects");

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScan(env: Record<string, string> = {}): RunResult {
  const r = spawnSync(
    "npx",
    ["tsx", "scripts/scan-usage.ts"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, HOME: home, ATLAS_DATA_DIR: dataDir, ...env },
    }
  );
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function transcript(project: string, session: string, lines: object[]): string {
  const dir = path.join(projects, project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${session}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

function toolLine(session: string, ts: string, tool: string, id: string) {
  return {
    timestamp: ts,
    sessionId: session,
    cwd: "/tmp/workspace/atlas",
    gitBranch: "main",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", name: tool, id, input: { pattern: "x" } }],
    },
  };
}

function db<T>(fn: (d: Database.Database) => T): T {
  const d = new Database(path.join(dataDir, "atlas.db"), { readonly: true });
  try {
    return fn(d);
  } finally {
    d.close();
  }
}

const eventCount = () =>
  db((d) => (d.prepare("SELECT count(*) c FROM tool_events").get() as { c: number }).c);
const meta = (key: string) =>
  db(
    (d) =>
      (d.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
        | { value: string }
        | undefined)?.value ?? null
  );
const lastRunRow = () =>
  db(
    (d) =>
      d
        .prepare(
          "SELECT status, error, note, rowsOut FROM scan_runs WHERE stage = 'scan:usage' AND status != 'running' ORDER BY id DESC LIMIT 1"
        )
        .get() as
        | { status: string; error: string | null; note: string | null; rowsOut: number }
        | undefined
  );

before(() => {
  fs.mkdirSync(projects, { recursive: true });
});

after(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("a first run mines the corpus and records a successful run", () => {
  transcript("proj-a", "sess-1", [
    toolLine("sess-1", "2026-08-01T10:00:00Z", "Bash", "toolu_a1"),
    toolLine("sess-1", "2026-08-01T10:01:00Z", "Read", "toolu_a2"),
  ]);
  transcript("proj-b", "sess-2", [
    toolLine("sess-2", "2026-08-02T10:00:00Z", "Grep", "toolu_b1"),
  ]);

  const r = runScan();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(eventCount(), 3);
  assert.equal(meta("usageEventCount"), "3");
  assert.equal(lastRunRow()?.status, "ok");
});

test("an unchanged corpus is not re-read", () => {
  const r = runScan();
  assert.equal(r.status, 0, r.stderr);
  // REGRESSION: the pre-fix collector re-read every file on every run, having
  // just deleted the table it was about to refill.
  assert.match(r.stdout, /0 new or changed/);
  assert.equal(eventCount(), 3);
});

test("a modified transcript is re-mined and replaces its own rows, not duplicated", () => {
  const file = transcript("proj-a", "sess-1", [
    toolLine("sess-1", "2026-08-01T10:00:00Z", "Bash", "toolu_a1"),
    toolLine("sess-1", "2026-08-01T10:01:00Z", "Read", "toolu_a2"),
    toolLine("sess-1", "2026-08-03T11:00:00Z", "Edit", "toolu_a3"),
  ]);
  // Push mtime forward explicitly: the file was rewritten within the same
  // second on a fast machine, and a same-second rewrite is exactly the case a
  // size-only or mtime-only ledger would miss.
  const future = new Date(Date.now() + 5_000);
  fs.utimesSync(file, future, future);

  const r = runScan();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 new or changed/);
  assert.equal(eventCount(), 4);
  assert.equal(
    db(
      (d) =>
        (d.prepare("SELECT count(*) c FROM tool_events WHERE sourceFile = ?").get(file) as {
          c: number;
        }).c
    ),
    3
  );
});

test("a deleted transcript's events are dropped, and the drop is reported", () => {
  fs.rmSync(path.join(projects, "proj-b", "sess-2.jsonl"));
  const r = runScan();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(eventCount(), 3);
  // A decrease is never allowed to pass silently, even when it is legitimate.
  assert.match(lastRunRow()?.note ?? "", /removed since last scan/);
  assert.match(lastRunRow()?.note ?? "", /fell 4 → 3/);
});

test("REGRESSION: an emptied transcript root fails loudly and preserves the data", () => {
  const before = { count: eventCount(), scannedAt: meta("usageScannedAt") };
  assert.ok(before.count > 0);

  fs.rmSync(path.join(projects, "proj-a"), { recursive: true, force: true });
  const r = runScan();

  // Pre-fix: DELETE ran before the loop, the loop found nothing, a fresh
  // timestamp was written and the process exited 0 — "0 tool events, scanned
  // just now", indistinguishable from a week with no work.
  assert.notEqual(r.status, 0, "an empty corpus after 3 events must not exit 0");
  assert.equal(eventCount(), before.count, "existing events must survive");
  assert.equal(
    meta("usageScannedAt"),
    before.scannedAt,
    "the mining clock must not advance on a failed run"
  );
  assert.equal(lastRunRow()?.status, "error");
  assert.match(lastRunRow()?.error ?? "", /refusing to report this as an empty week/);
});

test("REGRESSION: a missing transcript root is an error, not a quiet exit 0", () => {
  const before = eventCount();
  fs.rmSync(path.join(home, ".claude"), { recursive: true, force: true });

  const r = runScan();
  // Pre-fix this printed "nothing to scan" and returned successfully.
  assert.notEqual(r.status, 0);
  assert.equal(eventCount(), before, "existing events must survive");
  assert.equal(lastRunRow()?.status, "error");
  assert.match(lastRunRow()?.error ?? "", /transcript root not found/);

  fs.mkdirSync(projects, { recursive: true });
});

test("rows predating per-file tracking are re-mined rather than stranded", () => {
  // Simulate a database written by the old collector: rows with no sourceFile,
  // and no mining ledger. Without the migration these look "unchanged" forever
  // because no ledger entry ever claimed them.
  const d = new Database(path.join(dataDir, "atlas.db"));
  d.exec("DELETE FROM usage_files");
  d.prepare(
    "INSERT INTO tool_events (id, sessionId, ts, feature, category, howInvoked, paramKeys, scannedAt, sourceFile) VALUES (?,?,?,?,?,?,?,?,NULL)"
  ).run("legacy-1", "old", "2026-01-01T00:00:00Z", "Bash", "exec", "direct", "[]", "old");
  d.close();

  transcript("proj-c", "sess-3", [
    toolLine("sess-3", "2026-08-05T10:00:00Z", "Write", "toolu_c1"),
  ]);

  const r = runScan();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /predate per-file tracking/);
  assert.equal(
    db(
      (d2) =>
        (d2.prepare("SELECT count(*) c FROM tool_events WHERE sourceFile IS NULL").get() as {
          c: number;
        }).c
    ),
    0,
    "legacy rows must not survive the migration"
  );
  assert.equal(eventCount(), 1);
});
