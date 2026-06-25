import type { UsageCategory } from "@/lib/usage/types";

/**
 * Static catalog metadata for Claude Code features. This is the "what it does /
 * when to reach for it" layer, fused at rollup time with the measured usage
 * counts mined from transcripts. Descriptions are intentionally short and
 * neutral; they double as documentation for anyone who forks Atlas.
 *
 * Keys are matched against the normalized feature key (see parse.ts). A key may
 * be an exact feature ("Workflow") or a prefix family ("Skill:", "mcp:") — the
 * lookup tries the exact key first, then the family prefix.
 */
export interface FeatureMeta {
  displayName: string;
  category: UsageCategory;
  description: string;
  whenToUse: string;
  /** Recommended-but-easy-to-forget. Flagged "underused" when usage is low. */
  recommended?: boolean;
}

export const CATEGORY_META: Record<UsageCategory, { label: string; color: string }> = {
  orchestration: { label: "Orchestration", color: "#8b5cf6" },
  skill: { label: "Skills", color: "#1f8a7e" },
  mcp: { label: "Integrations", color: "#06b6d4" },
  exec: { label: "Shell", color: "#c75d3c" },
  file: { label: "Files", color: "#e8a317" },
  search: { label: "Search", color: "#2f6b4a" },
  web: { label: "Web", color: "#3b82f6" },
  command: { label: "Commands", color: "#b7ad9a" },
  other: { label: "Other", color: "#9c9384" },
};

/** Exact-key catalog. Prefix families (Skill:, Agent:, mcp:) are in FAMILY_META. */
const EXACT_META: Record<string, FeatureMeta> = {
  Workflow: {
    displayName: "Workflow",
    category: "orchestration",
    description:
      "Dynamic multi-agent orchestration — a script fans work across many subagents with pipeline/parallel topologies, verification stages, and a token budget.",
    whenToUse:
      "Audits, migrations, multi-file reviews, or any fan-out where you want structure and an adversarial verify pass rather than one serial pass.",
    recommended: true,
  },
  Agent: {
    displayName: "Subagent",
    category: "orchestration",
    description:
      "Spawns a single subagent with its own context window; can run in the background, in a git worktree, or remotely.",
    whenToUse:
      "Independent work you can delegate and keep only the conclusion of — broad searches, or parallel tasks that would otherwise blow up the main context.",
    recommended: true,
  },
  Task: {
    displayName: "Background task",
    category: "orchestration",
    description: "Creates and tracks an asynchronous task that runs across turns.",
    whenToUse: "Long-running work you want to monitor without blocking the conversation.",
  },
  Bash: {
    displayName: "Shell",
    category: "exec",
    description: "Runs a shell command in the working directory.",
    whenToUse: "Builds, tests, git, and anything a dedicated file/search tool doesn't cover.",
  },
  Read: {
    displayName: "Read file",
    category: "file",
    description: "Reads a file (text, image, PDF, or notebook) from disk.",
    whenToUse: "Inspecting a specific file you already know the path to.",
  },
  Edit: {
    displayName: "Edit file",
    category: "file",
    description: "Exact string-replacement edit on a previously read file.",
    whenToUse: "Targeted changes that preserve the surrounding code.",
  },
  Write: {
    displayName: "Write file",
    category: "file",
    description: "Creates a new file or fully replaces an existing one.",
    whenToUse: "New files, or wholesale rewrites after reading the original.",
  },
  Grep: {
    displayName: "Grep",
    category: "search",
    description: "Regex search across files.",
    whenToUse: "Finding where a symbol, string, or pattern lives.",
  },
  Glob: {
    displayName: "Glob",
    category: "search",
    description: "Filename pattern matching.",
    whenToUse: "Locating files by name or extension.",
  },
  ToolSearch: {
    displayName: "Tool search",
    category: "search",
    description: "Loads deferred tool schemas on demand so they become callable.",
    whenToUse: "Reaching for an MCP or harness tool that isn't loaded up front.",
  },
  WebSearch: {
    displayName: "Web search",
    category: "web",
    description: "Searches the web.",
    whenToUse: "Current information beyond the knowledge cutoff.",
  },
  WebFetch: {
    displayName: "Web fetch",
    category: "web",
    description: "Fetches and reads a specific URL.",
    whenToUse: "Pulling a known page or API response into context.",
  },
  AskUserQuestion: {
    displayName: "Ask user",
    category: "other",
    description: "Presents a structured multiple-choice question to the user.",
    whenToUse: "A genuinely user-owned decision a sensible default can't resolve.",
  },
};

