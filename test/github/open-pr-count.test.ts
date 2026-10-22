import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Octokit } from "@octokit/rest";
import { enrichRepos } from "@/lib/github";

/**
 * GitHub lists a repository's open pull requests a page at a time, at most 100
 * to a page, and names the other pages in a `Link` header. The scan asked for
 * one page of 100 and took its length as the count, so a repository with more
 * open pull requests showed 100, and its open issues (GitHub's
 * open_issues_count, which counts pull requests too, less that count) came out
 * too high by the difference. A server on 127.0.0.1 stands in for the GitHub
 * API here and pages the list with `Link` headers in GitHub's form.
 */

/** Open issues that are not pull requests, the same in each repository here. */
const ISSUES = 12;

interface Listing {
  /** Open pull requests in the repository. */
  prs: number;
  /** Page with a cursor: the `Link` header names a next page and no last one. */
  cursor?: boolean;
  /** The pull request listing answers 403. */
  denied?: boolean;
}

interface FakeApi {
  client: Octokit;
  /** How many requests each repository's pull request listing answered. */
  pullRequests: Map<string, number>;
  close(): Promise<void>;
}

async function fakeApi(repos: Record<string, Listing>): Promise<FakeApi> {
  const pullRequests = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
      res.end(JSON.stringify(body));
    };
    const match = /^\/repos\/example-org\/([^/]+)(\/pulls)?$/.exec(url.pathname);
    const listing = match ? repos[match[1]] : undefined;
    if (!match || !listing) return send(404, { message: "Not Found" });
    const name = match[1];
    if (!match[2]) {
      return send(200, {
        id: 1,
        name,
        owner: { login: "example-org" },
        private: false,
        fork: false,
        archived: false,
        language: "TypeScript",
        stargazers_count: 1,
        open_issues_count: listing.prs + ISSUES,
        default_branch: "main",
        pushed_at: "2026-10-01T00:00:00Z",
        description: null,
      });
    }
    pullRequests.set(name, (pullRequests.get(name) ?? 0) + 1);
    if (listing.denied) return send(403, { message: "Resource not accessible by integration" });

    const perPage = Math.min(Math.max(Number(url.searchParams.get("per_page") ?? 30), 1), 100);
    const start = listing.cursor
      ? Number(url.searchParams.get("after") ?? 0)
      : (Number(url.searchParams.get("page") ?? 1) - 1) * perPage;
    const end = Math.min(start + perPage, listing.prs);
    const items = Array.from({ length: Math.max(0, end - start) }, (_, i) => ({ number: start + i + 1 }));
    // The query keeps GitHub's layout: state, per_page, then the page or cursor.
    const at = (query: string) => `<${url.origin}${url.pathname}?state=open&per_page=${perPage}&${query}>`;
    const links: string[] = [];
    if (listing.cursor) {
      if (end < listing.prs) links.push(`${at(`after=${end}`)}; rel="next"`);
    } else {
      const page = start / perPage + 1;
      const last = Math.max(1, Math.ceil(listing.prs / perPage));
      if (page > 1) links.push(`${at(`page=${page - 1}`)}; rel="prev"`);
      if (page < last) links.push(`${at(`page=${page + 1}`)}; rel="next"`, `${at(`page=${last}`)}; rel="last"`);
      if (page > 1) links.push(`${at("page=1")}; rel="first"`);
    }
    return send(200, items, links.length > 0 ? { link: links.join(", ") } : {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    client: new Octokit({ baseUrl: `http://127.0.0.1:${port}` }),
    pullRequests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function targets(names: string[]) {
  return names.map((name) => ({ slug: name, owner: "example-org", repo: name }));
}

test("the open pull request count goes past one page of 100, and open issues subtract the full count", async () => {
  const counts = [0, 1, 2, 100, 101, 635];
  const names = counts.map((n) => `prs-${n}`);
  const api = await fakeApi(Object.fromEntries(counts.map((n) => [`prs-${n}`, { prs: n }])));
  try {
    const found = await enrichRepos(targets(names), api.client);
    for (const n of counts) {
      const e = found.get(`prs-${n}`);
      assert.ok(e, `prs-${n} is enriched`);
      assert.equal(e.openPrs, n, `prs-${n}: open pull requests`);
      assert.equal(e.openIssues, ISSUES, `prs-${n}: open issues`);
      // One request reads the count; the pages are not walked.
      assert.equal(api.pullRequests.get(`prs-${n}`), 1, `prs-${n}: pull request listing requests`);
    }
  } finally {
    await api.close();
  }
});

test("a listing that names a next page and no last page is counted page by page", async () => {
  const api = await fakeApi({ cursor: { prs: 250, cursor: true } });
  try {
    const e = (await enrichRepos(targets(["cursor"]), api.client)).get("cursor");
    assert.ok(e, "the repository is enriched");
    assert.equal(e.openPrs, 250);
    assert.equal(e.openIssues, ISSUES);
    // The first request, then three pages of at most 100.
    assert.equal(api.pullRequests.get("cursor"), 4);
  } finally {
    await api.close();
  }
});

test("when the pull request listing is refused, the count is unknown and open issues keep GitHub's total", async () => {
  const api = await fakeApi({ denied: { prs: 5, denied: true } });
  try {
    const e = (await enrichRepos(targets(["denied"]), api.client)).get("denied");
    assert.ok(e, "the repository is still enriched");
    assert.equal(e.openPrs, null);
    assert.equal(e.openIssues, 5 + ISSUES);
  } finally {
    await api.close();
  }
});
