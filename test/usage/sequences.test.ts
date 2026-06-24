import { test } from "node:test";
import assert from "node:assert/strict";
import {
  salientToken,
  sessionSequences,
  mineRoutines,
} from "@/lib/usage/sequences";
import { classifyRoutine, generateScaffold } from "@/lib/usage/scaffold";
import type { ToolEvent } from "@/lib/usage/types";

const NOW = new Date("2026-06-24T12:00:00Z");

function ev(p: Partial<ToolEvent> & { sessionId: string; ts: string }): ToolEvent {
  return {
    id: p.id ?? `${p.sessionId}-${p.ts}`,
    sessionId: p.sessionId,
    ts: p.ts,
    feature: p.feature ?? "Edit",
    category: p.category ?? "file",
    project: p.project ?? null,
    howInvoked: "direct",
    paramKeys: [],
    cwd: null,
    gitBranch: null,
  };
}

// Build a session that repeats edit → browser-check → edit.
function loopSession(sid: string, day: string): ToolEvent[] {
  return [
    ev({ sessionId: sid, ts: `${day}T09:00:00Z`, feature: "Edit", category: "file" }),
    ev({ sessionId: sid, ts: `${day}T09:01:00Z`, feature: "Read", category: "file" }),
    ev({
      sessionId: sid,
      ts: `${day}T09:02:00Z`,
      feature: "mcp:playwright.browser_navigate",
      category: "mcp",
    }),
    ev({ sessionId: sid, ts: `${day}T09:03:00Z`, feature: "Edit", category: "file" }),
  ];
}

test("salientToken collapses code and sanitizes names in public mode", () => {
  const edit = ev({ sessionId: "s", ts: "t", feature: "Edit", category: "file" });
  const bash = ev({ sessionId: "s", ts: "t", feature: "Bash", category: "exec" });
  assert.equal(salientToken(edit, false), "·code");
  assert.equal(salientToken(bash, false), "·code");

  const privSkill = ev({ sessionId: "s", ts: "t", feature: "Skill:secret-audit", category: "skill" });
  assert.equal(salientToken(privSkill, false), "Skill:secret-audit");
  assert.equal(salientToken(privSkill, true), "Skill:(other)"); // sanitized in public

  const mcp = ev({ sessionId: "s", ts: "t", feature: "mcp:playwright.browser_click", category: "mcp" });
  assert.equal(salientToken(mcp, true), "mcp:playwright"); // server-level
});

test("sessionSequences collapses consecutive duplicates and orders by ts", () => {
  const seqs = sessionSequences(loopSession("s1", "2026-06-20"), false);
  const seq = seqs.get("s1")!.map((t) => t.tok);
  // Edit, Read collapse to one ·code; then mcp; then ·code
  assert.deepEqual(seq, ["·code", "mcp:playwright", "·code"]);
});

test("mineRoutines surfaces a cross-session motif with real support", () => {
  const events = [
    ...loopSession("s1", "2026-06-20"),
    ...loopSession("s2", "2026-06-21"),
    ...loopSession("s3", "2026-06-22"),
  ];
  const routines = mineRoutines(events, { public: false, now: NOW, minSupport: 3 });
  const top = routines[0];
  assert.deepEqual(top.steps, ["·code", "mcp:playwright", "·code"]);
  assert.equal(top.support, 3);
  assert.equal(top.kind, "loop");
  // subsumption: the 2-step sub-motifs are not also listed
  assert.ok(!routines.some((r) => r.steps.join() === "·code,mcp:playwright"));
});

test("mineRoutines sanitizes private names in public mode", () => {
  const mk = (sid: string, day: string): ToolEvent[] => [
    ev({ sessionId: sid, ts: `${day}T09:00:00Z`, feature: "Skill:client-x-deploy", category: "skill" }),
    ev({ sessionId: sid, ts: `${day}T09:01:00Z`, feature: "Edit", category: "file" }),
  ];
  const events = [...mk("s1", "2026-06-20"), ...mk("s2", "2026-06-21"), ...mk("s3", "2026-06-22")];
  const routines = mineRoutines(events, { public: true, now: NOW, minSupport: 3 });
  assert.ok(routines.length >= 1);
  for (const r of routines) assert.ok(!r.steps.includes("Skill:client-x-deploy"));
  assert.ok(!JSON.stringify(routines).includes("client-x"), "private name scrubbed from routines");
});

test("salientToken fails closed on a feature/category desync (mcp)", () => {
  // category says mcp but the feature carries a private, non-mcp string —
  // must NOT echo the raw text; must bucket to mcp:(other).
  const desync = ev({
    sessionId: "s",
    ts: "t",
    feature: "weird:AcmeCorpSecretClient.x",
    category: "mcp",
  });
  assert.equal(salientToken(desync, true), "mcp:(other)");
  const desync2 = ev({ sessionId: "s", ts: "t", feature: "AcmeCorpSecretClient", category: "mcp" });
  assert.equal(salientToken(desync2, true), "mcp:(other)");
});

test("scaffold never names an unknown/private MCP server", () => {
  const s = generateScaffold(["mcp:AcmeCorpSecretClient", "·code"], "loop");
  assert.ok(!s.includes("AcmeCorpSecretClient"));
  assert.match(s, /call an MCP integration/);
  // known servers are still named (the showcase value)
  assert.match(generateScaffold(["mcp:playwright", "·code"], "loop"), /playwright/);
});

test("classifyRoutine picks the right automation kind", () => {
  assert.equal(classifyRoutine(["Skill:release-test", "·code"]), "skill");
  assert.equal(classifyRoutine(["·code", "mcp:playwright", "·code"]), "loop");
  assert.equal(classifyRoutine(["Agent:Explore", "mcp:playwright"]), "workflow");
});

test("generateScaffold produces honest, labeled output", () => {
  const wf = generateScaffold(["Agent:Explore", "mcp:playwright"], "workflow");
  assert.match(wf, /export const meta/);
  assert.match(wf, /starting scaffold/i); // labeled as a starting point, not a finished workflow
  const skill = generateScaffold(["Skill:release-test", "·code"], "skill");
  assert.match(skill, /release-test/);
});
