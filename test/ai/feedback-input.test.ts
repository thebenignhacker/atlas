import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeedback } from "@/lib/ai/feedback-input";

/**
 * POST /api/feedback refused a missing correctedValue with a 400 but recorded
 * one that was only whitespace, so a blank correction was stored and read back
 * as learned feedback. The route answers 400 whenever parseFeedback returns
 * null; these pin that a blank correctedValue is refused like a missing one,
 * and that a real correction still passes through as sent.
 */

const body = {
  entityType: "repo",
  entityId: "atlas",
  field: "summary",
  aiValue: "Generated summary.",
  correctedValue: "Corrected summary.",
  note: "user-edited summary",
};

/** `body` with one field left out. */
function without(key: keyof typeof body): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...body };
  delete copy[key];
  return copy;
}

test("a correctedValue that is empty after trimming is refused like a missing one", () => {
  assert.equal(parseFeedback(without("correctedValue")), null);
  for (const blank of ["", "   ", " \n\t "]) {
    assert.equal(parseFeedback({ ...body, correctedValue: blank }), null, JSON.stringify(blank));
  }
});

test("a correctedValue that is not a string is refused", () => {
  for (const value of [42, true, {}, ["Corrected summary."]]) {
    assert.equal(parseFeedback({ ...body, correctedValue: value }), null, JSON.stringify(value));
  }
});

test("a missing entityType, entityId or field is refused", () => {
  for (const key of ["entityType", "entityId", "field"] as const) {
    assert.equal(parseFeedback(without(key)), null, key);
  }
});

test("a body that is not an object is refused", () => {
  for (const value of [null, undefined, "Corrected summary.", 42]) {
    assert.equal(parseFeedback(value), null, String(value));
  }
});

test("a correction passes through as sent, and absent optional fields become null", () => {
  assert.deepEqual(parseFeedback(body), body);
  const padded = { ...body, correctedValue: "  Corrected summary.\n" };
  assert.deepEqual(parseFeedback(padded), padded);
  assert.deepEqual(parseFeedback(without("aiValue")), { ...body, aiValue: null });
  assert.deepEqual(parseFeedback(without("note")), { ...body, note: null });
});
