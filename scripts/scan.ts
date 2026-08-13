import "dotenv/config";
import fs from "node:fs";
import { getDb, initSchema, getMeta, setMeta } from "@/lib/db";
import { finishRun, pruneRuns, startRun } from "@/lib/scan-runs";
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

const STAGE = "scan";

async function main() {
  const t0 = Date.now();
  const startedAt = new Date().toISOString();
  const config = loadConfig();
  const db = getDb();
  initSchema(db);

  const runId = startRun(db, STAGE, startedAt);
  const finish = (
    status: "ok" | "empty" | "error",
    opts: { rowsIn?: number; rowsOut?: number; error?: string; note?: string }
  ): never => {
    finishRun(db, runId, {
      endedAt: new Date().toISOString(),
      status,
      rowsIn: opts.rowsIn ?? null,
      rowsOut: opts.rowsOut ?? null,
      error: opts.error ?? null,
      note: opts.note ?? null,
    });
    pruneRuns(db, STAGE);
    if (status === "error") {
      console.error(`atlas: scan FAILED — ${opts.error}`);
      process.exit(1);
    }
    console.log(
      `atlas: scan complete in ${((Date.now() - t0) / 1000).toFixed(1)}s${
        opts.note ? ` (${opts.note})` : ""
      }`
    );
    process.exit(0);
  };

  const priorRepoCount = Number(getMeta(db, "repoCount") ?? "0");

  // Precondition. An unmounted or renamed scan root yields zero repos and would
  // otherwise be written as a successful scan that measured an empty portfolio.
  const missingRoots = config.scanRoots.filter((r) => !fs.existsSync(r));
  if (missingRoots.length > 0) {
    finish("error", {
      rowsIn: 0,
      rowsOut: priorRepoCount,
      error: `scan root(s) not found: ${missingRoots.join(", ")} — refusing to overwrite ${priorRepoCount} repos with a partial walk`,
    });
  }

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
  // Checked BEFORE the write, because the write truncates. A walk that found
  // nothing where there was previously a portfolio is a failure of the walk,
  // and the old data is more honest than a confident zero.
  if (repos.length === 0 && priorRepoCount > 0) {
    finish("error", {
      rowsIn: 0,
      rowsOut: priorRepoCount,
      error: `walked ${config.scanRoots.length} root(s) and found 0 repos after ${priorRepoCount} previously — leaving the existing data in place`,
    });
  }

  write(repos, todos, activity);

  const now = new Date().toISOString();
  setMeta("lastScanAt", now);
  setMeta("repoCount", String(repos.length));
  setMeta("todoCount", String(todos.length));
  setMeta("activityCount", String(activity.length));
  setMeta("githubEnriched", String(githubEnriched));

  const notes: string[] = [];
  if (githubTargets > 0 && githubEnriched < githubTargets) {
    const short = githubTargets - githubEnriched;
    console.warn(
      `atlas: enriched ${githubEnriched}/${githubTargets} GitHub repos — ${short} missing visibility/stars/forks (token or rate limit).`
    );
    // Carried into the run record so a degraded scan is visible on the page,
    // not only in a terminal nobody is watching once this is automated.
    notes.push(`${short}/${githubTargets} GitHub repos unenriched`);
  }
  if (repos.length < priorRepoCount) {
    notes.push(`repo count fell ${priorRepoCount} → ${repos.length}`);
  }

  finish(repos.length === 0 ? "empty" : "ok", {
    rowsIn: config.scanRoots.length,
    rowsOut: repos.length,
    note: notes.length ? notes.join("; ") : undefined,
  });
}

main().catch((err) => {
  // Print the MESSAGE, not the Error object. getDb() refusing to create a
  // database is now the ordinary first-run failure, and its message already
  // says exactly what to run; burying that under seven stack frames turns an
  // actionable line into something that reads like a crash. Stack stays
  // available behind ATLAS_DEBUG for the genuinely unexpected cases.
  console.error(`atlas: scan failed: ${err instanceof Error ? err.message : String(err)}`);
  if (process.env.ATLAS_DEBUG && err instanceof Error) console.error(err.stack);
  try {
    const db = getDb();
    const open = db
      .prepare(
        "SELECT id FROM scan_runs WHERE stage = ? AND status = 'running' ORDER BY id DESC LIMIT 1"
      )
      .get(STAGE) as { id: number } | undefined;
    if (open) {
      finishRun(db, open.id, {
        endedAt: new Date().toISOString(),
        status: "error",
        error: String(err instanceof Error ? err.message : err),
      });
    }
  } catch {
    // The database itself is unavailable; the non-zero exit is the signal.
  }
  process.exit(1);
});
