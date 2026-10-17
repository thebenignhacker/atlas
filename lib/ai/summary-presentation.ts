/**
 * How a cached repo summary may be shown. Pure (no server-only import) so the
 * page, the interactive client block and the tests share one rule.
 *
 * The summary is prose written once and shown beside tiles measured at
 * snapshot time; a reader takes it as the current state. So it is shown only
 * with the date it was written, and flagged when the repo has a commit newer
 * than that date. A summary with no recorded date cannot say how current it
 * is, so it is not shown at all.
 */

/** A cached summary and when it was generated (ISO), if that was recorded. */
export interface RepoSummaryRecord {
  text: string;
  generatedAt: string | null;
}

export type SummaryPresentation =
  | { show: false }
  | { show: true; text: string; badge: string; staleFlag: string | null };

export const SUMMARY_STALE_FLAG =
  "Written before the latest commit; counts in the text may differ from the tiles.";

function instant(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function summaryPresentation(
  summary: RepoSummaryRecord | null,
  lastCommitAt: string | null
): SummaryPresentation {
  if (!summary || !summary.text) return { show: false };
  const written = instant(summary.generatedAt);
  if (written === null) return { show: false };
  const lastCommit = instant(lastCommitAt);
  return {
    show: true,
    text: summary.text,
    // UTC day, so the server render and the client render agree.
    badge: `AI-generated · ${new Date(written).toISOString().slice(0, 10)}`,
    staleFlag: lastCommit !== null && written < lastCommit ? SUMMARY_STALE_FLAG : null,
  };
}
