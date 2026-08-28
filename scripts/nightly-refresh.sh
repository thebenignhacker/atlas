#!/bin/bash
# Nightly Atlas refresh — the zero-session-token cloud leg of the streaming design.
#
# Runs from a user LaunchAgent (com.ecolibria.atlas-nightly) at 05:30 local — after the
# 04:00 router reboot window — via `/bin/zsh -lc` so the login environment (PATH, keys the
# snapshot generators read) is present without baking anything into the plist. No Claude
# session is involved; nothing this produces enters model context.
#
# Order matters: a failed scan aborts before any snapshot so a bad walk can never ship.
# The scan script itself refuses to overwrite a populated portfolio with an empty walk;
# this wrapper adds the between-steps discipline.

set -uo pipefail
ATLAS="$HOME/workspace/atlas"
LOG="$ATLAS/.nightly-refresh.log"

# Bounded log: rotate at ~1MB.
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1000000 ]; then
  mv -f "$LOG" "$LOG.1"
fi

{
  echo "=== nightly refresh $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
  cd "$ATLAS" || { echo "FATAL: atlas checkout missing"; exit 1; }

  if ! npm run scan; then
    echo "ABORT: scan failed — snapshots and deploy skipped (stale cloud beats wrong cloud)"
    exit 1
  fi
  if ! npm run snapshot; then
    echo "ABORT: public snapshot failed (sanitization refusal is a stop, not a skip)"
    exit 1
  fi
  if ! npm run snapshot:owner; then
    echo "ABORT: owner snapshot failed — deploy skipped"
    exit 1
  fi
  if ! vercel deploy --prod --yes; then
    echo "DEPLOY FAILED: local data is current; cloud lags until the next run"
    exit 1
  fi
  echo "=== done $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
} >> "$LOG" 2>&1
