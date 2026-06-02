import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AtlasConfig } from "@/lib/config";
import type { Priority, Repo, Todo, TodoKind, TodoStatus } from "@/lib/types";
import { dateFromFilename } from "@/lib/util/date";

// Short names builders use in todo filenames/fields, mapped to repo names.
// Generic name-matching runs first; this only helps common abbreviations.
const REPO_ALIASES: Record<string, string> = {
  hma: "hackmyagent",
  cli: "opena2a",
  "opena2a-cli": "opena2a",
  aim: "agent-identity-management",
  dvaa: "damn-vulnerable-ai-agent",
  nanomind: "nanomind-training",
  registry: "opena2a-registry",
  abg: "ai-browserguard",
  browserguard: "ai-browserguard",
  secretless: "secretless",
  "secretless-ai": "secretless",
  atx: "atx-spec",
  website: "opena2a-website",
  architecture: "opena2a-architecture",
};

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

function firstHeading(content: string, fallback: string): string {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

/** Match `**Key:** val`, `**Key**: val`, or `- **Key**: val` (not YAML). */
function field(content: string, key: string): string | null {
  const re = new RegExp(
    `^[\\s\\-*]*\\*\\*${key}\\*?\\*?:?\\*?\\*?\\s*:?\\s*(.+)$`,
    "im"
  );
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

function parsePriority(content: string): Priority | null {
  // Look on any line mentioning Priority/Severity, take the first P0-P3.
  for (const line of content.split("\n")) {
    if (/priority|severity/i.test(line)) {
      const m = line.match(/\bP([0-3])\b/);
      if (m) return `P${m[1]}` as Priority;
    }
  }
  return null;
}

const DONE_RE = /\b(done|shipped|fixed|complete[d]?|merged|published|resolved|closed)\b/i;
const OPEN_RE = /\b(todo|pending|incomplete|in[-\s]?progress|blocked|wip|open)\b/i;

function parseStatus(content: string, inArchiveDir: boolean): TodoStatus {
  if (inArchiveDir) return "archived";
  const statusLine = field(content, "Status");
  if (statusLine) {
    if (DONE_RE.test(statusLine)) return "done";
    if (OPEN_RE.test(statusLine)) return "open";
  }
  // Checkbox heuristic: all checked → done; some unchecked → open.
  const boxes = content.match(/^\s*-\s*\[[ xX]\]/gm);
  if (boxes && boxes.length > 0) {
    const unchecked = boxes.filter((b) => /\[ \]/.test(b)).length;
    return unchecked === 0 ? "done" : "open";
  }
  return "open"; // a todo with no explicit status defaults to open
}

function classifyKind(filename: string): TodoKind {
  const base = filename.replace(/\.md$/i, "");
  if (/^[A-Z0-9_]+$/.test(base)) return "index";
  if (/(index|master|audit|plan|architecture|decisions|readme)/i.test(base))
    return "index";
  if (/(handoff|pickup|next[-\s]?session|session-\d+)/i.test(base)) return "handoff";
  if (/^\d{4}-\d{2}-\d{2}/.test(base)) return "dated";
  return "other";
}

function guessRepo(filename: string, content: string): string | null {
  const fromField = field(content, "Repos") || field(content, "Repo");
  if (fromField) {
    // Take the first token, strip backticks/commas.
    const tok = fromField.split(/[,;(]/)[0].replace(/[`*]/g, "").trim();
    if (tok) return tok.split(/\s+/)[0];
  }
  return null;
}

/** Resolve a raw repo guess (or the filename) to an actual scanned repo slug. */
function resolveRepoSlug(
  guess: string | null,
  filename: string,
  reposByName: Map<string, Repo>,
  repoNames: string[]
): { slug: string | null; guess: string | null } {
  const tryName = (n: string | null): string | null => {
    if (!n) return null;
    const norm = n.toLowerCase();
    if (reposByName.has(norm)) return reposByName.get(norm)!.slug;
    if (REPO_ALIASES[norm] && reposByName.has(REPO_ALIASES[norm]))
      return reposByName.get(REPO_ALIASES[norm])!.slug;
    return null;
  };

  // 1) explicit guess from **Repos:** field
  let slug = tryName(guess);
  if (slug) return { slug, guess };

  // 2) alias token appearing in the filename
  const base = filename.toLowerCase().replace(/\.md$/, "");
  for (const [alias, target] of Object.entries(REPO_ALIASES)) {
    if (base.includes(alias) && reposByName.has(target)) {
      return { slug: reposByName.get(target)!.slug, guess: guess ?? alias };
    }
  }

  // 3) longest actual repo name that appears as a token in the filename
  const match = repoNames
    .filter((n) => n.length >= 3 && base.includes(n))
    .sort((a, b) => b.length - a.length)[0];
  if (match) return { slug: reposByName.get(match)!.slug, guess: guess ?? match };

  return { slug: null, guess };
}

function listMarkdown(dir: string): { path: string; archived: boolean }[] {
  const out: { path: string; archived: boolean }[] = [];
  function walk(d: string, archived: boolean) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith(".")) continue;
        walk(full, archived || /archive|done/i.test(e.name));
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        out.push({ path: full, archived });
      }
    }
  }
  walk(dir, false);
  return out;
}

export function scanTodos(config: AtlasConfig, repos: Repo[]): Todo[] {
  const scannedAt = new Date().toISOString();
  const reposByName = new Map<string, Repo>();
  for (const r of repos) reposByName.set(r.name.toLowerCase(), r);
  const repoNames = repos.map((r) => r.name.toLowerCase());

  const todos: Todo[] = [];
  for (const dir of config.todoDirs) {
    if (!fs.existsSync(dir)) {
      console.warn(`atlas: todo dir does not exist: ${dir}`);
      continue;
    }
    for (const { path: filePath, archived } of listMarkdown(dir)) {
      let content: string;
      let mtime: string;
      try {
        content = fs.readFileSync(filePath, "utf8");
        mtime = fs.statSync(filePath).mtime.toISOString();
      } catch {
        continue;
      }
      const filename = path.basename(filePath);
      const title = firstHeading(content, filename.replace(/\.md$/i, ""));
      const createdAt =
        dateFromFilename(filename) || field(content, "Created") || mtime.slice(0, 10);
      const priority = parsePriority(content);
      const status = parseStatus(content, archived);
      const guess = guessRepo(filename, content);
      const { slug: repoSlug, guess: repoGuess } = resolveRepoSlug(
        guess,
        filename,
        reposByName,
        repoNames
      );
      const triggerPhrase = field(content, "Trigger phrase") || field(content, "Trigger");
      const kind = classifyKind(filename);
      const excerpt = content
        .replace(/^#.*$/m, "")
        .replace(/\*\*[^*]+\*\*/g, "")
        .replace(/[#`>*_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240);

      todos.push({
        id: md5(filePath),
        path: filePath,
        filename,
        title,
        createdAt,
        modifiedAt: mtime,
        priority,
        status,
        repoSlug,
        repoGuess,
        triggerPhrase,
        kind,
        excerpt,
        source: priority || triggerPhrase ? "field" : "heuristic",
        checksum: md5(content),
        scannedAt,
      });
    }
  }
  return todos;
}
