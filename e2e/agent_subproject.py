"""End-to-end checks for Claude Code opening a sub-project (.design/sub-projects.md §8): a delegated request is allowed
the one script that makes a sub-project and told how, the stand-in `claude` (e2e/fake-claude, which enforces the
allowed tools) runs it, and a project of each kind appears inside the project, in the list under it and on disk, while
the parent's own files stay as they were; a reserved or taken name and a command outside the list are refused.
Run with `pnpm dev` started with e2e/fake-claude first on PATH: python3 e2e/agent_subproject.py (or pnpm e2e agent_subproject)"""
import os, json, re, shutil, time, urllib.request, urllib.error

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECTS = os.path.join(REPO, 'projects')
LOG = os.environ.get('FAKE_CLAUDE_LOG', '/tmp/fake-claude.log')
PARENT = 'zz-agent-sub'
SCRIPT = 'node scripts/new-sub-project.mjs'

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

def cards(): return {c['name']: c for c in call('GET', '/api/projects')[1]}
def files(name): return sorted(call('GET', f'/api/projects/{name}/files')[1]['files'])

def ask(project, prompt):
    """One delegated request; what the stand-in `claude` did, in order."""
    before = sum(1 for _ in open(LOG)) if os.path.exists(LOG) else 0
    call('POST', f'/api/projects/{project}/delegate', {'prompt': prompt, 'fresh': True})
    t = time.time()
    new = []
    while time.time() - t < 30:
        new = [json.loads(l) for l in open(LOG)][before:] if os.path.exists(LOG) else []
        if new and new[-1]['ev'] == 'end': break
        time.sleep(0.2)
    return new

def run(project, command):
    ev = ask(project, f'Draw it. FAKE_RUN: {command}')
    return next((e for e in ev if e['ev'] == 'ran'), None), next((e for e in ev if e['ev'] == 'start'), None), [e for e in ev if e['ev'] == 'denied']

def main():
    shutil.rmtree(os.path.join(PROJECTS, PARENT), ignore_errors=True)
    st, r = call('POST', '/api/projects', {'name': PARENT, 'title': 'Agent Sub', 'kind': 'design'})
    check('a parent project is made', st == 200, str(r))
    parent_dir = os.path.join(PROJECTS, PARENT)
    before = files(PARENT)

    # --- one of each kind, each through a delegated request ----------------------------------------
    made = {}
    for word, folder, kind in (('canvas', 'figure', 'design'), ('slides', 'deck', 'slides'), ('design-system', 'kit', 'design-system'), ('dashboard', 'numbers', 'dashboard'), ('doc', 'notes', 'docs'), ('motion', 'clip', 'motion')):
        extra = ' --size 800x600' if word == 'canvas' else ''
        ran, start, denied = run(PARENT, f'{SCRIPT} {PARENT} {word} {folder} "{folder.title()}"{extra}')
        args = start['args'] if start else []
        allowed = args[args.index('--allowedTools') + 1].split(',') if '--allowedTools' in args else []
        check(f'{kind}: the request is allowed that one script and no other Bash', 'Bash(node scripts/new-sub-project.mjs:*)' in allowed and not any(t == 'Bash' for t in allowed), str(allowed))
        check(f'{kind}: the script ran and printed the new folder', ran is not None and ran['code'] == 0 and ran['out'].endswith(f'/{PARENT}/{folder}/'), str(ran))
        c = next((c for c in cards().values() if c.get('path', '').endswith(f'/{PARENT}/{folder}')), None)
        made[folder] = c
        check(f'{kind}: it is a sub-project of its kind in the list, under the parent', c is not None and c['kind'] == kind and c['parent'] == PARENT and c['title'] == folder.title(), str(c))
        check(f'{kind}: its index file is on disk inside the parent folder', any(os.path.exists(os.path.join(parent_dir, folder, f)) for f in ('canvas.json', 'deck.json', 'design-system.json', 'dash.json', 'doc.json', 'motion.json')))
    check("the parent's own files are as they were", files(PARENT) == before, f'{before} -> {files(PARENT)}')
    board = next((f for f in os.listdir(os.path.join(parent_dir, 'figure')) if f.endswith('.dc.html')), '')
    check('a size is given to the starter', board and '800' in open(os.path.join(parent_dir, 'figure', board)).read())

    # --- what it is told --------------------------------------------------------------------------
    _, start, _ = run(PARENT, f'{SCRIPT} {PARENT} canvas second')
    prompt = start['prompt'] if start else ''
    check('the request says how to make a sub-project', f'node scripts/new-sub-project.mjs {PARENT} <canvas|slides' in prompt and 'never for an ordinary edit' in prompt)
    check('and lists the ones already inside, as not this project\'s files', f'/{PARENT}/figure/ (Canvas)' in prompt and f'/{PARENT}/notes/ (Doc)' in prompt and "not this project's files" in prompt)

    # --- a sub-project can make its own ------------------------------------------------------------
    figure = made['figure']['name']
    ran, _, _ = run(figure, f'{SCRIPT} {figure} canvas inner "Inner"')
    inner = next((c for c in cards().values() if c.get('path', '').endswith(f'/{PARENT}/figure/inner')), None)
    check('a sub-project makes one of its own', ran is not None and ran['code'] == 0 and inner is not None and inner['parent'] == figure, str(ran))

    # --- refusals ---------------------------------------------------------------------------------
    ran, _, _ = run(PARENT, f'{SCRIPT} {PARENT} canvas uploads')
    check('a folder a project keeps its own files in is refused', ran is not None and ran['code'] == 1 and 'own files' in ran['err'], str(ran))
    ran, _, _ = run(PARENT, f'{SCRIPT} {PARENT} canvas figure')
    check('a taken name is refused', ran is not None and ran['code'] == 1 and 'already' in ran['err'], str(ran))
    ran, _, _ = run(PARENT, f'{SCRIPT} {PARENT} chart foo')
    check('an unknown kind is refused with the usage', ran is not None and ran['code'] == 2 and 'usage' in ran['err'], str(ran))
    ran, _, _ = run(PARENT, f'{SCRIPT} no-such-project canvas x')
    check('a project that does not exist is refused', ran is not None and ran['code'] == 1, str(ran))
    ran, _, denied = run(PARENT, 'rm -rf projects')
    check('any other command is not allowed', ran is None and len(denied) == 1 and os.path.isdir(parent_dir), str(denied))
    st, r = call('POST', f'/api/projects/{PARENT}/sub-projects', {'name': 'x', 'kind': 'poster'})
    check('the route needs one of the six kinds', st == 400 and r.get('code') == 'badKind', str(r))
    check('nothing was left behind by the refused ones', sorted(f for f in os.listdir(parent_dir) if os.path.isdir(os.path.join(parent_dir, f))) == ['clip', 'deck', 'figure', 'kit', 'notes', 'numbers', 'second'], str(os.listdir(parent_dir)))
    stray = [d for d in os.listdir(PROJECTS) if re.fullmatch(r'(figure|deck|kit|numbers|notes|clip|second|inner)-[0-9a-f]{6}', d)]
    check('no sub-project left a folder of its own name in the projects folder', not stray, str(stray))
    check("the parent's own files are still as they were", files(PARENT) == before)

    shutil.rmtree(parent_dir, ignore_errors=True)
    for d in stray: shutil.rmtree(os.path.join(PROJECTS, d), ignore_errors=True)
    ok = sum(1 for _, k in results if k)
    print(f'\n{ok}/{len(results)} checks passed')
    raise SystemExit(0 if ok == len(results) else 1)

main()
