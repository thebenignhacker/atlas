import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Octokit } from "@octokit/rest";
import { enrichRepos, type RepoEnrichment } from "@/lib/github";
import { applyEnrichment } from "@/lib/scanners/repos";
import type { Repo } from "@/lib/types";

/**
 * GitHub answers a request for a renamed or transferred repository with a 301
 * to the repository's id, and the client follows it. The scan took each
 * repository's owner and name from the clone's remote, which keeps the old ones
 * until someone changes it, so the repository page linked to a URL that
 * redirects. A server on 127.0.0.1 stands in for the GitHub API here and
 * answers the old owner and name the way api.github.com does.
 */

const MOVED = {
  id: 42,
  name: "new-name",
  owner: { login: "new-org" },
  private: false,
  fork: false,
  archived: false,
  language: "Go",
  stargazers_count: 7,
  open_issues_count: 3,
  default_branch: "trunk",
  pushed_at: "2026-10-01T00:00:00Z",
  description: "A repository that moved",
};

const STAYED = {
  ...MOVED,
  id: 7,
  name: "same-name",
  owner: { login: "same-org" },
  description: "A repository that stayed",
};

interface FakeApi {
  client: Octokit;
  /** The path of every request the server answered, in order. */
  requests: string[];
  close(): Promise<void>;
}

async function fakeApi(): Promise<FakeApi> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    requests.push(url.pathname);
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
      res.end(JSON.stringify(body));
    };
    const old = /^\/repos\/old-org\/old-name(\/.*)?$/.exec(url.pathname);
    if (old) {
      const location = `${url.origin}/repositories/42${old[1] ?? ""}${url.search}`;
      return send(301, { message: "Moved Permanently", url: location }, { location });
    }
    switch (url.pathname) {
      case "/repositories/42":
        return send(200, MOVED);
      case "/repositories/42/pulls":
      case "/repos/new-org/new-name/pulls":
        return send(200, [{ number: 1 }]);
      case "/repos/same-org/same-name":
        return send(200, STAYED);
      case "/repos/same-org/same-name/pulls":
        return send(200, []);
      default:
        return send(404, { message: "Not Found" });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    client: new Octokit({ baseUrl: `http://127.0.0.1:${port}` }),
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

test("enrichment follows GitHub's redirect for a moved repository and reports its current owner and name", async () => {
  const api = await fakeApi();
  try {
    const found = await enrichRepos([{ slug: "clone", owner: "old-org", repo: "old-name" }], api.client);
    const e = found.get("clone");
    assert.ok(e, "the moved repository is enriched");
    assert.equal(e.owner, "new-org");
    assert.equal(e.repoName, "new-name");
    // The other facts are the moved repository's too.
    assert.equal(e.description, "A repository that moved");
    assert.equal(e.defaultBranch, "trunk");
    assert.equal(e.openPrs, 1);
    assert.equal(e.openIssues, 2);
    // Asked under the remote's owner and name, then redirected; the open pull
    // requests are read under the current ones.
    assert.deepEqual(api.requests, [
      "/repos/old-org/old-name",
      "/repositories/42",
      "/repos/new-org/new-name/pulls",
    ]);
  } finally {
    await api.close();
  }
});

test("a repository GitHub serves under the remote's owner and name keeps them", async () => {
  const api = await fakeApi();
  try {
    const found = await enrichRepos([{ slug: "here", owner: "same-org", repo: "same-name" }], api.client);
    const e = found.get("here");
    assert.ok(e, "the repository is enriched");
    assert.equal(e.owner, "same-org");
    assert.equal(e.repoName, "same-name");
    assert.equal(e.openPrs, 0);
  } finally {
    await api.close();
  }
});

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
    visibility: "unknown",
    isFork: null,
    isArchived: null,
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

function enrichment(over: Partial<RepoEnrichment> = {}): RepoEnrichment {
  return {
    owner: "new-org",
    repoName: "new-name",
    visibility: "public",
    isFork: false,
    isArchived: false,
    language: "Go",
    stars: 7,
    openIssues: 2,
    openPrs: 1,
    defaultBranch: "trunk",
    pushedAt: "2026-10-01T00:00:00Z",
    description: "A repository that moved",
    ...over,
  };
}

test("the scan records the owner and name GitHub reports in place of the remote's", () => {
  const remote = "https://github.com/old-org/old-name.git";
  const repos = [
    row("clone", { remoteUrl: remote, owner: "old-org", repoName: "old-name" }),
    row("offline", { remoteUrl: "https://github.com/some-org/offline.git", owner: "some-org", repoName: "offline" }),
  ];
  applyEnrichment(repos, new Map([["clone", enrichment()]]));

  const [moved, offline] = repos;
  assert.equal(moved.owner, "new-org");
  assert.equal(moved.repoName, "new-name");
  assert.equal(moved.visibility, "public");
  assert.equal(moved.isFork, 0);
  assert.equal(moved.openPrs, 1);
  // What the scan read locally stays: the folder name, the slug and the remote.
  assert.equal(moved.name, "clone");
  assert.equal(moved.slug, "clone");
  assert.equal(moved.remoteUrl, remote);
  // A repository GitHub did not answer for keeps the remote's owner and name.
  assert.equal(offline.owner, "some-org");
  assert.equal(offline.repoName, "offline");
  assert.equal(offline.visibility, "unknown");
});
