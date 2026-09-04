import "server-only";
import { loadConfig } from "@/lib/config";
import { repoAIEligible } from "@/lib/ai/policy-shared";
import type { Repo } from "@/lib/types";

/**
 * Whether a repo's content may be sent to an LLM. Privacy-first: public repos
 * are eligible; private repos require explicit opt-in (optInRepos) or the
 * global allowPrivate flag. This gate guards every AI call that includes
 * repo/README/todo text.
 */
export function isRepoAIEligible(repo: Pick<Repo, "slug" | "visibility">): boolean {
  return repoAIEligible(loadConfig().ai, repo);
}

export function eligibilityReason(
  repo: Pick<Repo, "slug" | "visibility">
): string | null {
  if (isRepoAIEligible(repo)) return null;
  return repo.visibility === "private"
    ? "Private repo — opt in (Settings) to include in AI."
    : "Unknown visibility — opt in (Settings) to include in AI.";
}
