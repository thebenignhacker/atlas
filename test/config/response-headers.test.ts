import { test } from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../../next.config";

// Every route gets the same static headers. None of them can block a resource
// the app loads: the content security policy carries frame-ancestors only, so
// inline styles and chart scripts are untouched. A full policy is a separate
// change because it needs a nonce and a browser check on every route.
const BASELINE = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

test("the framework header is not sent", () => {
  assert.equal(nextConfig.poweredByHeader, false);
});

test("every route carries exactly the four baseline headers", async () => {
  assert.equal(typeof nextConfig.headers, "function", "next.config must define headers()");
  const rules = await nextConfig.headers!();
  const all = rules.filter((r) => r.source === "/(.*)");
  assert.equal(all.length, 1, "one rule applies to every route");
  const sorted = (h: { key: string; value: string }[]) =>
    [...h].sort((a, b) => a.key.localeCompare(b.key));
  assert.deepEqual(sorted(all[0].headers), sorted(BASELINE));
});
