import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";

/**
 * A slug in sensitiveRepos withholds the GitHub repository it names, in every
 * clone. The scan gives each directory holding a .git a slug of its own, and the
 * public snapshot keeps one card per GitHub repository, so dropping the listed
 * slug alone can leave another clone of the same repository as its card, with a
 * slug and directory name that carry none of the listed identifiers. The gate's
 * text checks then find nothing to refuse and the repository is written out.
 *
 * The first two tests run the real publish gate against a seeded database and
 * assert on the artifact it writes. The third tests the gate's own check with a
 * card the generator never publishes.
 */

const repoRoot = process.cwd();
const dirs: string[] = [];

after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

interface Clone {
  slug: string;
  name: string;
  repoName: string;
  lastCommitAt: string;
  owner?: string;
}

// Every case also holds this unrelated repository, which stays published.
const PLAIN: Clone = {
  slug: "testorg-plain",
  name: "plain",
  repoName: "plain",
  lastCommitAt: "2026-01-10T00:00:00.000Z",
};

/** Seed a throwaway atlas tree with one public row and one event per clone, run
 *  the real publish gate against it, and return its exit status and artifact. */
function runGate(opts: { sensitiveRepos: string[]; publicOwners: string[]; clones: Clone[] }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-gate-clones-"));
  const dataDir = path.join(work, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  dirs.push(work);

  fs.writeFileSync(
    path.join(work, "atlas.config.json"),
    JSON.stringify({
      scanRoots: [],
      todoDirs: [],
      github: { user: "tester", orgs: [] },
      publicOwners: opts.publicOwners,
      sensitiveRepos: opts.sensitiveRepos,
    })
  );

  const db = new Database(path.join(dataDir, "atlas.db"));
  initSchema(db);
  const repo = db.prepare(
    "INSERT INTO repos (slug, name, path, owner, repoName, visibility, isFork, lastCommitAt) VALUES (?,?,?,?,?,?,?,?)"
  );
  const event = db.prepare(
    "INSERT INTO activity (id, repoSlug, type, title, ts) VALUES (?,?,?,?,?)"
  );
  for (const c of opts.clones) {
    repo.run(c.slug, c.name, `/x/${c.name}`, c.owner ?? "testorg", c.repoName, "public", 0, c.lastCommitAt);
    event.run(`commit-${c.slug}`, c.slug, "commit", `a commit in ${c.name}`, c.lastCommitAt);
  }
  db.close();

  // Run from the repo root (tsconfig `@/` aliases resolve against cwd) with the
  // config, database and output path taken from ATLAS_ROOT and ATLAS_DATA_DIR.
  const r = spawnSync("npx", ["tsx", "scripts/snapshot.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ATLAS_ROOT: work, ATLAS_DATA_DIR: dataDir },
  });
  const file = path.join(work, "public-snapshot.json");
  const snapshot = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as {
        repos: { slug: string }[];
        activity: { repoSlug: string | null }[];
      })
    : null;
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, snapshot };
}

test("a listed repository is withheld in every clone when the listed clone is not in the directory named after it", () => {
  // testorg/vault in three directories, none of them named vault. The listed
  // clone is vlt. The one-card rule would keep scratch9, the newest, whose slug
  // and directory name contain neither "testorg-vlt" nor "vlt". A repository of
  // the same name under another owner is another repository and is published.
  const r = runGate({
    sensitiveRepos: ["testorg-vlt"],
    publicOwners: ["testorg", "otherorg"],
    clones: [
      { slug: "testorg-vlt", name: "vlt", repoName: "vault", lastCommitAt: "2026-01-01T00:00:00.000Z" },
      { slug: "testorg-vlt-copy", name: "vlt-copy", repoName: "vault", lastCommitAt: "2026-02-01T00:00:00.000Z" },
      { slug: "testorg-scratch9", name: "scratch9", repoName: "vault", lastCommitAt: "2026-03-01T00:00:00.000Z" },
      { slug: "otherorg-vault", name: "vault", repoName: "vault", owner: "otherorg", lastCommitAt: "2026-01-20T00:00:00.000Z" },
      PLAIN,
    ],
  });
  assert.equal(r.status, 0, `the gate must write the snapshot; got:\n${r.out}`);
  assert.ok(r.snapshot, "the artifact must be written");
  assert.deepEqual(r.snapshot.repos.map((x) => x.slug).sort(), ["otherorg-vault", "testorg-plain"]);
  assert.deepEqual(r.snapshot.activity.map((e) => e.repoSlug).sort(), ["otherorg-vault", "testorg-plain"]);
});

test("a listed repository renamed on GitHub is withheld in every clone, the one in the directory of its new name included", () => {
  // Renamed from oldname to newname, so every clone reports repoName newname.
  // The listed clone is oldname. The one-card rule would keep the clone in the
  // directory named newname, whose slug and directory name contain neither
  // "testorg-oldname" nor "oldname". One clone reports the owner and the name
  // in another letter case.
  const r = runGate({
    sensitiveRepos: ["testorg-oldname"],
    publicOwners: ["testorg"],
    clones: [
      { slug: "testorg-oldname", name: "oldname", repoName: "newname", lastCommitAt: "2026-03-01T00:00:00.000Z" },
      { slug: "testorg-oldname-wt", name: "oldname-wt", repoName: "NewName", owner: "TestOrg", lastCommitAt: "2026-03-02T00:00:00.000Z" },
      { slug: "testorg-newname", name: "newname", repoName: "newname", lastCommitAt: "2026-01-01T00:00:00.000Z" },
      PLAIN,
    ],
  });
  assert.equal(r.status, 0, `the gate must write the snapshot; got:\n${r.out}`);
  assert.ok(r.snapshot, "the artifact must be written");
  assert.deepEqual(r.snapshot.repos.map((x) => x.slug), ["testorg-plain"]);
  assert.deepEqual(r.snapshot.activity.map((e) => e.repoSlug), ["testorg-plain"]);
});

test("the gate's check names each published card with the owner and repoName of a listed row, in any letter case", async () => {
  const { sensitiveRepoClones } = await import("@/lib/snapshot");
  const listed = [
    { slug: "testorg-vlt", owner: "testorg", repoName: "vault" },
    { slug: "testorg-loose", owner: "testorg", repoName: null },
  ];
  const published = [
    { slug: "testorg-scratch9", owner: "TestOrg", repoName: "Vault" },
    { slug: "otherorg-vault", owner: "otherorg", repoName: "vault" },
    { slug: "testorg-plain", owner: "testorg", repoName: "plain" },
    { slug: "testorg-loose-copy", owner: "testorg", repoName: null },
  ];
  assert.deepEqual(sensitiveRepoClones(listed, published), [["testorg-vlt", "testorg-scratch9"]]);
});
