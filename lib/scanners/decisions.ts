import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AtlasConfig } from "@/lib/config";
import type { Decision, DecisionClass, DecisionStatus } from "@/lib/types";

/**
 * Decision-log scanner (Autonomy Doctrine Amendment 1, 2026-08-28).
 *
 * Reads `<todoDir>/decisions/*.md` — one card per auto-adopted recommendation or
 * queued-for-Abdel action, house `**Field:**` format, spec in the directory's
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
  "queued-for-abdel",
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

export function scanDecisions(config: AtlasConfig): Decision[] {
  const scannedAt = new Date().toISOString();
  const decisions: Decision[] = [];

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
      if (!name.toLowerCase().endsWith(".md")) continue;
      if (name.toLowerCase() === "readme.md") continue;
      const filePath = path.join(dir, name);
      let content: string;
      let mtime: string;
      try {
        content = fs.readFileSync(filePath, "utf8");
        mtime = fs.statSync(filePath).mtime.toISOString();
      } catch {
        continue;
      }
      const decision = field(content, "Decision");
      if (!decision) {
        console.warn(`atlas: decisions — skipping ${name}: no **Decision:** line`);
        continue;
      }
      const dateFromName = name.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
      const klass = parseEnum(field(content, "Class"), CLASSES);
      const status = parseEnum(field(content, "Status"), STATUSES);
      if (!klass || !status) {
        console.warn(
          `atlas: decisions — skipping ${name}: unrecognised Class/Status (append-only log; fix the card, not the parser)`
        );
        continue;
      }
      const body = content
        .split(/^## Log$/m)[0]
        .replace(/^#\s.+$/m, "")
        .replace(/^\*\*[A-Za-z ]+:\*\*.*$/gm, "")
        .trim();

      decisions.push({
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
        scannedAt,
      });
    }
  }
  decisions.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return decisions;
}
