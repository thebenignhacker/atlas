import { execSync } from "node:child_process";
import type Database from "better-sqlite3";
import type {
  ContextCard,
  ContextEventKind,
  Confidence,
  CardVisibility,
  Freshness,
  Provenance,
  Session,
} from "@/lib/types";
import { captureProvenance, detectDrift } from "@/lib/context/provenance";

/**
 * Core read/write/verify logic for the Context Store. All functions take an
 * explicit `db` so they are trivially testable against an in-memory database.
 * Nothing here imports the Next.js / UI layer.
 */

const CARD_COLS = [
  "id","project","repoSlug","subject","claim","detail","provenance",
  "verifyCommand","verifyResult","verifyCheckedAt","confidence","derivedAt",
  "lastVerifiedAt","staleAfterDays","freshness","driftedPaths","tags","links",
  "status","supersededBy","visibility","sensitive","originSessionId",
  "createdAt","updatedAt",
] as const;

const DAY_MS = 86_400_000;

// --- helpers ---------------------------------------------------------------

export function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function cardId(project: string, subject: string): string {
  return `${slug(project)}:${slug(subject)}`;
}

function jsonArr<T>(s: unknown): T[] {
  if (typeof s !== "string" || !s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

// --- freshness (pure) ------------------------------------------------------

export function isExpired(
  lastVerifiedAt: string,
  staleAfterDays: number | null,
  now: Date = new Date()
): boolean {
  if (staleAfterDays === null || staleAfterDays === undefined) return false;
  const age = now.getTime() - new Date(lastVerifiedAt).getTime();
  return age > staleAfterDays * DAY_MS;
}

/**
 * The single source of truth for a card's trust state. Pure: drift is passed in
 * (computed against the filesystem by the caller) so this is unit-testable
 * without touching disk. Precedence is worst-first — a `fresh` result means the
 * card cleared every check.
 */
export function computeFreshness(i: {
  hasProvenance: boolean;
  driftedCount: number;
  verifyResult: "pass" | "fail" | "unknown" | null;
  lastVerifiedAt: string;
  staleAfterDays: number | null;
  now?: Date;
}): Freshness {
  if (i.driftedCount > 0) return "drifted";
  if (i.verifyResult === "fail") return "stale";
  if (isExpired(i.lastVerifiedAt, i.staleAfterDays, i.now)) return "expired";
  // No evidence it was ever true: no source files and no passing verify.
  if (!i.hasProvenance && i.verifyResult !== "pass") return "unverified";
  return "fresh";
}

// --- row mapping -----------------------------------------------------------

export type CardRow = Record<string, unknown>;

export function rowToCard(r: CardRow): ContextCard {
  return {
    id: r.id as string,
    project: r.project as string,
    repoSlug: (r.repoSlug as string) ?? null,
    subject: r.subject as string,
    claim: r.claim as string,
    detail: (r.detail as string) ?? null,
    provenance: jsonArr<Provenance>(r.provenance),
    verifyCommand: (r.verifyCommand as string) ?? null,
    verifyResult: (r.verifyResult as ContextCard["verifyResult"]) ?? null,
    verifyCheckedAt: (r.verifyCheckedAt as string) ?? null,
    confidence: (r.confidence as Confidence) ?? "medium",
    derivedAt: r.derivedAt as string,
    lastVerifiedAt: r.lastVerifiedAt as string,
    staleAfterDays:
      r.staleAfterDays === null || r.staleAfterDays === undefined
        ? null
        : Number(r.staleAfterDays),
    freshness: (r.freshness as Freshness) ?? "unverified",
    driftedPaths: jsonArr<string>(r.driftedPaths),
    tags: jsonArr<string>(r.tags),
    links: jsonArr<string>(r.links),
    status: (r.status as ContextCard["status"]) ?? "active",
    supersededBy: (r.supersededBy as string) ?? null,
    visibility: (r.visibility as CardVisibility) ?? "private",
    sensitive: r.sensitive === 1 || r.sensitive === true,
    originSessionId: (r.originSessionId as string) ?? null,
    createdAt: (r.createdAt as string) ?? null,
    updatedAt: (r.updatedAt as string) ?? null,
  };
}

// --- events ----------------------------------------------------------------

export function logEvent(
  db: Database.Database,
  e: {
    cardId: string | null;
    kind: ContextEventKind;
    fromState?: string | null;
    toState?: string | null;
    detail?: unknown;
  }
): void {
  db.prepare(
    "INSERT INTO context_events (cardId, kind, fromState, toState, detail, ts) VALUES (?,?,?,?,?,?)"
  ).run(
    e.cardId,
    e.kind,
    e.fromState ?? null,
    e.toState ?? null,
    e.detail === undefined ? null : JSON.stringify(e.detail),
    nowIso()
  );
}

// --- verify command runner -------------------------------------------------

/** Run a card's verifyCommand. exit 0 => 'pass'. Never throws. */
export function runVerifyCommand(
  cmd: string,
  cwd: string = process.cwd()
): "pass" | "fail" {
  try {
    execSync(cmd, { cwd, stdio: "ignore", timeout: 60_000 });
    return "pass";
  } catch {
    return "fail";
  }
}

// --- read by id ------------------------------------------------------------

export function getCard(db: Database.Database, id: string): ContextCard | null {
  const row = db
    .prepare("SELECT * FROM context_cards WHERE id = ?")
    .get(id) as CardRow | undefined;
  return row ? rowToCard(row) : null;
}

// --- add / upsert ----------------------------------------------------------

export interface AddCardInput {
  project: string;
  subject: string;
  claim: string;
  detail?: string | null;
  sourcePaths?: string[];
  verifyCommand?: string | null;
  staleAfterDays?: number | null;
  tags?: string[];
  links?: string[];
  confidence?: Confidence;
  visibility?: CardVisibility;
  /** Hard never-publishable flag (see ContextCard.sensitive). */
  sensitive?: boolean;
  repoSlug?: string | null;
  originSessionId?: string | null;
  /** Working dir to resolve sourcePaths and run the verify command against. */
  cwd?: string;
  /** Run the verifyCommand once on add to seed verifyResult (default true). */
  runVerify?: boolean;
}

/**
 * Create or update a card (id is derived from project+subject, so re-adding the
 * same subject updates in place and preserves createdAt). Enforces the
 * born-checkable rule: a card with neither a source nor a verify command is
 * rejected unless confidence is explicitly 'unverified'.
 */
export function addCard(
  db: Database.Database,
  input: AddCardInput
): ContextCard {
  const cwd = input.cwd ?? process.cwd();
  const sources = input.sourcePaths ?? [];
  const verifyCommand = input.verifyCommand ?? null;
  const confidence = input.confidence ?? "medium";

  if (sources.length === 0 && !verifyCommand && confidence !== "unverified") {
    throw new Error(
      "refusing to store an uncheckable card: pass --source <path> and/or " +
        "--verify '<cmd>', or set --confidence unverified to store it flagged."
    );
  }

  const provenance = captureProvenance(sources, cwd); // throws on missing file
  const driftedCount = 0; // just captured

  let verifyResult: ContextCard["verifyResult"] = null;
  let verifyCheckedAt: string | null = null;
  const runVerify = input.runVerify ?? true;
  if (verifyCommand && runVerify) {
    verifyResult = runVerifyCommand(verifyCommand, cwd);
    verifyCheckedAt = nowIso();
  }

  const now = nowIso();
  const freshness = computeFreshness({
    hasProvenance: provenance.length > 0,
    driftedCount,
    verifyResult,
    lastVerifiedAt: now,
    staleAfterDays: input.staleAfterDays ?? null,
  });

  const id = cardId(input.project, input.subject);
  const existing = getCard(db, id);
  const createdAt = existing?.createdAt ?? now;

  const record = {
    id,
    project: input.project,
    repoSlug: input.repoSlug ?? null,
    subject: input.subject,
    claim: input.claim,
    detail: input.detail ?? null,
    provenance: JSON.stringify(provenance),
    verifyCommand,
    verifyResult,
    verifyCheckedAt,
    confidence,
    derivedAt: now,
    lastVerifiedAt: now,
    staleAfterDays: input.staleAfterDays ?? null,
    freshness,
    driftedPaths: JSON.stringify([]),
    tags: JSON.stringify(input.tags ?? []),
    links: JSON.stringify(input.links ?? []),
    status: "active",
    supersededBy: null,
    visibility: input.visibility ?? "private",
    sensitive: input.sensitive ? 1 : 0,
    originSessionId: input.originSessionId ?? null,
    createdAt,
    updatedAt: now,
  };

  const cols = CARD_COLS.join(",");
  const ph = CARD_COLS.map((c) => `@${c}`).join(",");
  db.prepare(`INSERT OR REPLACE INTO context_cards (${cols}) VALUES (${ph})`).run(
    record as unknown as Record<string, string | number | null>
  );
  logEvent(db, {
    cardId: id,
    kind: "added",
    toState: freshness,
    detail: { sources: provenance.map((p) => p.path), verify: !!verifyCommand },
  });
  // Attribute the card to its originating session: register the session (if new)
  // and record that it touched this project/repo. Lets the UI show "established
  // by session X" and the user jump back. Only when we know it's a new card —
  // re-adding the same subject under the same session shouldn't double-count.
  if (input.originSessionId) {
    touchSession(db, input.originSessionId, {
      repos: [input.project, input.repoSlug ?? null].filter(
        (r): r is string => !!r
      ),
      countCard: !existing,
    });
  }
  return getCard(db, id)!;
}

// --- refresh one card's freshness against disk -----------------------------

/**
 * Recompute a card's freshness against the current filesystem (drift) and,
 * optionally, by re-running its verify command. Persists the new state and logs
 * the transition. Returns the refreshed card plus whether this call CAUGHT a
 * fresh->stale transition (used for the hero metric so each catch counts once).
 */
export function refreshCard(
  db: Database.Database,
  card: ContextCard,
  opts: { runVerify: boolean; cwd?: string }
): { card: ContextCard; caughtStale: boolean } {
  const cwd = opts.cwd ?? process.cwd();
  const drifted = detectDrift(card.provenance);
  const hasProvenance = card.provenance.length > 0;

  let verifyResult = card.verifyResult;
  let verifyCheckedAt = card.verifyCheckedAt;
  const ranVerifyNow = !!(opts.runVerify && card.verifyCommand);
  if (ranVerifyNow) {
    verifyResult = runVerifyCommand(card.verifyCommand!, cwd);
    verifyCheckedAt = nowIso();
  }

  // Is the card re-confirmed as of NOW? Never when sources drifted or a verify
  // failed. Otherwise: a provenance card is confirmed by its sources being
  // unchanged (the drift-check IS the verification — so it stays fresh while
  // stable, regardless of TTL). A verify-only card is confirmed only by actually
  // re-running its command this call and it passing. When confirmed, the TTL
  // clock resets; otherwise the stored lastVerifiedAt stands so TTL can expire.
  const verifyConfirmed = ranVerifyNow && verifyResult === "pass";
  const confirmedNow =
    drifted.length === 0 &&
    verifyResult !== "fail" &&
    (hasProvenance || verifyConfirmed);

  const effectiveLastVerified = confirmedNow ? nowIso() : card.lastVerifiedAt;
  const next = computeFreshness({
    hasProvenance,
    driftedCount: drifted.length,
    verifyResult,
    lastVerifiedAt: effectiveLastVerified,
    staleAfterDays: card.staleAfterDays,
  });

  const wasFresh = card.freshness === "fresh";
  const caughtStale = wasFresh && next !== "fresh";

  // lastVerifiedAt advances only when the card is confirmed still-true now.
  const lastVerifiedAt = confirmedNow ? effectiveLastVerified : card.lastVerifiedAt;

  db.prepare(
    `UPDATE context_cards SET freshness=?, driftedPaths=?, verifyResult=?,
      verifyCheckedAt=?, lastVerifiedAt=?, updatedAt=? WHERE id=?`
  ).run(
    next,
    JSON.stringify(drifted),
    verifyResult,
    verifyCheckedAt,
    lastVerifiedAt,
    nowIso(),
    card.id
  );

  if (caughtStale) {
    logEvent(db, {
      cardId: card.id,
      kind: "caught_stale",
      fromState: "fresh",
      toState: next,
      detail: { driftedPaths: drifted },
    });
  } else if (opts.runVerify && wasFresh === false && next === "fresh") {
    logEvent(db, {
      cardId: card.id,
      kind: "reverified",
      fromState: card.freshness,
      toState: "fresh",
    });
  }

  return { card: getCard(db, card.id)!, caughtStale };
}

// --- get (read path) -------------------------------------------------------

export interface GetCardsFilter {
  project?: string;
  freshOnly?: boolean;
  includeInactive?: boolean;
}

/**
 * Read cards for the session. When `recomputeDrift` is true (the CLI runs on the
 * owner machine where source files exist), each card is re-checked against disk
 * and freshness is updated live; any fresh->stale transition is caught and
 * counted. Cards are returned fresh-first, with flagged cards last so their
 * verify commands are the final thing the reader sees.
 */
export function getCards(
  db: Database.Database,
  filter: GetCardsFilter = {},
  opts: { recomputeDrift?: boolean; cwd?: string; logRead?: boolean } = {}
): ContextCard[] {
  const where: string[] = [];
  const params: Record<string, string> = {};
  if (!filter.includeInactive) where.push("status = 'active'");
  if (filter.project) {
    where.push("project = @project");
    params.project = filter.project;
  }
  const sql =
    "SELECT * FROM context_cards" +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "");
  let cards = (db.prepare(sql).all(params) as CardRow[]).map(rowToCard);

  if (opts.recomputeDrift) {
    cards = cards.map(
      (c) => refreshCard(db, c, { runVerify: false, cwd: opts.cwd }).card
    );
  }

  if (filter.freshOnly) cards = cards.filter((c) => c.freshness === "fresh");

  const rank: Record<Freshness, number> = {
    fresh: 0,
    drifted: 1,
    expired: 1,
    stale: 2,
    unverified: 3,
  };
  cards.sort(
    (a, b) =>
      rank[a.freshness] - rank[b.freshness] ||
      a.project.localeCompare(b.project) ||
      a.subject.localeCompare(b.subject)
  );

  if (opts.logRead !== false) {
    logEvent(db, {
      cardId: null,
      kind: "read",
      detail: { project: filter.project ?? null, cardCount: cards.length },
    });
  }
  return cards;
}

// --- verify ----------------------------------------------------------------

export function verifyCards(
  db: Database.Database,
  filter: { id?: string; project?: string; all?: boolean },
  opts: { cwd?: string } = {}
): { results: ContextCard[]; caught: number } {
  let cards: ContextCard[];
  if (filter.id) {
    // Accept either the full "project:subject" id or a bare subject when
    // --project is given (matches what users naturally type).
    const c =
      getCard(db, filter.id) ??
      (filter.project ? getCard(db, cardId(filter.project, filter.id)) : null);
    cards = c ? [c] : [];
  } else {
    cards = getCards(
      db,
      { project: filter.project },
      { recomputeDrift: false, logRead: false }
    );
  }
  let caught = 0;
  const results = cards.map((c) => {
    const { card, caughtStale } = refreshCard(db, c, {
      runVerify: true,
      cwd: opts.cwd,
    });
    if (caughtStale) caught++;
    return card;
  });
  return { results, caught };
}

// --- lifecycle -------------------------------------------------------------

export function supersedeCard(
  db: Database.Database,
  id: string,
  byId: string
): boolean {
  const info = db
    .prepare(
      "UPDATE context_cards SET status='superseded', supersededBy=?, updatedAt=? WHERE id=?"
    )
    .run(byId, nowIso(), id);
  if (info.changes > 0)
    logEvent(db, { cardId: id, kind: "superseded", detail: { by: byId } });
  return info.changes > 0;
}

export function retireCard(db: Database.Database, id: string): boolean {
  const info = db
    .prepare("UPDATE context_cards SET status='retired', updatedAt=? WHERE id=?")
    .run(nowIso(), id);
  if (info.changes > 0) logEvent(db, { cardId: id, kind: "retired" });
  return info.changes > 0;
}

// --- search ----------------------------------------------------------------

export function searchCards(
  db: Database.Database,
  query: string
): ContextCard[] {
  const like = `%${query}%`;
  const rows = db
    .prepare(
      `SELECT * FROM context_cards
       WHERE status='active' AND (subject LIKE ? OR claim LIKE ? OR detail LIKE ? OR tags LIKE ?)
       ORDER BY project, subject`
    )
    .all(like, like, like, like) as CardRow[];
  return rows.map(rowToCard);
}

// --- sessions --------------------------------------------------------------

function rowToSession(r: Record<string, unknown>): Session {
  return {
    id: r.id as string,
    startedAt: (r.startedAt as string) ?? null,
    endedAt: (r.endedAt as string) ?? null,
    summary: (r.summary as string) ?? null,
    branches: jsonArr<string>(r.branches),
    repos: jsonArr<string>(r.repos),
    cardCount: Number(r.cardCount ?? 0),
    createdAt: (r.createdAt as string) ?? null,
    updatedAt: (r.updatedAt as string) ?? null,
  };
}

export function getSession(db: Database.Database, id: string): Session | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToSession(row) : null;
}

