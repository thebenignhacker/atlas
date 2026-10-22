import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActivityEvent } from "@/lib/types";
import { ActivityView } from "@/components/ActivityView";

/**
 * A select is as wide as its longest option, and the activity page's
 * repository filter had no width limit, so a repository name set its width. On
 * a phone the filter's row is what the 4rem rail and the page's 20px padding on
 * each side leave of the screen: 271px at 375px wide. Measured in headless
 * Chrome with the committed public snapshot, whose longest name is the one
 * below, the select was 290px wide in that row and ended at x=374; at 360px
 * wide it made the page 374px wide, so the page scrolled sideways. The select
 * is now capped to the width of its row.
 *
 * The cap alone left WebKit scrolling. Measured in Playwright's WebKit build
 * with phone emulation at 320x640 and the same snapshot, the capped select was
 * 216px wide and ended at x=300, and choosing the name below, whose text runs
 * past the select's edge, made the page 340px wide; Chromium and Firefox stayed
 * at 320px. With the select's overflow hidden, WebKit kept the page at 320px,
 * so the select now clips its text inside its own box.
 */

const LONG = "agent-identity-management-telemetry";

const event = (id: string, repoSlug: string): ActivityEvent => ({
  id,
  repoSlug,
  type: "commit",
  title: `commit ${id}`,
  ts: "2026-10-01T12:00:00.000Z",
  meta: null,
  scannedAt: "2026-10-01T12:00:00.000Z",
});

const classesOf = (tag: string) => tag.match(/\sclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];

/** The repository filter's classes, rendered with the long name as an option. */
function filterClasses(): string[] {
  const html = renderToStaticMarkup(
    createElement(ActivityView, {
      events: [event("1", "atlas"), event("2", "telemetry")],
      repoMap: { atlas: "atlas", telemetry: LONG },
    })
  );
  const select = html.match(/<select\b[^>]*\saria-label="Filter by repository"[^>]*>[\s\S]*?<\/select>/)?.[0];
  assert.ok(select, `the activity view renders its repository filter; markup: ${html.slice(0, 300)}`);
  assert.ok(select.includes(`>${LONG}</option>`), "the long repository name is one of the options");
  return classesOf(select.slice(0, select.indexOf(">")));
}

test("the repository filter is no wider than its row", () => {
  const classes = filterClasses();
  assert.ok(classes.includes("max-w-full"), `the select is capped to its row's width: ${classes.join(" ")}`);
});

test("the repository filter clips a long name inside its own box", () => {
  const classes = filterClasses();
  assert.ok(classes.includes("overflow-hidden"), `the select clips its text to its box: ${classes.join(" ")}`);
});
