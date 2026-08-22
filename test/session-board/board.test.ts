import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boardCounts, scanSessionBoard, sessionTrees } from "@/lib/session-board";
import type { AtlasConfig } from "@/lib/config";

/**
 * The collector is tested against a STUB guard (written to a tmpdir and routed
 * via ATLAS_CLAIM_GUARD_PATH) so the suite never depends on ~/.claude existing
 * on the machine running it. The stub implements the guard's parse CONTRACT;
 * binding to the REAL guard's behaviour is the job of the bridge's --selftest
 * (asserted below when the real guard is present) and of the
 * `session-board-freshness` context card, which content-hashes the guard file.
 */

const STUB_GUARD = `
import os, pathlib, re, time
ACTIVE_RE = re.compile(r"^\\s*\\**Status:\\**\\s*active\\b", re.I | re.M)
SESSION_ID_RE = re.compile(r"^\\s*\\**Session:\\**\\s*\`?([0-9a-fA-F-]{8,})\`?", re.I | re.M)
CLAIM_RE = re.compile(r"\`([A-Za-z0-9_./-]+\\.[A-Za-z0-9_-]+)\`")
def claims_in(text):
    out = set()
    for m in CLAIM_RE.finditer(text):
        p = m.group(1)
        if p.startswith("./"):
            p = p[2:]
        if "/" in p:
            out.add(p)
    return out
def active_sessions(sdir, my_session_id):
    max_age = float(os.environ.get("CLAUDE_CLAIM_GUARD_MAX_AGE_DAYS", "3")) * 86400
    now = time.time()
    out = []
    for f in sorted(pathlib.Path(sdir).glob("*.md")):
        text = f.read_text(errors="ignore")
        if not ACTIVE_RE.search(text):
            continue
        if max_age > 0 and (now - f.stat().st_mtime) > max_age:
            continue
        m = SESSION_ID_RE.search(text)
        out.append((f, text, m.group(1) if m else None))
    return out
`;

let base: string;
let tree: string;
let config: AtlasConfig;

function write(rel: string, content: string, ageDays = 0): void {
  const p = path.join(tree, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (ageDays > 0) {
    const t = new Date(Date.now() - ageDays * 86_400_000);
    fs.utimesSync(p, t, t);
  }
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

before(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "board-"));
  tree = path.join(base, "tree");
  fs.mkdirSync(path.join(tree, ".claude-sessions"), { recursive: true });

  const stub = path.join(base, "stub-guard.py");
  fs.writeFileSync(stub, STUB_GUARD);
  process.env.ATLAS_CLAIM_GUARD_PATH = stub;

  // repoA: a real repo with one extra worktree (kept outside the tree, like
  // .worktrees/ checkouts, so it is not itself listed as a repo dir).
  const repoA = path.join(tree, "repoA");
  fs.mkdirSync(repoA);
  git(repoA, "init", "-q");
  git(repoA, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x");
  let wt = path.join(base, "wt", "repoA-fix");
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  git(repoA, "worktree", "add", "-q", wt, "-b", "fix-branch");
  // git reports realpaths (macOS tmpdir sits behind a /var symlink); the session
  // file must name the path the way git will report it for the match to bind.
  wt = fs.realpathSync(wt);

  // repoB: a directory that LOOKS like a repo but whose worktree listing fails
  // — the failure must be a note, never a board abort.
  fs.mkdirSync(path.join(tree, "repoB", ".git"), { recursive: true });

  // todo: a plain repo dir with no worktrees.
  fs.mkdirSync(path.join(tree, "todo", ".git"), { recursive: true });

  write(
    ".claude-sessions/2026-08-01-live.md",
    `# Live work\n**Session:** \`aaaaaaaa-1111\`\n**Status:** active\n` +
      `Editing \`repoA/src/main.ts\` and \`todo/roadmap/unit.md\`.\n` +
      `Worktree in use: ${wt}\n`,
    2
  );
  write(
    ".claude-sessions/2026-08-03-second.md",
    `# Second claimant\n**Session:** \`bbbbbbbb-2222\`\n**Status:** active\n` +
      `Editing \`repoA/src/other.ts\` and \`elsewhere/notes.md\`.\n`
  );
  write(
    ".claude-sessions/2026-05-01-forgotten.md",
    `# Forgotten\n**Session:** \`cccccccc-3333\`\n**Status:** active\n` +
      `Editing \`repoA/src/old.ts\`.\n`,
    30
  );
  write(
    ".claude-sessions/2026-08-02-finished.md",
    `# Finished\n**Status:** done\nEdited \`repoA/src/done.ts\`.\n`
  );

  config = {
    todoDirs: [path.join(tree, "todo")],
    exclude: ["node_modules"],
  } as AtlasConfig;
});

