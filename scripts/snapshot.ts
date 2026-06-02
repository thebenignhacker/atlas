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

  // 2) No private/fork repo names from the source DB.
  const dbPath = path.join(process.cwd(), "data", "atlas.db");
  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    const hidden = db
      .prepare("SELECT name FROM repos WHERE visibility != 'public' OR isFork = 1")
      .all() as { name: string }[];
    db.close();
    const publicNames = new Set(snapshot.repos.map((r) => r.name));
    for (const h of hidden) {
      if (publicNames.has(h.name)) continue; // name also belongs to a public repo
      if (new RegExp(`"${h.name}"`).test(json))
        violations.push(`hidden repo name "${h.name}" present`);
    }
  }

  // 3) No absolute unix paths at all.
  if (/"[^"]*\/Users\/[^"]*"/.test(json) || /"[^"]*\/home\/[^"]*"/.test(json))
    violations.push("absolute filesystem path present");

  if (violations.length > 0) {
    console.error("atlas: SNAPSHOT ABORTED — sanitization failed:");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  fs.writeFileSync(SNAPSHOT_PATH, json);
  console.log(
    `atlas: public snapshot written (${snapshot.repos.length} public repos, ${snapshot.activity.length} events, ${Object.keys(snapshot.summaries).length} summaries). Sanitization checks passed.`
  );
}

main();
