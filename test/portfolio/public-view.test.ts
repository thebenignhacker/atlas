import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AtlasStats, RepoWithSignals } from "@/lib/queries";
import type { ResolvedMode } from "@/lib/mode";
import { PortfolioStats } from "@/components/PortfolioStats";
import { PortfolioView } from "@/components/PortfolioView";
import { inAppRouter } from "../app-router";

/**
 * The public snapshot holds only public repos that are not forks, and no
 * todos. In the public view the "Private", "Forks" and "Open P0" tiles read 0
 * whatever the portfolio held, the "Private" visibility option and the "Has
 * todos" toggle matched no repo, and the visibility filter could not narrow
 * the list. The public view leaves them out; the local and owner views keep
 * them.
 */

const STATS: AtlasStats = {
  lastScanAt: "2026-10-01T00:00:00.000Z",
  repoCount: 9,
  todoCount: 4,
  activityCount: 20,
  publicCount: 5,
  privateCount: 3,
  forkCount: 1,
  needsAttention: 2,
  openP0: 1,
};

const ALL_TILES = ["Repos", "Public", "Private", "Forks", "Need attention", "Open P0"];
const PUBLIC_TILES = ["Repos", "Public", "Need attention"];

function strip(mode: ResolvedMode): string {
  return renderToStaticMarkup(createElement(PortfolioStats, { stats: STATS, mode }));
}

/** The tile labels, in order. */
function tileLabels(html: string): string[] {
  return [...html.matchAll(/<div class="mt-1\.5 [^"]*">([^<]+)<\/div>/g)].map((m) => m[1]);
}

/** The class list of the strip's grid, with the markup's entities decoded. */
function gridClass(html: string): string[] {
  const attr = html.match(/^<div class="([^"]*)"/)?.[1] ?? "";
  return attr.replace(/&gt;/g, ">").replace(/&amp;/g, "&").split(" ");
}

test("the public view's stat strip leaves out the tiles its snapshot cannot fill", () => {
  assert.deepEqual(tileLabels(strip("public")), PUBLIC_TILES);
});

test("the local and owner views keep every stat tile", () => {
  for (const mode of ["local", "owner"] as const) {
    assert.deepEqual(tileLabels(strip(mode)), ALL_TILES, `${mode} view`);
  }
});

test("three tiles fill their row instead of half of a six-column grid", () => {
  const three = gridClass(strip("public"));
  assert.ok(three.includes("sm:grid-cols-3"), `three columns from sm: ${three.join(" ")}`);
  assert.ok(!three.includes("lg:grid-cols-6"), `no six-column row: ${three.join(" ")}`);
  // On a phone's two columns the third tile spans the second row.
  assert.ok(three.includes("[&>:last-child]:col-span-2"), three.join(" "));
  assert.ok(three.includes("sm:[&>:last-child]:col-span-1"), three.join(" "));

  const six = gridClass(strip("local"));
  for (const c of ["grid-cols-2", "sm:grid-cols-3", "lg:grid-cols-6"]) {
    assert.ok(six.includes(c), `six tiles keep ${c}: ${six.join(" ")}`);
  }
  assert.ok(!six.some((c) => c.includes("col-span")), six.join(" "));
});

function repo(slug: string, over: Partial<RepoWithSignals> = {}): RepoWithSignals {
  return {
    slug,
    name: slug,
    path: `/repos/${slug}`,
    groupName: "example-org",
    remoteUrl: null,
    owner: "example-org",
    repoName: slug,
    branch: "main",
    lastCommitAt: "2026-10-01T00:00:00.000Z",
    lastCommitSha: null,
    lastCommitMsg: null,
    commitCount30d: 2,
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
    scannedAt: "2026-10-01T00:00:00.000Z",
    signals: { staleness: "recent", daysSinceCommit: 3, attention: [] },
    openTodos: 0,
    ...over,
  };
}

function view(publicView: boolean, repos: RepoWithSignals[]): string {
  return renderToStaticMarkup(inAppRouter(createElement(PortfolioView, { repos, publicView })));
}

test("the public view's filter bar has no visibility filter and no todos toggle", () => {
  const html = view(true, [repo("alpha"), repo("beta")]);
  assert.ok(!html.includes('value="private"'), "no Private option");
  assert.ok(!html.includes("All visibility"), "no visibility filter");
  assert.ok(!html.includes("Has todos"), "no Has todos toggle");
  // The filters the public snapshot can populate stay.
  for (const kept of ["All orgs", "All languages", "Any freshness", "Needs attention", "Group by org"]) {
    assert.ok(html.includes(kept), `keeps ${kept}`);
  }
});

test("the local and owner views keep the visibility filter and the todos toggle", () => {
  const html = view(false, [
    repo("alpha"),
    repo("beta", { visibility: "private", openTodos: 2 }),
  ]);
  assert.ok(html.includes('<option value="private">Private</option>'), "Private option");
  assert.ok(html.includes("All visibility"), "visibility filter");
  assert.ok(html.includes("Has todos"), "Has todos toggle");
});
