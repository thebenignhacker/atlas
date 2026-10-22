import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextView } from "@/components/ContextView";
import type { ContextCard } from "@/lib/types";

/**
 * On /context each card lists its provenance file names in a flex-wrap row, and
 * a name with no space or hyphen did not wrap. Measured in Playwright's Chromium
 * and WebKit builds with phone emulation, signed in to a unified deployment
 * whose owner snapshot carried five such names of 43 to 83 characters, made of
 * letters, digits, underscores and dots, at 320x640 no name broke, each was
 * wider than its 182px row, the widest 526px, and the page was 628px wide in
 * Chromium and 627px in WebKit. The names now carry overflow-wrap: anywhere, so
 * one that does not fit its row breaks between characters, and the page is
 * 320px wide in both engines.
 */

const LONG = "averyveryverylongprovenancefilenamewithnobreakopportunityanywhereinitsname0123.json";
const DRIFTED = "ARCHITECTURE_DECISION_RECORD_0042_REGISTRY_TRUST_GRAPH_AND_SIGNED_SNAPSHOTS.md";

const provenance = (name: string) => ({
  path: `docs/notes/${name}`,
  hash: "not-a-real-hash",
  hashAlgo: "sha256" as const,
  capturedAt: "2026-10-01T12:00:00.000Z",
});

const card: ContextCard = {
  id: "atlas:provenance",
  project: "atlas",
  repoSlug: null,
  subject: "provenance",
  claim: "c",
  detail: null,
  provenance: [provenance(LONG), provenance(DRIFTED)],
  verifyCommand: null,
  verifyResult: null,
  verifyCheckedAt: null,
  confidence: "medium",
  derivedAt: "2026-10-01T12:00:00.000Z",
  lastVerifiedAt: "2026-10-01T12:00:00.000Z",
  staleAfterDays: null,
  freshness: "drifted",
  driftedPaths: [`docs/notes/${DRIFTED}`],
  tags: [],
  links: [],
  status: "active",
  supersededBy: null,
  visibility: "private",
  sensitive: false,
  originSessionId: null,
  createdAt: null,
  updatedAt: null,
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The classes of the span that shows `name` in the card's provenance row. */
function nameClasses(html: string, name: string): string[] {
  const span = html.match(new RegExp(`<span class="([^"]*)">${escape(name)}`));
  assert.ok(span, `the card lists ${name.slice(0, 24)}...; markup: ${html.slice(0, 300)}`);
  return span[1].split(/\s+/);
}

test("a provenance file name with no space or hyphen can break inside its row", () => {
  const html = renderToStaticMarkup(createElement(ContextView, { cards: [card] }));
  for (const name of [LONG, DRIFTED]) {
    const classes = nameClasses(html, name);
    assert.ok(classes.includes("wrap-anywhere"), `the name may break anywhere: ${classes.join(" ")}`);
  }
});

test("a changed provenance file keeps its marker and colour", () => {
  const html = renderToStaticMarkup(createElement(ContextView, { cards: [card] }));
  assert.ok(nameClasses(html, LONG).includes("text-muted"), "an unchanged file reads muted");
  assert.ok(nameClasses(html, DRIFTED).includes("text-amber"), "a changed file reads amber");
  assert.match(html, new RegExp(`${escape(DRIFTED)}(<!-- -->)? \\(changed\\)</span>`));
});
