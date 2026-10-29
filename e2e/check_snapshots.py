"""`tingly-design check --snapshots` looks at the layout, after `pnpm build`: a copy of the sample deck with a line past
the slide's edge, a line cut off by its box, a faint caption and an empty slide reports each as a layout warning,
while the sample deck itself reports none. Runs the command line on its own projects folder; needs Chrome (DC_CHROME)."""
import os, sys, json, shutil, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def run(projects, name):
    out = subprocess.run(['pnpm', '-s', 'tingly-design', 'check', name, '-n', '--snapshots', '--json'], cwd=REPO, capture_output=True, text=True,
                         env={**os.environ, 'DC_PROJECTS': projects}, timeout=300)
    try: return json.loads(out.stdout)
    except ValueError: raise SystemExit(f'check printed no JSON:\n{out.stdout[-2000:]}\n{out.stderr[-2000:]}')

tmp = tempfile.mkdtemp(prefix='dc-check-')
try:
    projects = os.path.join(tmp, 'projects')
    os.makedirs(projects)
    keep = shutil.ignore_patterns('.journal.jsonl', '.runs.json', 'renders')
    shutil.copytree(os.path.join(REPO, 'projects', 'tingly-design-intro-slides'), os.path.join(projects, 'zz-clean'), ignore=keep)
    bad = os.path.join(projects, 'zz-layout')
    shutil.copytree(os.path.join(REPO, 'projects', 'tingly-design-intro-slides'), bad, ignore=keep)
    box = os.path.join(bad, 'slides', 'box.html')  # a plain background, so contrast can be judged
    s = open(box, encoding='utf-8').read()
    i = s.rindex('</section>')
    s = s[:i] + ('<p style="position:absolute;left:1700px;top:900px;width:600px;font-size:40px">Past the right edge here</p>'
                 '<p style="position:absolute;left:100px;top:40px;width:200px;height:30px;overflow:hidden;font-size:30px">This line is much too long for its box</p>'
                 '<p style="position:absolute;left:100px;top:1000px;font-size:20px;color:#DDDDDD">Faint caption</p>') + s[i:]
    open(box, 'w', encoding='utf-8').write(s)
    open(os.path.join(bad, 'slides', 'empty.html'), 'w').write('<section id="empty" style="background:#FFFFFF"></section>\n')
    # the two-column slide of a generated deck: a 1600px list in a 1fr 1fr grid pushes the card to the edge and squeezes it
    open(os.path.join(bad, 'slides', 'grid.html'), 'w').write(
        '<section id="grid" style="background:#FFFFFF;padding:60px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:40px">'
        '<ul style="width:1600px;font-size:32px;color:#111111"><li>One point</li><li>Another point</li></ul>'
        '<div style="background:#EEF2FF;padding:20px"><p style="font-size:52px;color:#111111;margin:0">最优重设价格是未来边际成本的加权平均</p></div>'
        '</div>'
        # a card placed half past the right edge, and a row whose child will not shrink to fit it
        '<div style="position:absolute;left:1500px;top:700px;width:700px;height:200px;background:#FDE68A;font-size:30px;color:#111111">Card cut by the edge</div>'
        '<div style="display:flex;width:800px;margin-top:300px"><div style="flex:none;width:1200px;height:80px;background:#BBF7D0;font-size:30px;color:#111111">Row child that will not fit</div></div>'
        '</section>\n')
    deck = json.load(open(os.path.join(bad, 'deck.json')))
    deck['order'].append('empty')
    deck['order'].append('grid')
    json.dump(deck, open(os.path.join(bad, 'deck.json'), 'w'), indent=2)

    clean = run(projects, 'zz-clean')
    check('the sample deck draws with no layout warnings', not [p for p in clean['problems'] if p['code'] == 'layout'], json.dumps(clean['problems'])[:300])
    r = run(projects, 'zz-layout')
    got = {(p['file'], p.get('rule')): p for p in r['problems'] if p['code'] == 'layout'}
    check('text past a slide\'s edge is reported', ('slides/box.html', 'outside') in got, str(list(got)))
    check('text cut off by its box is reported', ('slides/box.html', 'clipped') in got, str(list(got)))
    faint = got.get(('slides/box.html', 'contrast'))
    check('a faint caption on a plain background is reported with its contrast', faint and faint['params']['text'] == 'Faint caption' and faint['params']['ratio'] < 2, json.dumps(faint))
    check('an empty slide is reported as blank', ('slides/empty.html', 'blank') in got, str(list(got)))
    check('a box pushed past the slide edge is reported', ('slides/grid.html', 'boxOutside') in got or ('slides/grid.html', 'boxOverflow') in got, str(list(got)))
    check('a box wider than its grid is reported', ('slides/grid.html', 'boxOverflow') in got, str(list(got)))
    check('text squeezed into a narrow column is reported', ('slides/grid.html', 'squeezed') in got, str(list(got)))
    check('layout findings are warnings, so the check still passes', all(p['level'] == 'warning' for p in got.values()))
    check('each slide is still drawn', len(r['snapshots']) == len(deck['order']), str(r.get('snapshots'))[:300])
    # a dashboard: a number that came out as NaN, a chart with nothing in it, labels over each other or cut off
    dclean = os.path.join(projects, 'zz-dash-clean')
    shutil.copytree(os.path.join(REPO, 'projects', 'box-usage'), dclean, ignore=keep)
    dbad = os.path.join(projects, 'zz-dash-bad')
    os.makedirs(os.path.join(dbad, 'datasets')); os.makedirs(os.path.join(dbad, 'data')); os.makedirs(os.path.join(dbad, 'files'))
    shutil.copy(os.path.join(REPO, 'projects/box-usage/data/team.csv'), os.path.join(dbad, 'data/team.csv'))
    open(os.path.join(dbad, 'data/none.csv'), 'w').write('member,requests\n')
    json.dump({'title': 'Bad', 'params': {}}, open(os.path.join(dbad, 'dash.json'), 'w'))
    for id_, f in (('team', 'team.csv'), ('none', 'none.csv')):
        json.dump({'title': id_, 'description': id_, 'source': {'kind': 'file', 'url': 'data/' + f, 'name': f}, 'updated': {'at': '2026-10-01T09:00:00Z', 'by': 'Sample data'}}, open(os.path.join(dbad, 'datasets', id_ + '.json'), 'w'))
    open(os.path.join(dbad, 'files/index.html'), 'w').write('''<div style="padding:20px;font:14px sans-serif">
<p id="total">Total: <span id="t">—</span></p>
<div id="bars" data-source="team"><svg id="b" width="400" height="120"></svg></div>
<div id="empty" data-source="none"><svg id="e" width="400" height="120"><g class="tick"><line x1="0" x2="400" y1="100" y2="100" stroke="#999"/></g><path class="domain" d="M0,100H400" stroke="#999"/></svg></div>
<svg id="over" width="400" height="60"><text x="10" y="30" font-size="14">January sales</text><text x="60" y="30" font-size="14">February sales</text></svg>
<div style="display:none"><div id="tab2" data-source="team"><svg width="300" height="100"></svg></div></div>
<div id="css" data-source="team" style="width:63%;height:8px;background:#36c"></div>
<p>An unset variable is undefined in JavaScript.</p>
<svg id="tip" width="400" height="60"><text x="10" y="30" font-size="14">Tick one</text><g style="opacity:0"><text x="10" y="30" font-size="14">Hidden tooltip</text></g></svg>
<svg id="cut" width="200" height="60"><text x="120" y="30" font-size="14">A label that is too long</text></svg>
</div>
<script>
dash.onData(() => {
  const s = dash.data('team');
  if (s.status !== 'ok') return;
  document.getElementById('t').textContent = Math.round(s.data.map((d) => Number(d.nope)).reduce((a, b) => a + b, 0));
  const svg = d3.select('#b');
  svg.selectAll('rect').data(s.data).join('rect').attr('x', 0).attr('y', (d, i) => i * 10).attr('height', 8).attr('width', (d) => Number(d.nope) * 2);
});
</script>''')
    ok = run(projects, 'zz-dash-clean')
    check('the sample dashboard draws with no drawn-wrong warnings', not [p for p in ok['problems'] if p['code'] == 'layout' and p.get('rule') in ('nan', 'nanMore', 'empty', 'labelOverlap', 'labelOverlapMore', 'labelClipped', 'labelClippedMore')], json.dumps([p for p in ok['problems'] if p['code'] == 'layout'])[:400])
    d = run(projects, 'zz-dash-bad')
    dgot = {p.get('rule'): p for p in d['problems'] if p['code'] == 'layout'}
    nan = dgot.get('nanMore') or dgot.get('nan')
    check('a number that came out as NaN is reported with its text', nan and 'NaN' in nan['params']['text'], json.dumps(list(dgot)))
    check('a NaN drawn into a bar is named with the dataset', any('team' in p['params'].get('where', '') and 'NaN' in p['params']['text'] for p in d['problems'] if p['code'] == 'layout' and p.get('rule', '').startswith('nan')), json.dumps(dgot)[:400])
    check('a chart with only axes is reported as empty, with its dataset', dgot.get('empty') and 'none' in dgot['empty']['params']['where'] and '#empty' in dgot['empty']['params']['where'], json.dumps(dgot.get('empty')))
    check('labels over each other are reported', 'labelOverlap' in dgot and 'sales' in dgot['labelOverlap']['params']['text'], json.dumps(list(dgot)))
    check('a label cut off by its chart is reported', 'labelClipped' in dgot and '#cut' in dgot['labelClipped']['params']['where'], json.dumps(list(dgot)))
    check('the chart that did draw is not called empty', len([p for p in d['problems'] if p.get('rule') == 'empty']) == 1)
    check('a chart in a hidden tab, a CSS bar, the word undefined in prose and a hidden tooltip are not reported', not any(x in json.dumps(p) for p in d['problems'] if p['code'] == 'layout' for x in ('#tab2', '#css', 'unset variable', 'Hidden tooltip', '#tip')), json.dumps(dgot)[:500])
finally:
    shutil.rmtree(tmp, ignore_errors=True)

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
sys.exit(1 if failed else 0)
