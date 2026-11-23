import { test } from "node:test";
import assert from "node:assert/strict";
import { sensitiveTextLeak } from "@/lib/snapshot";

/**
 * The snapshot gate's check of a sensitive card's whole subject or claim, in
 * both directions. An occurrence whose whole token is the name, slug or
 * repoName of a published repository is not a leak; any other occurrence is.
 */

const published = new Set([
  "documentation-site-v2",
  "otherorg-documentation-site-v2",
  "otherorg-docs-site",
]);
const json = (o: unknown) => JSON.stringify(o, null, 2);

// --- must NOT fire: the text only appears inside a published identifier -------

test("a subject that is part of a published name, slug and repoName is not a leak", () => {
  const text = json({
    repos: [
      {
        slug: "otherorg-documentation-site-v2",
        name: "documentation-site-v2",
        repoName: "documentation-site-v2",
        url: "https://github.com/otherorg/documentation-site-v2",
      },
    ],
  });
  assert.equal(sensitiveTextLeak("documentation-site", text, published), null);
});

test("a subject that is a published slug, written as such in free text, is not a leak", () => {
  const text = json({
    repos: [{ slug: "otherorg-docs-site" }],
    activity: [{ title: "fix the OtherOrg-Docs-Site build" }],
  });
  assert.equal(sensitiveTextLeak("otherorg-docs-site", text, published), null);
  assert.equal(sensitiveTextLeak("OtherOrg-Docs-Site", text, published), null);
});

test("a published identifier that starts a line or follows a tab is not a leak", () => {
  for (const s of ["Intro.\ndocumentation-site-v2 is live", "release:\tdocumentation-site-v2"])
    assert.equal(sensitiveTextLeak("documentation-site", json({ x: s }), published), null, s);
});

test("a text absent from the artifact is not a leak", () => {
  assert.equal(sensitiveTextLeak("documentation-site", json({ repos: [] }), published), null);
});

// --- must STILL fire: any other occurrence ------------------------------------

test("a subject standing alone beside a published name that extends it is a leak", () => {
  const text = json({
    repos: [{ name: "documentation-site-v2" }],
    activity: [{ title: "move documentation-site to the new host" }],
  });
  assert.equal(sensitiveTextLeak("documentation-site", text, published), "documentation-site");
});

test("a token that extends a published identifier is a leak", () => {
  const text = json({ project: "otherorg-docs-site-secrets" });
  assert.equal(
    sensitiveTextLeak("otherorg-docs-site", text, published),
    "otherorg-docs-site-secrets"
  );
});

test("a subject found inside a longer word, without a boundary, is a leak", () => {
  const text = json({ project: "xdocumentation-site" });
  assert.equal(sensitiveTextLeak("documentation-site", text, published), "xdocumentation-site");
});

test("a claim of more than one word, quoted whole, is a leak", () => {
  const text = json({ claim: "quoted: moves to the new host" });
  assert.equal(
    sensitiveTextLeak("moves to the new host", text, published),
    "moves to the new host"
  );
});

test("a claim that holds a character JSON escapes is a leak when the JSON text holds it", () => {
  // The text is found in the JSON text as written, so it is reported as is.
  const claim = 'key: "documentation-site-v2"';
  const text = `{"x": 1, "y": ${claim}}`;
  assert.equal(sensitiveTextLeak(claim, text, published), claim);
  assert.equal(sensitiveTextLeak(claim, json({ x: "unrelated text" }), published), null);
});

test("a leak is reported even when a cleared occurrence appears first", () => {
  const text = json({
    repos: [{ name: "documentation-site-v2" }],
    activity: [{ title: "documentation-site-staging" }],
  });
  assert.equal(
    sensitiveTextLeak("documentation-site", text, published),
    "documentation-site-staging"
  );
});
