"""End-to-end checks for the Claude Code conversation a project keeps (.design/agent-panel.md): a stand-in `claude`
(e2e/fake-claude) records how it is called. The first request starts a conversation and the server keeps its session in the
project folder; the next one resumes it with no help from the page; `fresh` starts a new one; an explicit session wins; a
session Claude Code no longer has falls back to a new conversation by itself. No browser.
Run with `pnpm dev` started with e2e/fake-claude first on PATH: python3 e2e/conversation.py (or pnpm e2e conversation)"""
import os, json, time, urllib.request, urllib.error

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.environ.get('FAKE_CLAUDE_LOG', '/tmp/fake-claude.log')
PROJECT = 'box-console'
FILE = os.path.join(REPO, 'projects', PROJECT, '.claude-session.json')
LOST = '00000000-0000-4000-8000-000000000000'
MINE = '11111111-2222-4333-8444-555555555555'

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def api(path, body=None, method=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), method=method, headers={'content-type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def calls(): return [json.loads(l) for l in open(LOG)] if os.path.exists(LOG) else []

def run(prompt, **extra):
    """Hand a request over and wait for the stand-in to finish it (and any retry)."""
    before = len(calls())
    api(f'/api/projects/{PROJECT}/delegate', {'prompt': prompt, **extra})
    t = time.time()
    while time.time() - t < 20:
        new = calls()[before:]
        if new and new[-1]['ev'] == 'end' and new[-1]['code'] == 0: break
        time.sleep(0.2)
    time.sleep(0.3)
    return [c for c in calls()[before:] if c['ev'] == 'start']

def kept(): return api(f'/api/projects/{PROJECT}/conversation')

os.path.exists(LOG) and os.remove(LOG)
api(f'/api/projects/{PROJECT}/conversation', method='DELETE')
try:
    check('a project with no conversation has none', kept() is None)

    s = run('make it blue')
    k = kept()
    check('the first request starts a new conversation', len(s) == 1 and s[0]['resume'] is None, s)
    check('the server keeps its session', bool(k) and k['prompt'] == 'make it blue', k)
    check('the session is kept in the project folder', os.path.exists(FILE))
    first = k['session']

    s = run('and bolder')
    check('the next request resumes it without being told to', len(s) == 1 and s[0]['resume'] == first, s)
    check('the kept request is the latest one', kept()['prompt'] == 'and bolder')

    s = run('something else', fresh=True)
    second = kept()['session']
    check('fresh starts a new conversation', len(s) == 1 and s[0]['resume'] is None and second != first, s)

    s = run('back to that', resume=MINE)
    check('an explicit session wins', len(s) == 1 and s[0]['resume'] == MINE, s)

    open(FILE, 'w').write(json.dumps({'session': LOST, 'prompt': 'old', 'at': 1}))
    s = run('is anyone there')
    check('a session Claude Code lost is retried as a new conversation', [c['resume'] for c in s] == [LOST, None], s)
    k = kept()
    check('and the new conversation replaces it', bool(k) and k['session'] != LOST and k['prompt'] == 'is anyone there', k)

    api(f'/api/projects/{PROJECT}/conversation', method='DELETE')
    check('the conversation can be forgotten', kept() is None and not os.path.exists(FILE))
finally:
    try: api(f'/api/projects/{PROJECT}/conversation', method='DELETE')
    except Exception: pass

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
raise SystemExit(1 if failed else 0)
