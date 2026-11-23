import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { initSchema } from "@/lib/db";

/**
 * A slug in sensitiveRepos withholds the GitHub repository it names, in every
 * clone. The scan gives each directory holding a .git a slug of its own, and the
 * public snapshot keeps one card per GitHub repository, so dropping the listed
 * slug alone can leave another clone of the same repository as its card, with a
 * slug and directory name that carry none of the listed identifiers. The gate's
 * text checks then find nothing to refuse and the repository is written out.
 * The same holds for a context card on another clone: the published card drops
 * its repoSlug, so nothing in the artifact ties it to the listed repository.
 *
 * Every test but the third and the last runs the real publish gate against a
 * seeded database and asserts on its exit status and the artifact it writes. The
 * third tests the gate's own check with a card the generator never publishes,
 * and the last the helper that reads a listed identifier's word matches as
 * whole tokens.
 */

const repoRoot = process.cwd();
const dirs: string[] = [];

after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

interface Clone {
  slug: string;
  name: string;
  /** null: the scan could not read the repository from the clone's remote. */
  repoName: string | null;
  lastCommitAt: string;
  /** Defaults to testorg; null as for repoName. */
  owner?: string | null;
  /** Defaults to public; "unknown" when the clone was not enriched. */
  visibility?: string;
}

/** A public, active context card attached to a clone by its repoSlug. */
interface Card {
  id: string;
  repoSlug: string;
  subject: string;
  claim: string;
}

/** A commit event of a clone, seeded as the scan writes it
 *  (lib/scanners/activity.ts): the subject as its title, and as its meta the
 *  sha and the directory name of the clone. */
interface Commit {
  repoSlug: string;
  sha: string;
  title: string;
}

// Every case also holds this unrelated repository, which stays published.
const PLAIN: Clone = {
  slug: "testorg-plain",
  name: "plain",
  repoName: "plain",
  lastCommitAt: "2026-01-10T00:00:00.000Z",
};

/** Seed a throwaway atlas tree with one row and one event per clone, and the
 *  given commits, context cards and AI summaries (keyed by slug), run the real
 *  publish gate against it, and return its exit status and artifact. */
