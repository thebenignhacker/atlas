import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { mergeConfig } from "@/lib/config";
import { scanTodos } from "@/lib/scanners/todos";
import type { Todo } from "@/lib/types";

/**
 * A todo directory can hold subdirectories whose markdown files are records,
 * not todos. `todoSkipDirs` names them: the walk does not enter a directory
 * whose name is listed, and an empty list leaves the walk as it was.
 */

const roots: string[] = [];

after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function write(root: string, rel: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `# ${path.basename(rel, ".md")}\n`);
}

/** A todo directory with one dated file in `skipme/` and one beside it. */
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-todos-skip-"));
  roots.push(root);
  write(root, "skipme/2026-10-25.md");
  write(root, "2026-10-24-beside.md");
  return root;
}

function under(todos: Todo[], dir: string): string[] {
  return todos.filter((t) => t.path.startsWith(dir + path.sep)).map((t) => t.filename);
}

test("a directory named in todoSkipDirs yields no todo, and the file beside it still does", () => {
  const root = fixture();
  const todos = scanTodos(mergeConfig({ todoDirs: [root], todoSkipDirs: ["skipme"] }), []);
  assert.deepEqual(under(todos, path.join(root, "skipme")), []);
  assert.deepEqual(
    todos.map((t) => t.filename),
    ["2026-10-24-beside.md"]
  );
});

test("with todoSkipDirs empty the same directory yields its one todo (the control)", () => {
  const root = fixture();
  const todos = scanTodos(mergeConfig({ todoDirs: [root], todoSkipDirs: [] }), []);
  assert.deepEqual(under(todos, path.join(root, "skipme")), ["2026-10-25.md"]);
  assert.equal(todos.length, 2);
});

test("todoSkipDirs defaults to empty, so a config without the key skips nothing", () => {
  const root = fixture();
  const config = mergeConfig({ todoDirs: [root] });
  assert.deepEqual(config.todoSkipDirs, []);
  assert.deepEqual(under(scanTodos(config, []), path.join(root, "skipme")), ["2026-10-25.md"]);
});

test("a listed name is matched exactly, at any depth", () => {
  const root = fixture();
  write(root, "archive/skipme/2026-10-23.md");
  write(root, "skipme-not/2026-10-22.md");
  const todos = scanTodos(mergeConfig({ todoDirs: [root], todoSkipDirs: ["skipme"] }), []);
  assert.deepEqual(under(todos, path.join(root, "archive", "skipme")), []);
  assert.deepEqual(under(todos, path.join(root, "skipme-not")), ["2026-10-22.md"]);
});
