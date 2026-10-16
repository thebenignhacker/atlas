import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { RoadmapBoard } from "@/components/RoadmapBoard";
import type { RoadmapItem } from "@/lib/roadmap-shared";

/**
 * A native select is as wide as its longest option, and an owner can be a whole
 * sentence. Without a width bound, one long owner made the owner filter far wider
 * than the screen, and the roadmap page scrolled sideways on a phone and on a
 * desktop.
 */

const LONG_OWNER = "release scheduling and reporting work ".repeat(11).slice(0, 400);

function item(id: string, owner: string | null): RoadmapItem {
  return {
    id,
    title: `Unit ${id}`,
    area: "Platform",
    kind: "code",
    status: "ready",
    priority: "P1",
    order: 0,
    dependsOn: [],
    repos: [],
    links: [],
    owner,
    execution: null,
    effort: null,
    body: "",
    comments: [],
    path: `${id}.md`,
  };
}

const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
};

test("the owner filter keeps a width bound when an owner is 400 characters long", () => {
  const html = renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(RoadmapBoard, { items: [item("a", LONG_OWNER), item("b", "release team"), item("c", null)] })
    )
  );

  const select = html.split("<select").find((s) => s.includes(">All owners</option>"));
  assert.ok(select, "the board renders an owner filter");
  assert.ok(select.includes(`>${LONG_OWNER}</option>`), "the long owner is one of its options");
  const classes = select.slice(0, select.indexOf(">")).match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];
  assert.ok(
    classes.some((c) => c.startsWith("max-w-")),
    `the owner filter has a max-width at every screen size; its classes are: ${classes.join(" ")}`
  );
});
