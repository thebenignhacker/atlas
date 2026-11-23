import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActivityEvent } from "@/lib/types";
import { ActivityView } from "@/components/ActivityView";

/**
 * Commit times carry the committer's UTC offset (git log --format=%cI), so the
 * first ten characters of a time are its date in that offset. The three events
 * below all fall on 2026-03-02 in UTC, yet beta, the latest, reads 2026-03-01
 * as text, and the day list showed gamma and alpha above it. The day list, its
 * day labels and the heatmap now take each event's day in UTC, and the day list
 * orders events by instant.
 *
 * The clock is pinned to 06:45 UTC on 2026-03-02: after the three events,
 * before noon UTC, and still 2026-03-01 in America/Denver (UTC-07:00 until
 * 2026-03-08). The heatmap's days used to follow the zone the view renders in,
 * so the cases render in three zones and expect the same result in each.
 */

const BETA_AT = "2026-03-01T23:30:00-07:00"; // 06:30 UTC on 2026-03-02, the latest
const GAMMA_AT = "2026-03-02T03:00:00Z"; // 03:00 UTC
const ALPHA_AT = "2026-03-02T01:00:00+00:00"; // 01:00 UTC, the earliest

const NOW = Date.parse("2026-03-02T06:45:00Z");
const ZONES = ["UTC", "America/Denver", "Pacific/Kiritimati"];

const event = (title: string, ts: string): ActivityEvent => ({
  id: title,
  repoSlug: "atlas",
  type: "commit",
  title,
  ts,
  meta: null,
  scannedAt: "2026-03-02T06:45:00Z",
});

/** The view's markup at NOW in `zone`, without React's text separators. */
function render(events: ActivityEvent[], zone: string): string {
  const saved = process.env.TZ;
  process.env.TZ = zone;
  mock.timers.enable({ apis: ["Date"], now: NOW });
  try {
    return renderToStaticMarkup(createElement(ActivityView, { events, repoMap: {} })).replace(
      /<!-- -->/g,
      ""
    );
  } finally {
    mock.timers.reset();
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
}

/**
 * The day list as [label, titles] pairs in render order. A day's label is the
 * div with the sm:w-24 class; an event's title is a span whose title attribute
 * repeats its text.
 */
function dayList(html: string): Array<[string, string[]]> {
  const days: Array<[string, string[]]> = [];
  const parts = /<div class="[^"]*sm:w-24[^"]*">([^<]*)<\/div>|<span title="([^"]+)"[^>]*>\2<\/span>/g;
  for (const m of html.matchAll(parts)) {
    if (m[1] !== undefined) days.push([m[1], []]);
    else days.at(-1)?.[1].push(m[2]);
  }
  return days;
}

const inInstantOrder = () => [
  event("beta", BETA_AT),
  event("gamma", GAMMA_AT),
  event("alpha", ALPHA_AT),
];

test("the day list files each event under its UTC day, latest first", () => {
  for (const zone of ZONES) {
    assert.deepEqual(
      dayList(render(inInstantOrder(), zone)),
      [["today", ["beta", "gamma", "alpha"]]],
      `rendered in ${zone}`
    );
  }
});

test("the day list follows instant order when events arrive in text order", () => {
  // Sorted on the text of ts, latest first: gamma, alpha, beta.
  const inTextOrder = [event("gamma", GAMMA_AT), event("alpha", ALPHA_AT), event("beta", BETA_AT)];
  for (const zone of ZONES) {
    assert.deepEqual(
      dayList(render(inTextOrder, zone)),
      [["today", ["beta", "gamma", "alpha"]]],
      `rendered in ${zone}`
    );
  }
});

test("an event whose time does not parse is listed last, under never", () => {
  const events = [event("undated", "not a time"), event("beta", BETA_AT)];
  for (const zone of ZONES) {
    assert.deepEqual(
      dayList(render(events, zone)),
      [
        ["today", ["beta"]],
        ["never", ["undated"]],
      ],
      `rendered in ${zone}`
    );
  }
});

test("the heatmap counts each event on its UTC day", () => {
  for (const zone of ZONES) {
    const html = render(inInstantOrder(), zone);
    assert.ok(html.includes('title="2026-03-02: 3 commit(s)"'), `2026-03-02 holds all three, in ${zone}`);
    assert.ok(html.includes('title="2026-03-01: 0 commit(s)"'), `2026-03-01 holds none, in ${zone}`);
    assert.equal(
      html.match(/(\d+) commits in the last \d+ weeks/)?.[1],
      "3",
      `the heatmap's total counts all three, in ${zone}`
    );
  }
});
