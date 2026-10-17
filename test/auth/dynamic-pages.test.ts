import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// In unified mode the owner/public boundary rests on a single architectural
// assumption: every page renders per-request (force-dynamic) and nothing in app/
// statically caches output. If a page that renders owner data were cached, that
// HTML could be served to the public. This guard fails the build if that
// assumption is ever broken — defense-in-depth flagged by the security review.

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const APP = join(process.cwd(), "app");
const files = walk(APP);
const pages = files.filter((f) => /\/page\.tsx$/.test(f));

test("every page is force-dynamic (owner HTML can never be statically cached)", () => {
  assert.ok(pages.length >= 8, `expected to find pages, got ${pages.length}`);
  for (const p of pages) {
    const src = readFileSync(p, "utf8");
    assert.match(
      src,
      /export const dynamic = ["']force-dynamic["']/,
      `${p.replace(process.cwd(), "")} must declare \`export const dynamic = "force-dynamic"\``
    );
  }
});

test("no static-cache directives anywhere in app/ (would cache owner HTML)", () => {
  const banned = ['"use cache"', "'use cache'", "unstable_cache", "export const revalidate", "export const fetchCache"];
  for (const f of files.filter((f) => /\.tsx?$/.test(f))) {
    const src = readFileSync(f, "utf8");
    for (const bad of banned) {
      assert.ok(!src.includes(bad), `${f.replace(process.cwd(), "")} contains banned caching directive: ${bad}`);
    }
  }
});

// Next composes the /_not-found route from app/not-found.tsx and the root
// layout; it is the one route with neither a page.tsx nor a route.ts of its
// own, so the declarations checked above do not reach it. Left to the default,
// the route was prerendered at build time with the sidebar of the build's mode
// baked in: in a unified deployment a signed-in owner who opened an unknown
// URL saw the public navigation, while notFound() inside a dynamic route showed
// the owner's. The root layout's declaration applies to the routes below it,
// that one included.
test("the root layout is force-dynamic, so the not-found route renders per request too", () => {
  const src = readFileSync(join(APP, "layout.tsx"), "utf8");
  assert.match(
    src,
    /export const dynamic = ["']force-dynamic["']/,
    'app/layout.tsx must declare `export const dynamic = "force-dynamic"`: the /_not-found route has no page.tsx of its own to declare it'
  );
});
