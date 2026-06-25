import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import type { Priority } from "@/lib/types";
import {
  ROADMAP_STATUSES,
  type RoadmapItem,
  type RoadmapComment,
  type RoadmapLink,
  type RoadmapStatus,
} from "@/lib/roadmap-shared";

// ---------------------------------------------------------------------------
// Roadmap (server)
//
// A roadmap item is a single markdown file under `<todoDir>/roadmap/`. The file
// is the ONE source of truth: human-editable, git-tracked, and ingested by the
// existing todos scanner too. This module parses the richer roadmap fields the
// todos scanner drops (5-state status, area, dependencies, comment log) and can
// write status/comments back to the file so the board is interactive.
//
// Client-safe types and the status list live in lib/roadmap-shared.ts (no node
// imports) so the board client component can use them without bundling fs.
//
// Writing to Atlas is reporting only. It never touches OpenA2A product code, and
// a failed write here never blocks a build — the file just keeps its last value.
// ---------------------------------------------------------------------------

export {
  ROADMAP_STATUSES,
  type RoadmapItem,
  type RoadmapComment,
  type RoadmapLink,
  type RoadmapStatus,
};

/** Resolve the roadmap directories (one per configured todoDir). */
function roadmapDirs(): string[] {
  return loadConfig().todoDirs.map((d) => path.join(d, "roadmap"));
}

/**
 * Match a bold field line in any of these styles, colon inside or outside the
 * bold markers, value optional:
 *   **Key:** val   |   **Key**: val   |   **Key:**   |   **Key** val
 */
