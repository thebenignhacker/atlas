import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/**
 * The incremental ingest and the full scan share ONE parser; these tests pin
 * that contract and the upsert/delete lifecycle. The database is sandboxed via
 * ATLAS_DATA_DIR (the paths layer's documented override), never the real one.
 */

const REPO = path.resolve(__dirname, "..", "..");

const CARD = `# Test decision card

**Date:** 2026-08-28T15:00Z
**Session:** test-session
**Chief:** CDE
**Class:** adopted
**Status:** executed
**Tree:** personal
**Decision:** A test decision line.
**Why:** Because the ingest path needs a fixture.
**Alternatives:** none considered
**Reversibility:** delete the card
**Review trigger:** never
**Supersedes:** none
**Links:** none

Body detail.

## Log

- 2026-08-28 — created
`;

function run(dataDir: string, args: string[]): string {
  return execFileSync(
    "npx",
    ["tsx", path.join(REPO, "scripts", "ingest-decision.ts"), ...args],
    { env: { ...process.env, ATLAS_DATA_DIR: dataDir }, cwd: REPO, encoding: "utf8" }
  );
}

function rows(dataDir: string): { id: string; status: string; checksum: string }[] {
  const out = execFileSync(
    "npx",
    [
      "tsx",
      "-e",
      `import { getDb, initSchema } from "@/lib/db";
       const db = getDb(); initSchema(db);
       console.log(JSON.stringify(db.prepare("SELECT id,status,checksum FROM decisions ORDER BY id").all()));`,
    ],
    { env: { ...process.env, ATLAS_DATA_DIR: dataDir }, cwd: REPO, encoding: "utf8" }
  );
  const line = out.trim().split("\n").pop() ?? "[]";
  return JSON.parse(line);
}

function skipRows(dataDir: string): { id: string; reason: string }[] {
  const out = execFileSync(
    "npx",
    [
      "tsx",
      "-e",
      `import { getDb, initSchema } from "@/lib/db";
       const db = getDb(); initSchema(db);
       console.log(JSON.stringify(db.prepare("SELECT id,reason FROM decision_skips ORDER BY id").all()));`,
    ],
    { env: { ...process.env, ATLAS_DATA_DIR: dataDir }, cwd: REPO, encoding: "utf8" }
  );
  const line = out.trim().split("\n").pop() ?? "[]";
  return JSON.parse(line);
}

function freshSandbox(): { dataDir: string; cardsDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-ingest-"));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  execFileSync("npx", ["tsx", "-e", `import { createDb, initSchema } from "@/lib/db"; initSchema(createDb());`], {
    env: { ...process.env, ATLAS_DATA_DIR: dataDir },
    cwd: REPO,
  });
  const cardsDir = path.join(root, "decisions");
  fs.mkdirSync(cardsDir);
  return { dataDir, cardsDir };
}

test("a written card is ingested, an edit upserts in place, a deletion removes the row", () => {
  const { dataDir, cardsDir } = freshSandbox();
  const card = path.join(cardsDir, "2026-08-28-test-card.md");
  fs.writeFileSync(card, CARD);

  run(dataDir, [card]);
  let r = rows(dataDir);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, "2026-08-28-test-card");
  assert.equal(r[0].status, "executed");
  const firstChecksum = r[0].checksum;

  fs.writeFileSync(card, CARD.replace("**Status:** executed", "**Status:** superseded"));
  run(dataDir, [card]);
  r = rows(dataDir);
  assert.equal(r.length, 1, "an edit must upsert, never duplicate");
  assert.equal(r[0].status, "superseded");
  assert.notEqual(r[0].checksum, firstChecksum);

  fs.unlinkSync(card);
  run(dataDir, [card]);
  assert.equal(rows(dataDir).length, 0, "a deleted card's row is removed");
});

test("a malformed card is recorded as a skip with its reason, and README is never ingested", () => {
  const { dataDir, cardsDir } = freshSandbox();
  const bad = path.join(cardsDir, "2026-08-28-no-decision-line.md");
  fs.writeFileSync(bad, "# Not a card\n\n**Why:** missing the Decision line\n");
  const readme = path.join(cardsDir, "README.md");
  fs.writeFileSync(readme, CARD); // even a README that LOOKS like a card stays out
  const out = run(dataDir, [bad, readme]);
  assert.equal(rows(dataDir).length, 0);
  const skips = skipRows(dataDir);
  assert.equal(skips.length, 1, "the refused card is recorded, the README is not");
  assert.equal(skips[0].id, "2026-08-28-no-decision-line");
  assert.match(skips[0].reason, /no \*\*Decision:\*\* line/);
  // Exactly one line on a skip, carrying file and reason; nothing else.
  const lines = out.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, `expected one line, got: ${out}`);
  assert.match(lines[0], /skipped 2026-08-28-no-decision-line\.md: no \*\*Decision:\*\* line/);
});

test("ingest is silent on success", () => {
  const { dataDir, cardsDir } = freshSandbox();
  const card = path.join(cardsDir, "2026-08-28-quiet.md");
  fs.writeFileSync(card, CARD);
  assert.equal(run(dataDir, [card]).trim(), "", "a successful ingest prints nothing");
  assert.match(run(dataDir, ["--verbose", card]), /1 upserted/);
});

test("a card that breaks becomes a skip, and a repaired card clears it", () => {
  const { dataDir, cardsDir } = freshSandbox();
  const card = path.join(cardsDir, "2026-08-28-flip.md");
  fs.writeFileSync(card, CARD);
  run(dataDir, [card]);
  assert.equal(rows(dataDir).length, 1);

  // An edit that leaves a non-canonical Status must drop the old row: the row
  // would otherwise assert a status the file no longer states.
  fs.writeFileSync(card, CARD.replace("**Status:** executed", "**Status:** queued"));
  const out = run(dataDir, [card]);
  assert.equal(rows(dataDir).length, 0, "stale row removed");
  assert.equal(skipRows(dataDir).length, 1);
  assert.match(skipRows(dataDir)[0].reason, /Status "queued" is not one of/);
  assert.match(out, /skipped 2026-08-28-flip\.md: Status "queued"/);

  fs.writeFileSync(card, CARD);
  run(dataDir, [card]);
  assert.equal(rows(dataDir).length, 1, "repaired card is back");
  assert.equal(skipRows(dataDir).length, 0, "its skip row is cleared");

  fs.unlinkSync(card);
  run(dataDir, [card]);
  assert.equal(skipRows(dataDir).length, 0, "deletion clears any skip row too");
});

test("ingest and full-scan parse identically (one parser, no drift)", async () => {
  const { cardsDir } = freshSandbox();
  const card = path.join(cardsDir, "2026-08-28-parity.md");
  fs.writeFileSync(card, CARD);
  const { parseDecisionFile, scanDecisions } = await import("@/lib/scanners/decisions");
  const viaParse = parseDecisionFile(card, "2026-08-28T15:01:00.000Z");
  const viaScan = scanDecisions({ todoDirs: [path.dirname(cardsDir)] } as never).find(
    (d) => d.id === "2026-08-28-parity"
  );
  assert.ok(viaParse && viaScan);
  const strip = (d: object) => {
    const rest = { ...(d as Record<string, unknown>) };
    delete rest.scannedAt;
    return rest;
  };
  assert.deepEqual(strip(viaParse), strip(viaScan));
});
