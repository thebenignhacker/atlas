import { test } from "node:test";
import assert from "node:assert/strict";
import { repoAIEligible } from "@/lib/ai/policy-shared";

/**
 * The gate that decides whether a repo's content may be sent to an LLM. The
 * README promises that private repos are excluded unless opted in; this pins
 * every branch of that promise.
 */

const closed = { optInRepos: [] as string[], allowPrivate: false };

test("public repos are eligible by default", () => {
  assert.equal(repoAIEligible(closed, { slug: "a", visibility: "public" }), true);
});

test("private repos are refused unless opted in or allowPrivate is set", () => {
  const repo = { slug: "secret", visibility: "private" as const };
  assert.equal(repoAIEligible(closed, repo), false);
  assert.equal(repoAIEligible({ optInRepos: ["secret"], allowPrivate: false }, repo), true);
  assert.equal(repoAIEligible({ optInRepos: [], allowPrivate: true }, repo), true);
});

test("unknown visibility is treated as private (fail closed)", () => {
  const repo = { slug: "local-only", visibility: "unknown" as const };
  assert.equal(repoAIEligible(closed, repo), false);
  assert.equal(repoAIEligible({ optInRepos: [], allowPrivate: true }, repo), true);
});

test("opt-in is exact on slug, not a prefix", () => {
  const repo = { slug: "secret-2", visibility: "private" as const };
  assert.equal(repoAIEligible({ optInRepos: ["secret"], allowPrivate: false }, repo), false);
});
