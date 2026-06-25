import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { getDb, initSchema, setMeta } from "@/lib/db";
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
 * Files are streamed line-by-line (the corpus is hundreds of MB) and only
 * METADATA is extracted — never any input value. Full-replace + idempotent: a
 * re-run reproduces the same table from the same transcripts.
 */

const TE_COLS =
  "id,sessionId,ts,feature,category,project,howInvoked,paramKeys,cwd,gitBranch,scannedAt";

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
}

function toRow(e: ToolEvent, scannedAt: string): Row {
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

async function main() {
  const t0 = Date.now();
  const root = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(root)) {
    console.log(`atlas: no Claude transcripts at ${root} — nothing to scan.`);
    return;
  }

  const db = getDb();
  initSchema(db);
  const insert = db.prepare(
    `INSERT OR REPLACE INTO tool_events (${TE_COLS}) VALUES (${TE_COLS.split(",")
      .map((c) => `@${c}`)
      .join(",")})`
  );
  const writeBatch = db.transaction((rows: Row[]) => {
    for (const r of rows) insert.run(r);
  });

  db.exec("DELETE FROM tool_events;");
  const scannedAt = new Date().toISOString();

  const projectDirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  let fileCount = 0;
  let eventCount = 0;
  for (const dir of projectDirs) {
    const dirPath = path.join(root, dir.name);
    const files = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith(".jsonl"));
    for (const f of files) {
      fileCount++;
      const events = await eventsFromFile(path.join(dirPath, f.name));
      if (events.length) {
        writeBatch(events.map((e) => toRow(e, scannedAt)));
        eventCount += events.length;
      }
    }
  }

  setMeta("usageScannedAt", scannedAt);
  setMeta("usageEventCount", String(eventCount));
  console.log(
    `atlas: usage scan complete — ${eventCount} tool events from ${fileCount} sessions in ${(
      (Date.now() - t0) /
      1000
    ).toFixed(1)}s`
  );
}

main().catch((err) => {
  console.error("atlas: usage scan failed:", err);
  process.exit(1);
});
