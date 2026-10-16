import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GIT_ENV } from "../git/env";

export { GIT_ENV, gitEnv } from "../git/env";

/**
 * Throwaway git repositories for the census tests. The census reads origin/main,
 * so a fixture tree has to be a checkout with a pushed origin. Git runs with the
 * environment test/git/env.ts builds: no inherited GIT_ variable, and no global
 * or system config.
 */

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
