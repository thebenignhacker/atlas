import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUMMARY_STALE_FLAG,
  summaryPresentation,
} from "@/lib/ai/summary-presentation";

/**
 * A cached repo summary is prose written at one moment, shown beside tiles
 * measured at another. The reader takes it as the current state, so the page
 * must say when it was written and whether the repo has moved since. These
 * pin each branch of that rule.
 */

const lastCommitAt = "2026-08-26T21:44:16-06:00";
const text = "Marked stable with 32 commits in the last month.";

test("a summary with no recorded date is not shown", () => {
  assert.deepEqual(summaryPresentation({ text, generatedAt: null }, lastCommitAt), {
    show: false,
  });
});

test("no summary at all is not shown", () => {
  assert.deepEqual(summaryPresentation(null, lastCommitAt), { show: false });
});

test("an unparseable date counts as no date", () => {
  assert.deepEqual(
    summaryPresentation({ text, generatedAt: "not a date" }, lastCommitAt),
    { show: false }
  );
});

test("a summary written before the latest commit is shown with the flag line", () => {
  const p = summaryPresentation({ text, generatedAt: "2026-08-01T00:00:00Z" }, lastCommitAt);
  assert.deepEqual(p, {
    show: true,
    text,
    badge: "AI-generated · 2026-08-01",
    staleFlag: SUMMARY_STALE_FLAG,
  });
  assert.equal(
    SUMMARY_STALE_FLAG,
    "Written before the latest commit; counts in the text may differ from the tiles."
  );
});

test("a summary written after the latest commit is shown plain", () => {
  const p = summaryPresentation({ text, generatedAt: "2026-09-01T00:00:00Z" }, lastCommitAt);
  assert.deepEqual(p, {
    show: true,
    text,
    badge: "AI-generated · 2026-09-01",
    staleFlag: null,
  });
});

test("the comparison is by instant, not by string, across time zones", () => {
  // 03:00Z on the 27th is 21:00 on the 26th in -06:00: still before the
  // 21:44 commit, though the date string sorts after it.
  const before = summaryPresentation(
    { text, generatedAt: "2026-08-27T03:00:00Z" },
    lastCommitAt
  );
  assert.equal(before.show && before.staleFlag, SUMMARY_STALE_FLAG);
  const after = summaryPresentation(
    { text, generatedAt: "2026-08-27T04:00:00Z" },
    lastCommitAt
  );
  assert.equal(after.show && after.staleFlag, null);
});

test("a repo with no recorded commit shows a dated summary plain", () => {
  const p = summaryPresentation({ text, generatedAt: "2026-08-01T00:00:00Z" }, null);
  assert.equal(p.show && p.staleFlag, null);
});
