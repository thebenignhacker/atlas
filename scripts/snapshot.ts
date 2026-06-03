import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";
import path from "node:path";
import { generatePublicSnapshot, SNAPSHOT_PATH } from "@/lib/snapshot";
import { loadConfig } from "@/lib/config";
import { slug } from "@/lib/context/store";

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
  const dbPath = path.join(process.cwd(), "data", "atlas.db");
  if (!fs.existsSync(dbPath)) {
    violations.push(
      "source database not found — cannot verify private repo names are absent (fail-closed)"
    );
  } else {
    const db = new Database(dbPath, { readonly: true });
    const hidden = db
      .prepare("SELECT name FROM repos WHERE visibility != 'public' OR isFork = 1")
      .all() as { name: string }[];
    db.close();
    const publicNames = new Set(snapshot.repos.map((r) => r.name));
    for (const h of hidden) {
      if (publicNames.has(h.name)) continue; // name also belongs to a public repo
      // Only flag DISTINCTIVE names. Generic single words ("test", "registry")
      // collide with normal commit-message English and reveal no private repo;
      // compound/namespaced or long names ("aim-roadmap") are the real signal.
      const distinctive = h.name.length >= 5 && (h.name.length >= 12 || /[-_]/.test(h.name));
      if (!distinctive) continue;
      const esc = h.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${esc}\\b`, "i").test(json))
        violations.push(`hidden repo name "${h.name}" referenced in snapshot text`);
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
  const sensitiveSlugs = loadConfig().sensitiveRepos;
  if (sensitiveSlugs.length > 0) {
    if (!fs.existsSync(dbPath)) {
      violations.push(
        "source database not found — cannot verify sensitive content is absent (fail-closed)"
      );
    } else {
      const db = new Database(dbPath, { readonly: true });
      const sensitiveRepoRows = db
        .prepare(
          `SELECT slug, name FROM repos WHERE slug IN (${sensitiveSlugs
            .map(() => "?")
            .join(",")})`
        )
        .all(...sensitiveSlugs) as { slug: string; name: string }[];
      const sensitiveCards = db
        .prepare(
          "SELECT id, subject, claim, project, repoSlug FROM context_cards WHERE sensitive = 1"
        )
        .all() as {
        id: string;
        subject: string;
        claim: string;
        project: string;
        repoSlug: string | null;
      }[];
      db.close();

      const publicSlugSet = new Set(snapshot.repos.map((r) => r.slug));
      for (const r of sensitiveRepoRows) {
        if (publicSlugSet.has(r.slug))
          violations.push(`sensitive repo "${r.slug}" present in snapshot.repos`);
        for (const token of [r.slug, r.name]) {
          if (!token) continue;
          const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (new RegExp(`\\b${esc}\\b`, "i").test(json))
            violations.push(`sensitive repo identifier "${token}" present in snapshot text`);
        }
      }
      // A sensitive card must not appear by id, nor have its claim/subject text
      // surface via any other card. Distinctive substrings only (>=12 chars), to
      // avoid colliding with ordinary English shared across public claims.
      const publicCardIds = new Set(snapshot.contextCards.map((c) => c.id));
      for (const c of sensitiveCards) {
        if (publicCardIds.has(c.id))
          violations.push(`sensitive context card "${c.id}" present in snapshot`);
        if (json.includes(c.id))
          violations.push(`sensitive context card id "${c.id}" referenced in snapshot text`);
        for (const text of [c.subject, c.claim]) {
          const t = (text ?? "").trim();
          if (t.length >= 12 && json.includes(t))
            violations.push(`sensitive card text from "${c.id}" present in snapshot`);
        }
      }
      // Also catch a card under a sensitive repo by slug/project that wasn't
      // itself flagged sensitive (must still have been dropped upstream).
      const sensitiveSlugSet = new Set(sensitiveSlugs);
      for (const c of snapshot.contextCards) {
        if (
          (c.repoSlug && sensitiveSlugSet.has(c.repoSlug)) ||
          sensitiveSlugSet.has(slug(c.project))
        )
          violations.push(`card "${c.id}" under a sensitive repo present in snapshot`);
      }
    }
  }

  if (violations.length > 0) {
    console.error("atlas: SNAPSHOT ABORTED — sanitization failed:");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  fs.writeFileSync(SNAPSHOT_PATH, json);
  console.log(
    `atlas: public snapshot written (${snapshot.repos.length} public repos, ${snapshot.activity.length} events, ${Object.keys(snapshot.summaries).length} summaries, ${snapshot.contextCards.length} public context cards). Sanitization checks passed.`
  );
}

main();
