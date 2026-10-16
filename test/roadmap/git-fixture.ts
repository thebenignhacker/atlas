import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Throwaway git repositories for the census tests. The census reads origin/main,
 * so a fixture tree has to be a checkout with a pushed origin. Git runs with no
 * global or system config, so a developer's signing, hooks or default branch
 * cannot change what the tests see.
 */

/**
 * The variables git treats as local to one repository (the list
 * `git rev-parse --local-env-vars` prints), plus GIT_NAMESPACE. Git exports
 * GIT_DIR to a hook that runs from a linked worktree, so a test run from a
 * pre-push hook inherits it, and every fixture command would then act on that
 * repository instead of the temp directory. None of them is passed on.
 */
export const REPO_LOCAL_GIT_VARS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
];

/** The environment fixture git runs with: `env` without the variables above. */
export function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept = { ...env };
  for (const name of REPO_LOCAL_GIT_VARS) delete kept[name];
  return {
    ...kept,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "census-test",
    GIT_AUTHOR_EMAIL: "census-test@example.invalid",
    GIT_COMMITTER_NAME: "census-test",
    GIT_COMMITTER_EMAIL: "census-test@example.invalid",
  };
}

export const GIT_ENV: NodeJS.ProcessEnv = gitEnv(process.env);

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Write one unit file under `<todoDir>/roadmap/`. */
export function writeUnit(todoDir: string, name: string, status: string): void {
  fs.mkdirSync(path.join(todoDir, "roadmap"), { recursive: true });
  fs.writeFileSync(
    path.join(todoDir, "roadmap", name),
    `# ${name}\n\n**Area:** T\n**Kind:** code\n**Status:** ${status}\n**Priority:** P2\n**Repos:** r\n\n## Log\n`
  );
}

/** A bare repository with a main branch, to act as origin. */
export function bareOrigin(dir: string): string {
  git(path.dirname(dir), "init", "-q", "--bare", "-b", "main", dir);
  return dir;
}

/** Make `repo` a checkout of `origin`, commit `paths` in it and push to origin/main. */
export function publish(repo: string, origin: string, paths: string[]): void {
  if (!fs.existsSync(path.join(repo, ".git"))) {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "remote", "add", "origin", origin);
  }
  git(repo, "add", "--", ...paths);
  git(repo, "commit", "-q", "-m", "units");
  git(repo, "push", "-q", "origin", "HEAD:main");
}
