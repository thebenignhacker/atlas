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

export function getMetrics(db: Database.Database): ContextMetrics {
  const totalCards = (
    db.prepare("SELECT count(*) n FROM context_cards").get() as { n: number }
  ).n;
  const activeCards = (
    db
      .prepare("SELECT count(*) n FROM context_cards WHERE status='active'")
      .get() as { n: number }
  ).n;

  const staleCaught = (
    db
      .prepare("SELECT count(*) n FROM context_events WHERE kind='caught_stale'")
      .get() as { n: number }
  ).n;

  const reads = (
    db
      .prepare("SELECT count(*) n FROM context_events WHERE kind='read'")
      .get() as { n: number }
  ).n;

  // Freshness coverage over ACTIVE cards (point-in-time gauge).
  const freshness: Record<Freshness, number> = {
    fresh: 0,
    drifted: 0,
    expired: 0,
    stale: 0,
    unverified: 0,
  };
  const rows = db
    .prepare(
      "SELECT freshness, count(*) n FROM context_cards WHERE status='active' GROUP BY freshness"
    )
    .all() as { freshness: string; n: number }[];
  for (const r of rows) {
    if (FRESH_STATES.includes(r.freshness as Freshness)) {
      freshness[r.freshness as Freshness] = r.n;
    }
  }

  // Estimated tokens saved: for each recorded read, the baseline re-read cost
  // minus the cost of serving the cards instead. Floored at 0 per read.
  const readRows = db
    .prepare("SELECT detail FROM context_events WHERE kind='read'")
    .all() as { detail: string | null }[];
  let tokensSavedEstimate = 0;
  for (const r of readRows) {
    let cardCount = 0;
    try {
      cardCount = Number(JSON.parse(r.detail ?? "{}").cardCount ?? 0);
    } catch {
      cardCount = 0;
    }
    tokensSavedEstimate += Math.max(
      0,
      RE_READ_BASELINE_TOKENS - cardCount * TOKENS_PER_CARD
    );
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
