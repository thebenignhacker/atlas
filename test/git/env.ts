/**
 * The environment the tests run git with. Git obeys GIT_DIR, and the other
 * GIT_ variables that name a repository, over the directory a command runs in,
 * and it exports GIT_DIR to a hook that runs from a linked worktree. A test run
 * from a pre-push hook inherits it, so a fixture's init, commit or worktree add
 * would act on that repository instead of its temp directory. No GIT_ variable
 * is passed on, and git reads no global or system config, so a developer's
 * signing, hooks or default branch cannot change what the tests see either.
 */
export function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept = { ...env };
  for (const name of Object.keys(kept)) if (name.startsWith("GIT_")) delete kept[name];
  return {
    ...kept,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "atlas-test",
    GIT_AUTHOR_EMAIL: "atlas-test@example.invalid",
    GIT_COMMITTER_NAME: "atlas-test",
    GIT_COMMITTER_EMAIL: "atlas-test@example.invalid",
  };
}

/** `gitEnv` of this process's environment. */
export const GIT_ENV: NodeJS.ProcessEnv = gitEnv(process.env);
