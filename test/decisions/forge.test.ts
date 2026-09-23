import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  forgeSourceFromEnv,
  getLiveDecisions,
  resetForgeCache,
  MAX_FETCHES_PER_READ,
  type DecisionSnapshot,
  type Fetcher,
  type ForgeSource,
} from "@/lib/decisions-forge";
import { gitBlobSha, parseDecisionContent } from "@/lib/scanners/decisions";
import type { Decision } from "@/lib/types";

/**
 * The forge read is exercised with an injected fetcher, so every rule is keyed
 * on what was fetched and what came back, never on the network:
 *   - the public and local modes never contact the forge (the boundary);
 *   - only cards whose blob sha differs from the snapshot are fetched;
 *   - a card removed from the forge leaves the result;
 *   - a forge failure serves the snapshot with an `error` freshness and a note;
 *   - reads are cached for the TTL and shared in flight.
 */

const SOURCE: ForgeSource = {
  repo: "someone/todos",
  branch: "main",
  path: "decisions",
  token: "t",
  apiBase: "https://forge.invalid",
};

function cardText(title: string, decision: string): string {
  return `# ${title}\n\n**Date:** 2026-09-20T10:00Z\n**Class:** adopted\n**Status:** executed\n**Decision:** ${decision}\n`;
}

function card(name: string, content: string): Decision {
  const r = parseDecisionContent(name, content, {
    path: `snap/${name}`,
    modifiedAt: "2026-09-20T10:00:00.000Z",
    scannedAt: "2026-09-20T10:00:00.000Z",
    quiet: true,
  });
  assert.equal(r.kind, "card");
  return (r as { kind: "card"; card: Decision }).card;
}

const OLD = cardText("Old card", "Stays as it was.");
const CHANGED_BEFORE = cardText("Changed card", "Before.");
const CHANGED_AFTER = cardText("Changed card", "After.");
const NEW = cardText("New card", "Brand new.");

function snapshot(): DecisionSnapshot {
  return {
    decisions: [card("2026-09-20-old.md", OLD), card("2026-09-20-changed.md", CHANGED_BEFORE)],
    decisionSkips: [],
    generatedAt: "2026-09-21T05:30:00.000Z",
  };
}

/** A fake forge: a directory listing plus file bodies, recording every URL hit. */
function forge(files: Record<string, string>, opts: { listStatus?: number; fail?: boolean } = {}) {
  const hits: string[] = [];
  const fetcher: Fetcher = async (url) => {
    hits.push(url);
    if (opts.fail) throw new Error("connection refused");
    if (url.includes("/contents/decisions?")) {
      if (opts.listStatus && opts.listStatus !== 200)
        return new Response("nope", { status: opts.listStatus });
      const listing = Object.entries(files).map(([name, content]) => ({
        name,
        sha: gitBlobSha(content),
        type: "file",
      }));
      listing.push({ name: "README.md", sha: "x", type: "file" });
      return Response.json(listing);
    }
    const name = decodeURIComponent(url.split("/contents/decisions/")[1].split("?")[0]);
    if (!(name in files)) return new Response("missing", { status: 404 });
    return new Response(files[name], { status: 200 });
  };
  return { fetcher, hits };
}

const NOW = new Date("2026-09-22T12:00:00.000Z");

beforeEach(() => resetForgeCache());

test("public and local modes never contact the forge and see nothing", async () => {
  const f = forge({ "2026-09-20-old.md": OLD });
  for (const mode of ["public", "local"] as const) {
    const r = await getLiveDecisions(mode, { source: SOURCE, snapshot, fetch: f.fetcher, now: () => NOW });
    assert.deepEqual(r.decisions, []);
    assert.deepEqual(r.skips, []);
    assert.equal(r.source, "snapshot");
  }
  assert.deepEqual(f.hits, [], "no request may leave for a non-owner mode");
});

test("only changed and new cards are fetched; unchanged ones come from the snapshot", async () => {
  const f = forge({
    "2026-09-20-old.md": OLD,
    "2026-09-20-changed.md": CHANGED_AFTER,
    "2026-09-22-new.md": NEW,
  });
  const r = await getLiveDecisions("owner", { source: SOURCE, snapshot, fetch: f.fetcher, now: () => NOW });
  assert.equal(r.source, "forge");
  assert.equal(r.changed, 2);
  assert.equal(r.error, null);
  const fetched = f.hits.filter((u) => u.includes("/contents/decisions/")).map((u) => decodeURIComponent(u.split("/contents/decisions/")[1].split("?")[0]));
  assert.deepEqual(fetched.sort(), ["2026-09-20-changed.md", "2026-09-22-new.md"]);
  const byId = Object.fromEntries(r.decisions.map((d) => [d.id, d]));
  assert.equal(byId["2026-09-20-old"].decision, "Stays as it was.");
  assert.equal(byId["2026-09-20-old"].path, "snap/2026-09-20-old.md", "unchanged card is the snapshot's object");
  assert.equal(byId["2026-09-20-changed"].decision, "After.");
  assert.equal(byId["2026-09-22-new"].decision, "Brand new.");
  assert.equal(byId["2026-09-22-new"].blobSha, gitBlobSha(NEW));
  assert.equal(r.freshness.status, "ok");
  assert.match(r.freshness.note ?? "", /2 cards read live/);
});

