import assert from "node:assert/strict";
import test from "node:test";
import { estimateResultTokens, mineTokens } from "@/lib/usage/tokens";
import { rollupTokens } from "@/lib/usage/token-rollup";
import { RATE, costEstimate } from "@/lib/usage/pricing";

/**
 * The token miner is pure: parsed transcript lines in, rows out. Each cell is a
 * rule shared with the maintainer's transcript reader or cost report:
 *   - usage is summed once per requestId, whatever the streaming duplicates;
 *   - a turn starts at a user line that is not tool results only, and its
 *     prefix is its last request's input + cache creation + cache read;
 *   - a tool result's carry is its estimated tokens x the responses after it;
 *   - the only input value kept is a file path; a command never survives;
 *   - cost is the measured counts at the flat rates, labeled estimated.
 */

const S = "sess-1";
let n = 0;
const ts = (min: number) => `2026-09-22T10:${String(min).padStart(2, "0")}:00.000Z`;

function user(text: string, min: number) {
  return { type: "user", sessionId: S, cwd: "/Users/x/workspace/atlas", timestamp: ts(min), message: { role: "user", content: text } };
}
function assistant(opts: { requestId?: string; usage: [number, number, number, number]; tool?: { id: string; name: string; input: Record<string, unknown> }; model?: string; min: number }) {
  n += 1;
  const content: unknown[] = [{ type: "text", text: "ok" }];
  if (opts.tool) content.push({ type: "tool_use", id: opts.tool.id, name: opts.tool.name, input: opts.tool.input });
  return {
    type: "assistant",
    sessionId: S,
    cwd: "/Users/x/workspace/atlas",
    timestamp: ts(opts.min),
    requestId: opts.requestId ?? `req_${n}`,
    message: {
      role: "assistant",
      model: opts.model ?? "claude-test-1",
      id: `msg_${n}`,
      content,
      usage: { input_tokens: opts.usage[0], cache_creation_input_tokens: opts.usage[1], cache_read_input_tokens: opts.usage[2], output_tokens: opts.usage[3] },
    },
  };
}
function result(toolUseId: string, content: unknown, min: number) {
  return { type: "user", sessionId: S, cwd: "/Users/x/workspace/atlas", timestamp: ts(min), message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content }] } };
}

test("usage is summed once per requestId, the first record winning", () => {
  const a = assistant({ requestId: "req_a", usage: [100, 50, 0, 10], min: 1 });
  const dup = { ...a, message: { ...a.message, usage: { ...a.message.usage, output_tokens: 999 } } };
  const m = mineTokens([user("hi", 0), a, dup, dup]);
  assert.equal(m.requests.length, 1);
  assert.equal(m.requests[0].output, 10);
  assert.equal(m.requests[0].id, "req_a");
  assert.equal(m.requests[0].model, "claude-test-1");
  assert.equal(m.requests[0].project, "atlas");
});

test("turns start at non-tool-result user lines; the prefix is the turn's last request", () => {
  const lines = [
    user("first", 0),
    assistant({ usage: [1000, 0, 0, 10], tool: { id: "t1", name: "Read", input: { file_path: "/a/b.ts" } }, min: 1 }),
    result("t1", "x".repeat(360), 2),
    assistant({ usage: [50, 1100, 0, 20], min: 3 }),
    user("second", 4),
    assistant({ usage: [30, 0, 1200, 5], min: 5 }),
  ];
  const m = mineTokens(lines);
  assert.equal(m.turns, 2);
  assert.deepEqual(m.requests.map((r) => r.turnIndex), [1, 1, 2]);
  const roll = rollupTokens(m.requests, m.carry, { now: new Date("2026-09-22T12:00:00Z") });
  const s = roll.sessions[0];
  assert.equal(s.turns, 2);
  // turn 1's last request: 50 + 1100 + 0; turn 2's: 30 + 0 + 1200
  assert.equal(s.prefixMax, 1230);
  // upper median, the transcript reader's own choice (prefixes[len // 2])
  assert.equal(s.prefixMedian, 1230);
  assert.equal(s.requests, 3);
  assert.equal(s.cacheHitRatio, 1200 / (1080 + 1100 + 1200));
});

