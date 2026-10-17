import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerOnly } from "@/components/OwnerOnly";

/**
 * In the public view, /tokens, /roadmap, /strategy, /sessions, /session-board,
 * /todos, /decisions, /digest and /settings render only the private-view
 * placeholder, whose heading was an h2, so those pages had no h1. The
 * placeholder's heading is now the page's h1, and the shell around it adds none.
 */

const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "");

test("the private-view placeholder's heading is an h1 naming the feature", () => {
  const html = renderToStaticMarkup(createElement(OwnerOnly, { feature: "Tokens" }));
  const h1s = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/g) ?? [];
  assert.equal(h1s.length, 1, `one h1; markup: ${html}`);
  assert.equal(text(h1s[0]), "Tokens is private");
  assert.doesNotMatch(html, /<h[2-6]\b/, "no lower heading stands in for the page title");
});

test("the layout and sidebar around a page carry no h1 of their own", () => {
  for (const f of ["app/layout.tsx", "components/Sidebar.tsx"]) {
    assert.doesNotMatch(readFileSync(join(process.cwd(), f), "utf8"), /<h1\b/, `${f} adds no h1`);
  }
});

test("every private view renders the placeholder in the public view", () => {
  const pages = ["tokens", "roadmap", "strategy", "sessions", "session-board", "todos", "decisions", "digest", "settings"];
  for (const p of pages) {
    const src = readFileSync(join(process.cwd(), "app", p, "page.tsx"), "utf8");
    assert.match(src, /<OwnerOnly feature="[^"]+" \/>/, `app/${p}/page.tsx renders OwnerOnly`);
  }
});
