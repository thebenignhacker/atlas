import { test } from "node:test";
import assert from "node:assert/strict";
import { relativeTime } from "@/lib/util/date";

/**
 * Regression cover for "seven-week-old data read as 1mo ago". Month buckets of
 * 30 days put 50 and 59 days under the same label, which understates how old a
 * picture is exactly where the reader needs to know.
 */

const NOW = new Date("2026-10-17T18:00:00.000Z");

function daysBefore(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

test("week granularity holds through 90 days", () => {
  assert.equal(relativeTime(daysBefore(50), NOW), "7w ago");
  assert.equal(relativeTime(daysBefore(51), NOW), "7w ago");
  assert.equal(relativeTime(daysBefore(89), NOW), "12w ago");
});

test("months take over after 90 days", () => {
  assert.equal(relativeTime(daysBefore(100), NOW), "3mo ago");
  assert.equal(relativeTime(daysBefore(400), NOW), "1y ago");
});

test("a time after the clock reads as a day, never as a negative age", () => {
  // NOW is 18:00 UTC on 2026-10-17. A committer whose clock runs ahead can
  // write a time after it.
  assert.equal(relativeTime("2026-10-17T21:00:00Z", NOW), "today");
  assert.equal(relativeTime("2026-10-17T23:59:59-07:00", NOW), "2026-10-18");
  assert.equal(relativeTime("2026-10-18T00:00:00Z", NOW), "2026-10-18");
  assert.equal(relativeTime("2026-10-25T12:00:00Z", NOW), "2026-10-25");
});

test("days, today and yesterday are unchanged", () => {
  assert.equal(relativeTime(NOW.toISOString(), NOW), "today");
  assert.equal(relativeTime(daysBefore(1), NOW), "yesterday");
  assert.equal(relativeTime(daysBefore(5), NOW), "5d ago");
  assert.equal(relativeTime(daysBefore(20), NOW), "2w ago");
  assert.equal(relativeTime(null, NOW), "never");
});
