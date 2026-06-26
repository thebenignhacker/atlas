import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStrategyDoc } from "@/lib/strategy";

const DOC = `# OpenA2A. Strategy and Fundraising

Living strategy doc. Owner: Abdel Fane. Last updated: June 26, 2026.

## Operating doctrine

This section is prose only, no tasks.

- Authority before tools. (a bullet, not a checkbox)

## The October bar

The scorecard.

- [ ] (P0) Three to five named design partners deployed #strategy
- [x] (P0) Delaware C corp formed #strategy
- [ ] (P1) Raise materials ready #strategy

### W0. Entity gate

- [ ] (P0) File the Delaware C corp #strategy
- [ ] (P2) Basic legal and accounting in place #strategy

## Not tracked

- [ ] A plain todo with no strategy tag
`;

test("parses title and last-updated", () => {
  const doc = parseStrategyDoc(DOC, "opena2a-strategy");
  assert.equal(doc.title, "OpenA2A. Strategy and Fundraising");
  assert.equal(doc.updated, "June 26, 2026");
});

test("only #strategy-tagged checkboxes are counted", () => {
  const doc = parseStrategyDoc(DOC, "opena2a-strategy");
  // 3 (October bar) + 2 (W0) = 5; the untagged checkbox is excluded.
  assert.equal(doc.totalTasks, 5);
  assert.equal(doc.doneTasks, 1);
});

test("prose-only and untagged sections are dropped", () => {
  const doc = parseStrategyDoc(DOC, "opena2a-strategy");
  const titles = doc.sections.map((s) => s.title);
  assert.deepEqual(titles, ["The October bar", "W0. Entity gate"]);
  assert.ok(!titles.includes("Operating doctrine"));
  assert.ok(!titles.includes("Not tracked"));
});

test("priority, done-state, and tag stripping are correct", () => {
  const doc = parseStrategyDoc(DOC, "opena2a-strategy");
  const oct = doc.sections.find((s) => s.title === "The October bar")!;
  const corp = oct.tasks.find((t) => t.text.includes("C corp formed"))!;
  assert.equal(corp.done, true);
  assert.equal(corp.priority, "P0");
  assert.ok(!corp.text.includes("#strategy"));
  assert.ok(!corp.text.includes("(P0)"));
});

test("open P0/P1 counts exclude done tasks", () => {
  const doc = parseStrategyDoc(DOC, "opena2a-strategy");
  // Open P0: October "design partners" + W0 "File the C corp" = 2 (C corp formed is done).
  assert.equal(doc.openP0, 2);
  assert.equal(doc.openP1, 1);
});

test("section progress counts are accurate", () => {
  const doc = parseStrategyDoc(DOC, "opena2a-strategy");
  const oct = doc.sections.find((s) => s.title === "The October bar")!;
  assert.equal(oct.total, 3);
  assert.equal(oct.done, 1);
  assert.equal(oct.blurb, "The scorecard.");
});
