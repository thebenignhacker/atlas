import { test } from "node:test";
import assert from "node:assert/strict";
import { hiddenNameLeak } from "@/lib/snapshot";

/**
 * The snapshot gate's private-repo-name check, in BOTH directions.
 *
 * It used to test `\b${name}\b`, and `\b` treats `-` as a boundary — so the
 * private repo `crypto-census` matched inside the genuinely public
 * `crypto-census-data` and blocked every publish. Loosening the rule is the
 * obvious fix and the wrong one: it would stop catching real mentions. Both
 * halves are asserted here so a future tightening or loosening has to declare
 * itself.
 */

const published = new Set(["crypto-census-data", "atlas", "opena2a-registry-web"]);
const json = (o: unknown) => JSON.stringify(o);

// --- must NOT fire: the name only appears inside something we publish ---------

test("a public repo whose name extends a private one is not a leak", () => {
  const text = json({ repos: [{ name: "crypto-census-data", slug: "crypto-census-data" }] });
  assert.equal(hiddenNameLeak("crypto-census", text, published), null);
});

test("case differences in the published identifier still clear", () => {
  const text = json({ repos: [{ name: "Crypto-Census-Data" }] });
  assert.equal(hiddenNameLeak("crypto-census", text, published), null);
});

test("a name absent from the text is not a leak", () => {
  assert.equal(hiddenNameLeak("crypto-census", json({ repos: [] }), published), null);
});

// --- must STILL fire: anything else containing the private name --------------

test("a bare mention of the private name is a leak", () => {
  const text = json({ activity: [{ title: "sync crypto-census to prod" }] });
  assert.equal(hiddenNameLeak("crypto-census", text, published), "crypto-census");
});

test("an UNPUBLISHED compound containing the private name is a leak", () => {
  // The loose fix ("ignore any hyphenated extension") would wrongly clear this.
  const text = json({ activity: [{ title: "rotate crypto-census-secrets" }] });
  assert.equal(
    hiddenNameLeak("crypto-census", text, published),
    "crypto-census-secrets"
  );
});

test("a private name embedded with an underscore is a leak", () => {
  const text = json({ summaries: { x: "see crypto-census_backup for the dump" } });
  assert.equal(
    hiddenNameLeak("crypto-census", text, published),
    "crypto-census_backup"
  );
});

test("a prefix extension is caught too, not just a suffix", () => {
  const text = json({ summaries: { x: "internal-crypto-census notes" } });
  assert.equal(
    hiddenNameLeak("crypto-census", text, published),
    "internal-crypto-census"
  );
});

test("a leak is reported even when a cleared token appears first", () => {
  // Order matters: the published name occurs earlier in the document, and the
  // check must keep scanning rather than clear on the first match.
  const text = json({
    repos: [{ name: "crypto-census-data" }],
    activity: [{ title: "crypto-census went private" }],
  });
  assert.equal(hiddenNameLeak("crypto-census", text, published), "crypto-census");
});

test("regex metacharacters in a repo name are escaped, not interpreted", () => {
  const text = json({ activity: [{ title: "touching a.b.c today" }] });
  // Were the name interpolated raw, "." would match any character and this
  // would report a false leak against "axbxc"-shaped text.
  assert.equal(hiddenNameLeak("a.b.c", text, published), "a.b.c");
  assert.equal(hiddenNameLeak("a.b.c", json({ x: "axbxc" }), published), null);
});
