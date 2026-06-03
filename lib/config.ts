import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AtlasConfig {
  /** Directories to scan for git repositories. */
  scanRoots: string[];
  /** How many directory levels deep to look for a `.git` folder. */
  scanDepth: number;
  /** Directories containing todo markdown files. */
  todoDirs: string[];
  /** GitHub identity used for enrichment (visibility, stars, forks, counts). */
  github: { user?: string; orgs?: string[] };
  /** Directory name fragments to skip while walking. */
  exclude: string[];
  /**
   * GitHub owners/orgs allowed to appear in the PUBLIC snapshot. Empty = all
   * public repos. Use this to keep specific accounts out of the public demo.
   */
  publicOwners: string[];
  /**
   * Repo slugs marked SENSITIVE — a hard never-publish. A sensitive repo (and
   * every context card under it) is dropped from the public snapshot even when
   * the repo is GitHub-public, and the snapshot gate fails closed if one would
   * leak. Stronger than relying on GitHub visibility.
   */
  sensitiveRepos: string[];
  /** AI layer. Disabled by default — Atlas is fully usable without it. */
  ai: {
    enabled: boolean;
    provider: "anthropic" | "openai" | "ollama";
    models: { fast: string; deep: string };
    /** Repo slugs whose content may be sent to an LLM (per-scope opt-in). */
    optInRepos: string[];
    /** Allow sending private-repo content to the provider. */
    allowPrivate: boolean;
  };
}

const DEFAULT_CONFIG: AtlasConfig = {
  scanRoots: ["~/workspace"],
  scanDepth: 2,
  todoDirs: [],
  github: { user: undefined, orgs: [] },
  exclude: ["node_modules", ".next", ".git", "archive-", "dist", "build"],
  publicOwners: [],
  sensitiveRepos: [],
  ai: {
    enabled: false,
    provider: "anthropic",
    models: { fast: "claude-haiku-4-5-20251001", deep: "claude-sonnet-4-6" },
    optInRepos: [],
    allowPrivate: false,
  },
};

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

let cached: AtlasConfig | null = null;

export function loadConfig(): AtlasConfig {
  if (cached) return cached;
  const configPath = path.join(process.cwd(), "atlas.config.json");
  let userConfig: Partial<AtlasConfig> = {};
  if (fs.existsSync(configPath)) {
    try {
      userConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (err) {
      console.warn(`atlas: failed to parse atlas.config.json, using defaults:`, err);
    }
  }
  cached = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    github: { ...DEFAULT_CONFIG.github, ...userConfig.github },
    ai: { ...DEFAULT_CONFIG.ai, ...userConfig.ai },
  };
  // Normalize paths up-front so the rest of the code never sees a `~`.
  cached.scanRoots = cached.scanRoots.map(expandHome);
  cached.todoDirs = cached.todoDirs.map(expandHome);
  return cached;
}
