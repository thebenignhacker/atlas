import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar } from "@/components/Sidebar";
import { inAppRouter } from "../app-router";

/**
 * A standalone owner deployment's data mode is "owner" for every request the
 * proxy lets through, /login included, where the visitor has no session yet.
 * The sidebar read the mode as the session state, so a signed-out visitor on
 * /login saw the owner navigation, a Sign out button and the footer "owner
 * view · signed in". The sign-out control, the signed-in label and the
 * owner-only items now follow `signedIn`, the verified session the root layout
 * reads (isOwnerRequest in lib/request-mode.ts).
 */

type Props = { mode: "local" | "public" | "owner"; authEnabled: boolean; signedIn: boolean };

const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "");

function render(props: Props): string {
  return renderToStaticMarkup(inAppRouter(createElement(Sidebar, props), "/login"));
}

/** The hrefs of the navigation list, in order. */
function navHrefs(html: string): string[] {
  const nav = html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
  return [...nav.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => m[1]);
}

const PUBLIC_ITEMS = ["/", "/context", "/usage", "/activity"];
const ALL_ITEMS = [
  "/",
  "/roadmap",
  "/strategy",
  "/context",
  "/usage",
  "/tokens",
  "/sessions",
  "/session-board",
  "/todos",
  "/decisions",
  "/activity",
  "/digest",
  "/settings",
];

test("owner mode, signed out: no sign-out control, no signed-in label, no owner-only items", () => {
  const html = render({ mode: "owner", authEnabled: true, signedIn: false });
  assert.doesNotMatch(html, /Sign out/);
  assert.doesNotMatch(html, /action="\/api\/logout"/);
  assert.doesNotMatch(text(html), /signed in/);
  assert.match(text(html), /owner view · signed out/);
  assert.match(html, /<a\b[^>]*href="\/login"[^>]*>[\s\S]*?Owner login/);
  assert.deepEqual(navHrefs(html), PUBLIC_ITEMS);
});

test("owner mode, signed in: the sign-out control, the signed-in label and every item", () => {
  const html = render({ mode: "owner", authEnabled: true, signedIn: true });
  assert.match(html, /<form action="\/api\/logout" method="POST">/);
  assert.match(text(html), /owner view · signed in/);
  assert.doesNotMatch(html, /Owner login/);
  assert.deepEqual(navHrefs(html), ALL_ITEMS);
});

test("unified mode's public view is unchanged: the login link and the public items", () => {
  const html = render({ mode: "public", authEnabled: true, signedIn: false });
  assert.match(html, /Owner login/);
  assert.doesNotMatch(html, /Sign out/);
  assert.match(text(html), /public demo · built with Atlas/);
  assert.deepEqual(navHrefs(html), PUBLIC_ITEMS);
});

test("local mode lists every item and has no sign-in control", () => {
  const html = render({ mode: "local", authEnabled: false, signedIn: false });
  assert.doesNotMatch(html, /Owner login|Sign out/);
  assert.match(text(html), /local-first · your data stays here/);
  assert.deepEqual(navHrefs(html), ALL_ITEMS);
});

test("owner-only items stay out of a public data view whatever signedIn says", () => {
  const html = render({ mode: "public", authEnabled: true, signedIn: true });
  assert.deepEqual(navHrefs(html), PUBLIC_ITEMS);
});
