import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getDb, initSchema } from "@/lib/db";
import { parseDecisionEntry } from "@/lib/scanners/decisions";

/**
 * Incremental decision-card ingest — the zero-token streaming path.
 *
 * Invoked by the decision-ingest PostToolUse hook the moment a card file is
 * written, with the file path(s) as argv. Reuses the scanner's OWN parser
 * (parseDecisionFile) so the incremental path and the full scan can never
 * drift, and upserts by id. A path whose file no longer exists deletes its
 * row (a renamed card is a delete of the old path plus a write of the new).
 *
 * Contract with the hook: this script is best-effort and QUIET on the happy
 * path — one summary line per invocation to stdout (the hook redirects it to
 * a log file, never into model context). It exits 0 even on per-file skips;
 * the nightly full scan is the reconciler that heals anything missed. A
 * missing database is a real error (exit 1) so the log shows it, but the hook
 * still never blocks the Write that triggered it.
 */

const COLS =
  "id,path,filename,title,date,sessionId,chief,klass,status,tree,decision,why," +
  "alternatives,reversibility,reviewTrigger,supersedes,links,body,modifiedAt,checksum,scannedAt";

function main(rawArgv: string[]): number {
  const verbose = rawArgv.includes("--verbose");
  const argv = rawArgv.filter((a) => a !== "--verbose");
  if (argv.length === 0) {
    console.error("usage: tsx scripts/ingest-decision.ts [--verbose] <card.md> [...]");
    return 2;
  }
  const db = getDb();
  initSchema(db);
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO decisions (${COLS}) VALUES (${COLS.split(",")
      .map((c) => `@${c}`)
      .join(",")})`
  );
  const remove = db.prepare("DELETE FROM decisions WHERE id = ?");
  const SKIP_COLS = "id,path,filename,reason,modifiedAt,scannedAt";
  const upsertSkip = db.prepare(
    `INSERT OR REPLACE INTO decision_skips (${SKIP_COLS}) VALUES (${SKIP_COLS.split(",")
      .map((c) => `@${c}`)
      .join(",")})`
  );
  const removeSkip = db.prepare("DELETE FROM decision_skips WHERE id = ?");

  let upserted = 0;
  let removed = 0;
  let skipped = 0;
  for (const raw of argv) {
    const filePath = path.resolve(raw);
    const id = path.basename(filePath).replace(/\.md$/i, "");
    if (!fs.existsSync(filePath)) {
      removed += remove.run(id).changes;
      removeSkip.run(id);
      continue;
    }
    const r = parseDecisionEntry(filePath, undefined, { quiet: true });
    if (r.kind === "ignore") continue;
    if (r.kind === "skip") {
      // A card that stopped parsing (an edit broke it) must not keep its old
      // row: the row would assert a decision the file no longer states.
      remove.run(id);
      upsertSkip.run(r.skip);
      skipped += 1;
      // The one line this script prints on a skip. The hook feeds stdout to a
      // log, so this is also the only trace of a refused card outside Atlas.
      console.log(`atlas: decision ingest — skipped ${r.skip.filename}: ${r.skip.reason}`);
      continue;
    }
    upsert.run(r.card);
    removeSkip.run(id);
    upserted += 1;
  }
  // Silent on success: the card file on disk is the record, and the hook log
  // should hold nothing but refusals. `--verbose` restores the summary line
  // for a hand run.
  if (verbose)
    console.log(
      `atlas: decision ingest — ${upserted} upserted, ${removed} removed, ${skipped} skipped (${new Date().toISOString()})`
    );
  return 0;
}

process.exit(main(process.argv.slice(2)));
