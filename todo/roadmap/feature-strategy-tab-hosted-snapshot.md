# Atlas feature: bake strategy docs into the owner snapshot

**Area:** Feature
**Kind:** code
**Status:** done
**Priority:** P2
**Order:** 30
**Depends:**
**Repos:** atlas
**Links:**

The /strategy tab reads strategy docs from the local filesystem at request time
(`loadStrategyDocs()` over the configured `strategyDocs` paths), so it can never
show data on the hosted owner deployment — the files do not exist on the host.
Roadmap already solved this pattern: `lib/snapshot.ts` bakes roadmap files into
`owner-snapshot.json` at snapshot time. Do the same for strategy docs so the
hosted owner view renders them.

## Log

- 2026-07-13 — Filed from the "No data yet" diagnosis session: hosted owner view was broken by a git-built deploy (no owner snapshot); /strategy additionally can never work hosted until docs are baked into the snapshot.
- 2026-07-13 — BUILT + verified. OwnerSnapshot gains `strategy: StrategyDoc[]` (lib/snapshot.ts bakes loadStrategyDocs() beside roadmap); /strategy dispatches by mode like /roadmap (owner → snapshot with ?? [] fallback for older snapshots, local → live files). Verified against the real failure mode: dev server in unified mode with the strategy markdown moved aside (host simulation), real browser login → /strategy rendered the full 71-task board from the snapshot; unauth stayed owner-gated. 73/73 tests, build+lint clean.
