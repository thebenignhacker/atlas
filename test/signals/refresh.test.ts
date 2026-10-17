import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshSignals } from "@/lib/signals";
import type { Repo, RepoSignals } from "@/lib/types";

/**
 * Regression cover for "the Health donut said Active today from a snapshot built
 * seven weeks earlier". The deployed modes read repos from a committed snapshot;
 * staleness has to be measured against the request time, not the build time.
 */

const NOW = new Date("2026-10-17T12:00:00.000Z");
const DAY = 86_400_000;

function row(lastCommitAt: string | null, signals: RepoSignals): Repo & { signals: RepoSignals } {
  return {
    slug: "example-org-example",
    name: "example",
    path: "",
    groupName: "example-org",
    remoteUrl: null,
    owner: "example-org",
    repoName: "example",
    branch: "main",
    lastCommitAt,
    lastCommitSha: null,
    lastCommitMsg: "Initial commit",
    commitCount30d: 0,
    dirty: 0,
    ahead: 0,
    behind: 0,
    visibility: "public",
    isFork: 0,
    isArchived: 0,
    language: "TypeScript",
    stars: 0,
    openIssues: 0,
    openPrs: 0,
    defaultBranch: "main",
    pushedAt: null,
    description: null,
    scannedAt: "2026-08-28T13:40:47.869Z",
    signals,
  };
}

test("a repo stored as fresh at build time is stale 51 days later", () => {
  const lastCommitAt = new Date(NOW.getTime() - 51 * DAY).toISOString();
  const input = row(lastCommitAt, { staleness: "fresh", daysSinceCommit: 1, attention: [] });

  const [out] = refreshSignals([input], NOW);

  assert.equal(out.signals.staleness, "stale");
  assert.equal(out.signals.daysSinceCommit, 51);
  assert.deepEqual(out.signals.attention, []);
  // Pure: the stored snapshot row is not mutated.
  assert.equal(input.signals.staleness, "fresh");
  assert.equal(input.signals.daysSinceCommit, 1);
});

test("a repo with no commit date is dormant", () => {
  const input = row(null, { staleness: "fresh", daysSinceCommit: 1, attention: [] });

  const [out] = refreshSignals([input], NOW);

  assert.equal(out.signals.staleness, "dormant");
  assert.equal(out.signals.daysSinceCommit, null);
  assert.deepEqual(out.signals.attention, []);
});
