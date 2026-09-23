import type { CarryRow, UsageRequest } from "@/lib/usage/tokens";
import {
  CARRY_LABEL,
  COST_LABEL,
  RATE,
  TOKENS_LABEL,
  cacheHitRatio,
  costEstimate,
  type TokenCounts,
} from "@/lib/usage/pricing";

/**
 * Owner-only aggregation of mined token rows: per session, per repo, per day,
 * plus the carry leaderboards. Everything here is owner-only end to end: the
 * public rollup never reads these tables and the public snapshot verifier
 * asserts the section's absence.
 */

export interface SessionTokens extends TokenCounts {
  sessionId: string;
  project: string | null;
  firstAt: string | null;
  lastAt: string | null;
  requests: number;
  turns: number;
  /** Largest and median per-turn prefix (input + cache creation + cache read of the turn's last request). */
  prefixMax: number;
  prefixMedian: number;
  cacheHitRatio: number | null;
  costEstimate: number;
  models: string[];
}

export interface RepoTokens extends TokenCounts {
  project: string;
  sessions: number;
  requests: number;
  costEstimate: number;
}

export interface DayTokens extends TokenCounts {
  day: string;
  requests: number;
  costEstimate: number;
}

export interface CarryByTool {
  tool: string;
  calls: number;
  resultTokensEst: number;
  carryEst: number;
  /** Fraction of all carry. */
  share: number;
}

export interface CarryByFile {
  file: string;
  tool: string;
  calls: number;
  carryEst: number;
}

export interface TokenRollup {
  generatedAt: string;
  labels: { tokens: string; cost: string; carry: string };
  rates: typeof RATE;
  totals: TokenCounts & {
    requests: number;
    sessions: number;
    turns: number;
    costEstimate: number;
    cacheHitRatio: number | null;
    carryEst: number;
  };
  sessions: SessionTokens[];
  repos: RepoTokens[];
  /** Trailing 30 days, oldest first; days with no request are present with zeros. */
  days: DayTokens[];
  carryByTool: CarryByTool[];
  carryByFile: CarryByFile[];
  /** Account headroom readings joined in, or null with the reason when no source exists. */
  headroom: { note: string } | null;
}

export const EMPTY_TOKENS: TokenRollup = {
  generatedAt: "",
  labels: { tokens: TOKENS_LABEL, cost: COST_LABEL, carry: CARRY_LABEL },
  rates: RATE,
  totals: {
    input: 0, cacheCreation: 0, cacheRead: 0, output: 0,
    requests: 0, sessions: 0, turns: 0, costEstimate: 0, cacheHitRatio: null, carryEst: 0,
  },
  sessions: [],
  repos: [],
  days: [],
  carryByTool: [],
  carryByFile: [],
  headroom: null,
};

export interface TokenRollupOptions {
  now: Date;
  /** Sessions kept on the rollup, most expensive first. */
  sessionLimit?: number;
  fileLimit?: number;
  headroomNote?: string;
}

