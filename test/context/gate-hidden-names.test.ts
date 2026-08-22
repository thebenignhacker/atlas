import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";

/**
 * The publish gate's private-repo-name check, exercised through the REAL GATE
 * rather than through its helper.
 *
 * This file exists because a CRITICAL bypass lived entirely in the caller. The
 * helper (`hiddenNameLeak`) was correct and thoroughly unit-tested, while
 * `scripts/snapshot.ts` skipped calling it for any private repo whose name
 * appeared anywhere in the public identifier set — name, slug OR repoName. A
 * private `secretless-ai` was exempted wholesale because a public repo happened
 * to carry `repoName: "secretless-ai"`, and every token containing it published.
 *
 * A helper test cannot see that. These run the gate binary and assert on its
 * exit code, which is the only thing that actually decides whether we publish.
 */

const repoRoot = process.cwd();
const dirs: string[] = [];

after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

interface Repo {
  slug: string;
  name: string;
  repoName: string | null;
  visibility: string;
  isFork?: number;
}

/** Build a throwaway atlas tree + DB and run the real publish gate against it. */
function runGate(opts: { repos: Repo[]; cardClaim: string; cardProject?: string }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-gate-work-"));
  const dataDir = path.join(work, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  dirs.push(work);

  fs.writeFileSync(
    path.join(work, "atlas.config.json"),
    JSON.stringify({
      scanRoots: [],
      todoDirs: [],
      github: { user: "tester", orgs: [] },
      publicOwners: ["testorg"],
      sensitiveRepos: [],
    })
  );

  const db = new Database(path.join(dataDir, "atlas.db"));
  initSchema(db);
  const ins = db.prepare(
    "INSERT INTO repos (slug, name, path, owner, repoName, visibility, isFork, lastCommitAt) VALUES (?,?,?,?,?,?,?,?)"
  );
  for (const r of opts.repos) {
    ins.run(r.slug, r.name, `/x/${r.slug}`, "testorg", r.repoName, r.visibility, r.isFork ?? 0, "2026-08-01T00:00:00.000Z");
  }
  const now = "2026-08-01T00:00:00.000Z";
  db.prepare(
    `INSERT INTO context_cards (id, project, repoSlug, subject, claim, derivedAt, lastVerifiedAt,
       freshness, status, visibility, sensitive, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    "pub:card",
    opts.cardProject ?? "public-repo",
    null,
    "a published subject",
    opts.cardClaim,
    now,
    now,
    "fresh",
    "active",
    "public",
    0,
    now,
    now
  );
  db.close();

  // Run from the repo root (tsconfig `@/` aliases resolve against cwd) but point
  // the resolver at the throwaway tree. That the gate reads its config, database
  // and output path from ATLAS_ROOT/ATLAS_DATA_DIR rather than cwd is exactly
  // what the path unification bought.
  const r = spawnSync("npx", ["tsx", "scripts/snapshot.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ATLAS_ROOT: work, ATLAS_DATA_DIR: dataDir },
  });
  return {
    status: r.status ?? -1,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
    published: fs.existsSync(path.join(work, "public-snapshot.json")),
  };
}

const PUBLIC_ONLY: Repo[] = [
  { slug: "public-repo", name: "public-repo", repoName: "public-repo", visibility: "public" },
];

test("REGRESSION: a private name matching a public repo's repoName is still checked", () => {
  // The exact bypass. `secretless` is public but carries repoName
  // `secretless-ai`; `secretless-ai` is a separate PRIVATE repo. The old early
  // exit saw the name in the identifier set and skipped the repo entirely.
  const r = runGate({
    repos: [
      ...PUBLIC_ONLY,
      { slug: "secretless", name: "secretless", repoName: "secretless-ai", visibility: "public" },
      { slug: "secretless-ai", name: "secretless-ai", repoName: "secretless-ai", visibility: "private" },
    ],
    // The private name goes in `project`, NOT `claim`: sanitizeCard redacts
    // claim/detail/subject but passes project/id/tags through untouched, so the
    // gate is the only thing standing between those fields and the artifact.
    cardProject: "secretless-ai-internal",
    cardClaim: "benign text",
  });
  assert.notEqual(r.status, 0, `gate must abort; got:\n${r.out}`);
  assert.match(r.out, /secretless-ai/);
  assert.equal(r.published, false, "no artifact may be written when the gate aborts");
});

test("REGRESSION: a private name is matched case-insensitively inside a token", () => {
  // The private name is NOT any published repo's name, so the exemption does not
  // apply and the token must be caught despite differing in case. (A private
  // name that merely differs in CASE from a published name is a different
  // situation and is exempt -- that string is already public; see below.)
  const r = runGate({
    repos: [
      ...PUBLIC_ONLY,
      { slug: "crypto-census-data", name: "crypto-census-data", repoName: "crypto-census-data", visibility: "public" },
      { slug: "crypto-census", name: "crypto-census", repoName: "crypto-census", visibility: "private" },
    ],
    cardProject: "Crypto-Census-Secrets",
    cardClaim: "benign text",
  });
  assert.notEqual(r.status, 0, `gate must abort; got:\n${r.out}`);
  assert.equal(r.published, false);
});

test("a private name differing only in CASE from a published name is exempt", () => {
  // Repo names are case-insensitive for uniqueness on GitHub, and the published
  // name already discloses the string; only the exact casing would be new, which
  // is not worth deadlocking every publish over.
  const r = runGate({
    repos: [
      ...PUBLIC_ONLY,
      { slug: "crypto-census", name: "crypto-census", repoName: "crypto-census", visibility: "public" },
      { slug: "crypto-census-2", name: "Crypto-Census", repoName: "Crypto-Census", visibility: "private" },
    ],
    cardProject: "Crypto-Census-Secrets",
    cardClaim: "benign text",
  });
  assert.equal(r.status, 0, `gate must publish; got:\n${r.out}`);
  assert.equal(r.published, true);
});

test("a public repo whose name extends a private one still publishes", () => {
  // The false positive the token anchoring exists to fix. Must stay fixed:
  // this is the case that was blocking every publish.
  const r = runGate({
    repos: [
      ...PUBLIC_ONLY,
      { slug: "crypto-census-data", name: "crypto-census-data", repoName: "crypto-census-data", visibility: "public" },
      { slug: "crypto-census", name: "crypto-census", repoName: "crypto-census", visibility: "private" },
    ],
    cardProject: "crypto-census-data",
    cardClaim: "nothing sensitive here",
  });
  assert.equal(r.status, 0, `gate must pass; got:\n${r.out}`);
  assert.equal(r.published, true);
});

test("a bare mention of a private repo name aborts the publish", () => {
  const r = runGate({
    repos: [
      ...PUBLIC_ONLY,
      { slug: "internal-planning", name: "internal-planning", repoName: "internal-planning", visibility: "private" },
    ],
    cardProject: "internal-planning",
    cardClaim: "benign text",
  });
  assert.notEqual(r.status, 0, `gate must abort; got:\n${r.out}`);
  assert.equal(r.published, false);
});

test("the freshness block publishes no collector note", () => {
  // `note` was the one published free-text field that never passed through the
  // name/sensitive redactor, and it carries scan-root paths and database-wide
  // counts composed by the collector.
  const r = runGate({ repos: PUBLIC_ONLY, cardClaim: "benign" });
  assert.equal(r.status, 0, r.out);
  const work = dirs[dirs.length - 1];
  const snap = JSON.parse(fs.readFileSync(path.join(work, "public-snapshot.json"), "utf8"));
  for (const [name, f] of Object.entries(snap.freshness as Record<string, { note: unknown }>)) {
    assert.equal(f.note, null, `freshness.${name}.note must not be published`);
  }
});

test("a hidden repo whose NAME is already published does not deadlock the publish", () => {
  // A fork (hidden by isFork) sharing a published repo's name. That name is
  // already public, so a token extending it discloses nothing -- and checking it
  // would abort every future publish with no configuration remedy, reinstating
  // the outage the token anchoring was written to remove.
  const r = runGate({
    repos: [
      ...PUBLIC_ONLY,
      { slug: "vendor-sdk", name: "vendor-sdk", repoName: "vendor-sdk", visibility: "public" },
      { slug: "vendor-sdk-fork", name: "vendor-sdk", repoName: "vendor-sdk", visibility: "public", isFork: 1 },
    ],
    cardProject: "vendor-sdk-patches",
    cardClaim: "benign text",
  });
  assert.equal(r.status, 0, `gate must publish; got:\n${r.out}`);
  assert.equal(r.published, true);
});

test("the name-only exemption does NOT reopen the slug/repoName bypass", () => {
  // The exemption is published NAMES only. A private repo whose name matches a
  // published repo's repoName -- but no published NAME -- must still be checked.
  // This is the pair that makes the narrow exemption safe rather than a bypass.
  const r = runGate({
    repos: [
      ...PUBLIC_ONLY,
      { slug: "secretless", name: "secretless", repoName: "secretless-ai", visibility: "public" },
      { slug: "secretless-ai", name: "secretless-ai", repoName: "secretless-ai", visibility: "private" },
    ],
    cardProject: "secretless-ai-internal",
    cardClaim: "benign text",
  });
  assert.notEqual(r.status, 0, `gate must abort; got:\n${r.out}`);
  assert.equal(r.published, false);
});
