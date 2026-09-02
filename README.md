# Atlas

A local-first command center for developers who build many projects with LLM coding tools.

If you run Claude Code, Cursor, Copilot, or any agent across dozens of repos, you lose
the mental map every time you start a fresh session. Atlas rebuilds it: one screen for
every project, every scattered todo, what moved, what is going stale, and what to do
next. Your data never leaves your machine.

```bash
git clone https://github.com/thebenignhacker/atlas.git
cd atlas
npm install
cp atlas.config.example.json atlas.config.json   # point it at your project roots
npm run setup-db && npm run scan                  # scan your repos + todos
npm run dev                                        # open http://localhost:3000
```

That is the whole setup. The dashboard reads a local SQLite snapshot, so it loads
instantly and works offline.

## What you get

- **Portfolio map** — every repo as a card: language, public/private/fork, last-commit
  recency (color-coded), open PRs and todos, and actionable flags (uncommitted work,
  unpushed commits, behind upstream). Search, filter, and sort across all of them.
- **Todo command center** — every scattered todo markdown file, parsed and unified.
  Filter by priority (P0-P3), status, repo, or staleness. One click opens the source
  file in your editor.
- **Activity feed** — a cross-repo commit timeline and contribution heatmap, so you can
  see where your energy actually went.
- **AI digest** (optional) — a grounded briefing on what moved, what is stalling, and a
  short suggested-focus list. Built on measured facts, never invented.
- **Context Store** — verified facts about each project that flag themselves when they
  go stale, so you stop re-deriving "what's the status of X" every session. See below.
- **Usage** — which Claude Code features your work actually leans on, mined from your
  local session transcripts: per-feature counts and last-used, a 30-day activity trend,
  category and project breakdowns, and a prompt for high-leverage features you rarely
  reach for. It also mines recurring tool-sequences you repeat by hand and proposes a
  starting scaffold to automate each. Metadata only — tool names and timing, never
  commands or file contents.

## Context Store — stored context that can't quietly lie

Notes, indexes, and ledgers decay. An index says "last updated April"; a session trusts
it and acts on a fact that shipped weeks ago. Context that isn't trust-tagged is *worse*
than none — it misleads with confidence.

The Context Store fixes the part that actually matters: **freshness**. Each fact is a
small **card** pinned to the source files it came from (content-hashed) plus a one-line
re-check command. Read a project's cards at the start of a session instead of re-reading
the repo. When a card's sources change, it shows up flagged **re-verify** — it never
silently asserts something that has since become false.

```bash
# write a fact when you verify it (the source files are hashed for you)
atlas-context add --project nanomind --subject "classifier version" \
  --claim "classifier published at 0.5.0" \
  --source nanomind/nanomind-models.json \
  --verify 'jq -e ".models[\"nanomind-security-classifier\"].huggingface.publishedVersion==\"0.5.0\"" nanomind/nanomind-models.json' \
  --stale-after 30

# read it back next session — in one call, not a repo re-read
atlas-context get --project nanomind
#  [FRESH]   classifier version  nanomind   classifier published at 0.5.0
#  [DRIFTED] training corpus     nanomind   re-verify: jq -e '...' nanomind-models.json
```

The dashboard's **Context** view turns this into a panel: the hero number is **stale
facts caught before they misled a session** (counted from an event log — measured, not
estimated), alongside a freshness-coverage gauge and a conservative tokens-saved
estimate (labeled as an estimate, always). Cards default to private and live in the
gitignored database; only cards you explicitly mark public reach the public demo, with
their source paths and commands stripped. Full guide: [docs/CONTEXT_STORE.md](docs/CONTEXT_STORE.md).

## How it works

```
your filesystem + local git + GitHub API + (optional) an LLM
        |   npm run scan
        v
   SQLite (data/atlas.db)        <- single source of truth, stays on your machine
        v
   Next.js dashboard             <- reads the snapshot, renders instantly
```

`npm run scan` walks the roots in `atlas.config.json`, reads local git (last commit,
branch, dirty state, ahead/behind, recent commits), parses your todo markdown, and
enriches each repo with GitHub data (visibility, stars, forks, open PRs). GitHub
enrichment uses `GITHUB_TOKEN` if set, otherwise falls back to the `gh` CLI, otherwise
skips cleanly. Re-run it anytime, or schedule it.

## Configuration

Edit `atlas.config.json` (copied from the example):

| Field | What it does |
|---|---|
| `scanRoots` | Directories to scan for git repos |
| `scanDepth` | How many levels deep to look for a `.git` folder |
| `todoDirs` | Directories holding your todo markdown files |
| `github.user` / `github.orgs` | Your GitHub identity, used for enrichment |
| `ai.enabled` | Turn the AI layer on or off (default: off) |
| `ai.provider` | `anthropic`, `openai`, or `ollama` |
| `ai.optInRepos` / `ai.allowPrivate` | Which repos may have content sent to an LLM |

## The AI layer is optional and private by design

Atlas is fully usable with no API key. When you enable AI:

- **Pluggable** — Anthropic (default), OpenAI, or a local Ollama model.
- **Private by default** — only public (or explicitly opted-in) repos ever have content
  sent to a provider. Private repos are excluded unless you opt in. The Settings page
  shows exactly what gets sent.
