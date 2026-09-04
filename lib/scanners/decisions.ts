import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AtlasConfig } from "@/lib/config";
import type { Decision, DecisionClass, DecisionSkip, DecisionStatus } from "@/lib/types";

/**
 * Decision-log scanner.
 *
 * Reads `<todoDir>/decisions/*.md` — one card per auto-adopted recommendation or
 * owner-queued action, house `**Field:**` format, spec in the directory's
 * README. Owner-only end to end: the table feeds the owner snapshot and the
 * /decisions page; the public snapshot's verifier asserts the section's ABSENCE.
 *
 * Parsing is deliberately tolerant on optional fields and strict on identity:
 * a file with no `**Decision:**` line is skipped with a warning rather than
 * ingested as an empty card — a blank card would read as a decision with no
 * content, which is worse than a visible gap.
 */

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

function field(content: string, key: string): string | null {
  const re = new RegExp(`^\\*\\*${key}:\\*\\*\\s*(.+)$`, "im");
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

function firstHeading(content: string, fallback: string): string {
  const m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

const CLASSES: DecisionClass[] = [
  "adopted",
  "queued-for-owner",
  "conflict",
  "superseding",
  "reversal",
];
const STATUSES: DecisionStatus[] = ["executed", "pending", "superseded", "reversed"];

function parseEnum<T extends string>(raw: string | null, allowed: T[]): T | null {
  if (!raw) return null;
  const v = raw.toLowerCase().split(/\s|\|/)[0].trim() as T;
  return allowed.includes(v) ? v : null;
}

/**
 * Outcome of parsing one file in a decisions directory.
 *   - `card`:    a spec-compliant card.
 *   - `skip`:    a `.md` that is not a valid card — recorded with the reason so
 *                the owner view can show what needs fixing (the spec is
 *                append-only: fix the card, not the parser).
 *   - `ignore`:  not a card at all (README, non-markdown, unreadable). Nothing
 *                to surface.
 */
export type DecisionParse =
  | { kind: "card"; card: Decision }
  | { kind: "skip"; skip: DecisionSkip }
  | { kind: "ignore" };

/**
 * Parse ONE card file. The single parser both the full scan and the incremental
 * hook ingest go through — a second parser that could drift is the session-board
 * failure class, refused at build time.
 */
export function parseDecisionEntry(
  filePath: string,
  scannedAt?: string,
  opts: { quiet?: boolean } = {}
): DecisionParse {
  const name = path.basename(filePath);
  if (!name.toLowerCase().endsWith(".md") || name.toLowerCase() === "readme.md")
    return { kind: "ignore" };
  let content: string;
  let mtime: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
    mtime = fs.statSync(filePath).mtime.toISOString();
  } catch {
    return { kind: "ignore" };
  }
  const skip = (reason: string): DecisionParse => {
    if (!opts.quiet) console.warn(`atlas: decisions — skipping ${name}: ${reason}`);
    return {
      kind: "skip",
      skip: {
        id: name.replace(/\.md$/i, ""),
        path: filePath,
        filename: name,
        reason,
        modifiedAt: mtime,
        scannedAt: scannedAt ?? new Date().toISOString(),
      },
    };
  };

  const decision = field(content, "Decision");
  if (!decision) return skip("no **Decision:** line");
  const dateFromName = name.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const rawClass = field(content, "Class");
  const rawStatus = field(content, "Status");
  const klass = parseEnum(rawClass, CLASSES);
  const status = parseEnum(rawStatus, STATUSES);
  if (!klass || !status) {
    const problems: string[] = [];
    if (!klass)
      problems.push(
        rawClass
          ? `Class "${rawClass.split(/\s|\|/)[0]}" is not one of ${CLASSES.join(" | ")}`
          : "no **Class:** line"
      );
    if (!status)
      problems.push(
        rawStatus
          ? `Status "${rawStatus.split(/\s|\|/)[0]}" is not one of ${STATUSES.join(" | ")}`
          : "no **Status:** line"
      );
    return skip(problems.join("; "));
  }
  const body = content
    .split(/^## Log$/m)[0]
    .replace(/^#\s.+$/m, "")
    .replace(/^\*\*[A-Za-z ]+:\*\*.*$/gm, "")
    .trim();

  const card: Decision = {
    id: name.replace(/\.md$/i, ""),
    path: filePath,
    filename: name,
    title: firstHeading(content, name.replace(/\.md$/i, "")),
    date: field(content, "Date") ?? dateFromName,
    sessionId: field(content, "Session"),
    chief: field(content, "Chief"),
    klass,
    status,
    tree: field(content, "Tree"),
    decision,
    why: field(content, "Why"),
    alternatives: field(content, "Alternatives"),
    reversibility: field(content, "Reversibility"),
    reviewTrigger: field(content, "Review trigger"),
    supersedes: (() => {
      const s = field(content, "Supersedes");
      return s && s.toLowerCase() !== "none" ? s : null;
    })(),
    links: field(content, "Links"),
    body: body.slice(0, 4000),
    modifiedAt: mtime,
    checksum: md5(content),
    scannedAt: scannedAt ?? new Date().toISOString(),
  };
  return { kind: "card", card };
}

/** Card-or-null view of `parseDecisionEntry`, for callers that only want cards. */
export function parseDecisionFile(filePath: string, scannedAt?: string): Decision | null {
  const r = parseDecisionEntry(filePath, scannedAt);
  return r.kind === "card" ? r.card : null;
}

export interface DecisionLog {
  decisions: Decision[];
  skips: DecisionSkip[];
}

/** Every card and every refused file across all configured decision dirs. */
export function scanDecisionLog(config: AtlasConfig): DecisionLog {
  const scannedAt = new Date().toISOString();
  const decisions: Decision[] = [];
  const skips: DecisionSkip[] = [];

  for (const todoDir of config.todoDirs) {
    const dir = path.join(todoDir, "decisions");
    if (!fs.existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const r = parseDecisionEntry(path.join(dir, name), scannedAt);
      if (r.kind === "card") decisions.push(r.card);
      else if (r.kind === "skip") skips.push(r.skip);
    }
  }
  decisions.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  skips.sort((a, b) => b.filename.localeCompare(a.filename));
  return { decisions, skips };
}

export function scanDecisions(config: AtlasConfig): Decision[] {
  return scanDecisionLog(config).decisions;
}
