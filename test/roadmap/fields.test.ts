import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Unit files carry **Owner:**, **Execution:** and **Effort:** beside the board's
// original fields. The parser must keep them (null when absent), or ownership
// cannot be shown or filtered and an owner-reserved unit reads like any other.

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-fields-"));
const dir = path.join(root, "todo", "roadmap");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(root, "atlas.config.json"),
  JSON.stringify({ todoDirs: [path.join(root, "todo")] })
);
// loadConfig() caches on first call and reads the config from ATLAS_ROOT.
process.env.ATLAS_ROOT = root;

fs.writeFileSync(
  path.join(dir, "owned.md"),
  [
    "# Owned unit",
    "",
    "**Area:** Platform",
    "**Kind:** code",
    "**Status:** ready",
    "**Priority:** P1",
    "**Order:** 1",
    "**Owner:** program session",
    "**Execution:** fleet",
    "**Effort:** M (two days)",
    "",
    "The description.",
    "",
    "## Log",
    "",
    "- 2026-10-01 — seeded",
    "",
  ].join("\n")
);
fs.writeFileSync(
  path.join(dir, "bare.md"),
  "# Bare unit\n\n**Area:** Platform\n**Status:** todo\n**Order:** 2\n**Owner:**\n\nNo extra fields.\n"
);
fs.writeFileSync(
  path.join(dir, "styled.md"),
  "# Styled unit\n\n**Owner**: owner\n**Effort** S\n**Order:** 3\n"
);

async function load() {
  const { loadRoadmap } = await import("@/lib/roadmap");
  return Object.fromEntries(loadRoadmap().map((i) => [i.id, i]));
}

test("Owner, Execution and Effort are parsed from the unit file", async () => {
  const items = await load();
  assert.equal(items.owned.owner, "program session");
  assert.equal(items.owned.execution, "fleet");
  assert.equal(items.owned.effort, "M (two days)");
});

test("absent or empty fields are null, never an empty string", async () => {
  const items = await load();
  assert.equal(items.bare.owner, null);
  assert.equal(items.bare.execution, null);
  assert.equal(items.bare.effort, null);
});

test("the alternate bold-field styles parse the same way", async () => {
  const items = await load();
  assert.equal(items.styled.owner, "owner");
  assert.equal(items.styled.effort, "S");
  assert.equal(items.styled.execution, null);
});

test("the new fields stay out of the description body", async () => {
  const items = await load();
  assert.equal(items.owned.body, "The description.");
  assert.equal(items.bare.body, "No extra fields.");
});
