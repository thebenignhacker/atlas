import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeedback, readFeedback } from "@/lib/ai/feedback-input";

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

test("a missing or empty entityType, entityId or field is refused", () => {
  for (const key of ["entityType", "entityId", "field"] as const) {
    assert.equal(parseFeedback(without(key)), null, key);
    assert.equal(parseFeedback({ ...body, [key]: "" }), null, key);
  }
});

/**
 * The fields other than correctedValue used to pass through unchecked to
 * recordFeedback, whose SQLite bind throws on a JSON object, array or boolean,
 * and the route answered that throw with a 500 carrying the driver's message.
 * Refused here, they get the route's 400 instead.
 */
test("an entityType, entityId or field that is not a string is refused", () => {
  for (const key of ["entityType", "entityId", "field"] as const) {
    for (const value of [42, true, {}, ["repo"]]) {
      assert.equal(parseFeedback({ ...body, [key]: value }), null, `${key}: ${JSON.stringify(value)}`);
    }
  }
});

test("an aiValue or note that is neither a string nor null is refused", () => {
  for (const key of ["aiValue", "note"] as const) {
    for (const value of [42, false, {}, [], ["Generated summary."]]) {
      assert.equal(parseFeedback({ ...body, [key]: value }), null, `${key}: ${JSON.stringify(value)}`);
    }
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
  // The summary panel sends aiValue: null when no summary was shown.
  const nulls = { ...body, aiValue: null, note: null };
  assert.deepEqual(parseFeedback(nulls), nulls);
});

/**
 * The route ran req.json() inside the try whose catch answers with a 500
 * carrying the error's message, so a body that was not valid JSON, an empty one
 * included, got a 500 with the parser's text. The route now reads its body
 * through readFeedback, which refuses such a body, and answers it with its 400
 * instead.
 */

/** A POST to the feedback route whose body is `raw`, or that has no body. */
function post(raw?: string): Request {
  return new Request("http://127.0.0.1/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
}

test("a body that is not valid JSON is refused, an empty or missing one included", async () => {
  for (const raw of ["{bad", "", "Corrected summary.", '{"entityType": "repo",']) {
    assert.equal(await readFeedback(post(raw)), null, JSON.stringify(raw));
  }
  assert.equal(await readFeedback(post()), null, "no body");
});

test("a JSON body is read and checked as parseFeedback checks it", async () => {
  assert.deepEqual(await readFeedback(post(JSON.stringify(body))), body);
  assert.equal(await readFeedback(post(JSON.stringify({ ...body, entityType: {} }))), null);
  assert.equal(await readFeedback(post("null")), null);
});
