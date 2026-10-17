import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The /roadmap board writes a status change back to the unit file. Only the
// Status line may change: an empty `**Status:**` line must not take the line
// after it along, or the unit silently loses a field.

const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-update-"));
const dir = path.join(root, "todo", "roadmap");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(root, "atlas.config.json"),
  JSON.stringify({ todoDirs: [path.join(root, "todo")] })
);
// loadConfig() caches on first call and reads the config from ATLAS_ROOT.
process.env.ATLAS_ROOT = root;

import { updateRoadmapItem } from "@/lib/roadmap";

function unit(name: string, content: string): string {
  const p = path.join(dir, `${name}.md`);
  fs.writeFileSync(p, content);
  return p;
}

test("an empty **Status:** line is replaced and the next line is kept", () => {
  const p = unit("empty-inside", "# U\n\n**Status:**\n**Priority:** P1\n**Area:** Platform\n\nBody.\n");
  const item = updateRoadmapItem("empty-inside", { status: "done" });
  assert.equal(
    fs.readFileSync(p, "utf8"),
    "# U\n\n**Status:** done\n**Priority:** P1\n**Area:** Platform\n\nBody.\n"
  );
  assert.equal(item?.status, "done");
  assert.equal(item?.priority, "P1");
  assert.equal(item?.area, "Platform");
});

test("an empty **Status**: line is replaced and the next line is kept", () => {
  const p = unit("empty-outside", "# U\n\n**Status**:  \n**Repos:** closed-loop\n\nBody.\n");
  const item = updateRoadmapItem("empty-outside", { status: "in-review" });
  assert.equal(fs.readFileSync(p, "utf8"), "# U\n\n**Status:** in-review\n**Repos:** closed-loop\n\nBody.\n");
  assert.deepEqual(item?.repos, ["closed-loop"]);
});

test("a filled Status line is replaced in place, line endings kept", () => {
  const p = unit("filled", "# U\r\n\r\n**Status:** todo\r\n**Priority:** P2\r\n");
  const item = updateRoadmapItem("filled", { status: "blocked" });
  assert.equal(fs.readFileSync(p, "utf8"), "# U\r\n\r\n**Status:** blocked\r\n**Priority:** P2\r\n");
  assert.equal(item?.priority, "P2");
});

test("a unit with no Status line gets one after its title", () => {
  const p = unit("absent", "# U\n**Priority:** P3\n");
  updateRoadmapItem("absent", { status: "ready" });
  assert.equal(fs.readFileSync(p, "utf8"), "# U\n\n**Status:** ready\n**Priority:** P3\n");
});
