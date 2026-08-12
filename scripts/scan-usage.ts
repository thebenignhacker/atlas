import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type Database from "better-sqlite3";
import { getDb, initSchema, getMeta, setMeta } from "@/lib/db";
import { finishRun, pruneRuns, startRun } from "@/lib/scan-runs";
import { eventsFromLine } from "@/lib/usage/parse";
import type { ToolEvent } from "@/lib/usage/types";

/**
 * Mine Claude Code feature usage from local session transcripts into tool_events.
 *
 * Source: ~/.claude/projects/<encoded-cwd>/<session>.jsonl — one file per
 * session. We read ONLY the top-level session files (not the subagents/ subdirs)
 * so each main-session tool call is counted once; calls a workflow makes inside
 * its own subagents are represented by the parent Workflow/Agent invocation, not
 * double-counted.
 *
 * Files are streamed line-by-line and only METADATA is extracted — never any
 * input value.
 *
 * INCREMENTAL AND CRASH-SAFE. The previous implementation ran
 * `DELETE FROM tool_events` before the mining loop and wrote its
 * `usageScannedAt` only on success, so an interruption left a partially rebuilt
 * table carrying the PREVIOUS run's timestamp — a page confidently rendering a
 * fraction of the data as if it were all of it. Now:
 *
 *   - a transcript whose mtime and size are unchanged is not re-read at all
 *     (the corpus is ~1.2 GB; a full re-read every 10 minutes is not viable),
 *   - each chunk of files is replaced inside ONE transaction together with its
 *     `usage_files` ledger row, so an interruption can only lose whole chunks
 *     and the next run re-mines exactly those,
 *   - the run's outcome is recorded explicitly, so "found nothing" and "failed"
 *     stop being reported as success.
 */

const STAGE = "scan:usage";

const TE_COLS =
  "id,sessionId,ts,feature,category,project,howInvoked,paramKeys,cwd,gitBranch,scannedAt,sourceFile";

/** How many transcripts to mine before committing. Bounds re-work after a crash. */
const CHUNK = 200;

interface Row {
  id: string;
  sessionId: string | null;
  ts: string | null;
  feature: string;
  category: string;
  project: string | null;
  howInvoked: string;
  paramKeys: string; // JSON string
  cwd: string | null;
  gitBranch: string | null;
  scannedAt: string;
  sourceFile: string;
}

interface TranscriptFile {
  path: string;
  mtimeMs: number;
  size: number;
}

/** A mined file plus its rows, ready to be committed as one unit. */
interface MinedFile {
  file: TranscriptFile;
  rows: Row[];
}

function toRow(e: ToolEvent, scannedAt: string, sourceFile: string): Row {
  return {
    id: e.id,
    sessionId: e.sessionId,
    ts: e.ts,
    feature: e.feature,
    category: e.category,
    project: e.project,
    howInvoked: e.howInvoked,
    paramKeys: JSON.stringify(e.paramKeys),
    cwd: e.cwd,
    gitBranch: e.gitBranch,
    scannedAt,
    sourceFile,
  };
}

async function eventsFromFile(file: string): Promise<ToolEvent[]> {
  const out: ToolEvent[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let index = 0;
  for await (const line of rl) {
    index++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // a partially written / non-JSON line; skip it
    }
    for (const ev of eventsFromLine(obj, index)) out.push(ev);
  }
  return out;
}

/** Every top-level session transcript, with the stat fields the ledger compares. */
function listTranscripts(root: string): TranscriptFile[] {
  const out: TranscriptFile[] = [];
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(root, dir.name);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      continue; // unreadable project dir; the run record carries the shortfall
    }
    for (const f of entries) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const full = path.join(dirPath, f.name);
      try {
        const st = fs.statSync(full);
        out.push({ path: full, mtimeMs: Math.floor(st.mtimeMs), size: st.size });
      } catch {
        continue; // vanished between readdir and stat
      }
    }
  }
  return out;
}

interface LedgerRow {
  path: string;
  mtimeMs: number;
  size: number;
  eventCount: number;
}

function loadLedger(db: Database.Database): Map<string, LedgerRow> {
  const rows = db
    .prepare("SELECT path, mtimeMs, size, eventCount FROM usage_files")
    .all() as LedgerRow[];
  return new Map(rows.map((r) => [r.path, r]));
}

function countEvents(db: Database.Database): number {
  const r = db.prepare("SELECT count(*) AS c FROM tool_events").get() as {
    c: number;
  };
  return r.c;
}

