import fs from "node:fs";
import path from "node:path";

/**
 * The ONLY module permitted to compute a data or artifact path.
 *
 * Before this existed, five modules each derived their own from `process.cwd()`
 * and one hardcoded a sibling of it, so they agreed only while every entry
 * point happened to run from the repo root. They did not: `bin/atlas-context.ts`
 * runs from arbitrary directories and set `ATLAS_DATA_DIR` to compensate, but
 * then resolved `.current-session` against the repo anyway — so redirecting the
 * database silently detached session attribution from the cards it was meant to
 * label. That failure is invisible: cards still write, just without an origin.
 *
 * A test asserts no other module derives a data path from `process.cwd()`.
 *
 * This step deliberately MOVES NOTHING. Every default below resolves to exactly
 * where the files are today; `ATLAS_HOME` is accepted so a later migration has a
 * seam, but until it is set the layout is unchanged. Changing the resolver and
 * moving the data in one step would leave no working state to bisect against.
 *
 * Precedence, most specific first:
 *   ATLAS_DATA_DIR   explicit data directory (tests, the CLI)
 *   ATLAS_HOME       future data root; data lives in <ATLAS_HOME>/data
 *   ATLAS_ROOT       explicit repo root (set by entry points that chdir)
 *   process.cwd()    today's behaviour
 */

/** Repo root: where the app, its config and its published artifacts live. */
export function repoRoot(): string {
  return process.env.ATLAS_ROOT
    ? path.resolve(process.env.ATLAS_ROOT)
    : process.cwd();
}

/** Directory holding the derived index and hook state. */
export function dataDir(): string {
  if (process.env.ATLAS_DATA_DIR) return path.resolve(process.env.ATLAS_DATA_DIR);
  if (process.env.ATLAS_HOME)
    return path.join(path.resolve(process.env.ATLAS_HOME), "data");
  return path.join(repoRoot(), "data");
}

/** The derived SQLite index. Rebuildable — never the source of truth. */
export function dbPath(): string {
  return path.join(dataDir(), "atlas.db");
}

/**
 * Where the SessionStart hook records the current harness session id.
 *
 * Resolved through `dataDir()` rather than against the repo, which is the whole
 * point: a redirected data directory must take its session state with it.
 */
export function sessionStateFile(): string {
  return path.join(dataDir(), ".current-session");
}

/**
 * A session-state file left at the pre-unification location, when that is not
 * where we now look. Returned so callers can FAIL rather than read the wrong
 * one — silently preferring either copy is how a stale session id gets stamped
 * onto every card written for the rest of the day.
 */
export function legacySessionStateFile(): string | null {
  const legacy = path.join(repoRoot(), "data", ".current-session");
  if (path.resolve(legacy) === path.resolve(sessionStateFile())) return null;
  return fs.existsSync(legacy) ? legacy : null;
}

/** User config. Same directory as the app, not the data root. */
export function configPath(): string {
  return path.join(repoRoot(), "atlas.config.json");
}

/**
 * The sanitized artifact a fresh clone reads. Stays in the repo by decision: it
 * is meant to be public, and the publish gate needs its target to keep existing
 * — closing that gate by deleting the file it guards is not a fix.
 */
export function publicSnapshotPath(): string {
  return path.join(repoRoot(), "public-snapshot.json");
}

/**
 * The full unsanitized artifact. Overridable so the refresh pipeline can stage
 * it outside the tree; still defaults into the repo for now because the deploy
 * upload reads it from there today.
 */
export function ownerSnapshotPath(): string {
  return process.env.OWNER_SNAPSHOT_PATH
    ? path.resolve(process.env.OWNER_SNAPSHOT_PATH)
    : path.join(repoRoot(), "owner-snapshot.json");
}
