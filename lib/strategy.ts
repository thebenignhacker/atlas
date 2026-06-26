import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@/lib/config";
import { slugify } from "@/lib/util/format";
import type {
  StrategyDoc,
  StrategyPriority,
  StrategySection,
  StrategyTask,
} from "@/lib/strategy-shared";

// ---------------------------------------------------------------------------
// Strategy (server)
//
// A strategy doc is a markdown file listed in atlas.config.json `strategyDocs`.
// Only checkbox lines tagged `#strategy` are surfaced — that tag is the doc's
// own separation marker, keeping this work distinct from coding/roadmap and
// standards-filing todos. The doc is the single source of truth: check items off
// by editing the markdown, then refresh. Read live (filesystem); never enters
// the public snapshot, so investor names and raise numbers stay owner-only.
// ---------------------------------------------------------------------------

export type {
  StrategyDoc,
  StrategySection,
  StrategyTask,
  StrategyPriority,
} from "@/lib/strategy-shared";

const TASK_TAG = "#strategy";
// - [ ] (P0) some task #strategy   |   - [x] some task #strategy
const TASK_RE = /^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/;
const PRIORITY_RE = /^\((P[0-3])\)\s*/i;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function cleanText(raw: string): string {
  return raw
    .replace(new RegExp(`${TASK_TAG}\\b`, "gi"), "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a strategy markdown string into a structured doc. Pure (no I/O) so it
 * can be unit-tested. Sections are introduced by `##`/`###` headings; a heading
 * with no tagged tasks under it is dropped, so prose-only sections (e.g. the
 * operating doctrine) don't show as empty trackers.
 */
export function parseStrategyDoc(
  content: string,
  id: string,
  filePath = ""
): StrategyDoc {
  const lines = content.split("\n");
  let title = id;
  let updated: string | null = null;

  // Build an ordered section list as we encounter headings.
  const sections: StrategySection[] = [];
  let current: StrategySection | null = null;

  for (const line of lines) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      if (level === 1) {
        // The document title; not a tracker section.
        if (title === id) title = text;
        current = null;
        continue;
      }
      current = { title: text, level, blurb: "", tasks: [], done: 0, total: 0 };
      sections.push(current);
      continue;
    }

    if (updated === null) {
      const u = line.match(/last updated[:\s]+(.+?)\.?\s*$/i);
      if (u) updated = u[1].trim();
    }

    const task = line.match(TASK_RE);
    if (task) {
      const body = task[2];
      // Only checkbox lines carrying the separation tag count as strategy work.
      if (!new RegExp(`${TASK_TAG}\\b`, "i").test(body)) continue;
      let rest = body;
      let priority: StrategyPriority = null;
      const pr = rest.match(PRIORITY_RE);
      if (pr) {
        priority = pr[1].toUpperCase() as StrategyPriority;
        rest = rest.slice(pr[0].length);
      }
      const t: StrategyTask = {
        text: cleanText(rest),
        done: task[1].toLowerCase() === "x",
        priority,
        section: current?.title ?? "General",
      };
      if (!current) {
        current = {
          title: "General",
          level: 2,
          blurb: "",
          tasks: [],
          done: 0,
          total: 0,
        };
        sections.push(current);
      }
      current.tasks.push(t);
      continue;
    }

    // First non-empty prose line under a heading becomes its blurb.
    if (current && !current.blurb && current.tasks.length === 0) {
      const prose = line.trim();
      if (
        prose &&
        !prose.startsWith("#") &&
        !prose.startsWith("|") &&
        !prose.startsWith(">") &&
        !prose.startsWith("- ") &&
        !prose.startsWith("* ")
      ) {
        current.blurb = prose;
      }
    }
  }

  const kept = sections.filter((s) => s.tasks.length > 0);
  for (const s of kept) {
    s.total = s.tasks.length;
    s.done = s.tasks.filter((t) => t.done).length;
  }

  const allTasks = kept.flatMap((s) => s.tasks);
  return {
    id,
    title,
    updated,
    sections: kept,
    totalTasks: allTasks.length,
    doneTasks: allTasks.filter((t) => t.done).length,
    openP0: allTasks.filter((t) => !t.done && t.priority === "P0").length,
    openP1: allTasks.filter((t) => !t.done && t.priority === "P1").length,
    path: filePath,
  };
}

/** Load every configured strategy doc that exists on disk. */
export function loadStrategyDocs(): StrategyDoc[] {
  const docs: StrategyDoc[] = [];
  for (const filePath of loadConfig().strategyDocs) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const id = slugify(path.basename(filePath).replace(/\.md$/i, ""));
    docs.push(parseStrategyDoc(content, id, filePath));
  }
  return docs;
}
