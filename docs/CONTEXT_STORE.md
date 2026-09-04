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

### Sensitive (never publishable)

`private` means *default-not-published*. **`sensitive` means never-publishable** —
a hard exclude that holds even when the underlying GitHub repo is public.

- Mark a single card: `atlas-context add ... --sensitive`.
- Mark a whole repo: add its slug to `sensitiveRepos` in `atlas.config.json`.
  Every card under that repo (by `repoSlug`, or by a project name that maps to
  the slug) is excluded too, and the repo itself is dropped from the public
  snapshot — repos, activity, and AI summaries.

The public snapshot **fails closed**: `scripts/snapshot.ts` independently
re-derives the sensitive set and aborts (non-zero, no file written) if any
sensitive repo name/slug, sensitive card id, or sensitive card text would appear
in the output. Sensitive content still appears in the password-gated owner view
(that is not a public surface) and is flagged with a lock badge in the UI.

> Upgrading from a database created before the `sensitive` column existed? Run
> `npm run setup-db` once — it applies the column migration (idempotent, no data
> loss). The read-only snapshot path never migrates on its own.

## Sessions — which Claude session set this fact

Each card can be attributed to the Claude session that established it
(`context_cards.originSessionId`). The SessionStart hook calls
`atlas-context session begin`, which writes the harness session id to a
gitignored state file and registers the session in one step; a hook can't set an
env var in the Claude process, so `atlas-context add` reads the session id from
`--session`, then `$ATLAS_SESSION_ID`, then that state file. Each card added
under a session records the project/repo it touched and bumps the session's card
count (all measured).

The hook deliberately computes no path of its own. It used to `mkdir` the data
directory and write the file itself, which recreated that directory inside the
repo on every session start; the location now comes from `lib/paths.ts` like
every other data path, so moving the store moves the session state with it.

```
atlas-context session list                       # sessions, newest first
atlas-context session begin --id <id>            # state file + register (the hook calls this)
atlas-context session register --id <id>         # register only, idempotent
atlas-context session update --id <id> --summary "…" --branches a,b
```

The `/sessions` page (owner/local only — never in the public snapshot) lists each
session with the repos/branches it touched, the cards it established, and a
copyable `claude --resume <id>` command to jump back into it. Each context card
links to its originating session.

## Release trains — the release queue as data

A repo's release is a serial resource: one version line, a capped publish
budget, ordered post-publish obligations. Trains keep that state as data
instead of prose handoff files that go stale within a day.

```
atlas-context train enqueue <repo> --item "…" [--closing-step]
                    [--deadline YYYY-MM-DD] [--deadline-action "what to cut"]
atlas-context train status [<repo>] [--json]   # queue, lease, due/overdue triggers
atlas-context train lease <repo> [--ttl-hours N]
atlas-context train release <repo>
atlas-context train done <repo> --id N
atlas-context train surface                    # one line per pending train; silent when none
```

The model: any session **enqueues** obligations at merge time and moves on —
the merge is the handoff, and nobody waits for the release. Exactly one session
at a time holds the **conductor lease** for a repo; taking it is explicit,
another session's unexpired lease refuses loudly, and expiry shows as EXPIRED
rather than being silently reassigned. An item may carry a **deadline** with an
action ("no publish by this date → cut a patch with this item alone"), surfaced
loudly once due. The SessionStart hook prints pending trains via
`train surface`.

Trains are advisory and visible, never enforcing: the existing release gates
remain the enforcement of last resort, and Atlas being unreachable degrades to
files + gates — it can never block a publish.

## Where things live

| Path | What |
|------|------|
| `bin/atlas-context.ts` | the CLI |
| `lib/context/store.ts` | add / get / verify / freshness engine |
| `lib/context/train.ts` | release trains: queue / lease / deadline logic |
| `lib/context/provenance.ts` | source hashing + drift detection |
| `lib/context/metrics.ts` | metrics + honesty constants |
| `data/atlas.db` (table `context_cards`) | the cards (gitignored) |
| `data/atlas.db` (table `context_events`) | the event log behind the metrics |
| `data/atlas.db` (table `sessions`) | the Claude session registry (gitignored) |
| `data/atlas.db` (tables `release_trains`, `train_items`) | the release trains (gitignored) |
| `data/.current-session` | the harness session id the hook records (gitignored) |
| `lib/paths.ts` | the ONLY module that computes a data or artifact path |

Run from anywhere: the CLI always uses the Atlas repo's database, while
`--source` paths and verify commands resolve against your current directory
(override with `--cwd`).
