import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar } from "@/components/Sidebar";
import { inAppRouter } from "../app-router";

/**
 * Below md the sidebar showed its icons alone: each label was a span with
 * `hidden md:inline`, and only the `title` attribute carried the name, which
 * touch screens do not show, so on a phone Context and Usage could not be told
 * apart. Every item now shows its label at every width, stacked under the icon
 * on a phone.
 */

const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "").trim();

/**
 * Each icon item in the sidebar (the nav links and the sign-in or sign-out
 * item) with the class list of every span that carries its name. The logo
 * link is named by its aria-label, and the footer link has no icon.
 */
function items(html: string): { name: string; labelClasses: string[][] }[] {
  const out: { name: string; labelClasses: string[][] }[] = [];
  for (const m of html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const [, , attrs, inner] = m;
    if (attrs.includes("aria-label=") || !inner.includes("<svg")) continue;
    const labelClasses = [...inner.matchAll(/<span class="([^"]*)">([^<]+)<\/span>/g)].map((s) =>
      s[1].split(" ")
    );
    out.push({ name: text(inner), labelClasses });
  }
  return out;
}

function render(mode: "local" | "public" | "owner", authEnabled: boolean): string {
  return renderToStaticMarkup(inAppRouter(createElement(Sidebar, { mode, authEnabled }), "/usage"));
}

test("every sidebar item in the public view shows its label below md", () => {
  const found = items(render("public", true));
  assert.deepEqual(
    found.map((i) => i.name),
    ["Portfolio", "Context", "Usage", "Activity", "Owner login"]
  );
  for (const { name, labelClasses } of found) {
    assert.equal(labelClasses.length, 1, `${name} has one label span`);
    assert.ok(!labelClasses[0].includes("hidden"), `${name}'s label is shown on a phone: ${labelClasses[0].join(" ")}`);
  }
});

test("every sidebar item in the owner view shows its label below md", () => {
  const found = items(render("owner", true));
  assert.deepEqual(
    found.map((i) => i.name),
    [
      "Portfolio",
      "Roadmap",
      "Strategy",
      "Context",
      "Usage",
      "Tokens",
      "Sessions",
      "Session board",
      "Todos",
      "Decisions",
      "Activity",
      "AI digest",
      "Settings",
      "Sign out",
    ]
  );
  for (const { name, labelClasses } of found) {
    assert.ok(labelClasses.length === 1 && !labelClasses[0].includes("hidden"), `${name}'s label is shown on a phone`);
  }
});

test("the sidebar scrolls when its items are taller than the screen, without a scrollbar below md", () => {
  // With labels, the local view's thirteen items are taller than a 375 by 667
  // phone screen, and the rail is fixed to the viewport. A scrollbar that takes
  // layout width (10px in headless Chrome) pushed "Roadmap", "Sessions" and
  // "Decisions" past the edge of the rail.
  const attr = render("owner", true).match(/^<aside class="([^"]*)"/)?.[1] ?? "";
  const aside = attr.replace(/&gt;/g, ">").replace(/&amp;/g, "&").split(" ");
  for (const c of ["overflow-y-auto", "max-md:[scrollbar-width:none]", "max-md:[&::-webkit-scrollbar]:hidden"]) {
    assert.ok(aside.includes(c), `${c}: ${aside.join(" ")}`);
  }
});
