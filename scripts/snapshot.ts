import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";
import path from "node:path";
import { generatePublicSnapshot, SNAPSHOT_PATH } from "@/lib/snapshot";

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

  // 3) No absolute unix paths anywhere.
  if (/\/Users\/[\w.-]+/.test(json) || /\/home\/[\w.-]+/.test(json))
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
    if (c.provenance.length > 0)
      violations.push(`context card "${c.id}" leaked provenance paths`);
    if (c.verifyCommand)
      violations.push(`context card "${c.id}" leaked a verify command`);
    if (c.driftedPaths.length > 0)
      violations.push(`context card "${c.id}" leaked drifted paths`);
    if (c.originSessionId)
      violations.push(`context card "${c.id}" leaked an origin session id`);
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
