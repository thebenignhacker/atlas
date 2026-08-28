import Database from "better-sqlite3";
import fs from "node:fs";
import { dataDir, dbPath } from "@/lib/paths";

// Path resolution lives in lib/paths.ts — the single resolver. Resolved lazily
// (not at module load) so callers can route the DB elsewhere via
// ATLAS_DATA_DIR: the atlas-context CLI runs from arbitrary working
// directories but must always reach the same database.

/** Schema is idempotent (CREATE IF NOT EXISTS) so setup-db can run anytime. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS repos (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  groupName TEXT,
  remoteUrl TEXT,
  owner TEXT,
  repoName TEXT,
  branch TEXT,
  lastCommitAt TEXT,
  lastCommitSha TEXT,
  lastCommitMsg TEXT,
  commitCount30d INTEGER DEFAULT 0,
  dirty INTEGER DEFAULT 0,
  ahead INTEGER DEFAULT 0,
  behind INTEGER DEFAULT 0,
  visibility TEXT DEFAULT 'unknown',
  isFork INTEGER,
  isArchived INTEGER,
  language TEXT,
  stars INTEGER,
  openIssues INTEGER,
  openPrs INTEGER,
  defaultBranch TEXT,
  pushedAt TEXT,
  description TEXT,
  scannedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_repos_group ON repos(groupName);
CREATE INDEX IF NOT EXISTS idx_repos_commit ON repos(lastCommitAt);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  filename TEXT,
  title TEXT,
  createdAt TEXT,
  modifiedAt TEXT,
  priority TEXT,
  status TEXT DEFAULT 'unknown',
  repoSlug TEXT,
  repoGuess TEXT,
  triggerPhrase TEXT,
  kind TEXT,
  excerpt TEXT,
  source TEXT,
  checksum TEXT,
  scannedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_todos_repo ON todos(repoSlug);
CREATE INDEX IF NOT EXISTS idx_todos_priority ON todos(priority);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  filename TEXT,
  title TEXT,
  date TEXT,
  sessionId TEXT,
  chief TEXT,
  klass TEXT,
  status TEXT,
  tree TEXT,
  decision TEXT,
  why TEXT,
  alternatives TEXT,
  reversibility TEXT,
  reviewTrigger TEXT,
  supersedes TEXT,
  links TEXT,
  body TEXT,
  modifiedAt TEXT,
  checksum TEXT,
  scannedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status);
CREATE INDEX IF NOT EXISTS idx_decisions_klass ON decisions(klass);
CREATE INDEX IF NOT EXISTS idx_todos_created ON todos(createdAt);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  repoSlug TEXT,
  type TEXT,
  title TEXT,
  ts TEXT,
  meta TEXT,
  scannedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts);
CREATE INDEX IF NOT EXISTS idx_activity_repo ON activity(repoSlug);

CREATE TABLE IF NOT EXISTS ai_outputs (
  id TEXT PRIMARY KEY,
  entityType TEXT,
  entityId TEXT,
  task TEXT,
  contentHash TEXT,
  model TEXT,
  output TEXT,
  promptTokens INTEGER,
  completionTokens INTEGER,
  generatedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_entity ON ai_outputs(entityType, entityId, task);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entityType TEXT,
  entityId TEXT,
  field TEXT,
  aiValue TEXT,
  correctedValue TEXT,
  note TEXT,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS learned_prefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT,
  key TEXT,
  value TEXT,
  createdAt TEXT,
  UNIQUE(scope, key)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Context Store: verified, provenance-tagged facts about a project/feature.
-- Each card is a POINTER to truth that lives in code (its provenance files),
-- not a copy. Freshness is recomputed from those files; a card whose sources
-- drifted self-flags instead of silently misleading. See lib/context/*.
CREATE TABLE IF NOT EXISTS context_cards (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  repoSlug TEXT,
  subject TEXT NOT NULL,
  claim TEXT NOT NULL,
  detail TEXT,
  provenance TEXT,          -- JSON: [{ path, hash, hashAlgo, capturedAt }]
  verifyCommand TEXT,       -- shell cmd; exit 0 = claim still holds
  verifyResult TEXT,        -- 'pass' | 'fail' | 'unknown'
  verifyCheckedAt TEXT,
  confidence TEXT DEFAULT 'medium',  -- 'high' | 'medium' | 'low' | 'unverified'
  derivedAt TEXT NOT NULL,
  lastVerifiedAt TEXT NOT NULL,
  staleAfterDays INTEGER,   -- TTL; null = no time-based expiry
  freshness TEXT DEFAULT 'unverified',  -- cached computed state
  driftedPaths TEXT,        -- JSON array of provenance paths whose hash changed
  tags TEXT,                -- JSON string array
  links TEXT,               -- JSON array: card ids and/or [[memory-name]]
  status TEXT DEFAULT 'active',       -- 'active' | 'superseded' | 'retired'
  supersededBy TEXT,
  visibility TEXT DEFAULT 'private',  -- 'private' | 'public'
  -- Hard "never publishable" flag. Stronger than visibility=private: a sensitive
  -- card is dropped from EVERY public surface (and the snapshot gate fails closed
  -- if one would leak), even when the underlying GitHub repo is public.
  sensitive INTEGER DEFAULT 0,
  originSessionId TEXT,
  createdAt TEXT,
  updatedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_context_project ON context_cards(project);
CREATE INDEX IF NOT EXISTS idx_context_status ON context_cards(status);
CREATE INDEX IF NOT EXISTS idx_context_repo ON context_cards(repoSlug);
CREATE INDEX IF NOT EXISTS idx_context_fresh ON context_cards(freshness);
CREATE INDEX IF NOT EXISTS idx_context_session ON context_cards(originSessionId);
-- NOTE: the index on the sensitive column is created in initSchema AFTER the
-- column migration, so it works on databases predating that column too.

-- Claude session registry. A card's originSessionId points here so you can see
-- which session established a fact and jump back to it (claude --resume <id>).
-- Populated incrementally: the SessionStart hook registers a session; each card
-- added under that session merges its project/repo into the repos list and bumps
-- the count. Never published — sessions stay out of the public snapshot entirely.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  startedAt TEXT,
  endedAt TEXT,
  summary TEXT,
  branches TEXT,            -- JSON string array
  repos TEXT,               -- JSON string array (projects/repos this session touched)
  cardCount INTEGER DEFAULT 0,
  createdAt TEXT,
  updatedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(startedAt);

-- Append-only event log. The hero metric ("stale facts caught") is a COUNT over
-- kind='caught_stale' rows, so the headline number is measured, never estimated.
CREATE TABLE IF NOT EXISTS context_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cardId TEXT,
  kind TEXT,                -- 'added'|'read'|'caught_stale'|'reverified'|'superseded'|'retired'
  fromState TEXT,
  toState TEXT,
  detail TEXT,              -- JSON
  ts TEXT
);
CREATE INDEX IF NOT EXISTS idx_context_events_kind ON context_events(kind);
CREATE INDEX IF NOT EXISTS idx_context_events_card ON context_events(cardId);

-- Claude Code feature-usage events, mined from local session transcripts. Stores
-- METADATA ONLY: the tool name, timestamp, cwd/branch context, and the input KEY
-- NAMES (paramKeys) — never any input value (no commands, prompts, or file
-- contents). cwd/gitBranch/paramKeys are OWNER-ONLY; the public rollup is
-- computed from these rows but never serializes them. Populated by
-- \`npm run scan:usage\` (full-replace, idempotent).
CREATE TABLE IF NOT EXISTS tool_events (
  id TEXT PRIMARY KEY,        -- toolUseId, or sessionId:lineIndex when absent
  sessionId TEXT,
  ts TEXT,                    -- ISO 8601 from the transcript event
  feature TEXT NOT NULL,      -- normalized key: "Bash" | "Skill:x" | "Workflow:x" | "mcp:srv.tool" | "command:/x"
  category TEXT,              -- file|exec|search|orchestration|skill|mcp|web|command|other
  project TEXT,               -- derived from cwd; owner-only, bucketed for public
  howInvoked TEXT,            -- direct|subagent|workflow (v1: always 'direct')
  paramKeys TEXT,             -- JSON array of input KEY NAMES only; never values. Owner-only.
  cwd TEXT,                   -- owner-only; never in the public snapshot
  gitBranch TEXT,             -- owner-only; never in the public snapshot
  scannedAt TEXT,
  -- Transcript this row was mined from. Load-bearing: it makes a re-mine
  -- replaceable PER FILE, which is what lets the scan be incremental and
  -- crash-safe instead of truncate-then-refill. Owner-only (a local path).
  sourceFile TEXT
);
CREATE INDEX IF NOT EXISTS idx_tool_events_feature ON tool_events(feature);
CREATE INDEX IF NOT EXISTS idx_tool_events_ts ON tool_events(ts);
CREATE INDEX IF NOT EXISTS idx_tool_events_project ON tool_events(project);
CREATE INDEX IF NOT EXISTS idx_tool_events_session ON tool_events(sessionId);
-- NOTE: the index on sourceFile is created in initSchema AFTER the column
-- migration, for the same reason as context_cards.sensitive below: on a database
-- that already has tool_events, CREATE TABLE IF NOT EXISTS is a no-op, so the
-- column does not exist yet at this point and indexing it here fails outright.

-- Mining ledger for the usage scan: which transcript was read, at what
-- mtime/size, and how many events it yielded. A file whose mtime and size are
-- unchanged is skipped, so a 1.2 GB corpus is re-read only where it actually
-- changed. Deleting a row forces that file to be re-mined.
CREATE TABLE IF NOT EXISTS usage_files (
  path TEXT PRIMARY KEY,
  mtimeMs INTEGER NOT NULL,
  size INTEGER NOT NULL,
  eventCount INTEGER NOT NULL DEFAULT 0,
  scannedAt TEXT
);

-- Per-stage collector run log. Exists so that "never ran", "ran and found
-- nothing" and "ran and failed" are three distinguishable outcomes rather than
-- one empty table. Read by lib/freshness.ts; written by the collectors.
CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage TEXT NOT NULL,        -- 'scan' | 'scan:usage' | ...
  startedAt TEXT NOT NULL,
  endedAt TEXT,
  status TEXT NOT NULL,       -- 'running' | 'ok' | 'empty' | 'error'
  rowsIn INTEGER,
  rowsOut INTEGER,
  error TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_scan_runs_stage ON scan_runs(stage, id);

-- Release trains: per-repo release coordination as DATA (queue of obligations,
-- one advisory conductor lease, deadline triggers). See lib/context/train.ts.
-- Reporting-only: the publish gates stay the enforcement of last resort, so
-- nothing here is a runtime dependency of a release.
CREATE TABLE IF NOT EXISTS release_trains (
  repo TEXT PRIMARY KEY,
  leaseSessionId TEXT,
  leaseTakenAt TEXT,
  leaseExpiresAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS train_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'obligation',   -- 'obligation' | 'closing-step'
  item TEXT NOT NULL,
  deadline TEXT,            -- YYYY-MM-DD; due/overdue is derived at read time
  deadlineAction TEXT,      -- what to cut when the deadline passes unmet
  status TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'done'
  addedBySessionId TEXT,
  addedAt TEXT NOT NULL,
  doneAt TEXT,
  doneBySessionId TEXT
);
CREATE INDEX IF NOT EXISTS idx_train_items_repo ON train_items(repo, status);
`;

let writeDb: Database.Database | null = null;

function open(): Database.Database {
  const db = new Database(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

/**
 * Get a read-write connection to an EXISTING database.
 *
 * Deliberately refuses to create one. `new Database(path)` creates the file
 * silently, so any caller that resolved the wrong directory — a script run from
 * the wrong cwd, a hook that recreated a deleted folder, an unset
 * ATLAS_DATA_DIR — got a brand-new empty database instead of an error, and
 * wrote to it happily. Nothing failed; the writes simply landed somewhere
 * nobody reads, producing two half-populated stores with no way to tell which
 * is current. Split-brain is the worst outcome in the set precisely because it
 * is the quietest.
 *
 * Creation happens in exactly one place: `createDb()`, called by
 * `scripts/setup-db.ts`.
 */
