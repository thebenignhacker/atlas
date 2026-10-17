import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextMetrics } from "@/components/ContextMetrics";
import type { ContextMetrics as Metrics } from "@/lib/types";

/**
 * The public /context page read "1 stale fact flagged before they could
 * mislead a session" and "1 cards", and showed "~0 tokens saved" and "0 reads
 * served". The public snapshot never carries reads or tokens saved (they count
 * the owner's own sessions), so those zeros described nothing. The panel now
 * agrees in number, and the public view says what those two tiles show in the
 * owner's view instead of showing them as zero.
 */

/** The public snapshot's context metrics as published. */
const PUBLIC: Metrics = {
  totalCards: 1,
  activeCards: 1,
  staleCaught: 1,
  freshness: { fresh: 0, drifted: 1, expired: 0, stale: 0, unverified: 0 },
  tokensSavedEstimate: 0,
  reads: 0,
};

const OWNER: Metrics = {
  totalCards: 9,
  activeCards: 8,
  staleCaught: 3,
  freshness: { fresh: 5, drifted: 2, expired: 1, stale: 0, unverified: 0 },
  tokensSavedEstimate: 12400,
  reads: 7,
};

function render(m: Metrics, publicView = false): string {
  return renderToStaticMarkup(createElement(ContextMetrics, { m, publicView }));
}

function text(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, " ")
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

test("one stale fact caught reads in the singular", () => {
  const t = text(render(PUBLIC, true));
  assert.match(t, /\b1 stale fact flagged before it could mislead a session\b/);
  assert.doesNotMatch(t, /they could/);
});

test("several stale facts caught read in the plural", () => {
  const t = text(render(OWNER));
  assert.match(t, /\b3 stale facts flagged before they could mislead a session\b/);
});

test("card counts agree in number", () => {
  const one = render(PUBLIC, true);
  assert.match(text(one), /\b1 card\b/);
  assert.doesNotMatch(text(one), /\b1 cards\b/);
  assert.match(one, />active card</);

  const many = render(OWNER);
  assert.match(text(many), /\b8 cards\b/);
  assert.match(many, />active cards</);
});

test("the public view explains the two tiles it never publishes", () => {
  const html = render(PUBLIC, true);
  assert.doesNotMatch(html, />reads served</, "no reads tile in the public view");
  assert.doesNotMatch(html, />tokens saved</, "no tokens saved tile in the public view");
  assert.doesNotMatch(text(html), /~0/);
  const t = text(html);
  assert.match(t, /The public view shows only the cards the owner has published/);
  assert.match(t, /Reads served and tokens saved count the owner's own sessions/);
  assert.match(t, /how many times a session read a card/);
  // What the public view does carry is still shown.
  assert.match(html, />verified fresh</);
  assert.match(t, /\b1 drifted\b/);
});

test("the owner's view keeps the reads and tokens saved tiles", () => {
  const html = render(OWNER);
  assert.match(html, />reads served</);
  assert.match(html, />tokens saved</);
  assert.match(text(html), /~12K/);
  assert.doesNotMatch(text(html), /count the owner's own sessions/);
});