function field(content: string, key: string): string | null {
  const re = new RegExp(`^\\*\\*${key}[:\\s]*\\*\\*\\s*:?\\s*(.*)$`, "im");
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

function firstHeading(content: string, fallback: string): string {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function normalizeStatus(raw: string | null): RoadmapStatus {
  const s = (raw ?? "").toLowerCase().trim();
  if (/(^|\b)(done|shipped|complete|merged|published|resolved|closed)\b/.test(s))
    return "done";
  if (/in[-\s]?review|reviewing|review\b/.test(s)) return "in-review";
  if (/in[-\s]?progress|wip|started|working/.test(s)) return "in-progress";
  if (/blocked|waiting|gated/.test(s)) return "blocked";
  if (/ready|todo|open|pending/.test(s)) return "ready";
  // Unknown → ready is the safe default: never falsely show progress, but also
  // don't bury an item as blocked when no blocker was declared.
  return "ready";
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]/)
    .map((t) => t.replace(/[`*]/g, "").trim())
    .filter(Boolean);
}

/** Parse links from a **Links:** field: markdown `[label](url)` or bare URLs. */
function parseLinks(raw: string | null): RoadmapLink[] {
  if (!raw) return [];
  const out: RoadmapLink[] = [];
  const mdLink = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let m: RegExpExecArray | null;
  let rest = raw;
  while ((m = mdLink.exec(raw)) !== null) {
    out.push({ label: m[1].trim(), url: m[2].trim() });
    rest = rest.replace(m[0], " ");
  }
  for (const tok of rest.split(/\s+/)) {
    if (/^https?:\/\//.test(tok)) out.push({ label: shortUrl(tok), url: tok });
  }
  return out;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** Parse the `## Log` section into dated comments. */
function parseComments(content: string): RoadmapComment[] {
  const idx = content.search(/^##\s+Log\s*$/im);
  if (idx === -1) return [];
  const section = content.slice(idx).split("\n").slice(1).join("\n");
  const out: RoadmapComment[] = [];
  for (const line of section.split("\n")) {
    const m = line.match(/^\s*-\s*(\d{4}-\d{2}-\d{2})\s*(?:—|--|-|:)?\s*(.*)$/);
    if (m) out.push({ date: m[1], text: m[2].trim() });
  }
  return out;
}

/** Strip the field block and ## Log so the body is just the description. */
function parseBody(content: string): string {
  let b = content;
  const logIdx = b.search(/^##\s+Log\s*$/im);
  if (logIdx !== -1) b = b.slice(0, logIdx);
  return b
    .replace(/^#\s+.+$/m, "") // title heading
    .replace(/^\*\*[^*]+\*\*\s*:?.*$/gim, "") // **Field:** lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseFile(filePath: string): RoadmapItem | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const id = path.basename(filePath).replace(/\.md$/i, "");
  const orderRaw = field(content, "Order");
  const order = orderRaw && /^\d+$/.test(orderRaw) ? Number(orderRaw) : 9999;
  const kindRaw = (field(content, "Kind") ?? "").toLowerCase();
  const kind: RoadmapItem["kind"] =
    kindRaw === "code" ? "code" : kindRaw === "non-code" ? "non-code" : "other";
  const prRaw = field(content, "Priority");
  const priority =
    prRaw && /^P[0-3]$/i.test(prRaw.trim())
      ? (prRaw.trim().toUpperCase() as Priority)
      : null;

  return {
    id,
    title: firstHeading(content, id),
    area: field(content, "Area") ?? "Other",
    kind,
    status: normalizeStatus(field(content, "Status")),
    priority,
    order,
    dependsOn: parseList(field(content, "Depends")),
    repos: parseList(field(content, "Repos")),
    links: parseLinks(field(content, "Links")),
    body: parseBody(content),
    comments: parseComments(content),
    path: filePath,
  };
}

/** Load every roadmap item, sorted by Order then title. */
export function loadRoadmap(): RoadmapItem[] {
  const items: RoadmapItem[] = [];
  for (const dir of roadmapDirs()) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.toLowerCase().endsWith(".md")) continue;
      if (name.toLowerCase() === "readme.md") continue;
      const item = parseFile(path.join(dir, name));
      if (item) items.push(item);
    }
  }
  return items.sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title)
  );
}

/** Resolve an item id to its file path, guarding against path traversal. */
function resolvePath(id: string): string | null {
  if (!/^[a-z0-9._-]+$/i.test(id)) return null;
  for (const dir of roadmapDirs()) {
    const p = path.join(dir, `${id}.md`);
    if (path.dirname(p) !== path.resolve(dir)) continue; // traversal guard
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export interface RoadmapUpdate {
  status?: RoadmapStatus;
  /** A comment to append to the ## Log section, stamped with `today`. */
  comment?: string;
  /** ISO date (YYYY-MM-DD) for the comment stamp; caller supplies it. */
  today?: string;
}

/**
 * Apply a status change and/or append a comment to an item's markdown file.
 * Returns the reparsed item, or null if the id is unknown. Throws only on a
 * real filesystem write failure (the API layer turns that into a 500).
 */
export function updateRoadmapItem(
  id: string,
  update: RoadmapUpdate
): RoadmapItem | null {
  const filePath = resolvePath(id);
  if (!filePath) return null;
  let content = fs.readFileSync(filePath, "utf8");

  if (update.status && ROADMAP_STATUSES.includes(update.status)) {
    const statusLine = /^\*\*Status[:\s]*\*\*\s*:?.*$/im;
    if (statusLine.test(content)) {
      content = content.replace(statusLine, `**Status:** ${update.status}`);
    } else {
      // No Status field yet — insert after the title heading.
      content = content.replace(
        /^(#\s+.+\n)/m,
        `$1\n**Status:** ${update.status}\n`
      );
    }
  }

  const comment = update.comment?.trim();
  if (comment) {
    const date = update.today ?? "";
    const line = `- ${date}${date ? " — " : ""}${comment}`;
    if (/^##\s+Log\s*$/im.test(content)) {
      content = content.replace(/(##\s+Log\s*\n)/i, `$1\n${line}\n`);
    } else {
      content = content.replace(/\s*$/, `\n\n## Log\n\n${line}\n`);
    }
  }

  fs.writeFileSync(filePath, content, "utf8");
  return parseFile(filePath);
}
