import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "@/lib/paths";
import type { AtlasConfig } from "@/lib/config";
import type {
  BoardRepo,
  BoardRepoSession,
  BoardSessionFile,
  BoardTree,
  BoardWorktree,
  SessionBoard,
} from "@/lib/session-board-shared";

/**
 * Derive the session board: who holds what, live, with staleness surfaced.
 *
 * PARSING IS DELEGATED, never re-implemented. scripts/session-board.py imports
 * the shared-repo claim guard (~/.claude/hooks/shared-repo-claim-guard.py) and
 * uses ITS claim/status/staleness logic, so the board and the guard cannot
 * disagree about what a claim is. This module only assembles: which trees have
 * a .claude-sessions/ directory, which first path segment of a claim is a repo,
 * and which git worktrees exist. If the bridge fails, the board is UNAVAILABLE
 * (throws — the caller records the error loudly); there is no fallback parser.
 */

interface BridgeFile extends BoardSessionFile {
  active: boolean;
  stale: boolean;
  worktreeMentions: string[];
}

interface BridgeOutput {
  guardPath: string;
  dirs: { dir: string; error?: string; files: BridgeFile[] }[];
}

/** Trees = unique parents of configured todoDirs that have .claude-sessions/. */
export function sessionTrees(config: AtlasConfig): { tree: string; sessionsDir: string }[] {
  const parents = [...new Set(config.todoDirs.map((d) => path.dirname(path.resolve(d))))];
  return parents
    .map((tree) => ({ tree, sessionsDir: path.join(tree, ".claude-sessions") }))
    .filter(({ sessionsDir }) => {
      try {
        return fs.statSync(sessionsDir).isDirectory();
      } catch {
        return false;
      }
    });
}

function repoDirs(tree: string, exclude: string[]): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tree, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (e) =>
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        !exclude.some((x) => e.name.includes(x)) &&
        fs.existsSync(path.join(tree, e.name, ".git"))
    )
    .map((e) => e.name)
    .sort();
}

/**
 * Extra worktrees of one repo (the primary checkout itself is not listed).
 * `.git` being a FILE marks a worktree checkout; `git worktree list` from the
 * primary names them all.
 */
function extraWorktrees(repoPath: string): { path: string; branch: string | null }[] {
  const out = execFileSync("git", ["-C", repoPath, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["pipe", "pipe", "pipe"], // a non-repo's `fatal:` goes to the note, not the terminal
  });
  const worktrees: { path: string; branch: string | null }[] = [];
  let current: { path: string; branch: string | null } | null = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) worktrees.push(current);
      current = { path: line.slice("worktree ".length), branch: null };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }
  if (current) worktrees.push(current);
  // git prints REAL paths; path.resolve leaves symlinks (macOS /var → /private/var)
  // in place, so compare realpaths or the primary checkout counts as an extra.
  const real = (p: string) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const self = real(repoPath);
  return worktrees.filter((w) => real(w.path) !== self);
}

