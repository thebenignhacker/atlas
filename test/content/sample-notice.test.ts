import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PageHeader } from "@/components/PageHeader";
import type { SectionFreshness } from "@/lib/freshness-shared";

/**
 * Ages and health on a deployed page are measured from today, so once the
 * committed snapshot is more than 30 days old every repository reads as stale
 * or dormant, and the freshness line alone did not say what that does to the
 * counts. The page header now carries a note naming the date the data was
 * collected. A recent artifact shows none, and neither does local mode, where
 * pages read the database and there is no artifact.
 */

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "");

function repos(dataAt: string): SectionFreshness {
  return { dataAt, collectedAt: dataAt, builtAt: dataAt, status: "ok", count: 53, note: null };
}

function header(props: { freshness?: SectionFreshness | null; artifactBuiltAt?: string | null }) {
  const html = renderToStaticMarkup(createElement(PageHeader, { title: "Portfolio", ...props }));
  const notes = (html.match(/<p\b[^>]*\brole="note"[^>]*>[\s\S]*?<\/p>/g) ?? []).map(text);
  return { html, count: (html.match(/\brole="note"/g) ?? []).length, notes };
}

test("a header over an artifact 50 days old carries one frozen-sample note dated by its data", () => {
  const dataAt = daysAgo(51);
  const { html, count, notes } = header({ freshness: repos(dataAt), artifactBuiltAt: daysAgo(50) });
  assert.equal(count, 1, `one note; markup: ${html}`);
  assert.equal(notes.length, 1, "the note is a paragraph");
  assert.match(notes[0], /^Frozen sample/);
  assert.ok(
    notes[0].includes(new Date(dataAt).toISOString().slice(0, 10)),
    `names the UTC date of the newest datum; note: ${notes[0]}`
  );
  assert.match(html, /^<header\b[\s\S]*role="note"[\s\S]*<\/header>$/, "inside the page's header");
});

test("a header over an artifact 10 days old carries no note", () => {
  const { html, count } = header({ freshness: repos(daysAgo(11)), artifactBuiltAt: daysAgo(10) });
  assert.equal(count, 0, `no note; markup: ${html}`);
});

test("a header in local mode, with no artifact, carries no note however old the data", () => {
  const { html, count } = header({ freshness: repos(daysAgo(51)) });
  assert.equal(count, 0, `no note; markup: ${html}`);
});
