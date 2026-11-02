import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTEMPTS,
  WINDOW_MS,
  rateLimit,
  recordFailure,
  trackedKeyCount,
} from "@/lib/owner-auth/ratelimit";

// The sign-in limiter keeps one bucket per key in process memory. Each test
// passes its times explicitly and starts ten windows after the times the
// previous test used, so the buckets earlier tests left have all expired.

let epoch = 0;
function freshEpoch(): number {
  epoch += 10 * WINDOW_MS;
  return epoch;
}

test("five failures inside a window refuse the sixth attempt until the window passes", () => {
  const t0 = freshEpoch();
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    assert.equal(rateLimit("client", t0 + i).allowed, true, `attempt ${i + 1}`);
    recordFailure("client", t0 + i);
  }
  const at = t0 + MAX_ATTEMPTS;
  const refused = rateLimit("client", at);
  assert.equal(refused.allowed, false);
  // The window opened with the first failure, at t0.
  assert.equal(refused.retryAfterSec, Math.ceil((t0 + WINDOW_MS - at) / 1000));
  assert.equal(rateLimit("client", t0 + WINDOW_MS + 1).allowed, true);
});

test("a recorded failure drops every key whose window has passed", () => {
  const t0 = freshEpoch();
  for (let i = 0; i < 100; i++) recordFailure(`client-${i}`, t0);
  recordFailure("late", t0 + WINDOW_MS + 1);
  assert.equal(trackedKeyCount(), 1);
});

test("keys still inside their window are kept with their counts", () => {
  const t0 = freshEpoch();
  recordFailure("early", t0);
  recordFailure("mid", t0 + WINDOW_MS / 2);
  recordFailure("late", t0 + WINDOW_MS + 1);
  assert.equal(trackedKeyCount(), 2, "early is dropped; mid and late are kept");
  for (let i = 1; i < MAX_ATTEMPTS; i++) recordFailure("mid", t0 + WINDOW_MS + 2);
  assert.equal(rateLimit("mid", t0 + WINDOW_MS + 3).allowed, false);
});

test("under a new key per failure the map holds only the keys whose window is open", () => {
  const t0 = freshEpoch();
  const step = WINDOW_MS / 10;
  for (let i = 0; i < 100; i++) {
    recordFailure(`client-${i}`, t0 + i * step);
    // Keys recorded at most one window ago: this one and the ten before it.
    assert.equal(trackedKeyCount(), Math.min(i + 1, 11), `after failure ${i + 1}`);
  }
});