function runBridge(sessionDirs: string[], worktreePaths: string[]): BridgeOutput {
  const script = path.join(repoRoot(), "scripts", "session-board.py");
  try {
    const stdout = execFileSync("python3", [script], {
      input: JSON.stringify({ sessionDirs, worktreePaths }),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return JSON.parse(stdout) as BridgeOutput;
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err ? String(err.stderr).trim() : "";
    const msg = stderr || (err instanceof Error ? err.message : String(err));
    throw new Error(`session-board bridge failed: ${msg}`);
  }
}

function toSessionFile(f: BridgeFile): BoardSessionFile {
  return {
    file: f.file,
    sessionId: f.sessionId,
    ageDays: f.ageDays,
    title: f.title,
    claims: f.claims,
  };
}

function assembleTree(
  tree: string,
  sessionsDir: string,
  files: BridgeFile[],
  repos: Map<string, { path: string; worktrees: BoardWorktree[] }>,
  notes: string[]
): BoardTree {
  const activeFiles = files.filter((f) => f.active && !f.stale);
  const staleFiles = files.filter((f) => f.active && f.stale);

  const board = new Map<string, BoardRepo>();
  const repoEntry = (repo: string): BoardRepo => {
    let entry = board.get(repo);
    if (!entry) {
      entry = { repo, holder: null, sessions: [], worktrees: [] };
      board.set(repo, entry);
    }
    return entry;
  };

  // Oldest mtime first: the longest-standing live claim is the holder.
  const byAge = [...activeFiles].sort((a, b) => b.ageDays - a.ageDays);
  const unmatched = new Map<string, string[]>();
  for (const f of byAge) {
    const perRepo = new Map<string, string[]>();
    for (const claim of f.claims) {
      const seg = claim.split("/")[0];
      if (repos.has(seg)) {
        (perRepo.get(seg) ?? perRepo.set(seg, []).get(seg)!).push(claim);
      } else {
        (unmatched.get(f.file) ?? unmatched.set(f.file, []).get(f.file)!).push(claim);
      }
    }
    for (const [repo, claims] of perRepo) {
      const session: BoardRepoSession = {
        file: f.file,
        sessionId: f.sessionId,
        ageDays: f.ageDays,
        claims,
      };
      const entry = repoEntry(repo);
      entry.sessions.push(session);
      entry.holder ??= session;
    }
  }

  for (const [repo, { worktrees }] of repos) {
    if (!worktrees.length) continue;
    const entry = repoEntry(repo);
    entry.worktrees = worktrees.map((w) => ({
      ...w,
      matchedFiles: files
        .filter((f) => f.active && f.worktreeMentions.includes(w.path))
        .map((f) => f.file),
    }));
  }

  return {
    tree,
    sessionsDir,
    repos: [...board.values()].sort((a, b) => a.repo.localeCompare(b.repo)),
    active: activeFiles.map(toSessionFile),
    staleActives: staleFiles
      .map((f) => ({ file: f.file, sessionId: f.sessionId, ageDays: f.ageDays }))
      .sort((a, b) => b.ageDays - a.ageDays),
    unmatchedClaims: [...unmatched].map(([file, claims]) => ({ file, claims })),
    notes,
  };
}

/** Collect the board. Throws when the bridge (and so the one parser) is unavailable. */
export function scanSessionBoard(
  config: AtlasConfig,
  now: Date = new Date()
): SessionBoard {
  const trees = sessionTrees(config);
  const treeRepos = new Map<string, Map<string, { path: string; worktrees: BoardWorktree[] }>>();
  const treeNotes = new Map<string, string[]>();
  const allWorktreePaths: string[] = [];

  for (const { tree } of trees) {
    const repos = new Map<string, { path: string; worktrees: BoardWorktree[] }>();
    const notes: string[] = [];
    for (const name of repoDirs(tree, config.exclude)) {
      const repoPath = path.join(tree, name);
      let worktrees: { path: string; branch: string | null }[] = [];
      try {
        worktrees = extraWorktrees(repoPath);
      } catch (err) {
        notes.push(
          `worktree listing failed for ${name}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`
        );
      }
      repos.set(name, {
        path: repoPath,
        worktrees: worktrees.map((w) => ({ ...w, matchedFiles: [] })),
      });
      allWorktreePaths.push(...worktrees.map((w) => w.path));
    }
    treeRepos.set(tree, repos);
    treeNotes.set(tree, notes);
  }

  const bridge = runBridge(
    trees.map((t) => t.sessionsDir),
    allWorktreePaths
  );
  const byDir = new Map(bridge.dirs.map((d) => [d.dir, d]));

  return {
    generatedAt: now.toISOString(),
    guardPath: bridge.guardPath,
    trees: trees.map(({ tree, sessionsDir }) => {
      const dir = byDir.get(sessionsDir);
      const notes = treeNotes.get(tree) ?? [];
      if (dir?.error) notes.push(`session dir: ${dir.error}`);
      return assembleTree(
        tree,
        sessionsDir,
        dir?.files ?? [],
        treeRepos.get(tree) ?? new Map(),
        notes
      );
    }),
  };
}

/** Totals for meta/freshness: live actives and stale actives across trees. */
export function boardCounts(board: SessionBoard): { active: number; staleActive: number } {
  return {
    active: board.trees.reduce((n, t) => n + t.active.length, 0),
    staleActive: board.trees.reduce((n, t) => n + t.staleActives.length, 0),
  };
}
