import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";
import path from "node:path";
import {
  generatePublicSnapshot,
  distinctiveTokens,
  hiddenNameLeak,
  listedIdentifierLeak,
  sensitiveRepoClones,
  snapshotPath,
} from "@/lib/snapshot";
import { loadConfig } from "@/lib/config";
import { dbPath } from "@/lib/paths";
import { slug } from "@/lib/context/store";
import { DEFAULT_PUBLIC_USAGE_PROJECTS, publicFeatureKey } from "@/lib/usage/catalog-meta";

/** Anything that looks like an absolute or home-relative filesystem path. One
 *  definition, used by every per-field check below, so a path shape can never
 *  be caught in one section and missed in another. */
const pathish = /(?:\/(?:Users|home|root|var|tmp|private|opt|mnt)\/|~\/|\\\\)/;

/**
 * Generate the public snapshot, then ADVERSARIALLY verify it leaks nothing:
 *  - no home directory / username strings
 *  - no private or fork repo names
 *  - no absolute filesystem paths
 * Aborts (non-zero exit, no file written) if any check fails.
 */
function main() {
  const snapshot = generatePublicSnapshot();
  const json = JSON.stringify(snapshot, null, 2);

  const violations: string[] = [];

  // 1) Home dir + username must not appear ANYWHERE (path, owner, URL, text).
  const home = os.homedir();
  const username = path.basename(home);
  if (json.includes(home)) violations.push(`home directory path "${home}" present`);
  if (new RegExp(`\\b${username}\\b`).test(json))
    violations.push(`system username "${username}" present (check repo owners/URLs)`);

  // 2) No private/fork repo names anywhere (incl. bare references in commit
  //    messages, descriptions, AI summaries). FAIL CLOSED if the DB is absent.
  // Was path.join(process.cwd(), "data", "atlas.db"): the gate opened a
  // DIFFERENT database from the one lib/snapshot just read whenever
  // ATLAS_DATA_DIR was set, so it could verify the wrong data and pass.
  const gateDbPath = dbPath();
  if (!fs.existsSync(gateDbPath)) {
    violations.push(
      "source database not found — cannot verify private repo names are absent (fail-closed)"
    );
  } else {
    const db = new Database(gateDbPath, { readonly: true });
    const hidden = db
      .prepare("SELECT name FROM repos WHERE visibility != 'public' OR isFork = 1")
      .all() as { name: string }[];
    db.close();
    // Every identifier this snapshot publishes on purpose. Compared against the
    // WHOLE token a hidden name is found inside, below.
    const publicIdentifiers = new Set(
      snapshot.repos
        .flatMap((r) => [r.name, r.slug, r.repoName])
        .filter((s): s is string => !!s)
        .map((s) => s.toLowerCase())
    );
    // Published repo NAMES only — deliberately not slugs or repoNames. A hidden
    // repo whose name is literally a published repo's name (a fork, or two repos
    // of the same name in different orgs) is already disclosed by that published
    // name, so tokens extending it reveal nothing further, and checking it would
    // deadlock the publish with no configuration remedy.
    //
    // Widening THIS set is what created a gate bypass: with slugs and repoNames
    // in it, a private `secretless-ai` was exempted wholesale merely because an
    // unrelated public repo carried `repoName: "secretless-ai"`, and every token
    // containing that private name published freely. The wider set is still used
    // below for per-TOKEN clearing, which is safe because each of its members is
    // serialized into the artifact verbatim anyway.
    const publishedNames = new Set(snapshot.repos.map((r) => r.name.toLowerCase()));
    for (const h of hidden) {
      if (publishedNames.has(h.name.toLowerCase())) continue;
      // Only flag DISTINCTIVE names. Generic single words ("test", "registry")
      // collide with normal commit-message English and reveal no private repo;
      // compound/namespaced or long names ("aim-roadmap") are the real signal.
      const distinctive = h.name.length >= 5 && (h.name.length >= 12 || /[-_]/.test(h.name));
      if (!distinctive) continue;
      const leaked = hiddenNameLeak(h.name, json, publicIdentifiers);
      if (leaked !== null)
        violations.push(
          `hidden repo name "${h.name}" referenced in snapshot text (as "${leaked}")`
        );
    }
  }

  // 3) No absolute unix paths anywhere (common home + system roots).
  if (/\/(?:Users|home|root)\/[\w.-]+/.test(json))
    violations.push("absolute filesystem path present");

  // 4) No credential-like tokens (GitHub PAT, AWS key, OpenAI/Anthropic key,
  //    Slack token, private-key header) anywhere in the snapshot text.
  const tokenPatterns: [string, RegExp][] = [
    ["GitHub token", /gh[posru]_[A-Za-z0-9]{20,}/],
    ["GitHub PAT", /github_pat_[A-Za-z0-9_]{20,}/],
    ["AWS access key", /AKIA[0-9A-Z]{16}/],
    ["OpenAI/Anthropic key", /sk-[A-Za-z0-9-]{20,}/],
    ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
    ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ];
  for (const [label, re] of tokenPatterns) {
    if (re.test(json)) violations.push(`possible ${label} present`);
  }

  // 5) Context cards: only PUBLIC cards, and never their guts (source paths,
  //    verify commands, drift paths, origin session). These would leak machine
  //    layout and internal commands even though the claim itself is public.
  for (const c of snapshot.contextCards) {
    if (c.visibility !== "public")
      violations.push(`non-public context card "${c.id}" present in snapshot`);
    if (c.sensitive)
      violations.push(`SENSITIVE context card "${c.id}" present in snapshot`);
    if (c.provenance.length > 0)
      violations.push(`context card "${c.id}" leaked provenance paths`);
    if (c.verifyCommand)
      violations.push(`context card "${c.id}" leaked a verify command`);
    if (c.driftedPaths.length > 0)
      violations.push(`context card "${c.id}" leaked drifted paths`);
    if (c.originSessionId)
      violations.push(`context card "${c.id}" leaked an origin session id`);
  }

  // 6) Published metrics must describe ONLY the public cards — never disclose
  //    the count or freshness of private cards. Fail closed on any mismatch.
  const m = snapshot.contextMetrics;
  const freshnessSum = Object.values(m.freshness).reduce((a, b) => a + b, 0);
  if (m.totalCards !== snapshot.contextCards.length)
    violations.push(
      `contextMetrics.totalCards (${m.totalCards}) != public card count (${snapshot.contextCards.length}) — leaks private card count`
    );
  if (freshnessSum !== snapshot.contextCards.length)
    violations.push(
      `contextMetrics freshness sum (${freshnessSum}) != public card count (${snapshot.contextCards.length}) — leaks private card freshness`
    );
  if (m.reads !== 0)
    violations.push(`contextMetrics.reads (${m.reads}) should be 0 publicly (owner usage)`);

  // 7) SENSITIVE content must NEVER appear — a hard never-publish that holds
  //    even for GitHub-public repos. Re-derive the sensitive set independently
  //    of lib/snapshot (defense in depth) and fail closed if anything leaks:
  //    a sensitive repo (by slug or name), a sensitive card (by id or its
  //    distinctive claim/subject text), or any sensitive repo in snapshot.repos.
  // loadConfig has already canonicalized these to slug form.
  const sensitiveSlugs = loadConfig().sensitiveRepos;
  const sensitiveSlugSet = new Set(sensitiveSlugs);
  if (sensitiveSlugs.length > 0) {
    if (!fs.existsSync(gateDbPath)) {
      violations.push(
        "source database not found — cannot verify sensitive content is absent (fail-closed)"
      );
    } else {
      const db = new Database(gateDbPath, { readonly: true });
      // Fail closed (don't crash) if the DB predates the sensitive column: the
      // flag-based exclusion can't be trusted, so abort the snapshot.
      const hasSensitiveCol = (
        db.prepare("PRAGMA table_info(context_cards)").all() as { name: string }[]
      ).some((c) => c.name === "sensitive");
      if (!hasSensitiveCol) {
        violations.push(
          "context_cards predates the `sensitive` column — run `npm run setup-db` to migrate (fail-closed)"
        );
        db.close();
      } else {
        const sensitiveRepoRows = db
          .prepare(
            `SELECT slug, name, owner, repoName, visibility FROM repos WHERE slug IN (${sensitiveSlugs
              .map(() => "?")
              .join(",")})`
          )
          .all(...sensitiveSlugs) as {
          slug: string;
          name: string;
          owner: string | null;
          repoName: string | null;
          visibility: string | null;
        }[];
        // Every clone of a listed repository (each row with the owner and
        // repoName, in lower case, of a listed row) withholds the cards on it,
        // as the listed slug does. Mirrors lib/snapshot.
        const repoKey = (owner: string, repoName: string): string =>
          JSON.stringify([owner.toLowerCase(), repoName.toLowerCase()]);
        const keyedRows = db
          .prepare(
            "SELECT slug, name, owner, repoName FROM repos WHERE owner IS NOT NULL AND repoName IS NOT NULL"
          )
          .all() as { slug: string; name: string; owner: string; repoName: string }[];
        const listedKeys = new Set(
          sensitiveRepoRows.flatMap((r) =>
            r.owner === null || r.repoName === null ? [] : [repoKey(r.owner, r.repoName)]
          )
        );
        const withheldSlugSet = new Set([
          ...sensitiveSlugSet,
          ...keyedRows
            .filter((r) => listedKeys.has(repoKey(r.owner, r.repoName)))
            .map((r) => slug(r.slug)),
        ]);
        // All active cards that are sensitive: flagged, under a sensitive repo
        // in any of its clones, or whose project maps to one of their slugs.
        // Mirrors lib/snapshot.
        const sensitiveCards = (
          db
            .prepare(
              "SELECT id, subject, claim, detail, project, repoSlug, sensitive FROM context_cards WHERE status='active'"
            )
            .all() as {
            id: string;
            subject: string;
            claim: string;
            detail: string | null;
            project: string;
            repoSlug: string | null;
            sensitive: number;
          }[]
        ).filter(
          (c) =>
            c.sensitive === 1 ||
            (c.repoSlug && withheldSlugSet.has(slug(c.repoSlug))) ||
            withheldSlugSet.has(slug(c.project))
        );
        db.close();

        const publicSlugSet = new Set(snapshot.repos.map((r) => r.slug));
        // The identifiers of a listed row looked for as words below: its slug,
        // and its directory name unless a published card carries that name, in
        // any letter case, as its own name, as when another owner's repository
        // of the same name sits in the directory named after it. That name is in
        // the artifact as the published repository's, so refusing it would stop
        // every snapshot while both settings stand; check 2 skips such a hidden
        // name for the same reason. In its place the row's owner and repoName
        // are looked for, written owner/repoName as in a GitHub URL. No published
        // field carries that pair (the remote URL is not published), and
        // lib/snapshot does not redact it, as it redacts no name a published card
        // carries, so this check is the one that refuses free text naming the
        // listed repository by its owner and repoName. The name is skipped only
        // for a row GitHub answered for (visibility public or private), whose
        // owner and repoName are then GitHub's: lib/snapshot withholds every row
        // with them in any letter case, and the owner and repoName check below
        // refuses a published card with them. A row GitHub did not answer for
        // keeps the owner and name of its remote, which a transfer leaves out of
        // date, so the published repository of the same name can be the listed
        // one, and the name is still refused. So is the name of a row whose clone
        // sits in a directory named otherwise than its repoName, as after a
        // rename on GitHub: a published card that carries the directory name
        // need not carry that repoName, and neither the redaction in lib/snapshot
        // nor the text checks here look for a bare repoName, so skipping the name
        // would let free text name the listed repository by its GitHub name.
        const publishedNames = new Set(snapshot.repos.map((r) => r.name.toLowerCase()));
        // Whether GitHub answered for a listed row during the scan (visibility
        // public or private), so that its owner and repoName are GitHub's and
        // not its remote's (applyEnrichment in lib/scanners/repos.ts).
        type ListedRow = (typeof sensitiveRepoRows)[number];
        const answered = (r: ListedRow): r is ListedRow & { owner: string; repoName: string } =>
          r.owner !== null &&
          r.repoName !== null &&
          (r.visibility === "public" || r.visibility === "private");
        const listedTokens = (r: ListedRow): string[] =>
          answered(r) &&
          r.repoName.toLowerCase() === r.name.toLowerCase() &&
          publishedNames.has(r.name.toLowerCase())
            ? [r.slug, `${r.owner}/${r.repoName}`]
            : [r.slug, r.name];
        // A word match also finds a listed identifier inside a longer token,
        // since `\b` treats `-` as a boundary: vault inside vault-docs. Such a
        // token is not counted when it is the name, slug or repoName of a
        // published card (the identifiers check 2 clears tokens against) and
        // not the listed row's own slug, name or repoName, and only for a row
        // GitHub answered for. That row's owner and repoName are GitHub's, and
        // lib/snapshot withholds, and the check below refuses, every card with
        // them, so a published card is another repository. A row GitHub did
        // not answer for keeps the owner and name of its remote, which a
        // transfer or a rename leaves out of date, so a published card whose
        // name extends the listed name can be the listed repository in another
        // directory, and every word match of its identifiers still counts.
        const publishedIdentifiers = new Set(
          snapshot.repos
            .flatMap((p) => [p.name, p.slug, p.repoName])
            .filter((s): s is string => !!s)
            .map((s) => s.toLowerCase())
        );
        const clearedFor = (r: ListedRow): Set<string> => {
          if (!answered(r)) return new Set();
          const own = new Set([r.slug, r.name, r.repoName].map((s) => s.toLowerCase()));
          return new Set([...publishedIdentifiers].filter((s) => !own.has(s)));
        };
        for (const r of sensitiveRepoRows) {
          if (publicSlugSet.has(r.slug))
            violations.push(`sensitive repo "${r.slug}" present in snapshot.repos`);
          const cleared = clearedFor(r);
          for (const token of listedTokens(r)) {
            if (!token) continue;
            if (listedIdentifierLeak(token, json, cleared) !== null)
              violations.push(`sensitive repo identifier "${token}" present in snapshot text`);
          }
        }
        // The checks above look for the listed clone's own identifiers. Another
        // clone of the same GitHub repository has a slug and directory name of
        // its own, so also refuse any published card with the owner and repoName
        // of a listed row.
        for (const [listed, clone] of sensitiveRepoClones(sensitiveRepoRows, snapshot.repos))
          violations.push(
            `sensitive repo "${listed}" present in snapshot.repos through the clone "${clone}"`
          );
        // The one-card rule publishes one clone of each GitHub repository and
        // leaves the others out of the text checked above. When a listed row's
        // owner or repoName is unknown, or out of date after a transfer or a
        // rename, no published card has them, and the only rows that carry a
        // listed slug or name can be clones the rule left out. So for each
        // listed row GitHub did not answer for, look for the identifiers
        // listedTokens gives, as words, in the slug and directory name of every
        // clone of a published repository that is not itself published.
        //
        // A listed row GitHub answered for is left out of this check. Its owner
        // and repoName are GitHub's, lib/snapshot withholds every row with them,
        // and the check above refuses a published card with them, so the
        // published repository a clone belongs to is another repository, and a
        // word match in that clone's slug or directory name does not name the
        // listed one. `\b` treats `-` as a boundary, so with testorg/vault
        // listed, vault is found inside vault-docs-wt, the directory of a
        // second clone of the published otherorg/vault-docs. The text checks
        // above still look for that row's identifiers.
        const publishedByKey = new Map<string, string>();
        for (const r of snapshot.repos)
          if (r.owner !== null && r.repoName !== null)
            publishedByKey.set(repoKey(r.owner, r.repoName), r.slug);
        for (const row of keyedRows) {
          const published = publishedByKey.get(repoKey(row.owner, row.repoName));
          if (published === undefined || publicSlugSet.has(row.slug)) continue;
          for (const listedRow of sensitiveRepoRows) {
            if (answered(listedRow)) continue;
            for (const token of listedTokens(listedRow)) {
              if (!token) continue;
              const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const word = new RegExp(`\\b${esc}\\b`, "i");
              if (word.test(row.slug) || word.test(row.name))
                violations.push(
                  `sensitive repo identifier "${token}" names "${row.slug}", a clone of the published repository "${published}"`
                );
            }
          }
        }
        // A sensitive card must not appear by id, nor have its text surface via
        // any other card — both the whole trimmed claim/subject AND its
        // distinctive tokens (so a short secret like `prod-db-pw` quoted inside
        // a public card is still caught, not just long verbatim claims).
        //
        // A distinctive token that is, in lower case, the name of a published
        // repo card is not looked for, and neither is a subject or claim that
        // is, trimmed and in lower case, such a name. The artifact carries that
        // name as the repo card's own, and lib/snapshot leaves it as written:
        // it does not redact a sensitive token spelled as a published name, and
        // in free text it keeps a token that is a published repo card's name,
        // slug or repoName in any letter case. Looking for it would stop every
        // snapshot while the sensitive card exists; check 2 skips a hidden name
        // that is a published name for the same reason. Only names are skipped,
        // as only names are left out of the sensitive tokens lib/snapshot
        // redacts: a token that is a published slug or repoName and no
        // published name is still looked for, as are the sensitive card's other
        // tokens, and a subject or claim that holds a published name among
        // other words is still looked for whole. In the loop below, the checks
        // of its id make no such exception.
        const publicCardIds = new Set(snapshot.contextCards.map((c) => c.id));
        for (const c of sensitiveCards) {
          if (publicCardIds.has(c.id))
            violations.push(`sensitive context card "${c.id}" present in snapshot`);
          if (json.includes(c.id))
            violations.push(`sensitive context card id "${c.id}" referenced in snapshot text`);
          for (const text of [c.subject, c.claim]) {
            const t = (text ?? "").trim();
            if (publishedNames.has(t.toLowerCase())) continue;
            if (t.length >= 12 && json.includes(t))
              violations.push(`sensitive card text from "${c.id}" present in snapshot`);
          }
          for (const tok of [
            ...distinctiveTokens(c.subject),
            ...distinctiveTokens(c.claim),
            ...distinctiveTokens(c.detail),
          ]) {
            if (publishedNames.has(tok.toLowerCase())) continue;
            const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            if (new RegExp(`\\b${esc}\\b`, "i").test(json))
              violations.push(
                `distinctive sensitive token "${tok}" (from card "${c.id}") present in snapshot text`
              );
          }
        }
        // Also catch a card under a sensitive repo by slug/project that wasn't
        // itself flagged sensitive (must still have been dropped upstream).
        for (const c of snapshot.contextCards) {
          if (
            (c.repoSlug && sensitiveSlugSet.has(slug(c.repoSlug))) ||
            sensitiveSlugSet.has(slug(c.project))
          )
            violations.push(`card "${c.id}" under a sensitive repo present in snapshot`);
        }
      }
    }
  }

  // 8) Feature usage: the public rollup must carry AGGREGATES ONLY. Owner-only
  //    fields (cwd, gitBranch, paramKeys, raw recentEvents) must be absent by
  //    construction, project attribution must stay within the allowlist, and no
  //    tool-use id or path separator may ride along inside a feature name.
  const usage = snapshot.usage;
  if (!usage) {
    violations.push("usage rollup missing from snapshot (fail-closed)");
  } else {
    if (usage.recentEvents !== undefined)
      violations.push("usage.recentEvents present — owner-only raw events leaked");
    const uj = JSON.stringify(usage);
    for (const field of ["cwd", "gitBranch", "paramKeys"]) {
      if (uj.includes(`"${field}"`))
        violations.push(`usage rollup leaked owner-only field "${field}"`);
    }
    if (/toolu_[A-Za-z0-9]+/.test(uj))
      violations.push("usage rollup leaked a tool-use id");
    // Shape guard (don't rely on a bare throw to stay fail-closed): if the
    // rollup is malformed, record a violation instead of crashing past the loops.
    if (!Array.isArray(usage.projects) || !Array.isArray(usage.features)) {
      violations.push("usage rollup malformed — projects/features are not arrays");
    } else {
      const cfg = loadConfig().publicUsageProjects;
      const allowedProjects = new Set([
        ...(cfg.length ? cfg : DEFAULT_PUBLIC_USAGE_PROJECTS),
        "other",
      ]);
      for (const p of usage.projects) {
        if (!allowedProjects.has(p.project))
          violations.push(`usage project "${p.project}" not in the public allowlist`);
      }
      // A leaked filesystem path — NOT the legitimate "/" in a slash-command key
      // like "command:/clear". Genuine path markers only (home/system roots, "~/").
      for (const f of usage.features) {
        if (pathish.test(f.feature) || pathish.test(f.displayName))
          violations.push(`usage feature "${f.feature}" contains a filesystem path`);
        // Every published feature key must be allowlist-clean: a user-authored
        // skill/workflow/command/mcp/agent name that isn't on the known-safe list
        // could embed a private client/project name. publicFeatureKey is
        // idempotent on clean keys, so any inequality means a name slipped through.
        if (publicFeatureKey(f.feature) !== f.feature)
          violations.push(
            `usage feature "${f.feature}" is not allowlist-clean — possible private name leak`
          );
      }
      // Routines: every step token must be allowlist-clean (same rule as feature
      // keys — a routine could otherwise carry a private skill/workflow/command
      // name), and the generated scaffold text must contain no filesystem path.
      if (!Array.isArray(usage.routines)) {
        violations.push("usage rollup malformed — routines is not an array");
      } else {
        for (const r of usage.routines) {
          for (const step of r.steps) {
            if (publicFeatureKey(step) !== step)
              violations.push(`routine step "${step}" is not allowlist-clean`);
          }
          if (pathish.test(r.scaffold))
            violations.push("routine scaffold contains a filesystem path");
        }
      }
    }
  }

  // 9) Freshness block. Two separate failures are checked here, and the FIRST is
  //    a fail-closed publish gate rather than a leak check: an artifact without
  //    per-section ages cannot be read honestly (the reader has nothing to show
  //    but the build time, which is the defect this block exists to remove), so
  //    it must not be publishable at all.
  const freshness = snapshot.freshness;
  if (!freshness || typeof freshness !== "object") {
    violations.push("freshness block missing from snapshot (fail-closed)");
  } else {
    for (const required of ["repos", "activity", "usage", "context"]) {
      if (!freshness[required])
        violations.push(`freshness section "${required}" missing`);
    }
    // Owner-only sections must not appear even as an empty shell: their mere
    // presence would disclose that private todos/sessions exist and when they
    // were last touched.
    for (const ownerOnly of ["todos", "decisions", "sessions", "sessionBoard", "roadmap", "strategy", "tokens"]) {
      if (freshness[ownerOnly])
        violations.push(`freshness leaked owner-only section "${ownerOnly}"`);
    }
  }
  // Owner-only top-level sections must be absent from the public artifact
  // outright — including the refused-card list, which names files in a
  // private todo tree.
  for (const ownerOnly of ["todos", "decisions", "decisionSkips", "sessions", "sessionBoard", "roadmap", "strategy", "tokens"]) {
    if (ownerOnly in (snapshot as unknown as Record<string, unknown>))
      violations.push(`owner-only section "${ownerOnly}" present in public snapshot`);
  }
  {
    for (const [name, f] of Object.entries(freshness)) {
      if (f.builtAt !== snapshot.generatedAt)
        violations.push(
          `freshness section "${name}" builtAt disagrees with snapshot generatedAt`
        );
      // Collector notes quote what they were reading; the sanitizer strips paths
      // and check 3 greps the whole document, but assert per-field so a failure
      // names the section instead of the whole file.
      if (f.note && pathish.test(f.note))
        violations.push(`freshness note for "${name}" contains a filesystem path`);
    }
  }

  if (violations.length > 0) {
    console.error("atlas: SNAPSHOT ABORTED — sanitization failed:");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  fs.writeFileSync(snapshotPath(), json);
  const usageFresh = snapshot.freshness?.usage;
  console.log(
    `atlas: public snapshot written (${snapshot.repos.length} public repos, ${snapshot.activity.length} events, ${Object.keys(snapshot.summaries).length} summaries, ${snapshot.contextCards.length} public context cards). Sanitization checks passed.`
  );
  // Print the age of what was just published. A build that silently republishes
  // week-old mining output should say so at the moment it happens, not only on
  // the page nobody reloads.
  console.log(
    `atlas: usage data collected ${usageFresh?.collectedAt ?? "never"}, newest event ${usageFresh?.dataAt ?? "none"} (status: ${usageFresh?.status ?? "unknown"})`
  );
}

main();