export function getSessions(db: Database.Database): Session[] {
  const rows = db
    .prepare("SELECT * FROM sessions ORDER BY startedAt DESC, createdAt DESC")
    .all() as Record<string, unknown>[];
  return rows.map(rowToSession);
}

/**
 * Register a session (idempotent). Inserts the row on first sight with its
 * startedAt; a second call never moves startedAt or clobbers accumulated state.
 */
export function registerSession(
  db: Database.Database,
  input: { id: string; startedAt?: string; summary?: string | null }
): Session {
  const existing = getSession(db, input.id);
  const now = nowIso();
  if (!existing) {
    db.prepare(
      `INSERT INTO sessions (id, startedAt, endedAt, summary, branches, repos, cardCount, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      input.id,
      input.startedAt ?? now,
      null,
      input.summary ?? null,
      JSON.stringify([]),
      JSON.stringify([]),
      0,
      now,
      now
    );
  } else if (input.summary !== undefined && input.summary !== null) {
    db.prepare("UPDATE sessions SET summary=?, updatedAt=? WHERE id=?").run(
      input.summary,
      now,
      input.id
    );
  }
  return getSession(db, input.id)!;
}

/** Set free-form fields a session can't infer on its own (summary, branches). */
export function updateSession(
  db: Database.Database,
  id: string,
  patch: { summary?: string | null; branches?: string[]; endedAt?: string }
): Session | null {
  if (!getSession(db, id)) registerSession(db, { id });
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  if (patch.summary !== undefined) {
    sets.push("summary=?");
    vals.push(patch.summary);
  }
  if (patch.branches !== undefined) {
    sets.push("branches=?");
    vals.push(JSON.stringify(patch.branches));
  }
  if (patch.endedAt !== undefined) {
    sets.push("endedAt=?");
    vals.push(patch.endedAt);
  }
  if (sets.length === 0) return getSession(db, id);
  sets.push("updatedAt=?");
  vals.push(nowIso());
  db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id=?`).run(...vals, id);
  return getSession(db, id);
}

/**
 * Record that a session touched some repos/projects and (optionally) established
 * one more card. Auto-registers the session if it wasn't seen at start (a card
 * can be added with --session before any SessionStart hook ran). Repos are a
 * deduped union; cardCount only advances for genuinely new cards.
 */
export function touchSession(
  db: Database.Database,
  id: string,
  opts: { repos?: string[]; countCard?: boolean }
): void {
  const s = getSession(db, id) ?? registerSession(db, { id });
  const repos = Array.from(new Set([...s.repos, ...(opts.repos ?? [])]));
  const cardCount = s.cardCount + (opts.countCard ? 1 : 0);
  db.prepare(
    "UPDATE sessions SET repos=?, cardCount=?, updatedAt=? WHERE id=?"
  ).run(JSON.stringify(repos), cardCount, nowIso(), id);
}
