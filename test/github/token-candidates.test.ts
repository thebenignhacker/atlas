import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenCandidates } from "@/lib/github";

// Regression guard for the silent-enrichment-failure bug: an invalid
// GITHUB_TOKEN env var shadowed a working `gh` keyring login, so every repo's
// visibility/stars/forks stayed unset. The fix keeps the keyring token as a
// fallback candidate even when GITHUB_TOKEN is present. These assertions pin the
// candidate ordering and dedupe that make that fallback possible.

test("env token is tried first, then gh keyring as fallback", () => {
  const cands = tokenCandidates("env-tok", "gh-tok");
  assert.deepEqual(
    cands.map((c) => c.source),
    ["env", "gh"]
  );
  assert.equal(cands[0].token, "env-tok");
  assert.equal(cands[1].token, "gh-tok");
});

test("keyring fallback is kept when GITHUB_TOKEN is set (the bug)", () => {
  // The whole point: a present-but-invalid env token must NOT suppress the
  // keyring candidate, or enrichment fails silently for every repo.
  const cands = tokenCandidates("invalid-env-tok", "valid-gh-tok");
  assert.ok(cands.some((c) => c.source === "gh"));
});

test("identical env and gh tokens collapse to one candidate", () => {
  const cands = tokenCandidates("same", "same");
  assert.equal(cands.length, 1);
  assert.equal(cands[0].source, "env");
});

test("gh-only when no env token", () => {
  const cands = tokenCandidates(undefined, "gh-tok");
  assert.deepEqual(
    cands.map((c) => c.source),
    ["gh"]
  );
});

test("no candidates when neither source has a token", () => {
  assert.equal(tokenCandidates(undefined, null).length, 0);
  assert.equal(tokenCandidates("", null).length, 0);
});
