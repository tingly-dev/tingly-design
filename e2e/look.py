"""Claude Code can see the page it is editing (.design/agent-look.md): every request is allowed `node scripts/look.mjs` and told how
to use it, with the page the person has open as the pick; the route behind it draws one board, slide, tab or view (or the dashboard
page, or a motion piece's cover) into the project's renders/look/ as a PNG of the page's own size and says what the drawing found; the
script prints those paths. The stand-in `claude` (e2e/fake-claude) records how it was called.
Run with `pnpm dev` started with e2e/fake-claude first on PATH, and a Chrome (DC_CHROME): python3 e2e/look.py (or pnpm e2e look)"""
import os, json, struct, subprocess, time, shutil, urllib.request, urllib.error

BASE = os.environ.get('DC_API', os.environ.get('DC_URL', 'http://localhost:8787'))
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.environ.get('FAKE_CLAUDE_LOG', '/tmp/fake-claude.log')
results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def call(path, body=None, method=None):
    req = urllib.request.Request(BASE + path, method=method or ('POST' if body is not None else 'GET'), data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

def png_size(path):
    with open(path, 'rb') as f: head = f.read(24)
    return struct.unpack('>II', head[16:24]) if head[:8] == b'\x89PNG\r\n\x1a\n' else None

def run_claude(project, prompt, file=None):
    before = sum(1 for _ in open(LOG)) if os.path.exists(LOG) else 0
    call(f'/api/projects/{project}/delegate', {'prompt': prompt, 'fresh': True, **({'file': file} if file else {})})
    t = time.time()
    new = []
    while time.time() - t < 20:
        new = [json.loads(l) for l in open(LOG)][before:] if os.path.exists(LOG) else []
        if new and new[-1]['ev'] == 'end': break
        time.sleep(0.2)
    s = [c for c in new if c['ev'] == 'start']
    return s[0]['args'] if s else []

def arg(args, flag): return args[args.index(flag) + 1] if flag in args else ''

CANVAS, SLIDES, DS, DASH, DOC, MOTION = 'tingly-box-console-canvas', 'tingly-design-intro-slides', 'tingly-design-system', 'tingly-box-usage-dashboard', 'tingly-design-guide-doc', 'tingly-design-motion'
OPEN = {CANVAS: ('Main.dc.html', 'Main.dc.html'), SLIDES: ('slides/cover.html', 'cover'), DOC: ('tabs/overview.md', 'overview'), DASH: ('files/index.html', None), DS: (None, None), MOTION: (None, None)}

# --- the request: the tool is allowed, and told how to use ---------------------------------------
for project, (file, pick) in OPEN.items():
    args = run_claude(project, 'make it better', file)
    tools = arg(args, '--allowedTools').split(',')
    system = arg(args, '--append-system-prompt')
    check(f'{project}: Claude Code may run the look script', 'Bash(node scripts/look.mjs:*)' in tools, str(tools))
    check(f'{project}: and is told to look after a change, naming the project', f'node scripts/look.mjs {project}' in system and 'Read tool' in system)
    if pick: check(f'{project}: the page the person has open is the pick', f'node scripts/look.mjs {project} {pick}.' in system or f'node scripts/look.mjs {project} {pick} ' in system or f'node scripts/look.mjs {project} {pick}.' in system.replace(' .', '.'), system[system.find('node scripts/look.mjs'):][:90])
    else: check(f'{project}: with nothing open it says the pick is free', f'node scripts/look.mjs {project} [pick]' in system or f'node scripts/look.mjs {project}.' in system, system[system.find('node scripts/look.mjs'):][:90])

# --- the route: a PNG of the page, and what the drawing found ---------------------------------------
def drawn(project, pick, size=None, name=None):
    st, r = call(f'/api/projects/{project}/look', {'pick': pick} if pick else {})
    if st != 200 and 'sandbox' in r.get('error', '').lower():
        print(f'SKIP {name or project}: this machine\'s Chrome cannot start ({r["error"][:80]})')
        return None
    ok = st == 200 and r.get('files') and all(os.path.exists(f) for f in r['files'])
    sizes = [png_size(f) for f in r.get('files', [])]
    check(f'{name or project}: a PNG{" of " + "x".join(map(str, size)) if size else ""} is kept in renders/look/', ok and all(sizes) and all('/renders/look/' in f for f in r['files']) and (size is None or sizes[0] == size), f'{st} {json.dumps(r)[:300]}')
    return r if ok else None

r = drawn(SLIDES, 'cover', (1920, 1080), 'slides (slide cover)')
if r:
    check('slides: one slide is one picture', len(r['files']) == 1, str(r['files']))
    r2 = drawn(SLIDES, 'cover', (1920, 1080), 'slides (again)')
    check('a second look replaces the first', r2 and r2['files'] == r['files'] and len(os.listdir(r['dir'])) == 1, str(os.listdir(r['dir'])))
    st, bad = call(f'/api/projects/{SLIDES}/look', {'pick': 'no-such-slide'})
    check('a pick that is not there draws nothing and says so', st == 200 and not bad['files'] and any(p['level'] == 'error' for p in bad['problems']), json.dumps(bad)[:300])
    shutil.rmtree(r['dir'], ignore_errors=True)

    r = drawn(CANVAS, 'Main.dc.html', None, 'canvas (one artboard)')
    check('canvas: one artboard is one picture', r and len(r['files']) == 1, str(r))
    for project, pick, name in ((DOC, 'overview', 'docs (one tab)'), (DS, 'colors', 'design system (one view)'), (DASH, None, 'dashboard (its page)'), (MOTION, None, 'motion (the cover of each format)')):
        r = drawn(project, pick, None, name)
        if r: check(f'{name}: findings are worded for a model', all(isinstance(p['text'], str) and p['text'] and 'cli.' not in p['text'] for p in r['problems']), json.dumps(r['problems'])[:300])
    for p in (CANVAS, SLIDES, DOC, DS, DASH, MOTION): shutil.rmtree(os.path.join(REPO, 'projects', p, 'renders', 'look'), ignore_errors=True)

    # --- the script the agent runs ------------------------------------------------------------------
    env = {**os.environ, 'DC_SERVER_URL': BASE}
    out = subprocess.run(['node', 'scripts/look.mjs', SLIDES, 'cover'], cwd=REPO, env=env, capture_output=True, text=True, timeout=240)
    first = out.stdout.splitlines()[0] if out.stdout else ''
    check('the script prints the path of the picture', out.returncode == 0 and first.endswith('.png') and os.path.exists(first), out.stdout + out.stderr)
    bad = subprocess.run(['node', 'scripts/look.mjs', SLIDES, 'no-such-slide'], cwd=REPO, env=env, capture_output=True, text=True, timeout=240)
    check('and fails, saying what was not found, when nothing was drawn', bad.returncode == 1 and 'nothing was drawn' in bad.stderr, bad.stdout + bad.stderr)
    shutil.rmtree(os.path.join(REPO, 'projects', SLIDES, 'renders', 'look'), ignore_errors=True)
no_url = subprocess.run(['node', 'scripts/look.mjs', SLIDES], cwd=REPO, env={k: v for k, v in os.environ.items() if k != 'DC_SERVER_URL'}, capture_output=True, text=True)
check('the script says where it is meant to run when it has no server', no_url.returncode == 2 and 'DC_SERVER_URL' in no_url.stderr)

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
raise SystemExit(1 if failed else 0)
