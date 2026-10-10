import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Throwaway git repositories for the census tests. The census reads origin/main,
 * so a fixture tree has to be a checkout with a pushed origin. Git runs with no
 * global or system config, so a developer's signing, hooks or default branch
 * cannot change what the tests see.
 */

export const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "census-test",
  GIT_AUTHOR_EMAIL: "census-test@example.invalid",
  GIT_COMMITTER_NAME: "census-test",
  GIT_COMMITTER_EMAIL: "census-test@example.invalid",
};

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
