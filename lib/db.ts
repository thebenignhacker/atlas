import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Resolved lazily (not at module load) so callers can route the DB elsewhere
// via ATLAS_DATA_DIR — used by the atlas-context CLI, which runs from arbitrary
// working directories but must always read/write the Atlas repo's database.
function dataDir(): string {
  return process.env.ATLAS_DATA_DIR
    ? path.resolve(process.env.ATLAS_DATA_DIR)
    : path.join(process.cwd(), "data");
}
function dbPath(): string {
  return path.join(dataDir(), "atlas.db");
}

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
`;

let writeDb: Database.Database | null = null;

/** Get a read-write connection. Used by scanners and API mutations. */
export function getDb(): Database.Database {
  if (!writeDb) {
    const dir = dataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    writeDb = new Database(dbPath());
    writeDb.pragma("journal_mode = WAL");
    writeDb.pragma("foreign_keys = ON");
  }
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
