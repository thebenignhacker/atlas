import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRoadmap, normalizeStatus } from "@/lib/roadmap";
import { GIT_ENV, bareOrigin, publish } from "./git-fixture";

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
  // The census reads origin/main, so the fixture is pushed; the todo dir sits in a
  // subdirectory of its repo, as it can in a real tree.
  publish(root, bareOrigin(path.join(os.tmpdir(), `${path.basename(root)}-origin.git`)), ["todo"]);
  const cfg = path.join(root, "atlas.config.json");
  fs.writeFileSync(cfg, JSON.stringify({ todoDirs: [todo] }));

  const out = execFileSync(
    "python3",
    [path.join(REPO, "scripts", "roadmap-census.py"), "--json", "--config", cfg],
    { encoding: "utf8", env: GIT_ENV }
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

/**
 * Field-line shapes, as [file, the text after the title, the status both read].
 * The census used to accept a Status line without bold markers and to read past
 * an empty one into the next line; the board does neither.
 */
const LINE_SHAPES: [string, string, string][] = [
  ["plain", "Status: done\n", "todo"],
  ["table", "Status | done\n", "todo"],
  ["empty-colon-outside", "**Status**:\n**Repos:** closed-loop\n", "todo"],
  ["empty-colon-inside", "**Status:**\n**Priority:** P1\n", "todo"],
  ["empty-trailing-space", "**Status:**  \n**Repos:** closed-loop\n", "todo"],
  ["colon-inside", "**Status:** done\n", "done"],
  ["colon-outside", "**Status**: in-review\n", "in-review"],
  ["no-colon", "**Status** blocked\n", "blocked"],
  ["tab", "**Status:**\tin-progress\n", "in-progress"],
  ["crlf", "**Status:** ready\r\n**Priority:** P1\r\n", "ready"],
  ["lowercase-key", "**status:** done\n", "done"],
  ["absent", "**Priority:** P1\n", "todo"],
];

test("census and board read the Status line with the same rule", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-census-"));
  const todo = path.join(root, "todo");
  fs.mkdirSync(path.join(todo, "roadmap"), { recursive: true });
  for (const [name, fields] of LINE_SHAPES) {
    fs.writeFileSync(path.join(todo, "roadmap", `${name}.md`), `# ${name}\n\n${fields}\nBody.\n`);
  }
  publish(root, bareOrigin(path.join(os.tmpdir(), `${path.basename(root)}-origin.git`)), ["todo"]);
  const cfg = path.join(root, "atlas.config.json");
  fs.writeFileSync(cfg, JSON.stringify({ todoDirs: [todo] }));

  const out = execFileSync(
    "python3",
    [path.join(REPO, "scripts", "roadmap-census.py"), "--json", "--no-fetch", "--config", cfg],
    { encoding: "utf8", env: GIT_ENV }
  );
  const census = new Map(
    out
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { file: string; raw: string; status: string })
      .map((r) => [r.file.replace(/\.md$/, ""), r])
  );

  // loadConfig() caches on first call and reads the config from ATLAS_ROOT;
  // nothing earlier in this file loads it.
  process.env.ATLAS_ROOT = root;
  const board = new Map(loadRoadmap().map((i) => [i.id, i.status]));

  assert.equal(census.size, LINE_SHAPES.length);
  assert.equal(board.size, LINE_SHAPES.length);
  for (const [name, , expected] of LINE_SHAPES) {
    const c = census.get(name);
    assert.equal(board.get(name), expected, `${name}: board`);
    assert.equal(c?.status, expected, `${name}: census (raw ${JSON.stringify(c?.raw)})`);
  }
  for (const name of ["empty-colon-outside", "empty-colon-inside", "empty-trailing-space"]) {
    assert.equal(census.get(name)?.raw, "", `${name}: an empty field never reads the next line`);
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
