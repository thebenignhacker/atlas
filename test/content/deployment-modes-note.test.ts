import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atlasMode } from "@/lib/mode";

/**
 * The README names the mode an unset ATLAS_MODE selects and the mode the npm
 * scripts select. It used to mark local as the default, while a production
 * server started with ATLAS_MODE unset served the public view.
 *
 * These assertions read the fallback from atlasMode() and the scripts from
 * package.json instead of restating them, so the prose is compared with the code
 * that decides the mode.
 */

const ROOT = process.cwd();

const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const scripts: Record<string, string> = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8")
).scripts;

/** The text from the "Deployment modes" heading to the next heading, as one line. */
function modesSection(): string {
  const match = /^## Deployment modes\n([\s\S]*?)^#{2,3} /m.exec(readme);
  assert.ok(match, "the README has a Deployment modes section");
  return match[1].replace(/\s+/g, " ");
}

/** The section's mode bullets, as the lowercased mode name and the label's parenthesis. */
function modeLabels(): { mode: string; detail: string }[] {
  return [...modesSection().matchAll(/- \*\*(\w+) \(([^)]*)\):\*\*/g)].map((m) => ({
    mode: m[1].toLowerCase(),
    detail: m[2],
  }));
}

describe("the README's deployment modes agree with the code", () => {
  const original = process.env.ATLAS_MODE;

  beforeEach(() => { delete process.env.ATLAS_MODE; });
  afterEach(() => {
    if (original === undefined) delete process.env.ATLAS_MODE;
    else process.env.ATLAS_MODE = original;
  });

  test("the one mode marked default is the mode an unset ATLAS_MODE selects", () => {
    const marked = modeLabels().filter((l) => /\bdefault\b/.test(l.detail)).map((l) => l.mode);
    assert.deepEqual(marked, [atlasMode()]);
  });

  test("each mode's label names the value that selects it", () => {
    const labels = modeLabels();
    assert.deepEqual(labels.map((l) => l.mode).sort(), ["local", "owner", "public", "unified"]);
    for (const { mode, detail } of labels) {
      assert.ok(detail.includes(`\`ATLAS_MODE=${mode}\``), `the ${mode} label names ATLAS_MODE=${mode}`);
      process.env.ATLAS_MODE = mode;
      assert.equal(atlasMode(), mode);
    }
  });

  test("the section names the mode an unset or unrecognised value selects", () => {
    const unset = atlasMode();
    process.env.ATLAS_MODE = "publik";
    assert.equal(atlasMode(), unset, "an unrecognised value selects what an unset one does");
    assert.ok(
      modesSection().includes(`An unset or unrecognised value selects ${unset},`),
      `the section says an unset or unrecognised value selects ${unset}`
    );
  });

  test("the section names the mode npm run dev selects", () => {
    const selected = /\bATLAS_MODE=(\w+)/.exec(scripts.dev)?.[1];
    assert.ok(selected, "the dev script sets ATLAS_MODE");
    assert.ok(
      modesSection().includes(`\`npm run dev\` sets \`ATLAS_MODE=${selected}\`.`),
      `the section says npm run dev sets ATLAS_MODE=${selected}`
    );
  });

  test("the section and the scripts table say npm start serves the fallback mode", () => {
    assert.doesNotMatch(scripts.start, /ATLAS_MODE/, "the start script leaves the variable to the environment");
    const fallback = atlasMode();
    assert.ok(
      modesSection().includes(`\`npm start\` does not set it, so a production build serves the ${fallback} view`),
      `the section says a production build serves the ${fallback} view`
    );
    const row = readme.split("\n").find((line) => line.startsWith("| `npm run build` / `npm start` |"));
    assert.ok(row, "the scripts table has a row for npm start");
    assert.ok(row.includes(`in ${fallback} mode unless \`ATLAS_MODE\``), `the npm start row names ${fallback} mode`);
  });
});