export function getDb(): Database.Database {
  if (!writeDb) {
    if (!fs.existsSync(dbPath())) {
      throw new Error(
        `atlas: no database at ${dbPath()} — refusing to create one here, ` +
          `because a mistyped or unset ATLAS_DATA_DIR would silently start a ` +
          `second empty store. Run \`npm run setup-db\` if this path is right.`
      );
    }
    writeDb = open();
  }
  return writeDb;
}

/**
 * Create the database if absent and return a write connection. The ONE
 * sanctioned creation path; `scripts/setup-db.ts` is its only caller, so
 * "the database appeared" is always traceable to someone running setup-db.
 */
export function createDb(): Database.Database {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!writeDb) writeDb = open();
  return writeDb;
}

/** Open a fresh read-only connection. Used by the UI/API read layer. */
export function getReadDb(): Database.Database {
  if (!fs.existsSync(dbPath())) {
    throw new Error(
      "atlas: database not found. Run `npm run setup-db && npm run scan` first."
    );
  }
  const db = new Database(dbPath(), { readonly: true });
  db.pragma("query_only = ON");
  return db;
}

/**
 * Add a column to an existing table if it isn't there yet. `CREATE TABLE IF NOT
 * EXISTS` never alters an existing table, so a DB created before a column was
 * introduced needs this. Idempotent and safe to run on every init.
 */
function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  ddl: string
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

export function initSchema(db: Database.Database = getDb()): void {
  db.exec(SCHEMA);
  // Migrations for DBs created before these columns existed. The column must be
  // added before any index on it, hence after the SCHEMA exec above.
  addColumnIfMissing(db, "context_cards", "sensitive", "sensitive INTEGER DEFAULT 0");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_context_sensitive ON context_cards(sensitive)"
  );
  addColumnIfMissing(db, "tool_events", "sourceFile", "sourceFile TEXT");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_tool_events_source ON tool_events(sourceFile)"
  );
}

export function dbExists(): boolean {
  return fs.existsSync(dbPath());
}

export function setMeta(key: string, value: string): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
    .run(key, value);
}

export function getMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}
