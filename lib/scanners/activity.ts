import crypto from "node:crypto";
import type { ActivityEvent, Repo } from "@/lib/types";
import { readRecentCommits } from "@/lib/git";

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

/** Build a cross-repo activity feed from recent local commits. */
export function scanActivity(repos: Repo[], sinceDays = 45): ActivityEvent[] {
  const scannedAt = new Date().toISOString();
  const events: ActivityEvent[] = [];
  for (const repo of repos) {
    const commits = readRecentCommits(repo.path, sinceDays);
    for (const c of commits) {
      events.push({
        id: md5(`${repo.slug}:${c.sha}`),
        repoSlug: repo.slug,
        type: "commit",
        title: c.subject,
        ts: c.at,
        meta: JSON.stringify({ sha: c.sha.slice(0, 8), repo: repo.name }),
        scannedAt,
      });
    }
  }
  return events;
}
