import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * A first-run user with no database must get the one actionable line
 * (`npm run setup-db`), never a stack trace. The refusal message itself is
 * good; this pins that the CLI surfaces it as a message rather than a crash.
 */
test("no-database failure is a message, not a stack trace", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "cli-err-"));
  try {
    await assert.rejects(
      run("npx", ["tsx", "bin/atlas-context.ts", "train", "status"], {
        env: { ...process.env, ATLAS_DATA_DIR: empty },
      }),
      (err: Error & { code?: number; stderr?: string }) => {
        assert.equal(err.code, 1);
        const stderr = err.stderr ?? "";
        assert.match(stderr, /setup-db/, "the actionable next step is named");
        assert.doesNotMatch(stderr, /at .*\d+:\d+/, "no stack frames");
        return true;
      }
    );
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
