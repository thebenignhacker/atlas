import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseDecisionEntry, scanDecisionLog } from "@/lib/scanners/decisions";

/**
 * The parser is closed by spec (append-only log: fix the card, not the parser).
 * What it owes the owner in return is a NAMED reason for every file it refuses,
 * so the owner view can list what to fix instead of silently under-counting.
 */

const GOOD = `# A good card

**Date:** 2026-08-28T15:00Z
**Class:** adopted
**Status:** executed
**Decision:** The decision.
`;

function dir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atlas-decisions-parse-"));
}

function write(d: string, name: string, body: string): string {
  const p = path.join(d, name);
  fs.writeFileSync(p, body);
  return p;
}

const quiet = { quiet: true };

test("a spec-compliant card parses", () => {
  const d = dir();
  const r = parseDecisionEntry(write(d, "2026-08-28-good.md", GOOD), undefined, quiet);
  assert.equal(r.kind, "card");
  if (r.kind === "card") {
    assert.equal(r.card.klass, "adopted");
    assert.equal(r.card.status, "executed");
    assert.equal(r.card.decision, "The decision.");
  }
});

test("a missing Decision line is a skip that names the line", () => {
  const d = dir();
  const r = parseDecisionEntry(
    write(d, "2026-09-03-queued-thing.md", "# Queued\n\n**Class:** queued-for-owner\n**Status:** pending\n"),
    undefined,
    quiet
  );
  assert.equal(r.kind, "skip");
  if (r.kind === "skip") {
    assert.equal(r.skip.id, "2026-09-03-queued-thing");
    assert.equal(r.skip.filename, "2026-09-03-queued-thing.md");
    assert.equal(r.skip.reason, "no **Decision:** line");
  }
});

test("non-canonical Class and Status are both named, with the value seen", () => {
  const d = dir();
  const r = parseDecisionEntry(
    write(
      d,
      "2026-08-29-bad-enums.md",
      "# Bad\n\n**Class:** decision\n**Status:** queued\n**Decision:** x\n"
    ),
    undefined,
    quiet
  );
  assert.equal(r.kind, "skip");
  if (r.kind === "skip") {
    assert.match(r.skip.reason, /Class "decision" is not one of adopted \| queued-for-owner/);
    assert.match(r.skip.reason, /Status "queued" is not one of executed \| pending/);
  }
});

test("a missing Class or Status line says so rather than quoting an empty value", () => {
  const d = dir();
  const r = parseDecisionEntry(
    write(d, "2026-08-29-no-status.md", "# X\n\n**Class:** adopted\n**Decision:** x\n"),
    undefined,
    quiet
  );
  assert.equal(r.kind, "skip");
  if (r.kind === "skip") assert.equal(r.skip.reason, "no **Status:** line");
});

test("README and non-markdown files are ignored, not skipped", () => {
  const d = dir();
  assert.equal(parseDecisionEntry(write(d, "README.md", GOOD), undefined, quiet).kind, "ignore");
  assert.equal(parseDecisionEntry(write(d, "notes.txt", GOOD), undefined, quiet).kind, "ignore");
  assert.equal(parseDecisionEntry(path.join(d, "missing.md"), undefined, quiet).kind, "ignore");
});

test("scanDecisionLog returns cards and skips together, README excluded", () => {
  const root = dir();
  const d = path.join(root, "decisions");
  fs.mkdirSync(d);
  write(d, "2026-08-28-good.md", GOOD);
  write(d, "2026-08-29-bad.md", "# Bad\n\n**Why:** no decision\n");
  write(d, "README.md", GOOD);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const log = scanDecisionLog({ todoDirs: [root] } as never);
    assert.deepEqual(
      log.decisions.map((c) => c.id),
      ["2026-08-28-good"]
    );
    assert.deepEqual(
      log.skips.map((k) => [k.id, k.reason]),
      [["2026-08-29-bad", "no **Decision:** line"]]
    );
  } finally {
    console.warn = warn;
  }
});
