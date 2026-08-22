import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";
import {
  allStatuses,
  deadlineState,
  enqueueItem,
  markDone,
  releaseLease,
  takeLease,
  trainStatus,
} from "@/lib/context/train";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

const T0 = new Date("2026-08-22T10:00:00Z");
const at = (hoursLater: number) => new Date(T0.getTime() + hoursLater * 3_600_000);

test("enqueue creates the train and returns the stored item", () => {
  const db = freshDb();
  const item = enqueueItem(
    db,
    { repo: "demo", item: "PR #1 rides the next cut", sessionId: "sess-a" },
    T0
  );
  assert.equal(item.kind, "obligation");
  assert.equal(item.status, "pending");
  assert.equal(item.addedBySessionId, "sess-a");
  const status = trainStatus(db, "demo", T0);
  assert.ok(status);
  assert.equal(status.pending.length, 1);
  assert.equal(status.doneCount, 0);
  assert.deepEqual(status.lease, { state: "none" });
});

test("status is null for a repo with no train — callers can rely on the distinction", () => {
  const db = freshDb();
  assert.equal(trainStatus(db, "never-seen", T0), null);
});

test("deadline must be a date and an action needs a deadline", () => {
  const db = freshDb();
  assert.throws(
    () => enqueueItem(db, { repo: "d", item: "x", deadline: "tomorrow" }, T0),
    /YYYY-MM-DD/
  );
  assert.throws(
    () => enqueueItem(db, { repo: "d", item: "x", deadlineAction: "cut a patch" }, T0),
    /needs a --deadline/
  );
});

test("deadlineState derives upcoming, due and overdue from the clock", () => {
  const db = freshDb();
  const item = enqueueItem(
    db,
    { repo: "d", item: "security bump", deadline: "2026-08-23", deadlineAction: "cut alone" },
    T0
  );
  assert.equal(deadlineState(item, new Date("2026-08-22T23:59:00Z")), "upcoming");
  assert.equal(deadlineState(item, new Date("2026-08-23T00:01:00Z")), "due");
  assert.equal(deadlineState(item, new Date("2026-08-24T00:01:00Z")), "overdue");
  const done = markDone(db, "d", item.id, null, T0);
  assert.ok(done);
  assert.equal(deadlineState(done, new Date("2026-08-24T00:01:00Z")), "none");
});

test("a second session is refused while the lease is unexpired", () => {
  const db = freshDb();
  enqueueItem(db, { repo: "d", item: "x" }, T0);
  const first = takeLease(db, "d", "sess-a", 24, T0);
  assert.ok(first.ok);
  const second = takeLease(db, "d", "sess-b", 24, at(1));
  assert.ok(!second.ok);
  assert.equal(second.ok === false && second.holder.sessionId, "sess-a");
  // The holder renewing is not a conflict.
  const renew = takeLease(db, "d", "sess-a", 24, at(2));
  assert.ok(renew.ok && renew.renewed && renew.displaced === null);
});

test("an expired lease can be taken over, and the takeover names what it displaced", () => {
  const db = freshDb();
  enqueueItem(db, { repo: "d", item: "x" }, T0);
  takeLease(db, "d", "sess-a", 2, T0);
  const status = trainStatus(db, "d", at(3));
  assert.ok(status && status.lease.state === "expired");
  const takeover = takeLease(db, "d", "sess-b", 24, at(3));
  assert.ok(takeover.ok);
  assert.equal(takeover.ok && takeover.displaced?.sessionId, "sess-a");
});

test("leasing a repo with no train is an error, not a silent creation", () => {
  const db = freshDb();
  assert.throws(() => takeLease(db, "typo-repo", "sess-a", 24, T0), /no release train/);
});

test("releasing reports a foreign release; releasing nothing reports nothing", () => {
  const db = freshDb();
  enqueueItem(db, { repo: "d", item: "x" }, T0);
  assert.deepEqual(releaseLease(db, "d", "sess-a", T0), { released: false });
  takeLease(db, "d", "sess-a", 24, T0);
  const foreign = releaseLease(db, "d", "sess-b", at(1));
  assert.ok(foreign.released && foreign.foreign && foreign.wasHeldBy === "sess-a");
});

test("markDone moves an item out of pending exactly once", () => {
  const db = freshDb();
  const a = enqueueItem(db, { repo: "d", item: "one" }, T0);
  enqueueItem(db, { repo: "d", item: "two", kind: "closing-step" }, T0);
  const done = markDone(db, "d", a.id, "sess-a", at(1));
  assert.ok(done && done.status === "done" && done.doneBySessionId === "sess-a");
  const again = markDone(db, "d", a.id, "sess-b", at(2));
  assert.ok(again && again.doneBySessionId === "sess-a"); // first close stands
  assert.equal(markDone(db, "d", 999, null, at(1)), null);
  const status = trainStatus(db, "d", at(2));
  assert.ok(status);
  assert.equal(status.pending.length, 1);
  assert.equal(status.doneCount, 1);
});

test("allStatuses lists every train, sorted by repo", () => {
  const db = freshDb();
  enqueueItem(db, { repo: "zeta", item: "z" }, T0);
  enqueueItem(db, { repo: "alpha", item: "a" }, T0);
  const repos = allStatuses(db, T0).map((s) => s.repo);
  assert.deepEqual(repos, ["alpha", "zeta"]);
});
