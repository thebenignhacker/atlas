import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRequestMode } from "@/lib/mode";

/**
 * The per-request owner/public decision. Owner data is served only in unified
 * mode with a verified session; nothing else may resolve to "owner" from a
 * request, and an unverified session in unified mode is public.
 */

test("non-unified env modes pass through unchanged, whatever the session says", () => {
  for (const env of ["local", "public", "owner"] as const) {
    assert.equal(resolveRequestMode(env, true), env);
    assert.equal(resolveRequestMode(env, false), env);
  }
});

test("unified mode serves owner data only on a verified session", () => {
  assert.equal(resolveRequestMode("unified", true), "owner");
  assert.equal(resolveRequestMode("unified", false), "public");
});

test("only a literal true verifies — a truthy non-boolean never becomes owner", () => {
  // Defensive: verifySession returns a boolean, but the gate must not widen.
  assert.equal(resolveRequestMode("unified", "yes" as unknown as boolean), "public");
  assert.equal(resolveRequestMode("unified", 1 as unknown as boolean), "public");
});