test("a card removed from the forge leaves the result", async () => {
  const f = forge({ "2026-09-20-old.md": OLD });
  const r = await getLiveDecisions("owner", { source: SOURCE, snapshot, fetch: f.fetcher, now: () => NOW });
  assert.deepEqual(r.decisions.map((d) => d.id), ["2026-09-20-old"]);
  assert.equal(r.changed, 0);
  assert.match(r.freshness.note ?? "", /no card changed/);
});

test("a forge failure serves the snapshot with an error freshness and a loud note", async () => {
  for (const [label, f] of [
    ["unreachable", forge({}, { fail: true })],
    ["HTTP 403", forge({}, { listStatus: 403 })],
  ] as const) {
    resetForgeCache();
    const r = await getLiveDecisions("owner", { source: SOURCE, snapshot, fetch: f.fetcher, now: () => NOW });
    assert.equal(r.source, "snapshot", label);
    assert.deepEqual(r.decisions.map((d) => d.id).sort(), ["2026-09-20-changed", "2026-09-20-old"], label);
    assert.equal(r.freshness.status, "error", label);
    assert.match(r.freshness.note ?? "", /showing the snapshot built 2026-09-21T05:30:00.000Z/, label);
    assert.ok(r.error, label);
  }
});

test("a missing token or an unconfigured forge serves the snapshot, never fetches", async () => {
  const f = forge({ "2026-09-20-old.md": OLD });
  const noToken = await getLiveDecisions("owner", { source: { ...SOURCE, token: null }, snapshot, fetch: f.fetcher, now: () => NOW });
  assert.equal(noToken.source, "snapshot");
  assert.match(noToken.error ?? "", /token not configured/);
  resetForgeCache();
  const noSource = await getLiveDecisions("owner", { source: null, snapshot, fetch: f.fetcher, now: () => NOW });
  assert.equal(noSource.source, "snapshot");
  assert.match(noSource.error ?? "", /ATLAS_FORGE_REPO/);
  assert.deepEqual(f.hits, []);
});

test("reads are cached for the TTL and shared while in flight", async () => {
  const f = forge({ "2026-09-20-old.md": OLD, "2026-09-22-new.md": NEW });
  let t = NOW.getTime();
  const now = () => new Date(t);
  const opts = { source: SOURCE, snapshot, fetch: f.fetcher, now, ttlMs: 60_000 };
  const [a, b] = await Promise.all([getLiveDecisions("owner", opts), getLiveDecisions("owner", opts)]);
  assert.equal(a, b, "concurrent reads share one in-flight read");
  const listings = () => f.hits.filter((u) => u.includes("/contents/decisions?")).length;
  assert.equal(listings(), 1);
  t += 30_000;
  await getLiveDecisions("owner", opts);
  assert.equal(listings(), 1, "inside the TTL the cached read is served");
  t += 31_000;
  await getLiveDecisions("owner", opts);
  assert.equal(listings(), 2, "past the TTL the forge is read again");
});

test("a burst of changes is fetched within the per-read budget, the rest deferred", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < MAX_FETCHES_PER_READ + 5; i++) {
    files[`2026-09-22-burst-${String(i).padStart(3, "0")}.md`] = cardText(`Burst ${i}`, `Card ${i}.`);
  }
  const f = forge(files);
  const r = await getLiveDecisions("owner", {
    source: SOURCE,
    snapshot: () => ({ decisions: [], decisionSkips: [], generatedAt: null }),
    fetch: f.fetcher,
    now: () => NOW,
  });
  assert.equal(r.changed, MAX_FETCHES_PER_READ);
  assert.match(r.freshness.note ?? "", /5 more changed cards deferred/);
});

test("forge coordinates come from the environment by name, token falling back to GITHUB_TOKEN", () => {
  assert.equal(forgeSourceFromEnv({}), null);
  assert.equal(forgeSourceFromEnv({ ATLAS_FORGE_REPO: "not a slug" }), null);
  const s = forgeSourceFromEnv({ ATLAS_FORGE_REPO: "someone/todos", GITHUB_TOKEN: "g" });
  assert.deepEqual(s, {
    repo: "someone/todos",
    branch: "main",
    path: "decisions",
    token: "g",
    apiBase: "https://api.github.com",
  });
  const s2 = forgeSourceFromEnv({ ATLAS_FORGE_REPO: "someone/todos", ATLAS_FORGE_TOKEN: "f", GITHUB_TOKEN: "g", ATLAS_FORGE_BRANCH: "dev", ATLAS_FORGE_PATH: "/cards/" });
  assert.equal(s2?.token, "f");
  assert.equal(s2?.branch, "dev");
  assert.equal(s2?.path, "cards");
});
