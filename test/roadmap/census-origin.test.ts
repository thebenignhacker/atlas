import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GIT_ENV, bareOrigin, git, publish, writeUnit } from "./git-fixture";

/**
 * The census counts the store, which is each tree's origin/main, not whatever a
 * local checkout happens to hold. A checkout that is behind its remote, carries
 * local-only commits or has uncommitted drafts must not change the count, and a
 * tree that cannot be read must say so rather than count as zero.
 */

const CENSUS = path.resolve(__dirname, "..", "..", "scripts", "roadmap-census.py");

function census(cfg: string, ...flags: string[]): string {
  return execFileSync("python3", [CENSUS, "--config", cfg, ...flags], { encoding: "utf8", env: GIT_ENV });
}

function config(root: string, todoDirs: string[]): string {
  const cfg = path.join(root, "atlas.config.json");
  fs.writeFileSync(cfg, JSON.stringify({ todoDirs }));
  return cfg;
}

/** The plain-output row for one tree: [tree, total, ...per-status]. */
function row(out: string, tree: string): string[] {
  const line = out.split("\n").find((l) => l.startsWith(`${tree}  `));
  assert.ok(line, `no row for ${tree} in:\n${out}`);
  return line.split("  ");
}

/** origin has u1..u5; `behind` was cloned at u1..u2 and then gained local-only work. */
function behindCheckout(): { root: string; origin: string; behind: string; staleSha: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-census-"));
  const origin = bareOrigin(path.join(root, "origin.git"));
  const seed = path.join(root, "seed");
  fs.mkdirSync(seed);
  writeUnit(seed, "u1.md", "ready");
  writeUnit(seed, "u2.md", "ready");
  publish(seed, origin, ["roadmap"]);

  const behind = path.join(root, "behind");
  git(root, "clone", "-q", origin, behind);
  const staleSha = git(behind, "rev-parse", "origin/main");

  writeUnit(seed, "u3.md", "done");
  writeUnit(seed, "u4.md", "done");
  writeUnit(seed, "u5.md", "in-review");
  publish(seed, origin, ["roadmap"]);

  writeUnit(behind, "local-commit.md", "ready");
  git(behind, "add", "--", "roadmap/local-commit.md");
  git(behind, "commit", "-q", "-m", "local only");
  writeUnit(behind, "draft.md", "todo");
  return { root, origin, behind, staleSha };
}

test("a checkout behind origin/main is counted at origin/main, not at its working tree", () => {
  const { root, origin, behind } = behindCheckout();
  const inWorkingTree = fs.readdirSync(path.join(behind, "roadmap")).filter((f) => f.endsWith(".md"));
  assert.deepEqual(inWorkingTree.sort(), ["draft.md", "local-commit.md", "u1.md", "u2.md"]);
  const onOrigin = git(origin, "ls-tree", "-r", "--name-only", "main", "roadmap/").split("\n");
  assert.equal(onOrigin.length, 5);

  const out = census(config(root, [behind]));

  const [, total, ...byStatus] = row(out, behind);
  assert.equal(Number(total), onOrigin.length, "census total equals the files on origin/main");
  assert.match(out, /^units=5 trees=1 unknown=0$/m);
  assert.deepEqual(byStatus.map(Number), [0, 0, 2, 0, 1, 2, 0]);

  const sha = git(behind, "rev-parse", "origin/main");
  assert.equal(sha, git(origin, "rev-parse", "main"), "the census fetched origin/main before reading it");
  assert.match(out, new RegExp(`^  ${behind}  ${sha}  fetch=ok  behind=1  ahead=1  absent=3$`, "m"));
  assert.match(out, /Checkout gap: 1 tree\(s\) trail origin\/main .* misses 3 unit\(s\)/);

  const units = census(config(root, [behind]), "--json")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { file: string; sha: string });
  assert.deepEqual(units.map((u) => u.file), ["u1.md", "u2.md", "u3.md", "u4.md", "u5.md"]);
  assert.ok(units.every((u) => u.sha === sha), "every unit carries the sha it was read at");
});

