import type { RoutineKind } from "@/lib/usage/types";
import { isKnownMcpServer } from "@/lib/usage/catalog-meta";

/**
 * Turn a mined tool-sequence into a concrete automation suggestion. Pure and
 * testable. The output is a STARTING POINT — a tip or a scaffold to adapt — not
 * a finished, runnable workflow. We deliberately under-claim: most observed
 * sequences are linear and don't need multi-agent orchestration, so the
 * suggestion is matched to the shape of the motif (a skill you already have, a
 * `/loop`, or a Workflow skeleton) rather than pretending every sequence is a
 * sophisticated workflow.
 */

const KNOWN_SKILL_PREFIX = "Skill:";

/** Classify what kind of automation best fits an observed step sequence. */
export function classifyRoutine(steps: string[]): RoutineKind {
  const hasNamedSkill = steps.some(
    (s) => s.startsWith(KNOWN_SKILL_PREFIX) && !s.includes("(other)")
  );
  if (hasNamedSkill) return "skill";

  // An edit↔verify loop: code steps interleaved with a verification step
  // (browser automation, web, or another code run).
  const codeCount = steps.filter((s) => s === "·code").length;
  const hasVerify = steps.some((s) => s.startsWith("mcp:") || s === "·web");
  if (codeCount >= 2 || (codeCount >= 1 && hasVerify)) return "loop";

  // A genuine multi-step orchestration: 2+ distinct non-code salient tokens.
  const salient = new Set(steps.filter((s) => s !== "·code"));
  if (salient.size >= 2) return "workflow";

  return "manual";
}

/** Human-readable phrase for a salient step token. */
function humanize(step: string): string {
  if (step === "·code") return "edit files / run code & tests";
  if (step === "·web") return "look something up on the web";
  if (step.startsWith("mcp:")) {
    const server = step.slice(4);
    // Only name a server that is on the known-safe allowlist; anything else
    // (incl. "(other)" or a desync artifact) stays generic so the scaffold text
    // can't echo a private server name even if an unsanitized step slipped in.
    return isKnownMcpServer(server) ? `drive ${server} over MCP` : "call an MCP integration";
  }
  if (step.startsWith(KNOWN_SKILL_PREFIX)) {
    const name = step.slice(KNOWN_SKILL_PREFIX.length);
    return name === "(other)" ? "run a skill" : `run the ${name} skill`;
  }
  if (step.startsWith("Workflow:")) return "run a workflow";
  if (step.startsWith("Agent:")) {
    const type = step.slice("Agent:".length);
    return type === "(other)" ? "spawn a subagent" : `spawn a ${type} subagent`;
  }
  if (step.startsWith("command:")) return `run ${step.slice("command:".length)}`;
  if (step === "Task") return "run a background task";
  return step;
}

function slugName(steps: string[]): string {
  const core = steps
    .map((s) =>
      s.replace(/^·/, "").replace(/^(Skill|Workflow|Agent|mcp|command):/, "").replace(/[^a-z0-9]+/gi, "-")
    )
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  return core || "routine";
}

/** Build the automation scaffold/tip text for a routine. */
export function generateScaffold(steps: string[], kind: RoutineKind): string {
  const numbered = steps.map((s, i) => `${i + 1}. ${humanize(s)}`).join("\n");

  switch (kind) {
    case "skill": {
      const skill = steps
        .find((s) => s.startsWith(KNOWN_SKILL_PREFIX) && !s.includes("(other)"))!
        .slice(KNOWN_SKILL_PREFIX.length);
      return [
        `You already run the \`${skill}\` skill inside this sequence:`,
        numbered,
        "",
        `Invoke it directly with \`/${skill}\`, and consider a saved slash-command that runs the surrounding steps so the whole sequence is one action.`,
      ].join("\n");
    }
    case "loop":
      return [
        "This is an edit → verify loop you repeat by hand:",
        numbered,
        "",
        "Automate it with `/loop` (re-run the check on an interval) or a small Workflow that re-runs the verification until it passes:",
        "```js",
        "// /loop <your verify command>   — simplest option",
        "// or a Workflow:",
        "while (!passed) { await agent('run the verification, report pass/fail', {schema: VERDICT}); }",
        "```",
        "_Starting scaffold — adapt before running._",
      ].join("\n");
    case "workflow":
      return [
        "A multi-step sequence worth scripting as a Workflow:",
        numbered,
        "",
        "```js",
        `export const meta = {`,
        `  name: '${slugName(steps)}',`,
        `  description: '${steps.map(humanize).join(" → ")}',`,
        `  phases: [{ title: 'Run' }],`,
        `}`,
        `phase('Run')`,
        ...steps.map((s, i) => `// stage ${i + 1}: ${humanize(s)}  → agent(...) / parallel(...) / pipeline(...)`),
        "```",
        "_Starting scaffold — turn the stages into real agent()/parallel()/pipeline() calls before running._",
      ].join("\n");
    default:
      return [
        "A recurring sequence:",
        numbered,
        "",
        "Worth saving as a slash-command if you find yourself repeating it.",
      ].join("\n");
  }
}
