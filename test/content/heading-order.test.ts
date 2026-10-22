import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UsageCharts } from "@/components/UsageCharts";
import { ActivityView } from "@/components/ActivityView";
import { EMPTY_USAGE, type UsageRollup } from "@/lib/usage/types";
import type { ActivityEvent } from "@/lib/types";

/**
 * The chart panel titles are h3s. On the portfolio they sit under the h2 "At a
 * glance", but on /usage and /activity the page's h1 was directly above them,
 * so the outline skipped from h1 to h3. Both views now open with an h2 above
 * their panels. Above these views each page renders only its header, whose
 * heading is the h1, and on /usage the stat strip, which has no heading.
 */

const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "").trim();

/** The headings in document order, as [level, text]. */
function headings(el: ReactElement): [number, string][] {
  const html = renderToStaticMarkup(el);
  return [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => [Number(m[1]), text(m[2])]);
}

/** Fails when a heading sits more than one level below the one before it, starting under the page's h1. */
function assertNoSkippedLevel(found: [number, string][], view: string) {
  let previous = 1;
  for (const [level, title] of found) {
    assert.ok(level <= previous + 1, `${view}: h${level} "${title}" follows h${previous}`);
    previous = level;
  }
}

const USAGE: UsageRollup = {
  ...EMPTY_USAGE,
  totals: { events: 12, features: 2, sessions: 1, activeDays: 1, workflowsRun: 0 },
  spark: [0, 4, 8],
  byCategory: [{ category: "file", count: 12 }],
  projects: [{ project: "alpha", count: 12 }],
};

const EVENTS: ActivityEvent[] = [
  {
    id: "e1",
    repoSlug: "alpha",
    type: "commit",
    title: "Add the parser",
    ts: new Date().toISOString(),
    meta: null,
    scannedAt: new Date().toISOString(),
  },
];

test("the usage charts open with an h2 above their h3 panel titles", () => {
  const found = headings(createElement(UsageCharts, { usage: USAGE }));
  assert.deepEqual(found[0], [2, "At a glance"]);
  assert.deepEqual(
    found.slice(1),
    [
      [3, "By category"],
      [3, "Activity"],
      [3, "By project"],
    ]
  );
  assertNoSkippedLevel(found, "/usage");
});

test("the activity view opens with an h2 above its h3 panel titles", () => {
  const found = headings(createElement(ActivityView, { events: EVENTS, repoMap: { alpha: "alpha" } }));
  assert.deepEqual(found[0], [2, "At a glance"]);
  assert.deepEqual(
    found.slice(1).map(([level, title]) => [level, title.replace(/\s+/g, " ")]),
    [
      [3, "Most active repos"],
      [3, "By type"],
      [3, "Commits per week"],
      [3, "Daily heatmap · last 13 weeks"],
    ]
  );
  assertNoSkippedLevel(found, "/activity");
});
