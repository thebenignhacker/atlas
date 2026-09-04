#!/usr/bin/env python3
"""Count roadmap units by status across every todoDir in atlas.config.json.

Usage: python3 scripts/roadmap-census.py [--md] [--json] [--list STATUS,...] [--config PATH]

Statuses are read from the **Status:** field and normalized to the seven canonical
statuses the /roadmap board uses -- todo, blocked, ready, in-progress, in-review, done,
retired -- with the SAME rules as atlas/lib/roadmap.ts normalizeStatus(), so the census
and the board never disagree on the same files. An unknown or empty status is `todo`
(seeded, unvetted), never `ready`. A parity test (test/roadmap/census-parity.test.ts)
runs both over shared fixtures. Exit status 2 on a bad argument, 0 otherwise.
"""
import argparse, collections, glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORDER = ['todo', 'blocked', 'ready', 'in-progress', 'in-review', 'done', 'retired']


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


ap = argparse.ArgumentParser(description='Count roadmap units by status across every todoDir in atlas.config.json.')
ap.add_argument('--md', action='store_true', help='markdown tables instead of plain columns')
ap.add_argument('--json', action='store_true', help='one JSON object per unit (tree, file, raw, status, repos, prio, title), for tooling and the parity test')
ap.add_argument('--list', metavar='STATUS[,STATUS]', help='also list the units in these statuses: ' + ', '.join(ORDER))
ap.add_argument('--config', metavar='PATH', default=os.path.join(ROOT, 'atlas.config.json'), help='config file to read todoDirs from (default: the repo atlas.config.json)')
args = ap.parse_args()
md = args.md
want = None
if args.list:
    want = [b.strip() for b in args.list.split(',') if b.strip()]
    bad = [b for b in want if b not in ORDER]
    if bad:
        ap.error(f"unknown status(es) {', '.join(bad)}; choose from {', '.join(ORDER)}")

cfg = json.load(open(args.config))
units = []
for d in cfg.get('todoDirs', []):
    d = os.path.expanduser(d)
    tree = d.replace(os.path.expanduser('~/workspace/'), '').removesuffix('/todo')
    for f in sorted(glob.glob(os.path.join(d, 'roadmap', '*.md'))):
        if os.path.basename(f).upper().startswith('README'):
            continue
        t = open(f, errors='ignore').read()
        raw = field(t, 'Status')
        title = re.search(r'^#\s+(.+)$', t, re.M)
        units.append(dict(tree=tree, file=os.path.basename(f), raw=raw, status=normalize(raw),
                          repos=field(t, 'Repos') or field(t, 'Repo') or '-', prio=field(t, 'Priority') or '-',
                          title=(title.group(1).strip() if title else os.path.basename(f))))

if args.json:
    for u in units:
        print(json.dumps(u))
    sys.exit(0)

tot = collections.Counter(u['status'] for u in units)
per = collections.defaultdict(collections.Counter)
for u in units:
    per[u['tree']][u['status']] += 1
hdr = '| tree | total | ' + ' | '.join(ORDER) + ' |'
print(f"# Roadmap queue census\n\nUnits: {len(units)} across {len(per)} trees.\n" if md else f"units={len(units)} trees={len(per)}")
if md:
    print(hdr); print('|' + '---|' * (len(ORDER) + 2))
for tree, c in sorted(per.items(), key=lambda kv: -sum(kv[1].values())):
    row = [tree, str(sum(c.values()))] + [str(c[b]) for b in ORDER]
    print('| ' + ' | '.join(row) + ' |' if md else '  '.join(row))
row = ['ALL', str(len(units))] + [str(tot[b]) for b in ORDER]
print('| **' + '** | **'.join(row) + '** |' if md else '  '.join(row))
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