after(() => {
  delete process.env.ATLAS_CLAIM_GUARD_PATH;
  fs.rmSync(base, { recursive: true, force: true });
});

test("trees derive from todoDirs parents that have .claude-sessions", () => {
  const trees = sessionTrees(config);
  assert.equal(trees.length, 1);
  assert.equal(trees[0].tree, tree);
  const none = sessionTrees({ todoDirs: [path.join(base, "wt")] } as AtlasConfig);
  assert.equal(none.length, 0);
});

test("board: holder, staleness, worktrees and unmatched claims", () => {
  const board = scanSessionBoard(config);
  assert.equal(board.error, undefined);
  assert.equal(board.trees.length, 1);
  const t = board.trees[0];

  // Live actives only; the done file and the stale file are not on the board.
  assert.deepEqual(
    t.active.map((f) => f.file).sort(),
    ["2026-08-01-live.md", "2026-08-03-second.md"]
  );

  // The stale-active list names the file to archive, with its age.
  assert.equal(t.staleActives.length, 1);
  assert.equal(t.staleActives[0].file, "2026-05-01-forgotten.md");
  assert.ok(t.staleActives[0].ageDays > 3);

  // Holder = the LONGEST-STANDING live claim, not the newest.
  const repoA = t.repos.find((r) => r.repo === "repoA");
  assert.ok(repoA);
  assert.equal(repoA.holder?.file, "2026-08-01-live.md");
  assert.equal(repoA.sessions.length, 2);
  assert.deepEqual(repoA.sessions[0].claims, ["repoA/src/main.ts"]);

  const todo = t.repos.find((r) => r.repo === "todo");
  assert.equal(todo?.holder?.file, "2026-08-01-live.md");

  // The worktree is matched to the session file that names it.
  assert.equal(repoA.worktrees.length, 1);
  assert.equal(repoA.worktrees[0].branch, "fix-branch");
  assert.deepEqual(repoA.worktrees[0].matchedFiles, ["2026-08-01-live.md"]);

  // repoB's broken worktree listing is a note, and repoB (no claims, no
  // worktrees) earns no board row.
  assert.ok(t.notes.some((n) => n.includes("repoB")));
  assert.equal(t.repos.find((r) => r.repo === "repoB"), undefined);

  // A claim whose first segment is not a repo dir is surfaced, not dropped.
  assert.deepEqual(t.unmatchedClaims, [
    { file: "2026-08-03-second.md", claims: ["elsewhere/notes.md"] },
  ]);

  assert.deepEqual(boardCounts(board), { active: 2, staleActive: 1 });
});

test("a missing guard makes the board unavailable, loudly — no fallback parse", () => {
  const prev = process.env.ATLAS_CLAIM_GUARD_PATH;
  process.env.ATLAS_CLAIM_GUARD_PATH = path.join(base, "no-such-guard.py");
  try {
    assert.throws(() => scanSessionBoard(config), /guard not found|bridge failed/);
  } finally {
    process.env.ATLAS_CLAIM_GUARD_PATH = prev;
  }
});

test("bridge selftest holds against the real guard (skipped where absent)", (tc) => {
  const realGuard = path.join(
    os.homedir(),
    ".claude/hooks/shared-repo-claim-guard.py"
  );
  if (!fs.existsSync(realGuard)) {
    tc.skip("no real claim guard on this machine");
    return;
  }
  const env = { ...process.env };
  delete env.ATLAS_CLAIM_GUARD_PATH;
  execFileSync("python3", ["scripts/session-board.py", "--selftest"], {
    env,
    stdio: "ignore",
  });
});
