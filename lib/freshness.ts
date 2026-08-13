import type Database from "better-sqlite3";
import { getMeta } from "@/lib/db";
import { lastRun } from "@/lib/scan-runs";
import type { SectionFreshness, SectionStatus, SnapshotFreshness } from "@/lib/freshness-shared";

/**
 * Database-backed half of the freshness model. The pure half lives in
 * `lib/freshness-shared.ts` so UI components can render a SectionFreshness
 * without dragging better-sqlite3 toward the client bundle.
 */

/**
 * A missing table is the ONE error worth swallowing here: a database created
 * before a collector existed legitimately has no rows for it, and that is
 * "never collected", not a reason to fail the whole snapshot.
 *
 * Everything else rethrows. Catching broadly would report a corrupt or
 * unreadable database as a section that has simply never been collected — a
 * plausible-looking answer to the exact question this module exists to answer
 * honestly.
 */
function scalar(db: Database.Database, sql: string): string | null {
  try {
    const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
    if (!row) return null;
    const v = Object.values(row)[0];
    return v == null ? null : String(v);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/no such table|no such column/i.test(msg)) return null;
    throw err;
  }
}

/** Table names are compile-time literals below; the guard keeps it that way. */
function count(db: Database.Database, table: string): number {
  if (!/^[a-z_]+$/.test(table)) {
    throw new Error(`atlas: refusing to interpolate "${table}" into SQL`);
  }
  const v = scalar(db, `SELECT count(*) AS c FROM ${table}`);
  return v == null ? 0 : Number(v);
}

/**
 * Build a section entry. `stage` links the section to the collector whose run
 * record decides `status` — the DB alone cannot distinguish "ran and found
 * nothing" from "crashed before writing anything".
 */
function section(
  db: Database.Database,
  builtAt: string,
  opts: {
    dataAt: string | null;
    collectedAt: string | null;
    count: number;
    stage?: string;
  }
): SectionFreshness {
  const run = opts.stage ? lastRun(db, opts.stage) : null;
  let status: SectionStatus;
  let note: string | null = null;

  if (run?.status === "error") {
    status = "error";
    note = run.error ?? "collector reported an error";
  } else if (opts.collectedAt == null) {
    status = "never";
    note = opts.stage ? `\`npm run ${opts.stage}\` has never completed` : null;
  } else if (opts.count === 0) {
    status = "empty";
    note = "the collector ran and found nothing";
  } else {
    status = "ok";
    if (run?.note) note = run.note;
  }

  return {
    dataAt: opts.dataAt,
    collectedAt: opts.collectedAt,
    builtAt,
    status,
    count: opts.count,
    note,
  };
}

/**
 * Compute the freshness block baked into a snapshot. `owner` adds the sections
 * that exist only in the owner artifact. Every value is read from content —
 * never from a file mtime, which records a checkout, not a measurement.
 */
export function computeFreshness(
  db: Database.Database,
  builtAt: string,
  opts: { owner: boolean }
): SnapshotFreshness {
  const lastScanAt = getMeta(db, "lastScanAt");
  const usageScannedAt = getMeta(db, "usageScannedAt");

  const out: SnapshotFreshness = {
    repos: section(db, builtAt, {
      dataAt: scalar(db, "SELECT max(lastCommitAt) AS v FROM repos"),
      collectedAt: lastScanAt,
      count: count(db, "repos"),
      stage: "scan",
    }),
    activity: section(db, builtAt, {
      dataAt: scalar(db, "SELECT max(ts) AS v FROM activity"),
      collectedAt: lastScanAt,
      count: count(db, "activity"),
      stage: "scan",
    }),
    usage: section(db, builtAt, {
      dataAt: scalar(db, "SELECT max(ts) AS v FROM tool_events"),
      collectedAt: usageScannedAt,
      count: count(db, "tool_events"),
      stage: "scan:usage",
    }),
    // Cards are written directly by the CLI rather than mined by a collector,
    // so the last write IS the last collection. Not a shortcut: there is no
    // separate looking step that could silently stop.
    context: (() => {
      const updated = scalar(db, "SELECT max(updatedAt) AS v FROM context_cards");
      return section(db, builtAt, {
        dataAt: updated,
        collectedAt: updated,
        count: count(db, "context_cards"),
      });
    })(),
  };

  if (opts.owner) {
    out.todos = section(db, builtAt, {
      dataAt: scalar(db, "SELECT max(modifiedAt) AS v FROM todos"),
      collectedAt: lastScanAt,
      count: count(db, "todos"),
      stage: "scan",
    });
    const sessionsAt = scalar(db, "SELECT max(updatedAt) AS v FROM sessions");
    out.sessions = section(db, builtAt, {
      dataAt: sessionsAt,
      collectedAt: sessionsAt,
      count: count(db, "sessions"),
    });
  }

  return out;
}

