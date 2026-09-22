import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mineTokens } from "@/lib/usage/tokens";
import { rollupTokens } from "@/lib/usage/token-rollup";

/**
 * Reconciliation with the maintainer's own cost report
 * (~/.claude/scripts/token-cost-report.js) on ONE transcript: the same
 * fixture is mined here and read by the report from a throwaway HOME, and the
 * request count, the estimated cost and the carry total must agree exactly.
 * The fixture carries no streaming duplicates (one record per request), which
 * is the one place the two readers differ by design: this miner sums once per
 * requestId, the report sums every record. Skipped where the report is absent.
 */

const REPORT = path.join(os.homedir(), ".claude", "scripts", "token-cost-report.js");

function line(o: Record<string, unknown>): string {
  return JSON.stringify(o);
}

test("request count, estimated cost and carry agree with token-cost-report.js on one transcript", (t) => {
  if (!fs.existsSync(REPORT)) {
    t.skip(`${REPORT} not present`);
    return;
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-tokens-home-"));
  const dir = path.join(home, ".claude", "projects", "-Users-x-workspace-atlas");
  fs.mkdirSync(dir, { recursive: true });
  const S = "sess-reconcile";
  const big = "r".repeat(3_600_000);
  const lines = [
    { type: "user", sessionId: S, cwd: "/Users/x/workspace/atlas", timestamp: "2026-09-22T10:00:00Z", message: { role: "user", content: "start" } },
    { type: "assistant", sessionId: S, timestamp: "2026-09-22T10:00:01Z", requestId: "req_1", message: { role: "assistant", model: "claude-test-1", id: "m1", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/x/a.ts" } }], usage: { input_tokens: 1_200_000, cache_creation_input_tokens: 3_000_000, cache_read_input_tokens: 0, output_tokens: 80_000 } } },
    { type: "user", sessionId: S, timestamp: "2026-09-22T10:00:02Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: big }] } },
    { type: "assistant", sessionId: S, timestamp: "2026-09-22T10:00:03Z", requestId: "req_2", message: { role: "assistant", model: "claude-test-1", id: "m2", content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "ls" } }], usage: { input_tokens: 40_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 4_200_000, output_tokens: 60_000 } } },
    { type: "user", sessionId: S, timestamp: "2026-09-22T10:00:04Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "a".repeat(720_000) }] }] } },
    { type: "assistant", sessionId: S, timestamp: "2026-09-22T10:00:05Z", requestId: "req_3", message: { role: "assistant", model: "claude-test-1", id: "m3", content: [{ type: "text", text: "done" }], usage: { input_tokens: 10_000, cache_creation_input_tokens: 300_000, cache_read_input_tokens: 5_200_000, output_tokens: 500_000 } } },
  ];
  fs.writeFileSync(path.join(dir, `${S}.jsonl`), lines.map(line).join("\n") + "\n");

  const mined = mineTokens(lines);
  const roll = rollupTokens(mined.requests, mined.carry, { now: new Date("2026-09-22T12:00:00Z") });

  const out = spawnSync(process.execPath, [REPORT, "30"], { env: { ...process.env, HOME: home }, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  // The report prints whole dollars and carry in billions to two decimals, so
  // the fixture's counts are in the millions and carry is compared per tool.
  const total = out.stdout.match(/TOTAL ~\$([0-9.]+) across (\d+) requests/);
  assert.ok(total, `report output lacks the TOTAL line:\n${out.stdout}`);
  assert.equal(Number(total[2]), roll.totals.requests, "request count");
  assert.equal(Number(total[1]), Math.round(roll.totals.costEstimate), "estimated cost at the same rates, whole dollars");
  const model = out.stdout.match(/claude-test-1\s+reqs\s+(\d+) \| ctx\/turn\s+(\d+)k \| out\/turn\s+(\d+)/);
  assert.ok(model, `report output lacks the model row:\n${out.stdout}`);
  const s0 = roll.sessions[0];
  assert.equal(Number(model[1]), s0.requests);
  // The report's ctx/turn is the CACHED context per request (cache write + cache read), fresh input excluded.
  assert.equal(Number(model[2]), Math.round((s0.cacheCreation + s0.cacheRead) / s0.requests / 1000), "cached context per request, k");
  assert.equal(Number(model[3]), Math.round(s0.output / s0.requests), "output per request");
  for (const c of roll.carryByTool) {
    const row = out.stdout.match(new RegExp(`^${c.tool}\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+([0-9.]+)%`, "m"));
    assert.ok(row, `report output lacks the ${c.tool} carry row:\n${out.stdout}`);
    assert.equal(Number(row[1]), c.calls, `${c.tool} calls`);
    assert.equal(Number(row[2]), Math.round(c.resultTokensEst / c.calls), `${c.tool} tokens per call`);
    assert.equal(Number(row[3]), Math.round(c.carryEst / 1e6), `${c.tool} carry, Mtok-turns`);
    assert.equal(Number(row[4]), Number((c.share * 100).toFixed(1)), `${c.tool} share`);
  }
  fs.rmSync(home, { recursive: true, force: true });
});
