import type { Repo, RepoSignals } from "@/lib/types";
import { daysSince, stalenessBucket } from "@/lib/util/date";

/**
 * Machine-computed health signals. Pure function of measured facts — no AI,
 * no fabrication. Every reason is explainable and points toward an action.
 */
export function computeSignals(repo: Repo, now = new Date()): RepoSignals {
  const days = daysSince(repo.lastCommitAt, now);
  const staleness = stalenessBucket(days);
  const attention: string[] = [];

  // Only genuinely actionable items — age/dormancy is shown by staleness color,
  // not flagged as "attention" (that just creates noise across old repos).
  if (repo.dirty) attention.push("Uncommitted changes");
  if (repo.ahead > 0) attention.push(`${repo.ahead} unpushed`);
  if (repo.behind > 0) attention.push(`${repo.behind} behind upstream`);
  if (repo.openPrs && repo.openPrs > 0) attention.push(`${repo.openPrs} open PR(s)`);

  return { staleness, daysSinceCommit: days, attention };
}