async function main() {
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const db = getDb();
  initSchema(db);

  const runId = startRun(db, STAGE, startedAt);
  /** Record the outcome and leave. `usageScannedAt` moves ONLY on a clean run. */
  const finish = (
    status: "ok" | "empty" | "error",
    opts: { rowsIn?: number; rowsOut?: number; error?: string; note?: string }
  ): never => {
    finishRun(db, runId, {
      endedAt: new Date().toISOString(),
      status,
      rowsIn: opts.rowsIn ?? null,
      rowsOut: opts.rowsOut ?? null,
      error: opts.error ?? null,
      note: opts.note ?? null,
    });
    pruneRuns(db, STAGE);
    if (status === "error") {
      console.error(`atlas: usage scan FAILED — ${opts.error}`);
      process.exit(1);
    }
    console.log(
      `atlas: usage scan ${status} — ${opts.rowsOut ?? 0} tool events in ${(
        (Date.now() - t0) /
        1000
      ).toFixed(1)}s${opts.note ? ` (${opts.note})` : ""}`
    );
    process.exit(0);
  };

  const priorCount = Number(getMeta(db, "usageEventCount") ?? "0");
  const root = path.join(os.homedir(), ".claude", "projects");

  // Precondition, not a silent early return. A missing transcript root used to
  // print a friendly line and exit 0, which is indistinguishable from a healthy
  // run over an idle week once the output is a dashboard number.
  if (!fs.existsSync(root)) {
    finish("error", {
      rowsIn: 0,
      rowsOut: priorCount,
      error: `transcript root not found at ${root} — nothing was mined and the previous data is unchanged`,
    });
  }

  const files = listTranscripts(root);
  if (files.length === 0) {
    // Zero files where there were previously events is a collection failure
    // (moved/emptied root), not a report that no work happened.
    if (priorCount > 0) {
      finish("error", {
        rowsIn: 0,
        rowsOut: priorCount,
        error: `no transcripts found under ${root}, but ${priorCount.toLocaleString()} events were mined previously — refusing to report this as an empty week`,
      });
    }
    setMeta("usageScannedAt", startedAt);
    setMeta("usageEventCount", "0");
    finish("empty", { rowsIn: 0, rowsOut: 0 });
  }

  // A database written before `sourceFile` existed has rows that cannot be
  // replaced per file. Re-mine those from scratch once; skipping this would
  // strand them permanently (their files look "unchanged" forever).
  const legacyRows = (
    db
      .prepare("SELECT count(*) AS c FROM tool_events WHERE sourceFile IS NULL")
      .get() as { c: number }
  ).c;
  if (legacyRows > 0) {
    console.log(
      `atlas: ${legacyRows.toLocaleString()} rows predate per-file tracking — re-mining the corpus once`
    );
    db.transaction(() => {
      db.exec("DELETE FROM tool_events WHERE sourceFile IS NULL");
      db.exec("DELETE FROM usage_files");
    })();
  }

  const ledger = loadLedger(db);

  // Drop everything not backed by a transcript that exists right now, so a
  // deleted session cannot linger in the totals forever.
  //
  // Keyed on the set of files PRESENT, not on the ledger's own keys: a row
  // whose ledger entry was lost is invisible to a ledger-driven sweep and would
  // survive every future run, silently inflating the count. Comparing against
  // what is actually on disk cannot miss that case.
  const vanished = db.transaction((present: TranscriptFile[]): number => {
    db.exec(
      "CREATE TEMP TABLE IF NOT EXISTS present_files (path TEXT PRIMARY KEY); DELETE FROM present_files;"
    );
    const add = db.prepare("INSERT OR IGNORE INTO present_files (path) VALUES (?)");
    for (const f of present) add.run(f.path);
    const gone = (
      db
        .prepare(
          `SELECT count(DISTINCT sourceFile) AS c FROM tool_events
            WHERE sourceFile IS NOT NULL
              AND sourceFile NOT IN (SELECT path FROM present_files)`
        )
        .get() as { c: number }
    ).c;
    db.exec(
      `DELETE FROM tool_events
        WHERE sourceFile IS NOT NULL
          AND sourceFile NOT IN (SELECT path FROM present_files);
       DELETE FROM usage_files
        WHERE path NOT IN (SELECT path FROM present_files);`
    );
    return gone;
  })(files);

  const changed = files.filter((f) => {
    const known = ledger.get(f.path);
    return !known || known.mtimeMs !== f.mtimeMs || known.size !== f.size;
  });

  const insert = db.prepare(
    `INSERT OR REPLACE INTO tool_events (${TE_COLS}) VALUES (${TE_COLS.split(",")
      .map((c) => `@${c}`)
      .join(",")})`
  );
  const clearFile = db.prepare("DELETE FROM tool_events WHERE sourceFile = ?");
  const upsertLedger = db.prepare(
    `INSERT OR REPLACE INTO usage_files (path, mtimeMs, size, eventCount, scannedAt)
     VALUES (?, ?, ?, ?, ?)`
  );

  /**
   * Replace a chunk of files atomically. The ledger row and the rows it
   * describes are written in the same transaction — they can never disagree,
   * which is what makes an interrupted run resumable rather than corrupt.
   */
  const commitChunk = db.transaction((mined: MinedFile[], scannedAt: string) => {
    for (const m of mined) {
      clearFile.run(m.file.path);
      for (const r of m.rows) insert.run(r);
      upsertLedger.run(
        m.file.path,
        m.file.mtimeMs,
        m.file.size,
        m.rows.length,
        scannedAt
      );
    }
  });

  console.log(
    `atlas: ${files.length.toLocaleString()} transcripts, ${changed.length.toLocaleString()} new or changed${
      vanished ? `, ${vanished.toLocaleString()} vanished` : ""
    }`
  );

  let mined: MinedFile[] = [];
  let filesDone = 0;
  let unreadable = 0;
  for (const file of changed) {
    const scannedAt = new Date().toISOString();
    let events: ToolEvent[];
    try {
      events = await eventsFromFile(file.path);
    } catch {
      // One unreadable transcript must not abort the run, but it must not be
      // marked as mined either — leaving it out of the ledger re-tries it next
      // run instead of silently dropping its events forever.
      unreadable++;
      continue;
    }
    mined.push({
      file,
      rows: events.map((e) => toRow(e, scannedAt, file.path)),
    });
    filesDone++;
    if (mined.length >= CHUNK) {
      commitChunk(mined, scannedAt);
      mined = [];
      if (filesDone % 1000 < CHUNK) {
        console.log(`atlas:   ${filesDone.toLocaleString()}/${changed.length.toLocaleString()} mined`);
      }
    }
  }
  if (mined.length > 0) commitChunk(mined, new Date().toISOString());

  const total = countEvents(db);

  // A total collapse to zero where there was data is a collection failure. Do
  // NOT advance the timestamp: the page must keep showing the old age rather
  // than claim this emptiness was measured just now.
  if (total === 0 && priorCount > 0) {
    finish("error", {
      rowsIn: files.length,
      rowsOut: 0,
      error: `mined 0 events from ${files.length.toLocaleString()} transcripts after ${priorCount.toLocaleString()} previously — treating as a collection failure, not an idle period`,
    });
  }

  const notes: string[] = [];
  if (unreadable > 0) notes.push(`${unreadable} transcripts unreadable, will retry`);
  if (vanished > 0) notes.push(`${vanished} transcripts removed since last scan`);
  // A decrease is reported rather than judged. Transcripts do get pruned, so a
  // drop is not automatically a fault — but it is never allowed to pass
  // unremarked, which is how the collapse above would otherwise creep in
  // gradually instead of all at once.
  if (total < priorCount) {
    notes.push(
      `event count fell ${priorCount.toLocaleString()} → ${total.toLocaleString()}`
    );
  }

  setMeta("usageScannedAt", startedAt);
  setMeta("usageEventCount", String(total));

  finish(total === 0 ? "empty" : "ok", {
    rowsIn: files.length,
    rowsOut: total,
    note: notes.length ? notes.join("; ") : undefined,
  });
}

main().catch((err) => {
  console.error("atlas: usage scan failed:", err);
  // Best-effort: mark the open run as errored so freshness reports the failure
  // rather than an indefinite "running".
  try {
    const db = getDb();
    const open = db
      .prepare(
        "SELECT id FROM scan_runs WHERE stage = ? AND status = 'running' ORDER BY id DESC LIMIT 1"
      )
      .get(STAGE) as { id: number } | undefined;
    if (open) {
      finishRun(db, open.id, {
        endedAt: new Date().toISOString(),
        status: "error",
        error: String(err instanceof Error ? err.message : err),
      });
    }
  } catch {
    // The database itself is unavailable; the non-zero exit is the signal.
  }
  process.exit(1);
});
