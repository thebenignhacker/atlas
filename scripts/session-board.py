#!/usr/bin/env python3
"""Session-board bridge: parse .claude-sessions/ files USING THE CLAIM GUARD'S OWN PARSER.

The board and the guard must never disagree about what a claim is, which sessions are
active, or which are stale. So this script imports the guard module and calls its
functions -- `claims_in`, `ACTIVE_RE`, `SESSION_ID_RE`, `active_sessions` -- rather than
re-implementing any of them. If the guard cannot be imported, the board is UNAVAILABLE
and says so loudly; it never falls back to a second parser that would drift.

Stale classification is delegated too: a file is stale-active iff it matches the guard's
ACTIVE_RE but is excluded from `guard.active_sessions()` -- the exact set the guard
enforces with, same window, same env override.

Input (stdin JSON):  {"sessionDirs": ["/abs/.claude-sessions", ...],
                      "worktreePaths": ["/abs/tree/.worktrees/slug", ...]}
Output (stdout JSON): see `emit` below. Errors: message on stderr, exit 1.

Selftest (`--selftest`): asserts the guard's parse contract on inline fixtures. The
`session-board-freshness` context card runs this as its verify command; the card also
content-hashes the guard file, so either a behavioural or a textual guard change flags
the board for re-verification.
"""

import importlib.util
import json
import os
import pathlib
import sys
import time

DEFAULT_GUARD = os.path.expanduser("~/.claude/hooks/shared-repo-claim-guard.py")


def fail(msg):
    sys.stderr.write(f"session-board: {msg}\n")
    sys.exit(1)


def load_guard():
    path = os.environ.get("ATLAS_CLAIM_GUARD_PATH", DEFAULT_GUARD)
    if not os.path.isfile(path):
        fail(f"claim guard not found at {path} -- board unavailable (no fallback parser by design)")
    try:
        spec = importlib.util.spec_from_file_location("claim_guard", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception as e:  # noqa: BLE001 -- any import failure means "unavailable", loudly
        fail(f"claim guard at {path} failed to import: {e}")
    for name in ("claims_in", "active_sessions", "ACTIVE_RE", "SESSION_ID_RE"):
        if not hasattr(mod, name):
            fail(f"claim guard at {path} lacks `{name}` -- parser contract changed, board needs updating")
    return mod, path


def first_heading(text):
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("#"):
            return s.lstrip("#").strip()[:160]
    return None


def scan_dir(guard, sdir, worktree_paths):
    sdir = pathlib.Path(sdir)
    if not sdir.is_dir():
        return {"dir": str(sdir), "error": "not a directory", "files": []}
    # The guard's own non-stale-active set: same window, same env override, same skips.
    # my_session_id="" so the scanning session's own file is NOT excluded -- the board
    # shows everyone, including whoever runs the scan.
    live = {f.name for f, _t, _s in guard.active_sessions(sdir, "")}
    now = time.time()
    files = []
    for f in sorted(sdir.glob("*.md")):
        try:
            text = f.read_text(errors="ignore")
            mtime = f.stat().st_mtime
        except OSError:
            continue
        active = bool(guard.ACTIVE_RE.search(text))
        m = guard.SESSION_ID_RE.search(text)
        mentions = [
            w for w in worktree_paths
            if w in text or (".worktrees/" + os.path.basename(w)) in text
        ]
        files.append({
            "file": f.name,
            "active": active,
            "stale": active and f.name not in live,
            "sessionId": m.group(1) if m else None,
            "ageDays": round((now - mtime) / 86400, 2),
            "title": first_heading(text),
            "claims": sorted(guard.claims_in(text)),
            "worktreeMentions": mentions,
        })
    return {"dir": str(sdir), "files": files}


def selftest(guard):
    fixture = (
        "# t\n**Session:** `abc12345-def6`\n**Status:** active\n"
        "- `repo/src/a.ts` and `./repo/b.md` and bare `manifest.json`\n"
    )
    claims = guard.claims_in(fixture)
    assert claims == {"repo/src/a.ts", "repo/b.md"}, f"claims_in contract changed: {claims!r}"
    assert guard.ACTIVE_RE.search(fixture), "ACTIVE_RE no longer matches `**Status:** active`"
    assert guard.ACTIVE_RE.search("Status: active\n"), "ACTIVE_RE no longer matches bare form"
    assert not guard.ACTIVE_RE.search("Status: done\n"), "ACTIVE_RE matches non-active"
    sid = guard.SESSION_ID_RE.search(fixture)
    assert sid and sid.group(1) == "abc12345-def6", "SESSION_ID_RE contract changed"
    print("session-board selftest: guard parser contract holds")


def main():
    guard, guard_path = load_guard()
    if "--selftest" in sys.argv:
        selftest(guard)
        return
    try:
        req = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError) as e:
        fail(f"bad input JSON: {e}")
    worktrees = req.get("worktreePaths") or []
    out = {
        "guardPath": guard_path,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dirs": [scan_dir(guard, d, worktrees) for d in (req.get("sessionDirs") or [])],
    }
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
