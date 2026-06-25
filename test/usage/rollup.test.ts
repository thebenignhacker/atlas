import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFeature, eventsFromLine, projectFromCwd } from "@/lib/usage/parse";
import { rollupEvents } from "@/lib/usage/rollup";
import type { ToolEvent } from "@/lib/usage/types";

// The public rollup is the showcase surface. If it can carry a path, a private
// project name, a parameter value, or a raw event, that is a leak — so these
// tests guard the sanitization the same way context/snapshot-sensitive guards
// the card surface.

const NOW = new Date("2026-06-24T12:00:00Z");

test("normalizeFeature maps the tool families to stable keys", () => {
  assert.deepEqual(normalizeFeature("Bash", {}), { feature: "Bash", category: "exec" });
  assert.deepEqual(normalizeFeature("Skill", { skill: "pre-push-review" }), {
    feature: "Skill:pre-push-review",
    category: "skill",
  });
  assert.deepEqual(normalizeFeature("Agent", { subagent_type: "Explore" }), {
    feature: "Agent:Explore",
    category: "orchestration",
  });
  assert.equal(
    normalizeFeature("Workflow", { script: "export const meta = { name: 'feature-map' }" })
      .feature,
    "Workflow:feature-map"
  );
  assert.equal(
    normalizeFeature("mcp__playwright__browser_navigate", {}).feature,
    "mcp:playwright.browser_navigate"
  );
  assert.equal(normalizeFeature("TaskCreate", {}).feature, "Task");
});

test("projectFromCwd extracts the workspace org/dir", () => {
  assert.equal(projectFromCwd("/Users/me/workspace/opena2a-org/hma"), "opena2a-org");
  assert.equal(projectFromCwd("/Users/me/workspace/csnp"), "csnp");
  assert.equal(projectFromCwd("/tmp/elsewhere"), null);
  assert.equal(projectFromCwd(null), null);
});

test("eventsFromLine captures KEY NAMES only — never values", () => {
  const line = {
    timestamp: "2026-06-20T10:00:00Z",
    sessionId: "sess-1",
    cwd: "/Users/me/workspace/opena2a-org/hackmyagent",
    gitBranch: "main",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          name: "Bash",
          id: "toolu_1",
          input: { command: "cat secret.env", description: "x" },
        },
      ],
    },
  };
  const evs = eventsFromLine(line as Record<string, unknown>, 1);
  assert.equal(evs.length, 1);
  assert.deepEqual(evs[0].paramKeys, ["command", "description"]);
  assert.equal(evs[0].project, "opena2a-org");
  assert.equal(evs[0].feature, "Bash");
  assert.ok(!JSON.stringify(evs[0]).includes("secret.env"), "no input value captured");
});

test("eventsFromLine extracts slash commands", () => {
  const line = {
    timestamp: "2026-06-20T10:00:00Z",
    sessionId: "s",
    message: { content: "<command-name>/clear</command-name>\n<command-args></command-args>" },
  };
  const evs = eventsFromLine(line as Record<string, unknown>, 5);
  assert.equal(evs[0].feature, "command:/clear");
  assert.equal(evs[0].category, "command");
});

function ev(p: Partial<ToolEvent>): ToolEvent {
  return {
    id: p.id ?? "i",
    sessionId: p.sessionId ?? "s1",
    ts: p.ts ?? "2026-06-24T09:00:00Z",
    feature: p.feature ?? "Bash",
    category: p.category ?? "exec",
    project: p.project ?? null,
    howInvoked: "direct",
    paramKeys: p.paramKeys ?? [],
    cwd: p.cwd ?? null,
    gitBranch: p.gitBranch ?? null,
  };
}

test("public rollup drops owner-only fields and buckets non-allowlisted projects", () => {
  const events = [
    ev({
      project: "opena2a-org",
      cwd: "/Users/me/workspace/opena2a-org/x",
      gitBranch: "main",
      paramKeys: ["command"],
    }),
    ev({ project: "secret-client", feature: "Read", category: "file" }),
  ];
  const r = rollupEvents(events, {
    public: true,
    publicProjects: ["opena2a-org", "csnp"],
    now: NOW,
  });
  const json = JSON.stringify(r);
  assert.ok(!json.includes("/Users/"), "no filesystem path");
  assert.ok(!json.includes('"cwd"'), "no cwd field");
  assert.ok(!json.includes('"gitBranch"'), "no gitBranch field");
  assert.ok(!json.includes('"paramKeys"'), "no paramKeys field");
  assert.ok(!json.includes("secret-client"), "non-allowlisted project bucketed away");
  assert.deepEqual(
    r.projects.map((p) => p.project).sort(),
    ["opena2a-org", "other"]
  );
  assert.equal(r.recentEvents, undefined, "no raw events in public rollup");
});

test("public rollup truncates timestamps to date-only", () => {
  const r = rollupEvents([ev({ ts: "2026-06-24T09:13:45Z" })], { public: true, now: NOW });
  const bash = r.features.find((f) => f.feature === "Bash");
  assert.equal(bash?.lastUsed, "2026-06-24");
});

test("public feature keys are allowlisted: private names bucket, known names show", () => {
  const events = [
    ev({ feature: "Workflow:migrate-acmecorp-billing", category: "orchestration" }),
    ev({ feature: "Skill:acmebank-audit", category: "skill" }),
    ev({ feature: "Skill:pre-push-review", category: "skill" }),
    ev({ feature: "command:/deploy-acmebank-prod", category: "command" }),
    ev({ feature: "command:/clear", category: "command" }),
    ev({ feature: "mcp:acmecorp-internal.query", category: "mcp" }),
    ev({ feature: "mcp:playwright.browser_navigate", category: "mcp" }),
    ev({ feature: "Bash", category: "exec" }),
  ];
  const r = rollupEvents(events, { public: true, now: NOW });
  const keys = r.features.map((f) => f.feature);
  // user-authored / unknown names are bucketed — the name never ships
  assert.ok(keys.includes("Workflow:(custom)"));
  assert.ok(keys.includes("Skill:(other)"));
  assert.ok(keys.includes("command:(other)"));
  assert.ok(keys.includes("mcp:(other)"));
  // known-safe generic names are retained (the showcase value)
  assert.ok(keys.includes("Skill:pre-push-review"));
  assert.ok(keys.includes("command:/clear"));
  assert.ok(keys.includes("mcp:playwright.browser_navigate"));
  assert.ok(keys.includes("Bash"));
  // no private token survives anywhere in the public rollup
  const json = JSON.stringify(r);
  for (const tok of ["acmecorp", "acmebank", "internal", "migrate"]) {
    assert.ok(!json.includes(tok), `private token "${tok}" leaked`);
  }
});

test("owner mode keeps real feature names verbatim", () => {
  const r = rollupEvents(
    [ev({ feature: "Workflow:migrate-acmecorp-billing", category: "orchestration" })],
    { public: false, now: NOW }
  );
  assert.ok(r.features.some((f) => f.feature === "Workflow:migrate-acmecorp-billing"));
});

test("owner rollup keeps recentEvents and real project names", () => {
  const r = rollupEvents(
    [ev({ project: "secret-client", cwd: "/Users/me/workspace/secret-client/x" })],
    { public: false, now: NOW, recentLimit: 10 }
  );
  assert.equal(r.recentEvents?.length, 1);
  assert.equal(r.projects[0].project, "secret-client");
});
