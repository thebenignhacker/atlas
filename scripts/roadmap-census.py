#!/usr/bin/env python3
"""Count roadmap units by status across every todoDir in atlas.config.json.

Usage: python3 scripts/roadmap-census.py [--md] [--json] [--list STATUS,...] [--config PATH] [--no-fetch]

Units are read from each tree's origin/main, never from its working tree: a checkout that
trails its remote is a stale copy of the store, and counting it undercounts. Each tree is
fetched first (`git fetch origin main`; --no-fetch reads the last fetched ref instead), its
roadmap files are listed with `git ls-tree` and read with `git cat-file`, so a unit that
exists only on origin is counted and one that exists only in the checkout is not. Every
tree prints the origin/main sha it was read at, how many commits its checkout is behind and
ahead, and how many units on origin are absent from the checkout (what a reader of the
working tree, such as the board, does not see). A tree whose origin/main does not resolve
prints `unknown`, never 0, and is left out of the totals.

Statuses are read from the **Status:** field and normalized to the seven canonical
statuses the /roadmap board uses -- todo, blocked, ready, in-progress, in-review, done,
retired -- with the SAME rules as atlas/lib/roadmap.ts normalizeStatus(), so the census
and the board never disagree on the same files. An unknown or empty status is `todo`
(seeded, unvetted), never `ready`. A parity test (test/roadmap/census-parity.test.ts)
runs both over shared fixtures. Exit status 2 on a bad argument, 0 otherwise.
"""
import argparse, collections, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORDER = ['todo', 'blocked', 'ready', 'in-progress', 'in-review', 'done', 'retired']
REF = 'origin/main'


def normalize(raw):
    """Port of normalizeStatus() in lib/roadmap.ts. Keep the two in step; the parity
    test fails when they drift."""
    s = (raw or '').lower().strip()
    if re.search(r"\b(superseded|wont[-\s]?fix|won'?t[-\s]?fix|abandoned|retired)\b", s):
        return 'retired'
    if re.search(r"(^|\b)(done|shipped|complete|merged|published|resolved|closed)\b", s):
        return 'done'
    if re.search(r"in[-\s]?review|reviewing|review\b", s):
        return 'in-review'
    if re.search(r"in[-\s]?progress|wip|started|working", s):
        return 'in-progress'
    if re.search(r"blocked|waiting|gated", s):
        return 'blocked'
    if re.search(r"\bready\b", s):
        return 'ready'
    if re.search(r"todo|open|pending", s):
        return 'todo'
    return 'todo'


def field(t, k):
    m = re.search(r'^\*{0,2}%s\*{0,2}\s*[:|]\s*(.+)$' % k, t, re.M | re.I)
    return m.group(1).strip().strip('*`').strip() if m else ''


def git(cwd, *a, data=None, timeout=60):
    """Run git in cwd and return (ok, stdout bytes). Never prompts for credentials."""
    try:
        r = subprocess.run(['git', '-C', cwd, *a], input=data, capture_output=True, timeout=timeout,
                           env=dict(os.environ, GIT_TERMINAL_PROMPT='0'))
    except (OSError, subprocess.TimeoutExpired):
        return False, b''
    return r.returncode == 0, r.stdout


def is_unit(name):
    return name.endswith('.md') and not name.upper().startswith('README')


fetched = {}  # repo top level -> fetch ok, so todoDirs that share a repo fetch it once


