#!/usr/bin/env python3
"""Count roadmap units by status across every todoDir in atlas.config.json.

Usage: python3 scripts/roadmap-census.py [--md] [--list STATUS,...]
Statuses are read from the **Status:** field and folded into five buckets:
completed, in-progress, in-review, queued, blocked, parked, unknown.
"""
import collections, glob, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg = json.load(open(os.path.join(ROOT, 'atlas.config.json')))
BUCKET = {
    'done': 'completed', 'done.': 'completed',
    'in-progress': 'in-progress', 'in_progress': 'in-progress', 'inprogress': 'in-progress',
    'doing': 'in-progress', 'active': 'in-progress', 'exploring': 'in-progress', 'in': 'in-progress',
    'in-review': 'in-review', 'review': 'in-review',
    'ready': 'queued', 'todo': 'queued', 'planned': 'queued', 'backlog': 'queued', 'open': 'queued',
    'blocked': 'blocked',
    'retired': 'parked', 'superseded': 'parked', 'wontfix': 'parked', 'cut': 'parked', 'parked': 'parked',
}
def field(t, k):
    m = re.search(r'^\*{0,2}%s\*{0,2}\s*[:|]\s*(.+)$' % k, t, re.M | re.I)
    return m.group(1).strip().strip('*`').strip() if m else ''
units = []
for d in cfg.get('todoDirs', []):
    d = os.path.expanduser(d)
    tree = d.replace(os.path.expanduser('~/workspace/'), '').removesuffix('/todo')
    for f in glob.glob(os.path.join(d, 'roadmap', '*.md')):
        if os.path.basename(f).upper().startswith('README'):
            continue
        t = open(f, errors='ignore').read()
        raw = field(t, 'Status').lower().split()[0].strip(',;') if field(t, 'Status') else 'unknown'
        title = re.search(r'^#\s+(.+)$', t, re.M)
        units.append(dict(tree=tree, file=os.path.basename(f), raw=raw, bucket=BUCKET.get(raw, 'unknown'),
                          repos=field(t, 'Repos') or field(t, 'Repo') or '-', prio=field(t, 'Priority') or '-',
                          title=(title.group(1).strip() if title else os.path.basename(f))))
md = '--md' in sys.argv
want = None
for a in sys.argv[1:]:
    if a.startswith('--list'):
        want = (a.split('=', 1)[1] if '=' in a else sys.argv[sys.argv.index(a) + 1]).split(',')
order = ['completed', 'in-progress', 'in-review', 'queued', 'blocked', 'parked', 'unknown']
tot = collections.Counter(u['bucket'] for u in units)
per = collections.defaultdict(collections.Counter)
for u in units: per[u['tree']][u['bucket']] += 1
hdr = '| tree | total | ' + ' | '.join(order) + ' |'
print(f"# Roadmap queue census\n\nUnits: {len(units)} across {len(per)} trees.\n" if md else f"units={len(units)} trees={len(per)}")
if md: print(hdr); print('|' + '---|' * (len(order) + 2))
for tree, c in sorted(per.items(), key=lambda kv: -sum(kv[1].values())):
    row = [tree, str(sum(c.values()))] + [str(c[b]) for b in order]
    print('| ' + ' | '.join(row) + ' |' if md else '  '.join(row))
row = ['ALL', str(len(units))] + [str(tot[b]) for b in order]
print('| **' + '** | **'.join(row) + '** |' if md else '  '.join(row))
raw_odd = collections.Counter(u['raw'] for u in units if u['raw'] not in ('done', 'in-progress', 'ready', 'todo', 'blocked', 'retired', 'in-review'))
if raw_odd: print(f"\nNon-canonical Status spellings: {dict(raw_odd)}")
if want:
    for b in want:
        rows = sorted((u for u in units if u['bucket'] == b), key=lambda u: (u['prio'], u['tree'], u['repos']))
        print(f"\n## {b} ({len(rows)})\n")
        if md: print('| prio | tree | repos | work |\n|---|---|---|---|')
        for u in rows:
            print(f"| {u['prio']} | {u['tree']} | {u['repos'][:70]} | {u['title'][:110]} |" if md else f"{u['prio']}  {u['tree']}  {u['repos'][:50]}  {u['title'][:100]}")
