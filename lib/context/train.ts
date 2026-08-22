import type Database from "better-sqlite3";

/**
 * Release trains: the release of a repo is a SERIAL resource (one version line,
 * capped publish budget, ordered post-publish obligations), so its state lives
 * here as data instead of in prose handoff files that rot in a day.
 *
 * The model, per repo:
 *  - a QUEUE of obligations any session appends at merge time and moves on —
 *    the merge is the handoff; nobody waits for the release to happen;
 *  - one CONDUCTOR LEASE at a time — advisory and visible, never enforcing.
 *    Expiry is loud (status shows EXPIRED), never a silent reassignment;
 *  - items may carry a DEADLINE with an action ("no publish by <date> → cut a
 *    patch with this alone"), surfaced loudly once due.
 *
 * Reporting-only by design: the existing publish gates remain the enforcement
 * of last resort. Atlas being unreachable degrades to files + gates; nothing
 * here may ever block a release.
 */

export type TrainItemKind = "obligation" | "closing-step";
export type TrainItemStatus = "pending" | "done";

export interface TrainItem {
  id: number;
  repo: string;
  kind: TrainItemKind;
  item: string;
  deadline: string | null; // YYYY-MM-DD; due/overdue is derived, never stored
  deadlineAction: string | null;
  status: TrainItemStatus;
  addedBySessionId: string | null;
  addedAt: string;
  doneAt: string | null;
  doneBySessionId: string | null;
}

export interface LeaseInfo {
  sessionId: string;
  takenAt: string;
  expiresAt: string;
}

export type LeaseState =
  | { state: "none" }
  | { state: "active"; lease: LeaseInfo }
  | { state: "expired"; lease: LeaseInfo };

export interface TrainStatus {
  repo: string;
  pending: TrainItem[];
  doneCount: number;
  lease: LeaseState;
}

