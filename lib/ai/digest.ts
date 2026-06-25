import "server-only";
import { getRepos, getTodos, getActivity } from "@/lib/queries";
import { complete } from "@/lib/ai/provider";
import { isRepoAIEligible } from "@/lib/ai/policy";
import { getCached, saveOutput, hashContent } from "@/lib/ai/cache";
import { getLearningPreamble } from "@/lib/ai/learning";
import { isOwnerMode, type ResolvedMode } from "@/lib/mode";
import { loadOwnerSnapshot } from "@/lib/snapshot";
import { relativeTime } from "@/lib/util/date";

const SYSTEM = `You are Atlas, briefing a developer who ships many projects at once.
Given a factual snapshot of their portfolio, write a short markdown briefing with these sections:
## What moved — notable recent activity
## Going stale — projects losing momentum that may need a decision
## Needs attention — concrete actionable items (unpushed work, open PRs, P0 todos)
## Suggested focus — 2-3 specific next actions, most important first
Rules: use ONLY the provided facts. Never invent repos, numbers, or status. Be concise and specific.
No marketing language. Reference repos by name.`;

export interface DigestResult {
  text: string;
  model?: string;
  generatedAt: string;
  promptTokens?: number;
  completionTokens?: number;
  cached: boolean;
  reposIncluded: number;
  reposExcluded: number;
}

function buildSnapshot(): {
  text: string;
  included: number;
  excluded: number;
} {
  // Digest generation runs only on the local host (DB + API key present).
  const repos = getRepos("local");
  const eligible = repos.filter((r) => isRepoAIEligible(r));
  const excluded = repos.length - eligible.length;

  const active = eligible
    .filter((r) => r.commitCount30d > 0)
    .slice(0, 25)
    .map(
      (r) =>
        `- ${r.name} (${r.groupName}): ${r.commitCount30d} commits/30d, last ${relativeTime(r.lastCommitAt)}, ${r.signals.attention.join("; ") || "no flags"}`
    );

  const stale = eligible
    .filter((r) => r.signals.staleness === "stale" || r.signals.staleness === "dormant")
    .slice(0, 15)
    .map((r) => `- ${r.name}: last commit ${relativeTime(r.lastCommitAt)}`);

  const attention = eligible
    .filter((r) => r.signals.attention.length > 0)
    .slice(0, 20)
    .map((r) => `- ${r.name}: ${r.signals.attention.join("; ")}`);

  const eligibleSlugs = new Set(eligible.map((r) => r.slug));
  const p0 = getTodos("local", { priority: "P0", status: "open" })
    .filter((t) => !t.repoSlug || eligibleSlugs.has(t.repoSlug))
    .slice(0, 20)
    .map((t) => `- [P0] ${t.title}`);

  const recent = getActivity("local", 40)
    .filter((e) => !e.repoSlug || eligibleSlugs.has(e.repoSlug))
    .slice(0, 25)
    .map((e) => `- ${(e.ts ?? "").slice(0, 10)} ${e.title}`);

  const text = [
    `PORTFOLIO: ${eligible.length} repos in scope (${excluded} excluded by privacy policy).`,
    `\nACTIVE (committed in last 30d):\n${active.join("\n") || "none"}`,
    `\nGOING STALE:\n${stale.join("\n") || "none"}`,
    `\nACTIONABLE FLAGS:\n${attention.join("\n") || "none"}`,
    `\nOPEN P0 TODOS:\n${p0.join("\n") || "none"}`,
    `\nRECENT COMMITS:\n${recent.join("\n") || "none"}`,
  ].join("\n");

  return { text, included: eligible.length, excluded };
}

export async function generateDigest(force = false): Promise<DigestResult> {
  const snapshot = buildSnapshot();
  const contentHash = hashContent(snapshot.text);

  if (!force) {
    const cached = getCached("portfolio", "global", "digest", contentHash);
    if (cached) {
      return {
        text: cached.output,
        model: cached.model,
        generatedAt: cached.generatedAt,
        promptTokens: cached.promptTokens,
        completionTokens: cached.completionTokens,
        cached: true,
        reposIncluded: snapshot.included,
        reposExcluded: snapshot.excluded,
      };
    }
  }

  const preamble = getLearningPreamble();
  const system = preamble ? `${SYSTEM}\n\n${preamble}` : SYSTEM;
  const res = await complete({
    system,
    prompt: snapshot.text,
    tier: "deep",
    maxTokens: 1600,
  });

  saveOutput({
    entityType: "portfolio",
    entityId: "global",
    task: "digest",
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
    cached: false,
    reposIncluded: snapshot.included,
    reposExcluded: snapshot.excluded,
  };
}

/** Read the last digest from cache without generating a new one. */
export function getLastDigest(mode?: ResolvedMode): DigestResult | null {
  // Owner deployment has no DB; the digest is baked into the snapshot.
  if (mode ? mode === "owner" : isOwnerMode()) return loadOwnerSnapshot().digest;
  const cached = getCached(
    "portfolio",
    "global",
    "digest",
    hashContent(buildSnapshot().text)
  );
  const snapshot = buildSnapshot();
  if (!cached) {
    // Fall back to any prior digest even if the snapshot changed.
    return null;
  }
  return {
    text: cached.output,
    model: cached.model,
    generatedAt: cached.generatedAt,
    promptTokens: cached.promptTokens,
    completionTokens: cached.completionTokens,
    cached: true,
    reposIncluded: snapshot.included,
    reposExcluded: snapshot.excluded,
  };
}
