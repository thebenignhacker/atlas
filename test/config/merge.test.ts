import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeConfig } from "@/lib/config";

test("a partial ai.models keeps the default for the model not given", () => {
  const c = mergeConfig({ ai: { models: { fast: "custom-fast" } } } as never);
  assert.equal(c.ai.models.fast, "custom-fast");
  assert.ok(c.ai.models.deep, "deep model must fall back to the default, not undefined");
  assert.equal(c.ai.enabled, false, "sibling ai defaults survive");
});

test("an empty user config is the defaults", () => {
  const c = mergeConfig({});
  assert.equal(c.scanDepth, 2);
  assert.deepEqual(c.todoDirs, []);
  assert.equal(c.ai.provider, "anthropic");
});

test("top-level and github keys merge over defaults", () => {
  const c = mergeConfig({ scanDepth: 4, github: { user: "me" } } as never);
  assert.equal(c.scanDepth, 4);
  assert.equal(c.github.user, "me");
  assert.deepEqual(c.github.orgs, []);
});