interface TrainRow {
  repo: string;
  leaseSessionId: string | null;
  leaseTakenAt: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const iso = (d: Date) => d.toISOString();

/** YYYY-MM-DD of `now` in UTC — deadlines are dates, compared as dates. */
const utcDate = (now: Date) => now.toISOString().slice(0, 10);

export function deadlineState(
  item: Pick<TrainItem, "deadline" | "status">,
  now: Date
): "none" | "upcoming" | "due" | "overdue" {
  if (!item.deadline || item.status !== "pending") return "none";
  const today = utcDate(now);
  if (item.deadline < today) return "overdue";
  if (item.deadline === today) return "due";
  return "upcoming";
}

export function getTrain(db: Database.Database, repo: string): TrainRow | null {
  return (
    (db.prepare("SELECT * FROM release_trains WHERE repo = ?").get(repo) as
      | TrainRow
      | undefined) ?? null
  );
}

function ensureTrain(db: Database.Database, repo: string, now: Date): void {
  db.prepare(
    "INSERT OR IGNORE INTO release_trains (repo, createdAt, updatedAt) VALUES (?, ?, ?)"
  ).run(repo, iso(now), iso(now));
}

function touch(db: Database.Database, repo: string, now: Date): void {
  db.prepare("UPDATE release_trains SET updatedAt = ? WHERE repo = ?").run(iso(now), repo);
}

export function enqueueItem(
  db: Database.Database,
  input: {
    repo: string;
    item: string;
    kind?: TrainItemKind;
    deadline?: string | null;
    deadlineAction?: string | null;
    sessionId?: string | null;
  },
  now: Date = new Date()
): TrainItem {
  if (input.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(input.deadline)) {
    throw new Error(`deadline must be YYYY-MM-DD, got "${input.deadline}"`);
  }
  if (input.deadlineAction && !input.deadline) {
    throw new Error("a deadline action needs a --deadline to trigger on");
  }
  ensureTrain(db, input.repo, now);
  const info = db
    .prepare(
      `INSERT INTO train_items (repo, kind, item, deadline, deadlineAction, addedBySessionId, addedAt)
       VALUES (@repo, @kind, @item, @deadline, @deadlineAction, @sessionId, @addedAt)`
    )
    .run({
      repo: input.repo,
      kind: input.kind ?? "obligation",
      item: input.item,
      deadline: input.deadline ?? null,
      deadlineAction: input.deadlineAction ?? null,
      sessionId: input.sessionId ?? null,
      addedAt: iso(now),
    });
  touch(db, input.repo, now);
  return db
    .prepare("SELECT * FROM train_items WHERE id = ?")
    .get(info.lastInsertRowid) as TrainItem;
}

export function leaseState(train: TrainRow, now: Date): LeaseState {
  if (!train.leaseSessionId || !train.leaseExpiresAt || !train.leaseTakenAt) {
    return { state: "none" };
  }
  const lease: LeaseInfo = {
    sessionId: train.leaseSessionId,
    takenAt: train.leaseTakenAt,
    expiresAt: train.leaseExpiresAt,
  };
  return iso(now) < train.leaseExpiresAt
    ? { state: "active", lease }
    : { state: "expired", lease };
}

export function trainStatus(
  db: Database.Database,
  repo: string,
  now: Date = new Date()
): TrainStatus | null {
  const train = getTrain(db, repo);
  if (!train) return null;
  const pending = db
    .prepare(
      "SELECT * FROM train_items WHERE repo = ? AND status = 'pending' ORDER BY id"
    )
    .all(repo) as TrainItem[];
  const doneCount = (
    db
      .prepare(
        "SELECT count(*) n FROM train_items WHERE repo = ? AND status = 'done'"
      )
      .get(repo) as { n: number }
  ).n;
  return { repo, pending, doneCount, lease: leaseState(train, now) };
}

export function allStatuses(db: Database.Database, now: Date = new Date()): TrainStatus[] {
  const repos = db
    .prepare("SELECT repo FROM release_trains ORDER BY repo")
    .all() as { repo: string }[];
  return repos
    .map((r) => trainStatus(db, r.repo, now))
    .filter((s): s is TrainStatus => s !== null);
}

export type LeaseResult =
  | { ok: true; lease: LeaseInfo; displaced: LeaseInfo | null; renewed: boolean }
  | { ok: false; holder: LeaseInfo };

/**
 * Take (or renew) the conductor lease. Refused while another session's lease is
 * unexpired — the refusal is the coordination. Taking over an EXPIRED lease
 * succeeds and reports what it displaced, so a takeover is always visible.
 */
export function takeLease(
  db: Database.Database,
  repo: string,
  sessionId: string,
  ttlHours: number,
  now: Date = new Date()
): LeaseResult {
  const train = getTrain(db, repo);
  if (!train) {
    throw new Error(
      `no release train for "${repo}" — enqueue an obligation first (a lease on an empty train coordinates nothing)`
    );
  }
  const current = leaseState(train, now);
  if (current.state === "active" && current.lease.sessionId !== sessionId) {
    return { ok: false, holder: current.lease };
  }
  const lease: LeaseInfo = {
    sessionId,
    takenAt: iso(now),
    expiresAt: iso(new Date(now.getTime() + ttlHours * 3_600_000)),
  };
  db.prepare(
    `UPDATE release_trains
        SET leaseSessionId = ?, leaseTakenAt = ?, leaseExpiresAt = ?, updatedAt = ?
      WHERE repo = ?`
  ).run(lease.sessionId, lease.takenAt, lease.expiresAt, iso(now), repo);
  return {
    ok: true,
    lease,
    displaced: current.state === "expired" ? current.lease : null,
    renewed: current.state === "active" && current.lease.sessionId === sessionId,
  };
}

export type ReleaseLeaseResult =
  | { released: false }
  | { released: true; wasHeldBy: string; foreign: boolean };

/** Clear the lease. Releasing another session's lease works but is reported. */
export function releaseLease(
  db: Database.Database,
  repo: string,
  sessionId: string | null,
  now: Date = new Date()
): ReleaseLeaseResult {
  const train = getTrain(db, repo);
  if (!train?.leaseSessionId) return { released: false };
  const wasHeldBy = train.leaseSessionId;
  db.prepare(
    `UPDATE release_trains
        SET leaseSessionId = NULL, leaseTakenAt = NULL, leaseExpiresAt = NULL, updatedAt = ?
      WHERE repo = ?`
  ).run(iso(now), repo);
  return { released: true, wasHeldBy, foreign: wasHeldBy !== sessionId };
}

export function markDone(
  db: Database.Database,
  repo: string,
  id: number,
  sessionId: string | null,
  now: Date = new Date()
): TrainItem | null {
  const item = db
    .prepare("SELECT * FROM train_items WHERE repo = ? AND id = ?")
    .get(repo, id) as TrainItem | undefined;
  if (!item) return null;
  if (item.status === "done") return item;
  db.prepare(
    "UPDATE train_items SET status = 'done', doneAt = ?, doneBySessionId = ? WHERE id = ?"
  ).run(iso(now), sessionId ?? null, id);
  touch(db, repo, now);
  return db.prepare("SELECT * FROM train_items WHERE id = ?").get(id) as TrainItem;
}
