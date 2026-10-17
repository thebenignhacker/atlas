import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSaveCorrection,
  saveSummaryCorrection,
} from "@/lib/ai/summary-correction";

/**
 * The summary correction panel said "Saved. Atlas will respect this next
 * time." whatever /api/feedback answered, so the route's 400 for an empty
 * draft, and its 500 when the database could not be opened, read as a save.
 * These pin that only a 2xx answer is a save, and that the refusals tested
 * here come back with the reason the panel shows beside the draft.
 */

const correction = {
  slug: "atlas",
  aiValue: "Generated summary.",
  correctedValue: "Corrected summary.",
};

/** A fetch that answers every request with `status` and `body`, and records what it was sent. */
function answering(status: number, body: string) {
  const sent: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init });
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, sent };
}

test("a 400 is not a save, and carries the route's message", async () => {
  const { fetchImpl } = answering(
    400,
    JSON.stringify({ error: "entityType, entityId, field, correctedValue are required" })
  );
  assert.deepEqual(await saveSummaryCorrection({ ...correction, correctedValue: "" }, fetchImpl), {
    ok: false,
    error: "entityType, entityId, field, correctedValue are required",
  });
});

test("a 500 is not a save, and carries the route's message", async () => {
  const { fetchImpl } = answering(500, JSON.stringify({ error: "attempt to write a readonly database" }));
  assert.deepEqual(await saveSummaryCorrection(correction, fetchImpl), {
    ok: false,
    error: "attempt to write a readonly database",
  });
});

test("a refusal whose body has no message names the status", async () => {
  for (const body of ["<html>Bad gateway</html>", "{}", ""]) {
    const { fetchImpl } = answering(502, body);
    assert.deepEqual(await saveSummaryCorrection(correction, fetchImpl), {
      ok: false,
      error: "the server answered HTTP 502",
    });
  }
});

test("a request that never reaches the server is not a save", async () => {
  const fetchImpl = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  assert.deepEqual(await saveSummaryCorrection(correction, fetchImpl), {
    ok: false,
    error: "Failed to fetch",
  });
});

test("a 2xx is a save, and the request is the one the feedback route reads", async () => {
  const { fetchImpl, sent } = answering(200, JSON.stringify({ ok: true }));
  assert.deepEqual(await saveSummaryCorrection(correction, fetchImpl), { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "/api/feedback");
  assert.equal(sent[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(sent[0].init?.body)), {
    entityType: "repo",
    entityId: "atlas",
    field: "summary",
    aiValue: "Generated summary.",
    correctedValue: "Corrected summary.",
    note: "user-edited summary",
  });
});

test("an empty or whitespace-only draft cannot be saved", () => {
  assert.equal(canSaveCorrection(""), false);
  assert.equal(canSaveCorrection("  \n\t"), false);
  assert.equal(canSaveCorrection("Corrected summary."), true);
});
