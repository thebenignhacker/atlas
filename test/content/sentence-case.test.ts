import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerOnly } from "@/components/OwnerOnly";
import { filesUnder } from "./source-files";

/**
 * "AI Digest" was the one title-case label, in the sidebar, the digest page's
 * tab title and heading, and the private-view placeholder the public view
 * shows for it. Every other label is sentence case ("Session board", "Back to
 * the portfolio").
 */

const ROOT = process.cwd();

test("no page or component spells the digest in title case", () => {
  const files = [
    ...filesUnder(join(ROOT, "app"), /\.tsx?$/),
    ...filesUnder(join(ROOT, "components"), /\.tsx?$/),
  ];
  assert.ok(files.length > 20, `expected the app's sources, got ${files.length}`);
  for (const f of files) {
    assert.ok(!readFileSync(f, "utf8").includes("AI Digest"), `${relative(ROOT, f)} says "AI Digest"`);
  }
});

test("the digest page names the feature in sentence case", () => {
  const src = readFileSync(join(ROOT, "app", "digest", "page.tsx"), "utf8");
  assert.match(src, /title: "AI digest"/);
  assert.match(src, /<OwnerOnly feature="AI digest" \/>/);
  assert.match(src, /<PageHeader title="AI digest"/);
  const html = renderToStaticMarkup(createElement(OwnerOnly, { feature: "AI digest" }));
  assert.match(html, /<h1\b[^>]*>AI digest is private<\/h1>/);
});
