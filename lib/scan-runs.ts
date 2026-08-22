import type Database from "better-sqlite3";

/**
 * Per-stage run records. Without these a collector has exactly one observable
 * outcome — whatever rows happen to be in the table afterwards — so a crash
 * that wrote nothing, a run that legitimately found nothing, and a healthy run
 * are indistinguishable to every reader downstream.
 *
 * The record is written by the collector itself (not inferred from row counts)
 * so `error` survives the case that leaves no trace in the data tables at all.
 */

export type RunStatus = "running" | "ok" | "empty" | "error";

export interface ScanRunRow {
  id: number;
  stage: string;
  startedAt: string;
  endedAt: string | null;
  status: RunStatus;
  rowsIn: number | null;
  rowsOut: number | null;
  error: string | null;
  note: string | null;
}

/** Open a run record. Returns the row id to pass to `finishRun`. */
export function startRun(db: Database.Database, stage: string, startedAt: string): number {
  const info = db
    .prepare(
      "INSERT INTO scan_runs (stage, startedAt, status) VALUES (?, ?, 'running')"
    )
    .run(stage, startedAt);
  return Number(info.lastInsertRowid);
}

export function finishRun(
  db: Database.Database,
  id: number,
  fields: {
    endedAt: string;
    status: Exclude<RunStatus, "running">;
    rowsIn?: number | null;
    rowsOut?: number | null;
    error?: string | null;
    note?: string | null;
  }
): void {
  db.prepare(
    `UPDATE scan_runs
        SET endedAt = ?, status = ?, rowsIn = ?, rowsOut = ?, error = ?, note = ?
      WHERE id = ?`
  ).run(
    fields.endedAt,
    fields.status,
    fields.rowsIn ?? null,
    fields.rowsOut ?? null,
    fields.error ?? null,
    fields.note ?? null,
    id
  );
}

/**
 * The most recent COMPLETED run for a stage. A still-`running` row is skipped:
 * an interrupted process leaves one behind forever, and treating that as the
 * current state would report a crashed pipeline as permanently in progress.
 */
export function lastRun(db: Database.Database, stage: string): ScanRunRow | null {
  try {
    return (
      (db
        .prepare(
          `SELECT * FROM scan_runs
            WHERE stage = ? AND status != 'running'
            ORDER BY id DESC LIMIT 1`
        )
        .get(stage) as ScanRunRow | undefined) ?? null
    );
  } catch (err) {
    // ONLY the pre-migration case (no scan_runs table yet). A broader catch
    // would turn a corrupt database into "this stage has no run history",
    // which reads as benign and is how a broken pipeline looks healthy.
    const msg = err instanceof Error ? err.message : String(err);
    if (/no such table|no such column/i.test(msg)) return null;
    throw err;
  }
}

/**
 * Trim the log so an every-10-minutes pipeline cannot grow it without bound.
 * Keeps the newest `keep` records per stage.
 */
export function pruneRuns(db: Database.Database, stage: string, keep = 200): void {
  db.prepare(
    `DELETE FROM scan_runs
      WHERE stage = ?
        AND id NOT IN (
          SELECT id FROM scan_runs WHERE stage = ? ORDER BY id DESC LIMIT ?
        )`
  ).run(stage, stage, keep);
}
