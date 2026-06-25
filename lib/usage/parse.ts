import type { ToolEvent, UsageCategory } from "@/lib/usage/types";

/**
 * Pure transcript parsing. Kept free of filesystem I/O so it is unit-testable
 * against synthetic lines; the streaming reader (scripts/scan-usage.ts) feeds it
 * one parsed JSON object at a time.
 *
 * CRITICAL: this module extracts METADATA ONLY. It records the tool name, the
 * timestamp, the cwd/branch context, and the input KEY NAMES — never any input
 * value (no command strings, file contents, prompts, or arguments). That
 * invariant is what makes the data non-sensitive by construction.
 */

const FILE_TOOLS = new Set(["Read", "Write", "Edit", "NotebookEdit"]);
const SEARCH_TOOLS = new Set(["Grep", "Glob", "ToolSearch"]);
const WEB_TOOLS = new Set(["WebSearch", "WebFetch"]);

/** Derive the workspace project (org/dir) from a cwd, or null if outside it. */
export function projectFromCwd(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  const m = cwd.match(/\/workspace\/([^/]+)/);
  return m ? m[1] : null;
}

/** Best-effort workflow name: the named workflow, else meta.name in the script. */
function workflowName(input: Record<string, unknown>): string {
  if (typeof input.name === "string" && input.name.trim()) return input.name.trim();
  if (typeof input.script === "string") {
    const m = input.script.match(/name:\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
  }
  return "ad-hoc";
}

/** Normalize a raw tool_use name + input into a stable feature key + category. */
export function normalizeFeature(
  name: string,
  input: Record<string, unknown>
): { feature: string; category: UsageCategory } {
  if (name === "Bash") return { feature: "Bash", category: "exec" };
  if (FILE_TOOLS.has(name)) return { feature: name, category: "file" };
  if (SEARCH_TOOLS.has(name)) return { feature: name, category: "search" };
  if (WEB_TOOLS.has(name)) return { feature: name, category: "web" };

  if (name === "Skill") {
    const skill = typeof input.skill === "string" ? input.skill : "unknown";
    return { feature: `Skill:${skill}`, category: "skill" };
  }
  if (name === "Agent") {
    const type = typeof input.subagent_type === "string" ? input.subagent_type : "general";
    return { feature: `Agent:${type}`, category: "orchestration" };
  }
  if (name === "Workflow") {
    return { feature: `Workflow:${workflowName(input)}`, category: "orchestration" };
  }
  // Collapse the Task* family (Create/Update/Get/List/Output/Stop) into one.
  if (name.startsWith("Task")) return { feature: "Task", category: "orchestration" };
  if (name.startsWith("mcp__")) {
    const parts = name.slice(5).split("__");
    const server = parts[0] ?? "unknown";
    const tool = parts.slice(1).join("_") || "call";
    return { feature: `mcp:${server}.${tool}`, category: "mcp" };
  }
  return { feature: name, category: "other" };
}

const COMMAND_RE = /<command-name>([^<]+)<\/command-name>/;

/**
 * Extract every tool/feature event from one parsed transcript line. Returns an
 * array because a single assistant message can carry multiple tool_use blocks.
 * `index` disambiguates events that lack a tool-use id (e.g. slash commands).
 */
export function eventsFromLine(
  line: Record<string, unknown>,
  index: number
): ToolEvent[] {
  const ts = typeof line.timestamp === "string" ? line.timestamp : null;
  const sessionId = typeof line.sessionId === "string" ? line.sessionId : null;
  const cwd = typeof line.cwd === "string" ? line.cwd : null;
  const gitBranch = typeof line.gitBranch === "string" ? line.gitBranch : null;
  const project = projectFromCwd(cwd);
  const message = line.message as Record<string, unknown> | undefined;
  if (!message) return [];

  const content = message.content;
  const out: ToolEvent[] = [];

  // Slash-command invocations arrive as a user message whose content is a string
  // carrying a <command-name> tag.
  if (typeof content === "string") {
    const m = content.match(COMMAND_RE);
    if (m) {
      const cmd = m[1].trim();
      out.push({
        id: `${sessionId ?? "s"}:${index}`,
        sessionId,
        ts,
        feature: `command:${cmd}`,
        category: "command",
        project,
        howInvoked: "direct",
        paramKeys: [],
        cwd,
        gitBranch,
      });
    }
    return out;
  }

  if (!Array.isArray(content)) return [];
  for (const raw of content) {
    const item = raw as Record<string, unknown>;
    if (item.type !== "tool_use" || typeof item.name !== "string") continue;
    const input = (item.input as Record<string, unknown>) ?? {};
    const { feature, category } = normalizeFeature(item.name, input);
    out.push({
      id: typeof item.id === "string" ? item.id : `${sessionId ?? "s"}:${index}`,
      sessionId,
      ts,
      feature,
      category,
      project,
      howInvoked: "direct",
      // KEY NAMES ONLY — never values. This is the privacy invariant.
      paramKeys: Object.keys(input),
      cwd,
      gitBranch,
    });
  }
  return out;
}
