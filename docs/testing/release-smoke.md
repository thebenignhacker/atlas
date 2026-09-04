# Release smoke test

Run this before a deploy or a tag, as a new user would: a fresh clone, no context,
real commands. Unit tests are necessary and not sufficient; this is the walkthrough
that catches a page that renders but is wrong.

## 1. Fresh clone

```bash
git clone https://github.com/thebenignhacker/atlas.git /tmp/atlas-smoke && cd /tmp/atlas-smoke
npm ci
cp atlas.config.example.json atlas.config.json   # then point scanRoots/todoDirs at real dirs
npm run typecheck && npm run lint && npm test
```

Expected: typecheck and lint print nothing; the test summary reports `# fail 0`.

## 2. Index and dashboard

```bash
npm run setup-db && npm run scan
ATLAS_MODE=local npx next dev -p 3100
```

Expected from `scan`: a repo count that matches what you know is on disk, a todo count,
`parsed N decision cards` (and, if any were refused, `M not ingested (listed on /decisions)`),
and a session-board line. A board that says UNAVAILABLE names the missing parser path.

Open every page and read the numbers, not just the status code:

| Page | Check |
|---|---|
| `/` | Repo cards present; last-commit colours make sense for repos you touched today |
| `/todos` | Count matches the scan line; filters change the list; the editor link opens a real file |
| `/roadmap` | Units grouped by status; change one status in the UI and confirm the unit file changed |
| `/decisions` | Queued and conflict cards first; "Not ingested" count matches the scan line |
| `/session-board` | Trees listed, or a plain sentence saying why the board is unavailable |
| `/context` | Cards with freshness badges; a stale card shows its re-verify command |
| `/usage` | Feature counts and a 30-day trend after `npm run scan:usage` |
| `/strategy` | Empty state names `strategyDocs` if the config has none |
| `/sessions`, `/activity`, `/digest`, `/settings` | Render without an error boundary |

Then the CLI, without `npm link`:

```bash
npm run context -- --help
npm run context -- list --stale
npm run context -- add --project smoke --subject "smoke" --claim "smoke card" --source README.md
npm run context -- get --project smoke
npm run context -- retire smoke:smoke   # the id "add" printed as "saved smoke:smoke"
```

Expected: every hint printed by the tool is a command you can paste back.

## 3. Snapshots and deployed modes

```bash
npm run snapshot          # must exit 0 and write public-snapshot.json
npm run snapshot:owner    # must exit 0; owner-snapshot.json stays git-ignored
git status --short        # only public-snapshot.json may show as modified
ATLAS_MODE=public npm run build && ATLAS_MODE=public npm start
```

Expected on the public build: `/todos`, `/roadmap`, `/decisions`, `/sessions`, `/session-board`,
`/strategy`, `/digest` and `/settings` show the owner-only gate, not data;
`grep -c '"decisions"' public-snapshot.json` prints 0.

For a unified or owner deployment, additionally: log in with a wrong password (refused),
the right password (owner data appears), sign out (public data again).

## 4. Error paths

```bash
npm run context -- frobnicate; echo "exit=$?"            # unknown command: usage, exit 2
npm run context -- add --project x; echo "exit=$?"       # missing args: one-line error, non-zero
ATLAS_DATA_DIR=/tmp/nowhere npm run context -- list; echo "exit=$?"
```

Expected: the last one refuses to create a database and prints the setup-db hint, exit 1,
and `/tmp/nowhere/atlas.db` does not exist afterwards.

## 5. Real input, not synthetic events

For the two interactive flows (roadmap status change, owner login and sign-out) use a real
browser with real clicks and keystrokes. A `dispatchEvent` or scripted form submit passes
through code paths a person never hits; both flows have shipped regressions that only real
input reproduced.

## 6. Why each item exists

| Item | The bug it catches |
|---|---|
| typecheck + test on a fresh clone | A failing DB-path test reached main with no CI to stop it (2026-09-03) |
| Decisions "Not ingested" count | On the maintainer's tree, 2026-09-03, 101 of 242 decision cards were dropped silently and the owner queue under-counted |
| Session board reason sentence | The board depends on an external parser; without the reason the page reads as "no data" |
| Strategy empty state names the key | `strategyDocs` was missing from the example config, so the page was empty with no hint |
| CLI hints are pasteable | Hints printed `atlas-context …`, a command not on PATH without `npm link` |
| Public build hides owner sections | The public snapshot must never carry todos, decisions or session files |
| Sign-out in owner mode | Standalone owner deployments rendered no sign-out control |
| Error paths exit non-zero | A silent zero from a refused database open is how a second empty store appears |

## 7. Record

Note the date, commit, and any check that did not match in the pull request or the tag
message. A mismatch is a release blocker until it is explained or fixed.