function runGate(opts: {
  sensitiveRepos: string[];
  publicOwners: string[];
  clones: Clone[];
  cards?: Card[];
  commits?: Commit[];
  summaries?: Record<string, string>;
}) {
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
    const owner = c.owner === undefined ? "testorg" : c.owner;
    repo.run(c.slug, c.name, `/x/${c.name}`, owner, c.repoName, c.visibility ?? "public", 0, c.lastCommitAt);
    // A hash, as the scan makes an event id (lib/scanners/activity.ts). An id
    // that spells out the slug, such as commit-otherorg-vault-docs, is a token
    // the scan never writes into the artifact.
    const id = createHash("md5").update(`${c.slug}:${c.lastCommitAt}`).digest("hex");
    event.run(id, c.slug, "commit", `a commit in ${c.name}`, c.lastCommitAt);
  }
  const commit = db.prepare(
    "INSERT INTO activity (id, repoSlug, type, title, ts, meta) VALUES (?,?,?,?,?,?)"
  );
  for (const c of opts.commits ?? []) {
    const clone = opts.clones.find((x) => x.slug === c.repoSlug);
    if (clone === undefined) throw new Error(`no clone has the slug ${c.repoSlug}`);
    const id = createHash("md5").update(`${c.repoSlug}:${c.sha}`).digest("hex");
    const meta = JSON.stringify({ sha: c.sha, repo: clone.name });
    commit.run(id, c.repoSlug, "commit", c.title, clone.lastCommitAt, meta);
  }
  const card = db.prepare(
    `INSERT INTO context_cards (id, project, repoSlug, subject, claim, derivedAt, lastVerifiedAt,
       freshness, status, visibility, sensitive, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const now = "2026-01-10T00:00:00.000Z";
  for (const c of opts.cards ?? [])
    card.run(c.id, "tooling", c.repoSlug, c.subject, c.claim, now, now, "fresh", "active", "public", 0, now, now);
  const summary = db.prepare(
    "INSERT INTO ai_outputs (id, entityType, entityId, task, output, generatedAt) VALUES (?,?,?,?,?,?)"
  );
  for (const [entityId, output] of Object.entries(opts.summaries ?? {}))
    summary.run(createHash("md5").update(`summary:${entityId}`).digest("hex"), "repo", entityId, "summary", output, now);
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
        activity: { repoSlug: string | null; title: string; meta: string | null }[];
        contextCards: { id: string }[];
        summaries: Record<string, string>;
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

// testorg/widget in the directory named after it, which is the listed clone,
// and in widget-copy.
const WIDGET: Clone[] = [
  { slug: "testorg-widget", name: "widget", repoName: "widget", lastCommitAt: "2026-01-01T00:00:00.000Z" },
  { slug: "testorg-widget-copy", name: "widget-copy", repoName: "widget", lastCommitAt: "2026-02-01T00:00:00.000Z" },
];

test("a context card on another clone of a listed repository is withheld with the repository", () => {
  // The card names widget-copy by its repoSlug. Once that clone is withheld,
  // nothing in the artifact ties the card to the listed repository, so the
  // gate's text checks cannot refuse it.
  const r = runGate({
    sensitiveRepos: ["testorg-widget"],
    publicOwners: ["testorg"],
    clones: [...WIDGET, PLAIN],
    cards: [
      { id: "tooling:copy-fact", repoSlug: "testorg-widget-copy", subject: "copy fact", claim: "a fact recorded on the copy" },
      { id: "tooling:plain-fact", repoSlug: "testorg-plain", subject: "plain fact", claim: "a fact recorded on plain" },
    ],
  });
  assert.equal(r.status, 0, `the gate must write the snapshot; got:\n${r.out}`);
  assert.ok(r.snapshot, "the artifact must be written");
  assert.deepEqual(r.snapshot.repos.map((x) => x.slug), ["testorg-plain"]);
  assert.deepEqual(r.snapshot.contextCards.map((c) => c.id), ["tooling:plain-fact"]);
});

test("the gate refuses a published card that quotes a card on another clone of a listed repository", () => {
  // The quoted claim holds no distinctive token for the generator to redact,
  // so only the gate's own set of withheld cards, read from the database, can
  // see that the published card repeats the withheld card's text.
  const r = runGate({
    sensitiveRepos: ["testorg-widget"],
    publicOwners: ["testorg"],
    clones: [...WIDGET, PLAIN],
    cards: [
      { id: "tooling:copy-fact", repoSlug: "testorg-widget-copy", subject: "copy fact", claim: "the copy holds the staging notes" },
      { id: "tooling:plain-fact", repoSlug: "testorg-plain", subject: "plain fact", claim: "quoted: the copy holds the staging notes" },
    ],
  });
  assert.equal(r.status, 1, `the gate must refuse; got:\n${r.out}`);
  assert.equal(r.snapshot, null, "no artifact may be written");
  assert.match(r.out, /sensitive card text from "tooling:copy-fact" present in snapshot/);
});

test("the gate refuses when the listed clone's repository is unknown and the clone that carries its name is not published", () => {
  // The listed clone vlt has no owner or repoName (its remote names no GitHub
  // repository the scan can read), so nothing ties it to testorg/vault. Of the
  // other two clones of testorg/vault the one-card rule publishes the newest,
  // scratch9, and drops vlt-copy, the only one whose slug and directory name
  // carry the listed identifiers.
  const r = runGate({
    sensitiveRepos: ["testorg-vlt"],
    publicOwners: ["testorg"],
    clones: [
      { slug: "testorg-vlt", name: "vlt", owner: null, repoName: null, visibility: "unknown", lastCommitAt: "2026-01-01T00:00:00.000Z" },
      { slug: "testorg-vlt-copy", name: "vlt-copy", repoName: "vault", lastCommitAt: "2026-02-01T00:00:00.000Z" },
      { slug: "testorg-scratch9", name: "scratch9", repoName: "vault", lastCommitAt: "2026-03-01T00:00:00.000Z" },
      PLAIN,
    ],
  });
  assert.equal(r.status, 1, `the gate must refuse; got:\n${r.out}`);
  assert.equal(r.snapshot, null, "no artifact may be written");
  assert.match(
    r.out,
    /sensitive repo identifier "vlt" names "testorg-vlt-copy", a clone of the published repository "testorg-scratch9"/
  );
});

test("the gate refuses when the listed clone records the repository's old name and the clone that carries it is not published", () => {
  // testorg/oldname was renamed to newname. The listed clone oldname still
  // records the old name, so no published card has its owner and repoName. The
  // one-card rule publishes the clone in the directory named newname and drops
  // oldname-wt, the only clone of it whose slug and directory name carry the
  // listed identifiers.
  const r = runGate({
    sensitiveRepos: ["testorg-oldname"],
    publicOwners: ["testorg"],
    clones: [
      { slug: "testorg-oldname", name: "oldname", repoName: "oldname", visibility: "unknown", lastCommitAt: "2026-01-01T00:00:00.000Z" },
      { slug: "testorg-oldname-wt", name: "oldname-wt", repoName: "newname", lastCommitAt: "2026-03-01T00:00:00.000Z" },
      { slug: "testorg-newname", name: "newname", repoName: "newname", lastCommitAt: "2026-02-01T00:00:00.000Z" },
      PLAIN,
    ],
  });
  assert.equal(r.status, 1, `the gate must refuse; got:\n${r.out}`);
  assert.equal(r.snapshot, null, "no artifact may be written");
  assert.match(
    r.out,
    /sensitive repo identifier "oldname" names "testorg-oldname-wt", a clone of the published repository "testorg-newname"/
  );
});

test("a clone left out by the one-card rule that carries no listed identifier does not stop the snapshot", () => {
  // plain-wt is a second clone of testorg/plain; the one-card rule publishes
  // the clone in the directory named plain. Neither carries "testorg-vlt" or
  // "vlt", so the gate writes the snapshot.
  const r = runGate({
    sensitiveRepos: ["testorg-vlt"],
    publicOwners: ["testorg"],
    clones: [
      { slug: "testorg-vlt", name: "vlt", owner: null, repoName: null, visibility: "unknown", lastCommitAt: "2026-01-01T00:00:00.000Z" },
      PLAIN,
      { slug: "testorg-plain-wt", name: "plain-wt", repoName: "plain", lastCommitAt: "2026-02-01T00:00:00.000Z" },
    ],
  });
  assert.equal(r.status, 0, `the gate must write the snapshot; got:\n${r.out}`);
  assert.ok(r.snapshot, "the artifact must be written");
  assert.deepEqual(r.snapshot.repos.map((x) => x.slug), ["testorg-plain"]);
});

// testorg/vault in the directory named after it, which is the listed clone, and
// otherorg/vault, another repository of the same name, in a directory of the
// same name under another allowed owner.
const VAULTS: Clone[] = [
  { slug: "testorg-vault", name: "vault", repoName: "vault", lastCommitAt: "2026-01-01T00:00:00.000Z" },
  { slug: "otherorg-vault", name: "vault", repoName: "vault", owner: "otherorg", lastCommitAt: "2026-01-20T00:00:00.000Z" },
];

test("a listed repository is withheld and another owner's repository of the same name is published", () => {
  // The published card of otherorg/vault carries the name vault, the listed
  // clone's directory name, as its own name.
  const r = runGate({
    sensitiveRepos: ["testorg-vault"],
    publicOwners: ["testorg", "otherorg"],
    clones: [...VAULTS, PLAIN],
  });
  assert.equal(r.status, 0, `the gate must write the snapshot; got:\n${r.out}`);
  assert.ok(r.snapshot, "the artifact must be written");
  assert.deepEqual(r.snapshot.repos.map((x) => x.slug).sort(), ["otherorg-vault", "testorg-plain"]);
  assert.deepEqual(r.snapshot.activity.map((e) => e.repoSlug).sort(), ["otherorg-vault", "testorg-plain"]);
});

test("a second clone of another owner's repository of the listed name does not stop the snapshot", () => {
  // The one-card rule publishes otherorg/vault from the directory named vault
  // and leaves out vault-wt, whose directory name carries the word vault.
  const r = runGate({
    sensitiveRepos: ["testorg-vault"],
    publicOwners: ["testorg", "otherorg"],
    clones: [
      ...VAULTS,
      { slug: "otherorg-vault-wt", name: "vault-wt", repoName: "vault", owner: "otherorg", lastCommitAt: "2026-02-01T00:00:00.000Z" },
      PLAIN,
    ],
  });
  assert.equal(r.status, 0, `the gate must write the snapshot; got:\n${r.out}`);
  assert.ok(r.snapshot, "the artifact must be written");
  assert.deepEqual(r.snapshot.repos.map((x) => x.slug).sort(), ["otherorg-vault", "testorg-plain"]);
});

test("the gate refuses the listed slug in the text when another owner's repository carries the listed name", () => {
  // Only the listed directory name is already in the artifact as otherorg/vault's
  // own name. A card that quotes the listed slug still names the listed clone.
  const r = runGate({
    sensitiveRepos: ["testorg-vault"],
    publicOwners: ["testorg", "otherorg"],
    clones: [...VAULTS, PLAIN],
    cards: [
      { id: "tooling:plain-fact", repoSlug: "testorg-plain", subject: "plain fact", claim: "notes copied from testorg-vault" },
    ],
  });
  assert.equal(r.status, 1, `the gate must refuse; got:\n${r.out}`);
  assert.equal(r.snapshot, null, "no artifact may be written");
  assert.match(r.out, /sensitive repo identifier "testorg-vault" present in snapshot text/);
});

test("the gate refuses the listed repository's owner/name in the text when another owner's repository carries the listed name", () => {
  // The listed directory name is otherorg/vault's own name in the artifact, but
  // testorg/vault, the listed repository's owner and name, is in no published
  // field, and the generator redacts no name a published card carries. A card
  // that writes it, alone or in a GitHub URL, in any letter case, names the
  // listed repository. The listed repository is GitHub-public, then private.
  for (const [listed, claim] of [
    [VAULTS[0], "notes copied from testorg/vault"],
    [{ ...VAULTS[0], visibility: "private" }, "mirrors https://github.com/TestOrg/Vault.git"],
  ] as const) {
    const r = runGate({
      sensitiveRepos: ["testorg-vault"],
      publicOwners: ["testorg", "otherorg"],
      clones: [listed, VAULTS[1], PLAIN],
      cards: [{ id: "tooling:plain-fact", repoSlug: "testorg-plain", subject: "plain fact", claim }],
    });
    assert.equal(r.status, 1, `the gate must refuse "${claim}"; got:\n${r.out}`);
    assert.equal(r.snapshot, null, "no artifact may be written");
    assert.match(r.out, /sensitive repo identifier "testorg\/vault" present in snapshot text/);
  }
});

test("the gate refuses the listed name when the listed clone is not in the directory named after its GitHub repository", () => {
  // The listed clone sits in the directory vault, but its GitHub repository is
  // testorg/vault-private, as after a rename on GitHub. The published card of
  // otherorg/vault carries the name vault, and no published card carries
  // vault-private, which the generator does not redact: it redacts the listed
  // directory name, and only when no published card carries it. A card that
  // writes vault-private names the listed repository by its GitHub name.
  const r = runGate({
    sensitiveRepos: ["testorg-vault"],
    publicOwners: ["testorg", "otherorg"],
    clones: [{ ...VAULTS[0], repoName: "vault-private", visibility: "private" }, VAULTS[1], PLAIN],
    cards: [
      { id: "tooling:plain-fact", repoSlug: "testorg-plain", subject: "plain fact", claim: "notes copied from vault-private" },
    ],
  });
  assert.equal(r.status, 1, `the gate must refuse; got:\n${r.out}`);
  assert.equal(r.snapshot, null, "no artifact may be written");
  assert.match(r.out, /sensitive repo identifier "vault" present in snapshot text/);
});

test("the gate refuses the listed name when GitHub did not answer for the listed clone", () => {
  // Without GitHub's answer the listed clone keeps the owner and name of its
  // remote, which a transfer leaves out of date, so otherorg/vault can be the
  // listed repository under a new owner.
  const r = runGate({
    sensitiveRepos: ["testorg-vault"],
    publicOwners: ["testorg", "otherorg"],
    clones: [{ ...VAULTS[0], visibility: "unknown" }, VAULTS[1], PLAIN],
  });
  assert.equal(r.status, 1, `the gate must refuse; got:\n${r.out}`);
  assert.equal(r.snapshot, null, "no artifact may be written");
  assert.match(r.out, /sensitive repo identifier "vault" present in snapshot text/);
});

// otherorg/vault-docs, another repository, in the directory named after it. Its
// name and slug extend the listed name vault with a hyphen.
const VAULT_DOCS: Clone = {
  slug: "otherorg-vault-docs",
  name: "vault-docs",
  repoName: "vault-docs",
  owner: "otherorg",
  lastCommitAt: "2026-01-20T00:00:00.000Z",
};

test("a published repository whose name extends the listed name with a hyphen does not stop the snapshot", () => {
  // The listed clone testorg/vault sits in the directory named after it, and is
  // private, then GitHub-public. The word vault is in the published card's own
  // name, repoName and slug, inside the tokens vault-docs and
  // otherorg-vault-docs. In the second case the published repository is
  // testorg/vault-docs, whose slug testorg-vault-docs extends the listed slug.
  for (const [listed, docs] of [
    [{ ...VAULTS[0], visibility: "private" }, VAULT_DOCS],
    [VAULTS[0], { ...VAULT_DOCS, slug: "testorg-vault-docs", owner: "testorg" }],
  ] as const) {
    const r = runGate({
      sensitiveRepos: ["testorg-vault"],
      publicOwners: ["testorg", "otherorg"],
      clones: [listed, docs, PLAIN],
    });
    assert.equal(r.status, 0, `the gate must write the snapshot with ${docs.slug}; got:\n${r.out}`);
    assert.ok(r.snapshot, "the artifact must be written");
    assert.deepEqual(r.snapshot.repos.map((x) => x.slug).sort(), [docs.slug, "testorg-plain"].sort());
  }
});

test("a second clone of a published repository whose name extends the listed name with a hyphen does not stop the snapshot", () => {
  // The reproduction of #83: the cases above, with a second, older clone of
  // the published repository in the directory vault-docs-wt. The one-card rule
  // publishes the clone in the directory named vault-docs and leaves out
  // vault-docs-wt, whose slug and directory name carry the word vault, and in
  // the second case the listed slug testorg-vault as well. The listed clone is
  // one GitHub answered for, so the published repository is another
  // repository than the listed one.
  for (const [listed, docs] of [
    [{ ...VAULTS[0], visibility: "private" }, VAULT_DOCS],
    [VAULTS[0], { ...VAULT_DOCS, slug: "testorg-vault-docs", owner: "testorg" }],
  ] as const) {
    const wt: Clone = {
      ...docs,
      slug: `${docs.slug}-wt`,
      name: "vault-docs-wt",
      lastCommitAt: "2026-01-05T00:00:00.000Z",
    };
    const r = runGate({
      sensitiveRepos: ["testorg-vault"],
      publicOwners: ["testorg", "otherorg"],
      clones: [listed, docs, wt, PLAIN],
    });
    assert.equal(r.status, 0, `the gate must write the snapshot with ${wt.slug}; got:\n${r.out}`);
    assert.ok(r.snapshot, "the artifact must be written");
    assert.deepEqual(r.snapshot.repos.map((x) => x.slug).sort(), [docs.slug, "testorg-plain"].sort());
    assert.doesNotMatch(
      JSON.stringify(r.snapshot),
      /vault-docs-wt/i,
      "the second clone's slug and directory name may not be written to the artifact"
    );
  }
});

test("the gate refuses a second clone of a published repository that carries the listed name when GitHub did not answer for the listed clone", () => {
  // Without GitHub's answer the listed clone keeps the owner and name of its
  // remote, which a transfer and a rename leave out of date, so
  // otherorg/vault-docs can be the listed repository, and the second clone in
  // the directory vault-docs-wt is still read for the listed name.
  const r = runGate({
    sensitiveRepos: ["testorg-vault"],
    publicOwners: ["testorg", "otherorg"],
    clones: [
      { ...VAULTS[0], visibility: "unknown" },
      VAULT_DOCS,
      { ...VAULT_DOCS, slug: "otherorg-vault-docs-wt", name: "vault-docs-wt", lastCommitAt: "2026-01-05T00:00:00.000Z" },
      PLAIN,
    ],
  });
  assert.equal(r.status, 1, `the gate must refuse; got:\n${r.out}`);
  assert.equal(r.snapshot, null, "no artifact may be written");
  assert.match(
    r.out,
    /sensitive repo identifier "vault" names "otherorg-vault-docs-wt", a clone of the published repository "otherorg-vault-docs"/
  );
});

test("the gate refuses the listed name, alone or extended with a hyphen, in a token no published card carries", () => {
  // sanitizeCard redacts a card's subject, claim and detail, not its id, so the
  // id reaches the artifact as written. vault names the listed repository, and
  // vault-secrets is none of the published card's identifiers.
  for (const id of ["tooling:vault", "tooling:vault-secrets"]) {
    const r = runGate({
      sensitiveRepos: ["testorg-vault"],
      publicOwners: ["testorg", "otherorg"],
      clones: [{ ...VAULTS[0], visibility: "private" }, VAULT_DOCS, PLAIN],
      cards: [{ id, repoSlug: "testorg-plain", subject: "plain fact", claim: "a fact recorded on plain" }],
    });
    assert.equal(r.status, 1, `the gate must refuse the card id "${id}"; got:\n${r.out}`);
    assert.equal(r.snapshot, null, "no artifact may be written");
    assert.match(r.out, /sensitive repo identifier "vault" present in snapshot text/);
  }
});

test("the gate refuses a published name that extends the listed name when it can name the listed repository", () => {
  // First, GitHub did not answer for the listed clone, which keeps the owner
  // and name of its remote, so otherorg/vault-docs can be the listed repository
  // after a transfer and a rename. Then the listed clone's repository is
  // testorg/vault-docs on GitHub, as after a rename, so vault-docs is also the
  // listed repository's own name.
  for (const listed of [
    { ...VAULTS[0], visibility: "unknown" },
    { ...VAULTS[0], repoName: "vault-docs", visibility: "private" },
  ]) {
    const r = runGate({
      sensitiveRepos: ["testorg-vault"],
      publicOwners: ["testorg", "otherorg"],
      clones: [listed, VAULT_DOCS, PLAIN],
    });
    assert.equal(r.status, 1, `the gate must refuse; got:\n${r.out}`);
    assert.equal(r.snapshot, null, "no artifact may be written");
    assert.match(r.out, /sensitive repo identifier "vault" present in snapshot text/);
  }
});

test("the snapshot keeps a published name that extends the listed name whole in the published card's activity", () => {
  // The reproduction of #79 with commits as the scan writes them. The listed
  // name vault is redacted as a word, and \b treats '-' as a boundary, so it is
  // also found inside vault-docs: the published card's own name, and the
  // directory name the scan writes into the meta of each of its commits. A
  // marker there, [private]-docs beside the card's name vault-docs, would spell
  // out the listed name. The listed name on its own is still redacted.
  const r = runGate({
    sensitiveRepos: ["testorg-vault"],
    publicOwners: ["testorg", "otherorg"],
    clones: [{ ...VAULTS[0], visibility: "private" }, VAULT_DOCS, PLAIN],
    commits: [
      { repoSlug: VAULT_DOCS.slug, sha: "09c9d45d", title: "docs: build the vault-docs site" },
      { repoSlug: VAULT_DOCS.slug, sha: "1a2b3c4d", title: "docs: move the notes out of vault" },
    ],
  });
  assert.equal(r.status, 0, `the gate must write the snapshot; got:\n${r.out}`);
  assert.ok(r.snapshot, "the artifact must be written");
  assert.doesNotMatch(
    JSON.stringify(r.snapshot),
    /[\w-]\[private\]|\[private\][\w-]/,
    "no [private] marker may be joined to the rest of a token"
  );
  const events = new Map(
    r.snapshot.activity.filter((e) => e.repoSlug === VAULT_DOCS.slug).map((e) => [e.title, e.meta])
  );
  assert.equal(
    events.get("docs: build the vault-docs site"),
    JSON.stringify({ sha: "09c9d45d", repo: "vault-docs" })
  );
  assert.equal(
    events.get("docs: move the notes out of [private]"),
    JSON.stringify({ sha: "1a2b3c4d", repo: "vault-docs" })
  );
});

test("the snapshot still redacts the listed name inside a token no published card carries", () => {
  // vault-secrets is none of the published card's identifiers.
  const r = runGate({
    sensitiveRepos: ["testorg-vault"],
    publicOwners: ["testorg", "otherorg"],
    clones: [{ ...VAULTS[0], visibility: "private" }, VAULT_DOCS, PLAIN],
    commits: [{ repoSlug: VAULT_DOCS.slug, sha: "5e6f7a8b", title: "chore: rotate vault-secrets" }],
  });
  assert.equal(r.status, 0, `the gate must write the snapshot; got:\n${r.out}`);
  assert.ok(r.snapshot, "the artifact must be written");
  const title = r.snapshot.activity.find(
    (e) => e.repoSlug === VAULT_DOCS.slug && e.title.startsWith("chore: rotate ")
  )?.title;
  assert.ok(title !== undefined, "the commit must be published under its card");
  assert.match(title, /\[private\]/);
  assert.doesNotMatch(JSON.stringify(r.snapshot), /vault-secrets/i);
});

test("the snapshot replaces the whole token when free text extends a published name with the listed name in it", () => {
  // A version, a branch, a package or a command named after the published
  // repository vault-docs is a longer token, none of the published card's
  // identifiers, so the listed name in it is redacted. A marker for the word
  // vault alone, [private]-docs-v2 beside the card's name vault-docs, would
  // spell out the listed name, so the whole token is replaced, once also when
  // it holds the listed name twice. The published name itself, in any letter
  // case, is left as written.
  const r = runGate({
    sensitiveRepos: ["testorg-vault"],
    publicOwners: ["testorg", "otherorg"],
    clones: [{ ...VAULTS[0], visibility: "private" }, VAULT_DOCS, PLAIN],
    commits: [
      { repoSlug: VAULT_DOCS.slug, sha: "2b3c4d5e", title: "release vault-docs-v2" },
      { repoSlug: VAULT_DOCS.slug, sha: "3c4d5e6f", title: "Merge branch 'feature/vault-docs-search'" },
      { repoSlug: VAULT_DOCS.slug, sha: "4d5e6f7a", title: "bump new-vault-docs preview" },
      { repoSlug: VAULT_DOCS.slug, sha: "5e6f7a8c", title: "theme package vault-docs_theme for the site" },
      { repoSlug: VAULT_DOCS.slug, sha: "6f7a8b9c", title: "vault-docs-cli builds the Vault-Docs site" },
      { repoSlug: VAULT_DOCS.slug, sha: "7a8b9c0d", title: "drop vault-vault-docs" },
    ],
  });
  assert.equal(r.status, 0, `the gate must write the snapshot; got:\n${r.out}`);
  assert.ok(r.snapshot, "the artifact must be written");
  assert.doesNotMatch(
    JSON.stringify(r.snapshot),
    /[\w-]\[private\]|\[private\][\w-]/,
    "no [private] marker may be joined to the rest of a token"
  );
  assert.deepEqual(
    r.snapshot.activity
      .filter((e) => e.repoSlug === VAULT_DOCS.slug)
      .map((e) => e.title)
      .sort(),
    [
      "a commit in vault-docs",
      "release [private]",
      "Merge branch 'feature/[private]'",
      "bump [private] preview",
      "theme package [private] for the site",
      "[private] builds the Vault-Docs site",
      "drop [private]",
    ].sort()
  );
});

test("a published repository whose name extends the listed name is kept where it starts a line or follows a tab", () => {
  // The reproduction of #85. The generator reads a newline or a tab as the end
  // of a token, so it keeps my-vault, the published card's own name, as
  // written. The gate reads the JSON text, where they are written \n and \t;
  // it read the escape letter as part of the token after it, nmy-vault and
  // tmy-vault, which no published card carries, and refused the snapshot.
  const myVault: Clone = {
    slug: "otherorg-my-vault",
    name: "my-vault",
    repoName: "my-vault",
    owner: "otherorg",
    lastCommitAt: "2026-01-20T00:00:00.000Z",
  };
  const r = runGate({
    sensitiveRepos: ["testorg-vault"],
    publicOwners: ["testorg", "otherorg"],
    clones: [{ ...VAULTS[0], visibility: "private" }, myVault, PLAIN],
    commits: [{ repoSlug: myVault.slug, sha: "8b9c0d1e", title: "publish:\tmy-vault weekly" }],
    summaries: { [myVault.slug]: "Overview.\nmy-vault holds the docs." },
  });
  assert.equal(r.status, 0, `the gate must write the snapshot; got:\n${r.out}`);
  assert.ok(r.snapshot, "the artifact must be written");
  assert.equal(r.snapshot.summaries[myVault.slug], "Overview.\nmy-vault holds the docs.");
  assert.ok(
    r.snapshot.activity.some((e) => e.repoSlug === myVault.slug && e.title === "publish:\tmy-vault weekly"),
    "the commit title must be published as written"
  );
});

test("the gate's listed-identifier check reads each word match as the whole token around it", async () => {
  const { listedIdentifierLeak } = await import("@/lib/snapshot");
  const cleared = new Set(["vault-docs", "otherorg-vault-docs"]);
  // Only inside cleared tokens, in any letter case.
  assert.equal(listedIdentifierLeak("vault", '{"name":"vault-docs","slug":"otherorg-vault-docs"}', cleared), null);
  assert.equal(listedIdentifierLeak("vault", "see Vault-Docs", cleared), null);
  // The identifier itself, and longer tokens that are not cleared.
  assert.equal(listedIdentifierLeak("vault", "vault-docs, then the vault", cleared), "vault");
  assert.equal(listedIdentifierLeak("vault", "vault-docs and vault-secrets", cleared), "vault-secrets");
  assert.equal(listedIdentifierLeak("vault", "commit-otherorg-vault-docs", cleared), "commit-otherorg-vault-docs");
  assert.equal(
    listedIdentifierLeak("testorg/vault", "mirrors https://github.com/TestOrg/Vault.git", cleared),
    "TestOrg/Vault"
  );
  // No word match, as with a plain \b test.
  assert.equal(listedIdentifierLeak("vault", "vaults, myvault and vault_docs", cleared), null);
  // An empty set counts every word match.
  assert.equal(listedIdentifierLeak("vault", "vault-docs", new Set()), "vault-docs");
  // The text is JSON text: an escape sequence is read as the character it
  // stands for, so a newline, a tab or a control character before a token is
  // not part of it, and a word match right after one is found.
  const json = (s: string): string => JSON.stringify({ text: s });
  const myVault = new Set(["my-vault"]);
  assert.equal(listedIdentifierLeak("vault", json("Overview.\nmy-vault\tmy-vault"), myVault), null);
  assert.equal(listedIdentifierLeak("vault", json("a\u0001my-vault"), myVault), null);
  assert.equal(listedIdentifierLeak("vault", json("Overview.\nvault holds it"), myVault), "vault");
  assert.equal(listedIdentifierLeak("vault", json("Overview.\tvault-secrets"), myVault), "vault-secrets");
  // An escaped backslash is one character, and the letter after it is the
  // first letter of the next token.
  assert.equal(listedIdentifierLeak("vault", json("C:\\nmy-vault"), myVault), "nmy-vault");
});
