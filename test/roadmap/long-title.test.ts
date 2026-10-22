import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoadmapBoard } from "@/components/RoadmapBoard";
import type { RoadmapItem } from "@/lib/roadmap-shared";
import { inAppRouter } from "../app-router";

/**
 * Each roadmap card puts its title, an h3, beside its priority badge in a flex
 * row. A title holding a run with no break opportunity, such as an identifier,
 * could not narrow below that run, so it pushed the badge past the card's edge.
 * Measured in Playwright's Chromium and WebKit builds with phone emulation
 * against next start in unified mode, with an owner session, on an owner
 * snapshot of 42 items, 21 of whose titles carry an unbroken run of 25 to 41
 * characters: at 320x640 the page was 472px wide, the widest title 301px in a
 * 136px row, and 21 of the 42 badges ended past the screen's right edge. The
 * title now narrows and breaks the run.
 *
 * The same title shows in the dependency chip of each item that depends on it.
 * With the title's change alone and items depending on long-titled ones,
 * dependency chips kept the page 334px wide at 320x640, so the chip breaks the
 * run the same way.
 */

const RUN = "registry_trust_lookup_with_signed_attestation".slice(0, 41);
const TITLE = `Move ${RUN} into the core`;

function item(id: string, title: string, dependsOn: string[] = []): RoadmapItem {
  return {
    id,
    title,
    area: "Platform",
    kind: "code",
    status: "ready",
    priority: "P1",
    order: 0,
    dependsOn,
    repos: [],
    links: [],
    owner: null,
    execution: null,
    effort: null,
    body: "",
    comments: [],
    path: `${id}.md`,
  };
}

const classesOf = (attrs: string) => attrs.match(/\sclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];

/** The signed-in board, read-only as on a deployed host, with a long-titled item and one that depends on it. */
function board(): string {
  return renderToStaticMarkup(
    inAppRouter(
      createElement(RoadmapBoard, {
        items: [item("long", TITLE), item("after", "Unit after", ["long"])],
        readOnly: true,
      })
    )
  );
}

test("a card title with a 41-character unbroken run can narrow and break inside its card", () => {
  const html = board();
  const h3 = [...html.matchAll(/<h3\b([^>]*)>([^<]*)<\/h3>/g)].find((m) => m[2] === TITLE);
  assert.ok(h3, `the board renders the long title as a card heading; markup: ${html.slice(0, 300)}`);
  assert.ok(
    html.slice(h3.index + h3[0].length).startsWith("<span"),
    "the priority badge follows the title in the same row"
  );
  const classes = classesOf(h3[1]);
  assert.ok(classes.includes("min-w-0"), `the title can narrow beside the badge: ${classes.join(" ")}`);
  assert.ok(
    classes.includes("[overflow-wrap:anywhere]"),
    `the title breaks a run with no break opportunity: ${classes.join(" ")}`
  );
});

test("a dependency chip showing that title can narrow and break inside its card", () => {
  const html = board();
  const chip = html.match(new RegExp(`<span\\b([^>]*\\stitle="${TITLE}"[^>]*)>`));
  assert.ok(chip, "the dependent item's card shows the long title in a dependency chip");
  const classes = classesOf(chip[1]);
  assert.ok(classes.includes("min-w-0"), `the chip can narrow in its row: ${classes.join(" ")}`);
  assert.ok(
    classes.includes("[overflow-wrap:anywhere]"),
    `the chip breaks a run with no break opportunity: ${classes.join(" ")}`
  );
});
