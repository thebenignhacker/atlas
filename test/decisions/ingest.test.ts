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

test("a malformed card is skipped with no row, and README is never ingested", () => {
  const { dataDir, cardsDir } = freshSandbox();
  const bad = path.join(cardsDir, "2026-08-28-no-decision-line.md");
  fs.writeFileSync(bad, "# Not a card\n\n**Why:** missing the Decision line\n");
  const readme = path.join(cardsDir, "README.md");
  fs.writeFileSync(readme, CARD); // even a README that LOOKS like a card stays out
  const out = run(dataDir, [bad, readme]);
  assert.match(out, /0 upserted/);
  assert.equal(rows(dataDir).length, 0);
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
