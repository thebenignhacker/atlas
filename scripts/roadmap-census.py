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

Statuses are read from the **Status:** field with a port of field() in atlas/lib/roadmap.ts
(the bold markers are required and the value is read on the field's own line) and
normalized to the seven canonical statuses the /roadmap board uses -- todo, blocked, ready,
in-progress, in-review, done, retired -- with a port of normalizeStatus() in the same file.
An unknown or empty status is `todo` (seeded, unvetted), never `ready`. A parity test
(test/roadmap/census-parity.test.ts) runs the census and the board over shared fixtures and
fails when the two place a fixture in different statuses. Each configured todoDir has its
own row; two that would print under the same name keep their /todo suffix. Exit status 2 on
a bad argument, 0 otherwise.
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
    """Port of field() in lib/roadmap.ts: a `**Key:**` line, colon inside or outside the bold
    markers, read on that line only, so an empty field is '' and never the next line of the
    file. Keep the two in step; the parity test fails when they drift."""
    m = re.search(r'^\*\*%s[: \t]*\*\*[ \t]*:?[ \t]*(.*)$' % re.escape(k), t, re.M | re.I)
    return m.group(1).strip() if m else ''


def bare(v):
    """A field value without the code or bold marks around it, for the printed columns."""
    return v.strip('*`').strip()


# The variables that tie git to one repository: the list `git rev-parse --local-env-vars` prints,
# less GIT_CONFIG_PARAMETERS and GIT_CONFIG_COUNT (`-c` settings, which git itself passes on when it
# runs a command in another repository), plus GIT_NAMESPACE. Git exports GIT_DIR to a hook that
# runs from a linked worktree, and an inherited one would point every `git -C <tree>` below at that
# repository instead of the tree, so none of them is passed on. The rest of the environment, which
# a fetch may need, is.
REPO_LOCAL_GIT_VARS = frozenset((
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE',
    'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS',
    'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'))


def git(cwd, *a, data=None, timeout=60):
    """Run git in cwd and return (ok, stdout bytes). Never prompts for credentials."""
    env = {k: v for k, v in os.environ.items() if k not in REPO_LOCAL_GIT_VARS}
    env['GIT_TERMINAL_PROMPT'] = '0'
    try:
        r = subprocess.run(['git', '-C', cwd, *a], input=data, capture_output=True, timeout=timeout,
                           env=env)
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
dirs = [os.path.expanduser(d) for d in cfg.get('todoDirs', [])]
short = [d.replace(os.path.expanduser('~/workspace/'), '') for d in dirs]
names = [s.removesuffix('/todo') for s in short]
# `<X>/todo` and `<X>` would both print as `<X>`; those keep the suffix, so each prints apart.
names = [s if names.count(n) > 1 else n for s, n in zip(short, names)]
# One source per configured todoDir, in config order: two that share a name still get a row each.
units, sources = [], []
for d, tree in zip(dirs, names):
    src, files = read_tree(d, not args.no_fetch)
    src['tree'], src['units'] = tree, collections.Counter()
    sources.append(src)
    for name, t in files:
        raw = field(t, 'Status')
        title = re.search(r'^#\s+(.+)$', t, re.M)
        units.append(dict(tree=tree, sha=src['sha'], file=name, raw=raw, status=normalize(raw),
                          repos=bare(field(t, 'Repos')) or bare(field(t, 'Repo')) or '-',
                          prio=bare(field(t, 'Priority')) or '-',
                          title=(title.group(1).strip() if title else name)))
        src['units'][units[-1]['status']] += 1
unknown = [s for s in sources if not s['sha']]

if args.json:
    for s in unknown:
        print(f"roadmap-census: {s['tree']}: unknown ({s['why']}), not counted", file=sys.stderr)
    for s in sources:
        if s['sha'] and s['fetch'] == 'failed':
            print(f"roadmap-census: {s['tree']}: fetch failed, read the last fetched {REF}", file=sys.stderr)
    for u in units:
        print(json.dumps(u))
    sys.exit(0)

tot = collections.Counter(u['status'] for u in units)
per = [s for s in sources if s['sha']]
hdr = '| tree | total | ' + ' | '.join(ORDER) + ' |'
if md:
    note = f" {len(unknown)} tree(s) unknown, not in the totals." if unknown else ''
    print(f"# Roadmap queue census\n\nUnits: {len(units)} across {len(per)} trees, read from {REF}.{note}\n")
    print(hdr); print('|' + '---|' * (len(ORDER) + 2))
else:
    print(f"units={len(units)} trees={len(per)} unknown={len(unknown)}")
for s in sorted(per, key=lambda s: -sum(s['units'].values())):
    c = s['units']
    row = [s['tree'], str(sum(c.values()))] + [str(c[b]) for b in ORDER]
    print('| ' + ' | '.join(row) + ' |' if md else '  '.join(row))
for s in unknown:
    row = [s['tree'], 'unknown'] + ['-'] * len(ORDER)
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
    for s in sources:
        tree = s['tree']
        if md:
            sha = f"`{s['sha']}`" if s['sha'] else f"unknown ({s['why']})"
            print(f"| {tree} | {sha} | {s['fetch']} | {num(s['behind'])} | {num(s['ahead'])} | {num(s['absent'])} |")
        elif s['sha']:
            print(f"  {tree}  {s['sha']}  fetch={s['fetch']}  behind={num(s['behind'])}  ahead={num(s['ahead'])}  absent={num(s['absent'])}")
        else:
            print(f"  {tree}  unknown ({s['why']})  fetch={s['fetch']}")
    gap = [s for s in sources if s['behind'] or s['absent']]
    if gap:
        missing = sum(s['absent'] or 0 for s in gap)
        print(f"\nCheckout gap: {len(gap)} tree(s) trail {REF} ({', '.join(s['tree'] for s in gap)}); a reader of those working trees"
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
