import type { AtlasConfig } from "@/lib/config";
import type { Repo } from "@/lib/types";

/**
 * The pure form of the AI eligibility gate — no server-only import, so it can
 * be tested directly. `lib/ai/policy.ts` binds it to the loaded config.
 *
 * Privacy-first: public repos are eligible; private repos require an explicit
 * per-repo opt-in or the global allowPrivate flag; a repo whose visibility is
 * unknown (no GitHub remote) is treated as private.
 */
export function repoAIEligible(
  ai: Pick<AtlasConfig["ai"], "optInRepos" | "allowPrivate">,
  repo: Pick<Repo, "slug" | "visibility">
): boolean {
  if (ai.optInRepos.includes(repo.slug)) return true;
  if (repo.visibility === "public") return true;
  if (repo.visibility === "private") return ai.allowPrivate;
  // unknown visibility (no GitHub remote) → treat as private (conservative).
  return ai.allowPrivate;
}