test("carry is the result's estimated tokens times the responses that followed", () => {
  const lines = [
    user("go", 0),
    assistant({ usage: [1, 0, 0, 1], tool: { id: "t1", name: "Bash", input: { command: "cat secret.env", description: "x" } }, min: 1 }),
    result("t1", "y".repeat(36), 2), // 10 tokens
    assistant({ usage: [1, 0, 0, 1], tool: { id: "t2", name: "Read", input: { file_path: "/repo/big.ts" } }, min: 3 }),
    result("t2", "z".repeat(3600), 4), // 1000 tokens
    assistant({ usage: [1, 0, 0, 1], min: 5 }),
    assistant({ usage: [1, 0, 0, 1], min: 6 }),
  ];
  const m = mineTokens(lines);
  const byTool = Object.fromEntries(m.carry.map((c) => [c.tool, c]));
  assert.equal(byTool.Bash.resultTokensEst, 10);
  assert.equal(byTool.Bash.responsesRemaining, 3, "three responses after the Bash result");
  assert.equal(byTool.Bash.carryEst, 30);
  assert.equal(byTool.Read.responsesRemaining, 2);
  assert.equal(byTool.Read.carryEst, 2000);
  assert.equal(byTool.Read.file, "/repo/big.ts", "the file a Read named is kept, owner-only");
  assert.equal(byTool.Bash.file, null, "a command is never kept");
  assert.ok(!JSON.stringify(m).includes("secret.env"), "no input value but a path survives");
  const roll = rollupTokens(m.requests, m.carry, { now: new Date("2026-09-22T12:00:00Z") });
  assert.equal(roll.carryByTool[0].tool, "Read");
  assert.equal(roll.carryByTool[0].share, 2000 / 2030);
  assert.deepEqual(roll.carryByFile, [{ file: "/repo/big.ts", tool: "Read", calls: 1, carryEst: 2000 }]);
  assert.equal(roll.totals.carryEst, 2030);
});

test("result token estimates follow the cost report's rule", () => {
  assert.equal(estimateResultTokens("a".repeat(36)), 10);
  assert.equal(estimateResultTokens([{ type: "image", source: "..." }]), 1500);
  assert.equal(estimateResultTokens(undefined), 0);
});

test("cost is the measured counts at the flat rates and every figure is labeled", () => {
  const m = mineTokens([user("a", 0), assistant({ usage: [1_000_000, 1_000_000, 1_000_000, 1_000_000], min: 1 })]);
  const roll = rollupTokens(m.requests, m.carry, { now: new Date("2026-09-22T12:00:00Z") });
  assert.equal(roll.totals.costEstimate, RATE.input + RATE.cacheWrite + RATE.cacheRead + RATE.output);
  assert.equal(costEstimate({ input: 2e6, cacheCreation: 0, cacheRead: 0, output: 0 }), 2 * RATE.input);
  assert.match(roll.labels.tokens, /^measured/);
  assert.match(roll.labels.cost, /^estimated/);
  assert.match(roll.labels.carry, /^estimated/);
  assert.equal(roll.repos[0].project, "atlas");
  assert.equal(roll.repos[0].sessions, 1);
  assert.equal(roll.days.length, 30);
  assert.equal(roll.days[29].day, "2026-09-22");
  assert.equal(roll.days[29].requests, 1);
  assert.equal(roll.headroom, null, "no headroom source means unavailable, not zero");
});

test("lines without a usage block or a message are not requests", () => {
  const m = mineTokens([{ type: "summary", summary: "x" }, { type: "assistant", message: { role: "assistant", content: [] } }, user("q", 0)]);
  assert.equal(m.requests.length, 0);
  assert.equal(m.turns, 1);
});
