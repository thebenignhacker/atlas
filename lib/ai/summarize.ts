import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getRepo, getTodos } from "@/lib/queries";
import { complete } from "@/lib/ai/provider";
import { isRepoAIEligible, eligibilityReason } from "@/lib/ai/policy";
import { getCached, saveOutput, hashContent, type CachedOutput } from "@/lib/ai/cache";
import { getLearningPreamble } from "@/lib/ai/learning";

const SYSTEM = `You are Atlas, summarizing a software project for the developer who builds it.
Write ONE concise paragraph (max 55 words): what the project is and its current state.
Rules: use ONLY the facts provided. Never invent features, version numbers, metrics, or status.
If the facts are thin, say so plainly. No marketing language, no superlatives.`;

function readReadme(repoPath: string): string {
  for (const name of ["README.md", "readme.md", "README.MD", "Readme.md"]) {
    const p = path.join(repoPath, name);
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").slice(0, 3500);
    } catch {
      /* ignore */
    }
  }
  return "";
}

export interface SummaryResult extends Partial<CachedOutput> {
  text: string;
  blocked?: string;
}

export async function summarizeRepo(
  slug: string,
  force = false
): Promise<SummaryResult> {
  const repo = getRepo(slug);
  if (!repo) throw new Error(`Repo not found: ${slug}`);

  if (!isRepoAIEligible(repo)) {
    return { text: "", blocked: eligibilityReason(repo) ?? "Not eligible for AI." };
  }

  const readme = readReadme(repo.path);
  const todos = getTodos({ repoSlug: slug });
  const todoTitles = todos.slice(0, 15).map((t) => `[${t.priority ?? "-"}] ${t.title}`);

  const facts = [
    `Name: ${repo.name}`,
    `Group: ${repo.groupName ?? "-"}`,
    `Language: ${repo.language ?? "unknown"}`,
    `Visibility: ${repo.visibility}`,
    `Stars: ${repo.stars ?? 0}`,
    `Last commit: ${repo.lastCommitAt ?? "unknown"} — "${repo.lastCommitMsg ?? ""}"`,
    `Commits in 30d: ${repo.commitCount30d}`,
    `Open todos: ${todos.filter((t) => t.status === "open").length}`,
    readme ? `README:\n${readme}` : "README: (none)",
    todoTitles.length ? `Recent todos:\n${todoTitles.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const contentHash = hashContent(
    `${repo.lastCommitSha ?? ""}|${hashContent(readme)}|${todoTitles.join("|")}`
  );

  if (!force) {
    const cached = getCached("repo", slug, "summary", contentHash);
    if (cached) return { text: cached.output, ...cached };
  }

  const preamble = getLearningPreamble();
  const system = preamble ? `${SYSTEM}\n\n${preamble}` : SYSTEM;
  const res = await complete({ system, prompt: facts, tier: "fast", maxTokens: 300 });

  saveOutput({
    entityType: "repo",
    entityId: slug,
    task: "summary",
    contentHash,
    model: res.model,
    output: res.text.trim(),
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
  });

  return {
    text: res.text.trim(),
    model: res.model,
    generatedAt: new Date().toISOString(),
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    cached: false as unknown as true,
  };
}
