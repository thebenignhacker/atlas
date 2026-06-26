import "dotenv/config";
import { getDb, initSchema, setMeta } from "@/lib/db";
import { loadConfig } from "@/lib/config";
import { scanRepos } from "@/lib/scanners/repos";
import { scanTodos } from "@/lib/scanners/todos";
import { scanActivity } from "@/lib/scanners/activity";
import type { ActivityEvent, Repo, Todo } from "@/lib/types";

const REPO_COLS = `slug,name,path,groupName,remoteUrl,owner,repoName,branch,lastCommitAt,lastCommitSha,lastCommitMsg,commitCount30d,dirty,ahead,behind,visibility,isFork,isArchived,language,stars,openIssues,openPrs,defaultBranch,pushedAt,description,scannedAt`;
const TODO_COLS = `id,path,filename,title,createdAt,modifiedAt,priority,status,repoSlug,repoGuess,triggerPhrase,kind,excerpt,source,checksum,scannedAt`;
const ACT_COLS = `id,repoSlug,type,title,ts,meta,scannedAt`;

function placeholders(cols: string): string {
  return cols
    .split(",")
    .map((c) => `@${c}`)
    .join(",");
}

async function main() {
  const t0 = Date.now();
  const config = loadConfig();
  const db = getDb();
  initSchema(db);

  console.log(`atlas: scanning roots: ${config.scanRoots.join(", ")}`);
  const { repos, githubTargets, githubEnriched } = await scanRepos(config);
  console.log(`atlas: found ${repos.length} repos (${githubTargets} with GitHub remotes)`);

  const todos = scanTodos(config, repos);
  console.log(`atlas: parsed ${todos.length} todos`);

  const activity = scanActivity(repos);
  console.log(`atlas: collected ${activity.length} activity events`);

  // Full-snapshot replace of derived tables; AI/feedback/prefs persist.
  const repoInsert = db.prepare(`INSERT INTO repos (${REPO_COLS}) VALUES (${placeholders(REPO_COLS)})`);
  const todoInsert = db.prepare(`INSERT INTO todos (${TODO_COLS}) VALUES (${placeholders(TODO_COLS)})`);
  const actInsert = db.prepare(`INSERT INTO activity (${ACT_COLS}) VALUES (${placeholders(ACT_COLS)})`);

  const write = db.transaction(
    (rs: Repo[], ts: Todo[], as: ActivityEvent[]) => {
      db.exec("DELETE FROM repos; DELETE FROM todos; DELETE FROM activity;");
      for (const r of rs) repoInsert.run(r);
      for (const t of ts) todoInsert.run(t);
      for (const a of as) actInsert.run(a);
    }
  );
  write(repos, todos, activity);

  const now = new Date().toISOString();
  setMeta("lastScanAt", now);
  setMeta("repoCount", String(repos.length));
  setMeta("todoCount", String(todos.length));
  setMeta("activityCount", String(activity.length));
  setMeta("githubEnriched", String(githubEnriched));

  if (githubTargets > 0 && githubEnriched < githubTargets) {
    console.warn(
      `atlas: enriched ${githubEnriched}/${githubTargets} GitHub repos — ${githubTargets - githubEnriched} missing visibility/stars/forks (token or rate limit).`
    );
  }
  console.log(`atlas: scan complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("atlas: scan failed:", err);
  process.exit(1);
});