test("--no-fetch reads the last fetched origin/main and prints that sha", () => {
  const { root, behind, staleSha } = behindCheckout();
  const out = census(config(root, [behind]), "--no-fetch");
  assert.match(out, /^units=2 trees=1 unknown=0$/m);
  assert.match(out, new RegExp(`^  ${behind}  ${staleSha}  fetch=skipped  behind=0  ahead=1  absent=0$`, "m"));
  assert.equal(git(behind, "rev-parse", "origin/main"), staleSha, "--no-fetch left the ref alone");
});

test("a tree that cannot be read is unknown, never 0, and stays out of the totals", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-census-"));
  const good = path.join(root, "good");
  fs.mkdirSync(good);
  writeUnit(good, "a.md", "done");
  publish(good, bareOrigin(path.join(root, "good.git")), ["roadmap"]);

  const plain = path.join(root, "plain");
  writeUnit(plain, "x.md", "ready");
  const noOrigin = path.join(root, "no-origin");
  fs.mkdirSync(noOrigin);
  git(noOrigin, "init", "-q", "-b", "main");
  writeUnit(noOrigin, "y.md", "ready");
  git(noOrigin, "add", "--", "roadmap");
  git(noOrigin, "commit", "-q", "-m", "local");
  const missing = path.join(root, "missing");
  const cfg = config(root, [good, plain, noOrigin, missing]);

  const out = census(cfg);
  assert.match(out, /^units=1 trees=1 unknown=3$/m);
  for (const tree of [plain, noOrigin, missing]) {
    assert.deepEqual(row(out, tree).slice(1), ["unknown", "-", "-", "-", "-", "-", "-", "-"]);
  }
  assert.equal(row(out, "ALL")[1], "1");
  assert.match(out, new RegExp(`^  ${plain}  unknown \\(not a git checkout\\)`, "m"));
  assert.match(out, new RegExp(`^  ${noOrigin}  unknown \\(origin/main does not resolve\\)`, "m"));

  assert.match(census(cfg, "--md"), new RegExp(`^\\| ${noOrigin} \\| unknown \\|`, "m"));

  const json = spawnSync("python3", [CENSUS, "--config", cfg, "--json"], { encoding: "utf8", env: GIT_ENV });
  assert.equal(json.status, 0);
  assert.equal(json.stdout.trim().split("\n").length, 1, "only the readable tree's unit is a row");
  assert.match(json.stderr, new RegExp(`${noOrigin}: unknown \\(origin/main does not resolve\\), not counted`));
});

test("<X>/todo and <X> each get a row, in either order, and the one that cannot be read is unknown", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-census-"));
  const x = path.join(root, "x");
  const todo = path.join(x, "todo");
  fs.mkdirSync(todo, { recursive: true });
  writeUnit(todo, "a.md", "done");
  publish(todo, bareOrigin(path.join(root, "x-todo.git")), ["roadmap"]);

  for (const todoDirs of [[todo, x], [x, todo]]) {
    const cfg = config(root, todoDirs);
    const run = spawnSync("python3", [CENSUS, "--config", cfg, "--no-fetch"], { encoding: "utf8", env: GIT_ENV });
    assert.equal(run.status, 0, run.stderr);
    const out = run.stdout;
    assert.match(out, /^units=1 trees=1 unknown=1$/m);
    assert.deepEqual(row(out, todo).slice(1), ["1", "0", "0", "0", "0", "0", "1", "0"]);
    assert.deepEqual(row(out, x).slice(1), ["unknown", "-", "-", "-", "-", "-", "-", "-"]);
    assert.match(out, new RegExp(`^  ${x}  unknown \\(not a git checkout\\)`, "m"));

    const json = spawnSync("python3", [CENSUS, "--config", cfg, "--no-fetch", "--json"], {
      encoding: "utf8",
      env: GIT_ENV,
    });
    assert.equal(json.status, 0, json.stderr);
    assert.deepEqual(
      json.stdout.trim().split("\n").map((l) => (JSON.parse(l) as { tree: string }).tree),
      [todo],
      "the unit carries the name of the tree it was read from"
    );
    assert.match(json.stderr, new RegExp(`${x}: unknown \\(not a git checkout\\), not counted`));
  }
});
