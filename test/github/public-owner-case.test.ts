import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { Octokit } from "@octokit/rest";
import { initSchema } from "@/lib/db";
import { enrichRepos } from "@/lib/github";
import { applyEnrichment } from "@/lib/scanners/repos";
import type { Repo } from "@/lib/types";

/**
 * Asked for OPENA2A-ORG/hackmyagent, GitHub answers with the owner spelled
 * opena2a-org. The scan records GitHub's spelling in place of the remote's,
 * and the public
 * snapshot compared it with publicOwners case-sensitively, so a repository
 * whose publicOwners entry was spelled like its remote was left out of the
 * snapshot. A server on 127.0.0.1 stands in for the GitHub API. The Node test
 * runner runs each test file in its own process, so the chdir, ATLAS_DATA_DIR
 * and the cached config stay inside this file.
 */

const work = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-owner-case-work-"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-owner-case-data-"));
const origCwd = process.cwd();

const HACKMYAGENT = {
  id: 1,
  name: "hackmyagent",
  owner: { login: "opena2a-org" },
  private: false,
  fork: false,
  archived: false,
  language: "TypeScript",
  stargazers_count: 0,
  open_issues_count: 0,
  default_branch: "main",
  pushed_at: "2026-10-01T00:00:00Z",
  description: null,
};

/** Run `fn` against a stand-in for the GitHub API, closing it afterwards. */
async function withFakeApi<T>(fn: (client: Octokit) => Promise<T>): Promise<T> {
  const server = http.createServer((req, res) => {
    // The stand-in matches the path lowercased, the way GitHub answered
    // OPENA2A-ORG/hackmyagent under opena2a-org.
    const route = new URL(req.url ?? "/", `http://${req.headers.host}`).pathname.toLowerCase();
    const body =
      route === "/repos/opena2a-org/hackmyagent"
        ? HACKMYAGENT
        : route === "/repos/opena2a-org/hackmyagent/pulls"
          ? []
          : null;
    res.writeHead(body ? 200 : 404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body ?? { message: "Not Found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(new Octokit({ baseUrl: `http://127.0.0.1:${port}` }));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function row(slug: string, over: Partial<Repo> = {}): Repo {
  return {
    slug,
    name: slug,
    path: `/repos/${slug}`,
    groupName: "example-group",
    remoteUrl: null,
    owner: null,
    repoName: null,
    branch: "main",
    lastCommitAt: null,
    lastCommitSha: null,
    lastCommitMsg: null,
    commitCount30d: 0,
    dirty: 0,
    ahead: 0,
    behind: 0,
    visibility: "public",
    isFork: 0,
    isArchived: 0,
    language: null,
    stars: null,
    openIssues: null,
    openPrs: null,
    defaultBranch: null,
    pushedAt: null,
    description: null,
    scannedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

/** Insert repositories into the database the snapshot reads. */
function store(repos: Repo[]): void {
  const db = new Database(path.join(dataDir, "atlas.db"));
  try {
    const cols = Object.keys(repos[0]);
    const insert = db.prepare(
      `INSERT INTO repos (${cols.join(",")}) VALUES (${cols.map((c) => `@${c}`).join(",")})`
    );
    for (const r of repos) insert.run(r);
  } finally {
    db.close();
  }
}

async function publishedSlugs(): Promise<string[]> {
  const { generatePublicSnapshot } = await import("@/lib/snapshot");
  return generatePublicSnapshot().repos.map((r) => r.slug);
}

before(() => {
  fs.writeFileSync(
    path.join(work, "atlas.config.json"),
    JSON.stringify({
      scanRoots: [],
      scanDepth: 2,
      todoDirs: [],
      github: { user: "tester", orgs: [] },
      exclude: [],
      publicOwners: ["OPENA2A-ORG", "testorg"],
    })
  );
  process.env.ATLAS_DATA_DIR = dataDir;
  process.chdir(work);
  const db = new Database(path.join(dataDir, "atlas.db"));
  initSchema(db);
  db.close();
});

after(() => {
  process.chdir(origCwd);
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("a repository GitHub reports under its owner's other letter case stays in the public snapshot", async () => {
  const repos = [
    row("hackmyagent", {
      remoteUrl: "https://github.com/OPENA2A-ORG/hackmyagent.git",
      owner: "OPENA2A-ORG",
      repoName: "hackmyagent",
      visibility: "unknown",
      isFork: null,
      isArchived: null,
    }),
  ];
  const found = await withFakeApi((client) =>
    enrichRepos([{ slug: "hackmyagent", owner: "OPENA2A-ORG", repo: "hackmyagent" }], client)
  );
  applyEnrichment(repos, found);
  // The scan records GitHub's spelling, not the remote's.
  assert.equal(repos[0].owner, "opena2a-org");
  assert.equal(repos[0].visibility, "public");
  store(repos);

  assert.ok(
    (await publishedSlugs()).includes("hackmyagent"),
    "publicOwners lists OPENA2A-ORG, which is the same GitHub owner as opena2a-org"
  );
});

test("publicOwners matches an owner in another letter case and still leaves out owners it does not list", async () => {
  store([
    row("mixed-case", { owner: "TestOrg" }),
    row("upper-case", { owner: "TESTORG" }),
    row("elsewhere", { owner: "other-org" }),
    row("no-owner", { owner: null }),
  ]);
  const published = await publishedSlugs();

  assert.ok(published.includes("mixed-case"), "TestOrg is the owner publicOwners lists as testorg");
  assert.ok(published.includes("upper-case"), "TESTORG is the owner publicOwners lists as testorg");
  assert.ok(!published.includes("elsewhere"), "an owner publicOwners does not list stays out");
  assert.ok(!published.includes("no-owner"), "a repository with no owner stays out");
});
