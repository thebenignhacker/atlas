/**
 * Cost estimation for mined token counts.
 *
 * The rates are the flat list rates the maintainer's own cost report uses
 * (~/.claude/scripts/token-cost-report.js): one table for every model, cache
 * write at 1.25x input, cache read at 0.1x input. A dollar figure computed from
 * them is an ESTIMATE, a relative weight for comparing sessions and repos,
 * never a bill: it is applied to measured token counts and to nothing else,
 * and every surface that shows it carries `COST_LABEL`.
 */

/** $ per million tokens. */
export const RATE = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 } as const;

export const TOKENS_LABEL = "measured: token counts as the transcripts record them, summed once per request";
export const COST_LABEL =
  `estimated: measured tokens x flat list rates ($/MTok input ${RATE.input}, output ${RATE.output}, ` +
  `cache write ${RATE.cacheWrite}, cache read ${RATE.cacheRead}), a relative weight, not a bill`;
export const CARRY_LABEL =
  "estimated: tool-result bytes / 3.6 as tokens, x the assistant responses that followed in the session";

export interface TokenCounts {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
}

/** Estimated dollars for measured counts, at `RATE`. */
export function costEstimate(t: TokenCounts): number {
  return (
    (t.input * RATE.input +
      t.cacheCreation * RATE.cacheWrite +
      t.cacheRead * RATE.cacheRead +
      t.output * RATE.output) /
    1e6
  );
}

/** Share of the context that was served from cache: cacheRead over everything sent. */
export function cacheHitRatio(t: TokenCounts): number | null {
  const sent = t.input + t.cacheCreation + t.cacheRead;
  return sent > 0 ? t.cacheRead / sent : null;
}
