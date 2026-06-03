# Context Store

Stop re-deriving "what's the status of X" every session.

The Context Store keeps small, verified **context cards** about your projects —
each card is a fact plus the source files it came from, a fingerprint of those
files, and a one-line command to re-check it. Read a project's cards at the
start of a session instead of re-reading the repo. When a card's sources change,
it shows up flagged **re-verify** — it never silently asserts something that has
since become false.

```
$ atlas-context get --project nanomind
2 cards

[FRESH] classifier version  nanomind
  classifier published at 0.5.0
  sources: nanomind-models.json  ·  verified 2 minutes ago

[DRIFTED] training corpus  nanomind
  corpus frozen at sft-v6
  sources: nanomind-models.json  ·  verified 3 days ago
  changed: nanomind-models.json
  re-verify: jq -e '...' nanomind/nanomind-models.json
```

## Why

Stored context decays. An index says "last updated April", a ledger lists a
follow-up as open that shipped weeks ago — and a session trusts it. Context that
isn't trust-tagged is *worse* than none, because it misleads with confidence.

The hard part isn't storage, it's **freshness**. So every card carries:

- **provenance** — the source files it was derived from, hashed at derivation time
- a **verify command** — exits 0 if the claim still holds
- a **freshness** state — recomputed from the above, surfaced on every read

A card is a *pointer to truth that lives in your code*, not a copy of it. If the
code changes, the card drifts and tells you to look again.

## The three habits

1. **write-on-derive** — when you verify a non-obvious fact about a project,
   write a card with the source(s) and (for anything numeric or stateful) a
   verify command:
   ```
   atlas-context add --project nanomind --subject "classifier version" \
     --claim "classifier published at 0.5.0" \
     --source nanomind/nanomind-models.json \
     --verify 'jq -e ".models[\"nanomind-security-classifier\"].huggingface.publishedVersion == \"0.5.0\"" nanomind/nanomind-models.json' \
     --stale-after 30
   ```
2. **read-at-start** — `atlas-context get --project X` instead of re-reading the
   repo. Add `--fresh-only` to see just the trustworthy cards.
3. **re-verify-on-stale** — if a card is flagged `DRIFTED` / `EXPIRED` / `STALE`,
   run its verify command (or `atlas-context verify <id>`), then update the card
   (re-`add` it to re-capture sources) or `supersede` it. **Never trust a flagged
   card.**

## Freshness states

| State | Meaning | What to do |
|-------|---------|-----------|
| `FRESH` | sources unchanged, verify (if any) passed, within TTL | trust it |
| `DRIFTED` | a source file changed since derivation | re-derive: re-`add` the card |
| `EXPIRED` | past its `--stale-after` window (time-sensitive cards) | re-run verify |
| `STALE` | the verify command failed | re-derive or `supersede` |
| `UNVERIFIED` | stored with no source and no verify (`--confidence unverified`) | treat as a hint, not a fact |

Notes on the model:
- A **provenance card** (has `--source`) stays `FRESH` as long as its sources are
  unchanged — the drift-check *is* the verification, so TTL doesn't expire it.
  Use `--source` for facts pinned to a file.
- A **verify-only card** (only `--verify`, no source) is time-sensitive: it
  `EXPIRED`s past its TTL and is refreshed only by actually re-running the
  command. Use it for facts the file can't prove (e.g. "prod endpoint responds").
- A card must be born checkable: `add` rejects a card with neither a source nor a
  verify command, unless you pass `--confidence unverified` (and it's flagged
  forever).

## Metrics & the honesty contract

`atlas-context metrics` (and the Atlas dashboard) report:

- **Stale facts caught** (hero) — counted from an append-only event log, logged
  exactly once when a card flips out of `FRESH`. This number is **measured**.
- **Freshness coverage** — a live count of cards by state. Measured.
- **Tokens saved** — the *only* estimate, and labeled as such everywhere. It is
  a deliberately conservative lower bound: for each recorded read,
  `max(0, RE_READ_BASELINE_TOKENS − cards_served × TOKENS_PER_CARD)`. The
  baseline (`6,000` tokens) is below the real cost of re-deriving a project's
  state by re-reading an index + sources + a little git archaeology. Constants
  live in `lib/context/metrics.ts`. Never presented as exact-measured.

### Cost: is this cheaper than re-reading?

The store only earns its place if reading cards costs less than re-deriving
state. Dogfood baseline (NanoMind, measured once):

- Re-deriving "current NanoMind state" the old way — open the master index, the
  CDS ledger, and the model manifest, then sanity-check against git — is on the
  order of several thousand tokens, and (this is the real cost) it can be
  **wrong** when those docs have decayed.
- `atlas-context get --project nanomind` returns the cards in a few hundred
  tokens, each tagged with whether it's still true.

If maintaining a card ever costs more than it saves, `retire` it.

## Public / private

- Cards default to `--visibility private`. The card database lives in the
  gitignored `data/atlas.db` and never enters git.
- The public Atlas snapshot includes only `--visibility public` cards, with
  source paths and verify commands stripped and private repo names redacted (see
  the snapshot adversarial check). Mark a card `public` only when its claim is
  safe to show on the public demo.

## Where things live

| Path | What |
|------|------|
| `bin/atlas-context.ts` | the CLI |
| `lib/context/store.ts` | add / get / verify / freshness engine |
| `lib/context/provenance.ts` | source hashing + drift detection |
| `lib/context/metrics.ts` | metrics + honesty constants |
| `data/atlas.db` (table `context_cards`) | the cards (gitignored) |
| `data/atlas.db` (table `context_events`) | the event log behind the metrics |

Run from anywhere: the CLI always uses the Atlas repo's database, while
`--source` paths and verify commands resolve against your current directory
(override with `--cwd`).
