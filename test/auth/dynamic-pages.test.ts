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
