import type Database from "better-sqlite3";
import type { ContextMetrics, Freshness } from "@/lib/types";

/**
 * Aggregate metrics for the dashboard and README.
 *
 * HONESTY CONTRACT (see docs/CONTEXT_STORE.md):
 *  - `staleCaught` and `freshness` are MEASURED — counted directly from the
 *    event log / card table. The hero number is never modeled.
 *  - `tokensSavedEstimate` is the ONLY estimate. It is computed from a
 *    deliberately conservative re-read baseline and labeled "estimate"
 *    everywhere it is shown. It is a lower bound, not a measurement.
 */

/**
 * Conservative tokens a session would spend re-deriving a project's state the
 * old way (reading an index/ledger + a couple of source files + a little git
 * archaeology) if the Context Store did not exist. Deliberately low so the
 * estimate under-claims. Baseline re-measured during dogfood; see the doc.
 */
export const RE_READ_BASELINE_TOKENS = 6_000;
/** Rough tokens to serve one card in a `get` (claim capped at 280 chars). */
export const TOKENS_PER_CARD = 160;

const FRESH_STATES: Freshness[] = [
  "fresh",
  "drifted",
  "expired",
  "stale",
  "unverified",
];

/**
 * @param opts.publicOnly  Scope EVERY number to `visibility='public'` cards.
 *   Used for the public snapshot so it never discloses the count, freshness, or
 *   read/usage activity of private cards. Read/usage stats (reads, tokensSaved)
 *   are owner-only and reported as 0 publicly. Owner/local pass no opts and see
 *   the full picture.
 */
export function getMetrics(
  db: Database.Database,
  opts: { publicOnly?: boolean } = {}
): ContextMetrics {
  const pub = opts.publicOnly === true;
  const scope = pub ? " AND visibility='public'" : "";

  const totalCards = (
    db
      .prepare(`SELECT count(*) n FROM context_cards WHERE 1=1${pub ? " AND visibility='public'" : ""}`)
      .get() as { n: number }
  ).n;
  const activeCards = (
    db
      .prepare(`SELECT count(*) n FROM context_cards WHERE status='active'${scope}`)
      .get() as { n: number }
  ).n;

  // caught_stale events scoped to in-scope cards (public set when publicOnly).
  const staleCaught = (
    db
      .prepare(
        `SELECT count(*) n FROM context_events WHERE kind='caught_stale'` +
          (pub
            ? " AND cardId IN (SELECT id FROM context_cards WHERE visibility='public')"
            : "")
      )
      .get() as { n: number }
  ).n;

  // Read/usage stats are owner activity, never published.
  const reads = pub
    ? 0
    : (
        db
          .prepare("SELECT count(*) n FROM context_events WHERE kind='read'")
          .get() as { n: number }
      ).n;

  // Freshness coverage over in-scope ACTIVE cards (point-in-time gauge).
  const freshness: Record<Freshness, number> = {
    fresh: 0,
    drifted: 0,
    expired: 0,
    stale: 0,
    unverified: 0,
  };
  const rows = db
    .prepare(
      `SELECT freshness, count(*) n FROM context_cards WHERE status='active'${scope} GROUP BY freshness`
    )
    .all() as { freshness: string; n: number }[];
  for (const r of rows) {
    if (FRESH_STATES.includes(r.freshness as Freshness)) {
      freshness[r.freshness as Freshness] = r.n;
    }
  }

  // Estimated tokens saved (owner-only): baseline re-read cost minus the cost of
  // serving the cards instead, per recorded read. Floored at 0 per read.
  let tokensSavedEstimate = 0;
  if (!pub) {
    const readRows = db
      .prepare("SELECT detail FROM context_events WHERE kind='read'")
      .all() as { detail: string | null }[];
    for (const r of readRows) {
      let cardCount = 0;
      try {
        cardCount = Number(JSON.parse(r.detail ?? "{}").cardCount ?? 0);
      } catch {
        cardCount = 0;
      }
      // A read that returned no cards saved nothing — the question wasn't
      // answered, so it didn't replace a repo re-read. Only credit real hits.
      if (cardCount > 0) {
        tokensSavedEstimate += Math.max(
          0,
          RE_READ_BASELINE_TOKENS - cardCount * TOKENS_PER_CARD
        );
      }
    }
  }

  return {
    totalCards,
    activeCards,
    staleCaught,
    freshness,
    tokensSavedEstimate,
    reads,
  };
}
