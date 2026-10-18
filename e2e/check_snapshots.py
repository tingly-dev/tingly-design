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
    out = subprocess.run(['pnpm', '-s', 'tingly-design', 'check', name, '--snapshots', '--json'], cwd=REPO, capture_output=True, text=True,
                         env={**os.environ, 'DC_PROJECTS': projects}, timeout=300)
    try: return json.loads(out.stdout)
    except ValueError: raise SystemExit(f'check printed no JSON:\n{out.stdout[-2000:]}\n{out.stderr[-2000:]}')

tmp = tempfile.mkdtemp(prefix='dc-check-')
try:
    projects = os.path.join(tmp, 'projects')
    os.makedirs(projects)
    keep = shutil.ignore_patterns('.journal.jsonl', '.runs.json', 'renders')
    shutil.copytree(os.path.join(REPO, 'projects', 'tingly-intro'), os.path.join(projects, 'zz-clean'), ignore=keep)
    bad = os.path.join(projects, 'zz-layout')
    shutil.copytree(os.path.join(REPO, 'projects', 'tingly-intro'), bad, ignore=keep)
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
finally:
    shutil.rmtree(tmp, ignore_errors=True)

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
sys.exit(1 if failed else 0)