def read_tree(d, fetch):
    """Read one todoDir's roadmap units at origin/main. Returns (source, [(file, text)]);
    source['sha'] is None when the tree cannot be read, and source['why'] says why."""
    src = dict(sha=None, fetch='skipped', behind=None, ahead=None, absent=None, why='')
    ok, top = git(d, 'rev-parse', '--show-toplevel')
    if not ok:
        src['why'] = 'not a git checkout'
        return src, []
    if fetch:
        top = top.decode().strip()
        if top not in fetched:
            fetched[top] = git(d, 'fetch', '--quiet', 'origin', 'main', timeout=120)[0]
        src['fetch'] = 'ok' if fetched[top] else 'failed'
    ok, sha = git(d, 'rev-parse', '--verify', '--quiet', REF + '^{commit}')
    if not ok:
        src['why'] = f'{REF} does not resolve'
        return src, []
    sha = sha.decode().strip()
    # The todoDir may be a subdirectory of its repo (prefix 'todo/'); --full-tree makes
    # ls-tree take and print paths from the repo root either way.
    prefix = git(d, 'rev-parse', '--show-prefix')[1].decode().strip()
    ok, listing = git(d, 'ls-tree', '--full-tree', '-z', sha, '--', prefix + 'roadmap/')
    if not ok:
        src['why'] = f'cannot list roadmap/ at {sha[:12]}'
        return src, []
    entries = []
    for rec in listing.split(b'\0'):
        meta, _, p = rec.decode('utf-8', 'surrogateescape').partition('\t')
        if not p:
            continue
        typ, oid = meta.split()[1:3]
        name = p.rsplit('/', 1)[-1]
        if typ == 'blob' and is_unit(name):
            entries.append((name, oid))
    entries.sort()
    files = []
    if entries:
        ok, out = git(d, 'cat-file', '--batch', data=''.join(o + '\n' for _, o in entries).encode())
        try:
            i = 0
            for name, _ in entries:
                j = out.index(b'\n', i)
                size = int(out[i:j].split()[2])
                files.append((name, out[j + 1:j + 1 + size].decode('utf-8', 'ignore')))
                i = j + 1 + size + 1
        except (ValueError, IndexError):
            ok = False
        if not ok:
            src['why'] = f'cannot read roadmap blobs at {sha[:12]}'
            return src, []
    src['sha'] = sha
    ok, lr = git(d, 'rev-list', '--left-right', '--count', 'HEAD...' + sha)
    if ok:
        src['ahead'], src['behind'] = (int(n) for n in lr.split())
    src['absent'] = sum(1 for name, _ in entries if not os.path.exists(os.path.join(d, 'roadmap', name)))
    return src, files


ap = argparse.ArgumentParser(description='Count roadmap units by status across every todoDir in atlas.config.json.')
ap.add_argument('--md', action='store_true', help='markdown tables instead of plain columns')
ap.add_argument('--json', action='store_true', help='one JSON object per unit (tree, sha, file, raw, status, repos, prio, title), for tooling and the parity test; unknown trees are reported on stderr')
ap.add_argument('--list', metavar='STATUS[,STATUS]', help='also list the units in these statuses: ' + ', '.join(ORDER))
ap.add_argument('--config', metavar='PATH', default=os.path.join(ROOT, 'atlas.config.json'), help='config file to read todoDirs from (default: the repo atlas.config.json)')
ap.add_argument('--no-fetch', action='store_true', help=f'read the last fetched {REF} instead of fetching it first')
args = ap.parse_args()
md = args.md
want = None
if args.list:
    want = [b.strip() for b in args.list.split(',') if b.strip()]
    bad = [b for b in want if b not in ORDER]
    if bad:
        ap.error(f"unknown status(es) {', '.join(bad)}; choose from {', '.join(ORDER)}")

cfg = json.load(open(args.config))
units, sources = [], {}
for d in cfg.get('todoDirs', []):
    d = os.path.expanduser(d)
    tree = d.replace(os.path.expanduser('~/workspace/'), '').removesuffix('/todo')
    src, files = read_tree(d, not args.no_fetch)
    sources[tree] = src
    for name, t in files:
        raw = field(t, 'Status')
        title = re.search(r'^#\s+(.+)$', t, re.M)
        units.append(dict(tree=tree, sha=src['sha'], file=name, raw=raw, status=normalize(raw),
                          repos=field(t, 'Repos') or field(t, 'Repo') or '-', prio=field(t, 'Priority') or '-',
                          title=(title.group(1).strip() if title else name)))
unknown = [t for t, s in sources.items() if not s['sha']]

if args.json:
    for t in unknown:
        print(f"roadmap-census: {t}: unknown ({sources[t]['why']}), not counted", file=sys.stderr)
    for t, s in sources.items():
        if s['sha'] and s['fetch'] == 'failed':
            print(f"roadmap-census: {t}: fetch failed, read the last fetched {REF}", file=sys.stderr)
    for u in units:
        print(json.dumps(u))
    sys.exit(0)

