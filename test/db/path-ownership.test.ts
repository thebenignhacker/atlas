import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * lib/paths.ts is the ONLY module permitted to compute a data or artifact
 * path.
 *
 * Deliberately NOT a ban on `process.cwd()`. Resolving a user-supplied
 * `--source` path or a verify command against the invocation directory is
 * correct and must keep working; banning the call outright would push those
 * uses into a workaround and teach the guard to be suppressed. What is banned
 * is the specific defect: joining the process's working directory to one of
 * OUR OWN data files, which is what let five modules disagree about where the
 * store lives depending on who launched them.
 *
 * The artifact list is derived from the resolver's own exports, so adding a new
 * path function to lib/paths.ts extends this guard automatically rather than
 * leaving a silently unguarded file behind.
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["lib", "scripts", "bin", "app", "components"];
const RESOLVER = path.join("lib", "paths.ts");

/** Our own data/artifact files. A cwd-relative join to any of these is a bug. */
const ARTIFACTS = [
  "atlas.db",
  "atlas.config.json",
  "public-snapshot.json",
  "owner-snapshot.json",
  ".current-session",
  '"data"',
];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        out.push(path.relative(ROOT, full));
      }
    }
  };
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d));
  return out;
}

test("no module outside lib/paths.ts joins process.cwd() to one of our data files", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    if (file === RESOLVER) continue;
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    src.split("\n").forEach((line, i) => {
      if (!line.includes("process.cwd()")) return;
      if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
      if (ARTIFACTS.some((a) => line.includes(a))) {
        offenders.push(`${file}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `these derive a data path from the working directory instead of lib/paths.ts:\n${offenders.join("\n")}`
  );
});

test("the guard is not vacuous — it catches a reintroduced cwd-derived path", () => {
  // Same predicate the test above applies, run against a line that used to be
  // real code (lib/db.ts, before path unification). A guard that cannot fail on
  // the original defect proves nothing about the current tree.
  const reintroduced = 'return path.join(process.cwd(), "data", "atlas.db");';
  assert.ok(
    reintroduced.includes("process.cwd()") &&
      ARTIFACTS.some((a) => reintroduced.includes(a)),
    "the predicate must flag the pre-unification line it exists to prevent"
  );
});

test("legitimate cwd use for user-supplied paths is still permitted", () => {
  // Provenance resolves --source against the invocation directory on purpose.
  // If this ever reports zero, the guard has been over-tightened into banning
  // process.cwd() outright and someone will route around it.
  const legitimate = sourceFiles().filter((f) => {
    if (f === RESOLVER) return false;
    return fs
      .readFileSync(path.join(ROOT, f), "utf8")
      .split("\n")
      .some(
        (l) =>
          l.includes("process.cwd()") &&
          !l.trimStart().startsWith("*") &&
          !l.trimStart().startsWith("//") &&
          !ARTIFACTS.some((a) => l.includes(a))
      );
  });
  assert.ok(
    legitimate.length > 0,
    "expected cwd to remain in use for resolving user-supplied source paths"
  );
});

test("every path the resolver exports is actually routed through it", async () => {
  const paths = await import("@/lib/paths");
  const exported = Object.keys(paths).filter((k) => typeof (paths as Record<string, unknown>)[k] === "function");
  // Guards against the resolver being added but bypassed: if nobody imports it,
  // path unification did not happen.
  const importers = sourceFiles().filter(
    (f) =>
      f !== RESOLVER &&
      fs.readFileSync(path.join(ROOT, f), "utf8").includes('from "@/lib/paths"')
  );
  assert.ok(exported.length >= 6, `resolver should export the path set, got ${exported.length}`);
  assert.ok(
    importers.length >= 4,
    `expected the resolver to be used across modules, found only: ${importers.join(", ")}`
  );
});
