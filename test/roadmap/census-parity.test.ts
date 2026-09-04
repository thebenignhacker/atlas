import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeStatus } from "@/lib/roadmap";

/**
 * The census script (Python) and the /roadmap board (lib/roadmap.ts) read the
 * same unit files. They must place every file in the same status, or the two
 * surfaces report different totals for the same tree. The census carries a
 * port of normalizeStatus(); this test is what keeps the port honest.
 */

const REPO = path.resolve(__dirname, "..", "..");

const SPELLINGS = [
  "done", "Done.", "shipped", "closed", "merged 2026-01-01",
  "in-progress", "in progress", "WIP", "started",
  "in-review", "reviewing", "review",
  "blocked", "blocked (waiting on X)", "gated",
  "ready", "Ready | P1",
  "todo", "open", "pending",
  "retired", "superseded", "wontfix", "closed as wontfix", "abandoned",
  "", "gibberish", "queued", "parked", "partially",
];

test("census and board normalize every status spelling identically", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-census-"));
  const todo = path.join(root, "todo");
  fs.mkdirSync(path.join(todo, "roadmap"), { recursive: true });
  SPELLINGS.forEach((s, i) => {
    const body = `# Unit ${i}\n\n**Area:** T\n**Kind:** code\n**Status:** ${s}\n**Priority:** P2\n**Repos:** r\n\n## Log\n`;
    fs.writeFileSync(path.join(todo, "roadmap", `unit-${i}.md`), body);
  });
  fs.writeFileSync(path.join(todo, "roadmap", "README.md"), "# not a unit\n\n**Status:** done\n");
  const cfg = path.join(root, "atlas.config.json");
  fs.writeFileSync(cfg, JSON.stringify({ todoDirs: [todo] }));

  const out = execFileSync(
    "python3",
    [path.join(REPO, "scripts", "roadmap-census.py"), "--json", "--config", cfg],
    { encoding: "utf8" }
  );
  const rows = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) as {
    file: string;
    raw: string;
    status: string;
  }[];
  assert.equal(rows.length, SPELLINGS.length, "README excluded, every unit counted once");
  for (const r of rows) {
    const i = Number(r.file.match(/unit-(\d+)/)![1]);
    const expected = normalizeStatus(SPELLINGS[i] || null);
    assert.equal(r.status, expected, `"${SPELLINGS[i]}" → board ${expected}, census ${r.status}`);
  }
});

test("the census does not read the repo config when --config is given", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-census-"));
  const cfg = path.join(root, "atlas.config.json");
  fs.writeFileSync(cfg, JSON.stringify({ todoDirs: [] }));
  const out = execFileSync("python3", [path.join(REPO, "scripts", "roadmap-census.py"), "--config", cfg], {
    encoding: "utf8",
  });
  assert.match(out, /^units=0 trees=0/);
});