tot = collections.Counter(u['status'] for u in units)
per = {t: collections.Counter() for t, s in sources.items() if s['sha']}
for u in units:
    per[u['tree']][u['status']] += 1
hdr = '| tree | total | ' + ' | '.join(ORDER) + ' |'
if md:
    note = f" {len(unknown)} tree(s) unknown, not in the totals." if unknown else ''
    print(f"# Roadmap queue census\n\nUnits: {len(units)} across {len(per)} trees, read from {REF}.{note}\n")
    print(hdr); print('|' + '---|' * (len(ORDER) + 2))
else:
    print(f"units={len(units)} trees={len(per)} unknown={len(unknown)}")
for tree, c in sorted(per.items(), key=lambda kv: -sum(kv[1].values())):
    row = [tree, str(sum(c.values()))] + [str(c[b]) for b in ORDER]
    print('| ' + ' | '.join(row) + ' |' if md else '  '.join(row))
for tree in unknown:
    row = [tree, 'unknown'] + ['-'] * len(ORDER)
    print('| ' + ' | '.join(row) + ' |' if md else '  '.join(row))
row = ['ALL', str(len(units))] + [str(tot[b]) for b in ORDER]
print('| **' + '** | **'.join(row) + '** |' if md else '  '.join(row))

# Where each count came from, and how far each checkout trails it.
def num(v):
    return '-' if v is None else str(v)
if sources:
    how = 'the last fetched ref, --no-fetch' if args.no_fetch else 'fetched before reading'
    if md:
        print(f"\n## Source\n\nEach tree is read at its {REF} ({how}), never at its working tree. The checkout columns"
              " say how far the local checkout trails that sha; units absent from the checkout are on origin"
              " but missing from what a working-tree reader sees.\n")
        print(f'| tree | {REF} | fetch | checkout behind | checkout ahead | units absent from checkout |')
        print('|---|---|---|---|---|---|')
    else:
        print(f"\nsource: {REF} per tree ({how})")
    for tree, s in sources.items():
        if md:
            sha = f"`{s['sha']}`" if s['sha'] else f"unknown ({s['why']})"
            print(f"| {tree} | {sha} | {s['fetch']} | {num(s['behind'])} | {num(s['ahead'])} | {num(s['absent'])} |")
        elif s['sha']:
            print(f"  {tree}  {s['sha']}  fetch={s['fetch']}  behind={num(s['behind'])}  ahead={num(s['ahead'])}  absent={num(s['absent'])}")
        else:
            print(f"  {tree}  unknown ({s['why']})  fetch={s['fetch']}")
    gap = [t for t, s in sources.items() if s['behind'] or s['absent']]
    if gap:
        missing = sum(sources[t]['absent'] or 0 for t in gap)
        print(f"\nCheckout gap: {len(gap)} tree(s) trail {REF} ({', '.join(gap)}); a reader of those working trees"
              f" misses {missing} unit(s) counted above.")
# Spellings the board folds by rule rather than reads verbatim. Listed so the
# writers can be fixed; the count above already places them.
canon = set(ORDER)
raw_odd = collections.Counter(u['raw'].lower().split()[0].strip(',;.') if u['raw'] else '(empty)' for u in units if (u['raw'] or '').lower().strip() not in canon)
if raw_odd:
    print(f"\nNon-canonical Status spellings ({sum(raw_odd.values())} unit(s), folded by rule): {dict(raw_odd)}")
if want:
    for b in want:
        rows = sorted((u for u in units if u['status'] == b), key=lambda u: (u['prio'], u['tree'], u['repos']))
        print(f"\n## {b} ({len(rows)})\n")
        if md:
            print('| prio | tree | repos | work |\n|---|---|---|---|')
        for u in rows:
            print(f"| {u['prio']} | {u['tree']} | {u['repos'][:70]} | {u['title'][:110]} |" if md else f"{u['prio']}  {u['tree']}  {u['repos'][:50]}  {u['title'][:100]}")