/** Prefix-family fallbacks keyed by the part before the first ':' or '.'. */
const FAMILY_META: Record<string, FeatureMeta> = {
  Skill: {
    displayName: "Skill",
    category: "skill",
    description:
      "Invokes a packaged skill / slash-command — a reusable procedure with its own instructions.",
    whenToUse: "Whenever a skill matches the task; it beats hand-assembling the steps.",
    recommended: true,
  },
  mcp: {
    displayName: "MCP integration",
    category: "mcp",
    description:
      "Calls an external system over MCP (browser automation, Drive, Gmail, Notion, etc.).",
    whenToUse: "Driving real external services rather than simulating them.",
  },
  command: {
    displayName: "Slash command",
    category: "command",
    description: "A slash-command typed into the prompt.",
    whenToUse: "Triggering a saved command or skill directly.",
  },
};

/** Look up catalog metadata for a normalized feature key. */
export function featureMeta(feature: string): FeatureMeta | null {
  if (EXACT_META[feature]) return EXACT_META[feature];
  const family = feature.split(/[:.]/)[0];
  return FAMILY_META[family] ?? null;
}

/**
 * Projects (org / workspace-dir names) whose usage may be ATTRIBUTED BY NAME in
 * the public showcase. Anything not on this list is bucketed into "other" so the
 * public view never discloses the existence of a private client or project.
 *
 * Overridable via `publicUsageProjects` in atlas.config.json. Default keeps the
 * showcase honest about the two public-facing bodies of work without naming
 * anything private.
 */
export const DEFAULT_PUBLIC_USAGE_PROJECTS = ["opena2a-org", "csnp"];

// --- Public feature-name allowlist -------------------------------------------
// A feature key's VARIABLE part (the skill / workflow / command / mcp-server /
// agent-type name) can be user-authored and may embed a private client/project
// name. Redacting by blocklist is unsound — the blocklist is built from tracked
// repos, but a client folder is not a repo, so its name is never on the list.
// So the public path ALLOWLISTS instead: a name is shown only if it's a known,
// generic, safe value; anything else collapses to a "(other)"/"(custom)" bucket
// (the COUNT still shows — the showcase value — but the name never leaks).
//
// Separatorless feature keys (Bash, Read, Edit, AskUserQuestion, ...) are harness
// tool names — not user-nameable — so they are inherently safe and pass through.

const KNOWN_SKILLS = new Set([
  "brainstorm", "debug", "outcome-manifest", "persona-design", "pre-push-review",
  "release-test", "review", "tdd", "verify", "write", "deep-research",
  "frontend-design", "update-config", "keybindings-help", "code-review", "simplify",
  "fewer-permission-prompts", "loop", "schedule", "claude-api", "run", "init",
  "security-review",
]);

const KNOWN_AGENT_TYPES = new Set([
  "general-purpose", "general", "claude", "claude-code-guide", "Explore", "Plan",
  "statusline-setup", "code-reviewer",
]);

const KNOWN_MCP_SERVERS = new Set([
  "playwright", "claude_ai_Canva", "claude_ai_Gmail", "claude_ai_Google_Calendar",
  "claude_ai_Google_Drive", "claude_ai_Invideo", "claude_ai_Notion",
]);

const KNOWN_COMMANDS = new Set([
  "/clear", "/model", "/login", "/logout", "/compact", "/stickers", "/help",
  "/config", "/fast", "/remote-control", "/resume", "/loop", "/schedule",
  "/code-review", "/pre-push-review", "/release-test", "/review", "/security-review",
  "/init", "/run", "/verify", "/debug", "/brainstorm", "/write", "/simplify",
  "/context", "/cost", "/memory", "/mcp", "/agents", "/doctor", "/status",
]);

/** Whether an MCP server name is a known, generic, safe-to-name integration. */
export function isKnownMcpServer(server: string): boolean {
  return KNOWN_MCP_SERVERS.has(server);
}

/**
 * Sanitize a feature key for PUBLIC display. Idempotent — the snapshot gate calls
 * it and asserts `publicFeatureKey(f) === f` for every published feature, so any
 * un-allowlisted (possibly private) name is caught fail-closed. Workflow names are
 * always bucketed: they are user-authored and the likeliest to embed a client name.
 */
export function publicFeatureKey(feature: string): string {
  const sep = feature.search(/[:.]/);
  if (sep < 0) return feature; // harness tool name — not user-nameable, safe
  const head = feature.slice(0, sep);
  const tail = feature.slice(sep + 1);
  switch (head) {
    case "Skill":
      return KNOWN_SKILLS.has(tail) ? feature : "Skill:(other)";
    case "Agent":
      return KNOWN_AGENT_TYPES.has(tail) ? feature : "Agent:(other)";
    case "command":
      return KNOWN_COMMANDS.has(tail) ? feature : "command:(other)";
    case "Workflow":
      return "Workflow:(custom)"; // always bucket user-authored workflow names
    case "mcp":
      return KNOWN_MCP_SERVERS.has(tail.split(".")[0]) ? feature : "mcp:(other)";
    default:
      return `${head}:(other)`;
  }
}
