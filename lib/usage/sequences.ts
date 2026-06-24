import type { Routine, ToolEvent } from "@/lib/usage/types";
import { publicFeatureKey } from "@/lib/usage/catalog-meta";
import { classifyRoutine, generateScaffold } from "@/lib/usage/scaffold";

/**
 * Mine recurring tool-sequences ("motifs") from per-session usage and turn the
 * frequent ones into automation candidates. Pure and testable.
 *
 * Denoising is the whole game: raw tool bigrams (Read→Edit, Bash→Bash) are
 * ubiquitous and meaningless. So consecutive file/shell/search calls collapse to
 * a single `·code` step, and we keep only SALIENT tokens — skills, subagents,
 * workflows, slash-commands, MCP servers, web. A motif like
 * `·code → mcp:playwright → ·code` (edit, browser-check, fix) is a real,
 * automatable pattern; `Read → Edit` is not.
 *
 * Sanitization mirrors feature keys: in public mode every salient token is run
 * through publicFeatureKey, so a private skill/workflow/command name can never
 * leak into a public routine either.
 */

export interface MineOptions {
  public: boolean;
  now: Date;
  /** Minimum distinct sessions a motif must appear in to be surfaced. */
  minSupport?: number;
  /** Longest motif length to consider. */
  maxLen?: number;
  /** Cap on routines returned. */
  topK?: number;
}

/** Collapse an event to a salient, sanitized token — or null to drop as noise. */
export function salientToken(e: ToolEvent, isPublic: boolean): string | null {
  switch (e.category) {
    case "file":
    case "exec":
    case "search":
      return "·code";
    case "web":
      return "·web";
    case "other":
      return null; // AskUserQuestion etc. — not part of an automatable routine
    case "mcp": {
      // Derive the server-level token from the SANITIZED value, never the raw
      // feature — and fail closed if feature/category desynced (a row whose
      // category is "mcp" but whose feature isn't an "mcp:" key). This keeps the
      // privacy invariant correct-by-construction, not dependent on the gate.
      const pf = isPublic ? publicFeatureKey(e.feature) : e.feature;
      if (!pf.startsWith("mcp:")) return "mcp:(other)";
      return pf.includes(".") ? `mcp:${pf.slice(4).split(".")[0]}` : pf;
    }
    case "skill":
    case "orchestration":
    case "command":
      return isPublic ? publicFeatureKey(e.feature) : e.feature;
    default:
      return null;
  }
}

interface Tok {
  tok: string;
  ts: string | null;
}

/** Per-session ordered salient tokens, with consecutive duplicates collapsed. */
export function sessionSequences(
  events: ToolEvent[],
  isPublic: boolean
): Map<string, Tok[]> {
  const bySession = new Map<string, ToolEvent[]>();
  for (const e of events) {
    if (!e.sessionId || !e.ts) continue;
    const arr = bySession.get(e.sessionId) ?? [];
    arr.push(e);
    bySession.set(e.sessionId, arr);
  }

  const out = new Map<string, Tok[]>();
  for (const [sid, evs] of bySession) {
    evs.sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));
    const seq: Tok[] = [];
    for (const e of evs) {
      const tok = salientToken(e, isPublic);
      if (tok == null) continue;
      const prev = seq[seq.length - 1];
      if (prev && prev.tok === tok) {
        prev.ts = e.ts; // extend the run; keep the latest ts
      } else {
        seq.push({ tok, ts: e.ts });
      }
    }
    if (seq.length >= 2) out.set(sid, seq);
  }
  return out;
}

function isContiguousSub(small: string[], big: string[]): boolean {
  if (small.length >= big.length) return false;
  for (let i = 0; i + small.length <= big.length; i++) {
    let ok = true;
    for (let j = 0; j < small.length; j++) {
      if (big[i + j] !== small[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

interface Motif {
  steps: string[];
  sessions: Set<string>;
  occurrences: number;
  lastSeen: string | null;
}

export function mineRoutines(events: ToolEvent[], opts: MineOptions): Routine[] {
  const minSupport = opts.minSupport ?? 3;
  const maxLen = opts.maxLen ?? 4;
  const topK = opts.topK ?? 10;
  const seqs = sessionSequences(events, opts.public);

  const motifs = new Map<string, Motif>();
  for (const [sid, seq] of seqs) {
    for (let n = 2; n <= maxLen; n++) {
      for (let i = 0; i + n <= seq.length; i++) {
        const window = seq.slice(i, i + n);
        const steps = window.map((w) => w.tok);
        // Skip motifs that are entirely code (·code → ·code) — not informative.
        if (steps.every((s) => s === "·code")) continue;
        const key = steps.join(" → ");
        let m = motifs.get(key);
        if (!m) {
          m = { steps, sessions: new Set(), occurrences: 0, lastSeen: null };
          motifs.set(key, m);
        }
        m.sessions.add(sid);
        m.occurrences++;
        const last = window.reduce<string | null>(
          (acc, w) => (w.ts && (!acc || w.ts > acc) ? w.ts : acc),
          null
        );
        if (last && (!m.lastSeen || last > m.lastSeen)) m.lastSeen = last;
      }
    }
  }

  const ranked = Array.from(motifs.values())
    .filter((m) => m.sessions.size >= minSupport)
    .sort(
      (a, b) =>
        b.sessions.size - a.sessions.size ||
        b.steps.length - a.steps.length ||
        b.occurrences - a.occurrences
    );

  // Subsumption: drop a shorter motif when a LONGER motif contains it
  // contiguously and is almost as frequent (>= 85% of its support). This removes
  // both `·code → Agent` and `Agent → ·code` in favor of the more informative
  // `·code → Agent → ·code`, instead of listing all three.
  const kept: Motif[] = [];
  for (const m of ranked) {
    const subsumed = ranked.some(
      (b) =>
        b !== m &&
        b.steps.length > m.steps.length &&
        b.sessions.size >= m.sessions.size * 0.85 &&
        isContiguousSub(m.steps, b.steps)
    );
    if (subsumed) continue;
    kept.push(m);
    if (kept.length >= topK) break;
  }

  return kept.map((m) => {
    const kind = classifyRoutine(m.steps);
    return {
      steps: m.steps,
      support: m.sessions.size,
      occurrences: m.occurrences,
      lastSeen: m.lastSeen ? (opts.public ? m.lastSeen.slice(0, 10) : m.lastSeen) : null,
      kind,
      scaffold: generateScaffold(m.steps, kind),
    };
  });
}
