import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { slugify } from "@/lib/util/format";
import { configPath } from "@/lib/paths";

export interface AtlasConfig {
  /** Directories to scan for git repositories. */
  scanRoots: string[];
  /** How many directory levels deep to look for a `.git` folder. */
  scanDepth: number;
  /** Directories containing todo markdown files. */
  todoDirs: string[];
  /**
   * Markdown docs tracked on the owner-only /strategy page. Kept deliberately
   * separate from todoDirs/roadmap so strategy/fundraising work never mixes with
   * coding or standards-filing todos. Only checkbox lines tagged `#strategy` are
   * surfaced. These docs are read live (filesystem) and never enter the public
   * snapshot, so investor names and raise numbers stay owner-only.
   */
  strategyDocs: string[];
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
  /**
   * Project / workspace-dir names whose Claude Code usage may be ATTRIBUTED BY
   * NAME in the public showcase. Anything not listed is bucketed into "other",
   * so the public usage view never discloses a private client or project. Empty
   * falls back to DEFAULT_PUBLIC_USAGE_PROJECTS (lib/usage/catalog-meta).
   */
  publicUsageProjects: string[];
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
  strategyDocs: [],
  github: { user: undefined, orgs: [] },
  exclude: ["node_modules", ".next", ".git", "archive-", "dist", "build"],
  publicOwners: [],
  sensitiveRepos: [],
  publicUsageProjects: [],
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
  const file = configPath();
  let userConfig: Partial<AtlasConfig> = {};
  if (fs.existsSync(file)) {
    try {
      userConfig = JSON.parse(fs.readFileSync(file, "utf8"));
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
  cached.strategyDocs = (cached.strategyDocs ?? []).map(expandHome);
  // Canonicalize sensitiveRepos to the SAME slug form repos are stored under, so
  // a hand-typed entry with uppercase or stray whitespace ("My-Repo", "repo ")
  // still matches and the never-publish guarantee can't silently fail open.
  cached.sensitiveRepos = Array.from(
    new Set(cached.sensitiveRepos.map(slugify).filter(Boolean))
  );
  return cached;
}