- **Cheap** — results are cached by content hash, so re-scanning never re-spends tokens
  unless the underlying content changed.
- **Grounded** — AI output is built from measured facts, clearly marked as generated,
  and never mixed with your real git data.
- **Self-learning** — when you correct something the AI got wrong, Atlas records the
  correction and feeds it back into future prompts, so it stops repeating the mistake.
  This is a local feedback loop, not model training. See it in Settings.

To enable: set `ai.enabled` to `true` and provide a key
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) in your environment or a `.env` file.

## Scripts

| Command | What it does |
|---|---|
| `npm run setup-db` | Create the local SQLite schema |
| `npm run scan` | Scan your repos, todos, and session board into the database |
| `npm run scan:usage` | Mine Claude Code feature usage from local session transcripts |
| `npm run snapshot` | Generate the sanitized public snapshot (for a public demo) |
| `npm run snapshot:owner` | Generate the full owner snapshot (for a private remote view) |
| `npm run hash-password` | Hash the owner password for `OWNER_PASSWORD_HASH` (reads stdin) |
| `npm run dev` | Start the dashboard (full local view) |
| `npm run build` / `npm start` | Production build and serve |

**Roadmap census** counts every unit Atlas tracks, by status, across all `todoDirs`:

```
python3 scripts/roadmap-census.py --md --list in-progress
```

Buckets: completed, in-progress, in-review, queued, blocked, parked, unknown. A unit with no
readable `Status:` field lands in unknown and is reported, not dropped.

## Deployment modes

Atlas runs in four modes from one codebase, selected by `ATLAS_MODE`:

- **Local (default):** reads the full SQLite database. You see everything. No login,
  because it is your machine.
- **Public (`ATLAS_MODE=public`):** reads only `public-snapshot.json` and serves a
  sanitized, read-only view. Private repos, forks, local file paths, todos, and settings
  are never present. The full database is never deployed, so it cannot leak.
- **Owner (`ATLAS_MODE=owner`):** reads `owner-snapshot.json` (your full data) behind a
  password — a standalone private deployment.
- **Unified (`ATLAS_MODE=unified`):** ONE deployment that serves the public showcase to
  everyone and your full private data once you log in. The data source is chosen **per
  request** — a request with a valid owner session reads the owner snapshot, everyone else
  reads the public one. Both snapshots are bundled; owner data is never served without a
  verified session. This is how the public site and the private view live on a single
  project.

### Public demo

1. Choose which owners are public in `atlas.config.json` via `publicOwners`
   (empty means all public repos; list specific orgs/users to scope it).
2. Run `npm run snapshot`. It writes `public-snapshot.json` and aborts if any private
   data (your username, local paths, private or fork repo names) is detected.
3. Deploy with the environment variable `ATLAS_MODE=public` (for example on Vercel).
   The committed `public-snapshot.json` is the data source; no database is needed.

Re-run `npm run snapshot` and redeploy whenever you want to refresh the public view.

### Private view — log in on the public site (unified mode)

The recommended setup: ONE deployment that shows the public showcase to visitors and your
full private data — including private repos — once you log in. Access is a single password;
no OAuth, no second project.

1. Generate the credentials (locally — the plaintext password never leaves your machine):
   - `AUTH_SECRET` for signing sessions: `openssl rand -base64 32`
   - `OWNER_PASSWORD_HASH`: `echo -n 'your-strong-password' | npm run hash-password`
     (prints `OWNER_PASSWORD_HASH=scrypt:…`; use 16+ chars — the scrypt hash is the only
     brute-force barrier).
2. On the deployment, set these environment variables (never commit them):
   - `ATLAS_MODE=unified`
   - `AUTH_SECRET` (from step 1)
   - `OWNER_PASSWORD_HASH` (from step 1)
3. Run `npm run snapshot` (public) and `npm run snapshot:owner` (full, gitignored) — both
   are bundled; the public one is served to visitors, the owner one only after login.
4. Deploy with both snapshots present in the working directory (for example
   `vercel deploy --prod`). `owner-snapshot.json` ships via the CLI upload, never through
   git, and is read server-side only — it is not an HTTP-reachable static file.

Visitors see the public showcase and an "Owner login" link; logging in unlocks the full
view (private repos, todos, sessions) on the same URL. (A standalone `ATLAS_MODE=owner`
deployment also exists if you prefer the private view on a separate project.)

Security: the password is stored only as a salted **scrypt** hash; sessions are
HMAC-signed (`AUTH_SECRET`), `HttpOnly; Secure; SameSite=Strict` cookies that expire after
7 days. Login is rate-limited per IP. The gate **fails closed** — if `AUTH_SECRET` or
`OWNER_PASSWORD_HASH` is missing, owner mode serves nothing (503). Unauthenticated visitors
are redirected to `/login`. Owner mode is read-only (the host has no database), so re-run
`npm run snapshot:owner` and redeploy to refresh.

## Privacy

Everything stays local. The SQLite database, your config, and `.env` are git-ignored.
Local git facts are never sent anywhere. The only outbound calls are to GitHub (for repo
metadata) and, if you enable it, your chosen LLM provider for eligible repos only.

## License

MIT
