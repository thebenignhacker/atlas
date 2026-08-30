import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStatus } from "@/lib/roadmap";

// Status normalization contract. The load-bearing pins:
//   - `todo` maps to "todo" (seeded), never to "ready" — a seeded unit is not vetted.
//   - Unknown / missing statuses fall back to "todo", never to "ready" — an
//     unparsed status is unvetted by definition.
//   - Terminal-negative spellings (superseded / wontfix / abandoned / retired)
//     map to "retired", never to "done" — they must not inflate the done record.

test("todo maps to todo, never ready", () => {
  assert.equal(normalizeStatus("todo"), "todo");
  assert.equal(normalizeStatus("Todo"), "todo");
  assert.equal(normalizeStatus("TODO"), "todo");
});

test("open and pending are seeded, not ready", () => {
  assert.equal(normalizeStatus("open"), "todo");
  assert.equal(normalizeStatus("pending"), "todo");
});

test("unknown falls back to todo, never ready", () => {
  assert.equal(normalizeStatus(null), "todo");
  assert.equal(normalizeStatus(""), "todo");
  assert.equal(normalizeStatus("???"), "todo");
  assert.equal(normalizeStatus("planned"), "todo");
  assert.equal(normalizeStatus("next"), "todo");
  assert.equal(normalizeStatus("decide"), "todo");
});

test("terminal-negative values map to retired, never done", () => {
  assert.equal(normalizeStatus("superseded"), "retired");
  assert.equal(normalizeStatus("superseded-by-other-unit"), "retired");
  assert.equal(normalizeStatus("wontfix"), "retired");
  assert.equal(normalizeStatus("won't fix"), "retired");
  assert.equal(normalizeStatus("abandoned"), "retired");
  assert.equal(normalizeStatus("retired"), "retired");
});

test("retired outranks done wording in the same value", () => {
  assert.equal(normalizeStatus("closed as wontfix"), "retired");
  assert.equal(normalizeStatus("done — superseded"), "retired");
});

test("the five prior statuses keep their mappings", () => {
  assert.equal(normalizeStatus("ready"), "ready");
  assert.equal(normalizeStatus("blocked"), "blocked");
  assert.equal(normalizeStatus("waiting on upstream"), "blocked");
  assert.equal(normalizeStatus("in-progress"), "in-progress");
  assert.equal(normalizeStatus("wip"), "in-progress");
  assert.equal(normalizeStatus("in-review"), "in-review");
  assert.equal(normalizeStatus("done"), "done");
  assert.equal(normalizeStatus("shipped"), "done");
});

test("comment-polluted values still classify by their token", () => {
  assert.equal(normalizeStatus("todo (vet at lane touch)"), "todo");
  assert.equal(normalizeStatus("ready — deps verified clear"), "ready");
});
