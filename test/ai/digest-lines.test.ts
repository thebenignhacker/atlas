import { test } from "node:test";
import assert from "node:assert/strict";
import { recentEventLine } from "@/lib/ai/digest-lines";

/**
 * The digest's RECENT COMMITS lines name each event's day as the activity view
 * does: the UTC day of its instant (utcDate). Commit times carry the
 * committer's UTC offset (git log --format=%cI), so the first ten characters of
 * a time can name another day. The reproduction of #93: 23:30 at UTC-07:00 on
 * 2026-03-01 is 06:30 UTC on 2026-03-02, listed under 2026-03-02 on the
 * activity page and written as 2026-03-01 in the digest.
 */

test("a recent event is written under the UTC day of its instant", () => {
  assert.equal(
    recentEventLine({ ts: "2026-03-01T23:30:00-07:00", title: "beta commit" }),
    "- 2026-03-02 beta commit"
  );
  assert.equal(
    recentEventLine({ ts: "2026-03-02T01:00:00+00:00", title: "alpha commit" }),
    "- 2026-03-02 alpha commit"
  );
  assert.equal(
    recentEventLine({ ts: "2026-03-02T01:00:00+05:30", title: "gamma commit" }),
    "- 2026-03-01 gamma commit"
  );
});

test("a recent event with no readable time is written without a day", () => {
  assert.equal(recentEventLine({ ts: null, title: "undated" }), "- undated");
  assert.equal(recentEventLine({ ts: "not a time", title: "unparsed" }), "- unparsed");
});