function zero(): TokenCounts {
  return { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
}

function add(a: TokenCounts, r: TokenCounts): void {
  a.input += r.input;
  a.cacheCreation += r.cacheCreation;
  a.cacheRead += r.cacheRead;
  a.output += r.output;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function rollupTokens(
  requests: UsageRequest[],
  carry: CarryRow[],
  opts: TokenRollupOptions
): TokenRollup {
  const sessionLimit = opts.sessionLimit ?? 200;
  const fileLimit = opts.fileLimit ?? 30;

  type Acc = TokenCounts & {
    sessionId: string;
    project: string | null;
    firstAt: string | null;
    lastAt: string | null;
    requests: number;
    models: Set<string>;
    /** turnIndex -> prefix of the last request seen for that turn. */
    prefixByTurn: Map<number, number>;
  };
  const bySession = new Map<string, Acc>();
  const totals = zero();
  const byRepo = new Map<string, RepoTokens & { sessionIds: Set<string> }>();
  const byDay = new Map<string, DayTokens>();

  for (const r of requests) {
    add(totals, r);
    const sid = r.sessionId ?? "unknown";
    let s = bySession.get(sid);
    if (!s) {
      s = { ...zero(), sessionId: sid, project: r.project, firstAt: r.ts, lastAt: r.ts, requests: 0, models: new Set(), prefixByTurn: new Map() };
      bySession.set(sid, s);
    }
    add(s, r);
    s.requests += 1;
    if (r.model) s.models.add(r.model);
    if (!s.project && r.project) s.project = r.project;
    if (r.ts) {
      if (!s.firstAt || r.ts < s.firstAt) s.firstAt = r.ts;
      if (!s.lastAt || r.ts > s.lastAt) s.lastAt = r.ts;
    }
    s.prefixByTurn.set(r.turnIndex, r.input + r.cacheCreation + r.cacheRead);

    const proj = r.project ?? "unknown";
    let p = byRepo.get(proj);
    if (!p) {
      p = { ...zero(), project: proj, sessions: 0, requests: 0, costEstimate: 0, sessionIds: new Set() };
      byRepo.set(proj, p);
    }
    add(p, r);
    p.requests += 1;
    p.sessionIds.add(sid);

    if (r.ts) {
      const day = r.ts.slice(0, 10);
      let d = byDay.get(day);
      if (!d) {
        d = { ...zero(), day, requests: 0, costEstimate: 0 };
        byDay.set(day, d);
      }
      add(d, r);
      d.requests += 1;
    }
  }

  const sessions: SessionTokens[] = [...bySession.values()]
    .map((s) => {
      const prefixes = [...s.prefixByTurn.values()];
      const counts = { input: s.input, cacheCreation: s.cacheCreation, cacheRead: s.cacheRead, output: s.output };
      return {
        ...counts,
        sessionId: s.sessionId,
        project: s.project,
        firstAt: s.firstAt,
        lastAt: s.lastAt,
        requests: s.requests,
        turns: s.prefixByTurn.size,
        prefixMax: prefixes.length ? Math.max(...prefixes) : 0,
        prefixMedian: median(prefixes),
        cacheHitRatio: cacheHitRatio(counts),
        costEstimate: costEstimate(counts),
        models: [...s.models].sort(),
      };
    })
    .sort((a, b) => b.costEstimate - a.costEstimate);

  const repos: RepoTokens[] = [...byRepo.values()]
    .map(({ sessionIds, ...p }) => ({ ...p, sessions: sessionIds.size, costEstimate: costEstimate(p) }))
    .sort((a, b) => b.costEstimate - a.costEstimate);

  const days: DayTokens[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(opts.now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const found = byDay.get(d);
    days.push(found ? { ...found, costEstimate: costEstimate(found) } : { ...zero(), day: d, requests: 0, costEstimate: 0 });
  }

  const toolAcc = new Map<string, CarryByTool>();
  const fileAcc = new Map<string, CarryByFile>();
  let carryTotal = 0;
  for (const c of carry) {
    carryTotal += c.carryEst;
    let t = toolAcc.get(c.tool);
    if (!t) {
      t = { tool: c.tool, calls: 0, resultTokensEst: 0, carryEst: 0, share: 0 };
      toolAcc.set(c.tool, t);
    }
    t.calls += 1;
    t.resultTokensEst += c.resultTokensEst;
    t.carryEst += c.carryEst;
    if (c.file) {
      const key = `${c.file}\u0000${c.tool}`;
      let f = fileAcc.get(key);
      if (!f) {
        f = { file: c.file, tool: c.tool, calls: 0, carryEst: 0 };
        fileAcc.set(key, f);
      }
      f.calls += 1;
      f.carryEst += c.carryEst;
    }
  }
  const carryByTool = [...toolAcc.values()]
    .map((t) => ({ ...t, share: carryTotal > 0 ? t.carryEst / carryTotal : 0 }))
    .sort((a, b) => b.carryEst - a.carryEst);
  const carryByFile = [...fileAcc.values()].sort((a, b) => b.carryEst - a.carryEst).slice(0, fileLimit);

  return {
    generatedAt: opts.now.toISOString(),
    labels: { tokens: TOKENS_LABEL, cost: COST_LABEL, carry: CARRY_LABEL },
    rates: RATE,
    totals: {
      ...totals,
      requests: requests.length,
      sessions: bySession.size,
      turns: sessions.reduce((n, s) => n + s.turns, 0),
      costEstimate: costEstimate(totals),
      cacheHitRatio: cacheHitRatio(totals),
      carryEst: carryTotal,
    },
    sessions: sessions.slice(0, sessionLimit),
    repos,
    days,
    carryByTool,
    carryByFile,
    headroom: opts.headroomNote ? { note: opts.headroomNote } : null,
  };
}
