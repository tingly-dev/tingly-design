"""End-to-end checks for the run feed: the request echoed above the prompt, a run's steps in plain words,
elapsed time, stopping, a busy bar that keeps what was typed, the files a run changed, undoing a run, an
editor that opens mid-run, and the same feed in every kind.
Run after `pnpm build`: python3 e2e/run_feed.py  (DC_CHROME=/path/to/chrome to use another Chromium)
Starts its own server (production mode, PORT=0) on a fresh projects folder, with the mock model and a
stand-in `claude` that reports steps slowly, so it needs neither `pnpm dev` nor an API key."""
import os, sys, asyncio, json, subprocess, tempfile, threading, time, urllib.request, urllib.error
from playwright.async_api import async_playwright, expect

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get('DC_CHROME')
MOCK_PORT = 8792

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

# A stand-in for Claude Code that works like the real one, slowly: it says something, reads the format
# reference and the index, searches, then edits the first content file of the folder (absolute paths, as
# Claude Code reports them). "SLOW" in the request makes it pause long enough to be stopped; "FAIL" makes
# it fail after editing. It records each request.
FAKE_CLAUDE = r'''#!/usr/bin/env python3
import sys, json, os, re, time, glob
if '--version' in sys.argv: print('0.0.0 (fake)'); sys.exit(0)
args = sys.argv[1:]
prompt = args[args.index('-p') + 1]
open(os.environ['FAKE_CLAUDE_LOG'], 'a').write(json.dumps({'prompt': prompt}) + '\n')
folder = os.path.abspath(re.search(r'folder: (\S+)/', prompt).group(1))
def out(o): print(json.dumps(o), flush=True)
def say(t): out({'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': t}]}})
def tool(name, inp): out({'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'name': name, 'input': inp}]}})
d = 0.4
say('先看格式说明。'); time.sleep(d)
tool('Read', {'file_path': os.path.join(os.getcwd(), '.claude/skills/slides/SKILL.md')}); time.sleep(d)
idx = sorted(glob.glob(folder + '/*.json'))
if idx: tool('Read', {'file_path': idx[0]}); time.sleep(d)
tool('Grep', {'pattern': 'title', 'path': folder}); time.sleep(d)
if 'SLOW' in prompt: time.sleep(30)
cands = sorted(glob.glob(folder + '/*.dc.html')) + sorted(glob.glob(folder + '/slides/*.html')) + sorted(glob.glob(folder + '/tabs/*.md')) \
    + sorted(glob.glob(folder + '/scenes/*.html')) + sorted(glob.glob(folder + '/files/index.html')) + sorted(glob.glob(folder + '/README.md'))
p = cands[0]
tool('Edit', {'file_path': p}); time.sleep(d)
s = open(p).read()
open(p, 'w').write(s + '\n<!-- run-feed -->\n' if p.endswith('.md') else s.replace('</', '<!-- run-feed --></', 1))
time.sleep(d * 2)
if 'FAIL' in prompt:
    out({'type': 'result', 'result': 'API Error: overloaded', 'is_error': True}); sys.exit(1)
out({'type': 'result', 'result': '改好了标题。', 'is_error': False})
'''

def delete(url):
    try:
        return urllib.request.urlopen(urllib.request.Request(url, method='DELETE')).status
    except urllib.error.HTTPError as e:
        return e.code

def lines(path):
    try: return [json.loads(l) for l in open(path) if l.strip()]
    except FileNotFoundError: return []

async def main():
    if not os.path.exists(os.path.join(REPO, 'apps/editor/dist/index.html')):
        raise SystemExit('no editor build: run pnpm build first')
    tmp = tempfile.mkdtemp(prefix='dc-runfeed-')
    projects = os.path.join(tmp, 'projects')
    bin_dir = os.path.join(tmp, 'bin'); os.makedirs(bin_dir)
    open(os.path.join(bin_dir, 'claude'), 'w').write(FAKE_CLAUDE); os.chmod(os.path.join(bin_dir, 'claude'), 0o755)
    mock_log = os.path.join(tmp, 'mock.log'); claude_log = os.path.join(tmp, 'claude.log')
    mock = subprocess.Popen([sys.executable, os.path.join(HERE, 'mock_anthropic.py'), mock_log, str(MOCK_PORT)])
    server = subprocess.Popen(
        [os.path.join(REPO, 'apps/server/node_modules/.bin/tsx'), 'src/index.ts'], cwd=os.path.join(REPO, 'apps/server'),
        env={**os.environ, 'NODE_ENV': 'production', 'PORT': '0', 'DC_PROJECTS': projects, 'DC_EXIT_WITH_STDIN': '1',
             'ANTHROPIC_API_KEY': 'x', 'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{MOCK_PORT}',
             'PATH': bin_dir + os.pathsep + os.environ['PATH'], 'FAKE_CLAUDE_LOG': claude_log},
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    port = None; t = time.time()
    while time.time() - t < 30:
        line = server.stdout.readline()
        if line.startswith('TINGLY_DESIGN_READY '):
            port = json.loads(line.split(' ', 1)[1])['port']; break
        if not line and server.poll() is not None: break
    if not port: raise SystemExit('the server did not start')
    threading.Thread(target=lambda: [None for _ in server.stdout], daemon=True).start()
    base = f'http://127.0.0.1:{port}'
    read = lambda proj, f: open(os.path.join(projects, proj, f)).read()
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            pg = await b.new_page(locale='zh-CN', viewport={'width': 1280, 'height': 800})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            feed = pg.locator('.runfeed')
            box = pg.locator('textarea[aria-label="请求"]')
            await pg.goto(f'{base}/?p=box-console')
            await pg.wait_for_selector('.board')
            await pg.wait_for_timeout(800)

            # the fast model: the request stays in view, the run ends with what to do next
            pristine = read('box-console', 'Main.dc.html')
            await box.fill('把标题改成紫色')
            await box.press('Enter')
            await expect(feed.locator('.run-ask')).to_have_text('把标题改成紫色')
            check('a sent request is cleared from the box and echoed in the feed', await box.input_value() == '')
            await expect(feed).to_contain_text('已保存', timeout=15000)
            check('a finished fast run says how long it took', '用时' in await feed.inner_text())
            check('a retried run counts only the kept statements', '5 条语句' in await feed.inner_text(), await feed.inner_text())
            saved = lambda: read('box-console', 'Main.dc.html') != pristine
            for _ in range(50):
                if saved(): break
                await pg.wait_for_timeout(100)
            await feed.get_by_role('button', name='撤销').click()
            for _ in range(50):
                if not saved(): break
                await pg.wait_for_timeout(100)
            check('the feed undoes the fast run', not saved())
            # the statements can be taken into the Code tab's jQuery box, the advanced path, to adjust by hand
            await feed.locator('.run-link', has_text='条语句').click()
            await feed.get_by_role('button', name='在 jQuery 里改').click()
            await expect(pg.locator('.panel [role="tab"][aria-selected="true"]')).to_have_text('代码')
            jq = await pg.locator('.jqbox textarea').input_value()
            check('“在 jQuery 里改” puts the kept statements in the Code tab', len(jq.strip().split('\n')) == 5, jq)
            await pg.locator('.panel [role="tab"]', has_text='属性').click()

            # Claude Code: steps in plain words, elapsed time, a busy bar that keeps what was typed
            await pg.get_by_role('button', name='Claude Code', exact=True).click()
            original = {f: read('box-console', f) for f in os.listdir(os.path.join(projects, 'box-console')) if f.endswith('.dc.html')}
            await box.fill('把标题改短')
            await box.press('Enter')
            await expect(feed.locator('.run-ask')).to_have_text('把标题改短')
            await expect(feed).to_contain_text('Claude Code 正在', timeout=5000)
            await expect(feed.locator('.run-step', has_text='读格式说明')).to_have_count(1, timeout=5000)
            await expect(feed.locator('.run-step', has_text='读 canvas.json')).to_have_count(1, timeout=5000)
            check('a step names project files relative to the project', tmp not in await feed.inner_text(), await feed.inner_text())
            check('what Claude Code says is shown as it says it', await feed.locator('.run-say', has_text='先看格式说明').count() == 1)
            check('a running run shows its elapsed time', '已 ' in await feed.locator('.run-time').inner_text())
            check('the send button becomes stop while it runs', await pg.locator('.prompt .send', has_text='停止').count() == 1)
            await box.fill('再改一下副标题')
            await box.press('Enter')
            await expect(pg.locator('.prompt-hint.warn')).to_contain_text('还在处理上一条')
            check('a request sent while busy stays in the box', await box.input_value() == '再改一下副标题')
            await expect(pg.locator('.board .badge.claude')).to_have_count(1, timeout=8000)
            check('the artboard being changed says so', True)
            await expect(feed).to_contain_text('Claude Code 完成', timeout=15000)
            text = await feed.inner_text()
            check('a finished run shows Claude Code\'s answer', '改好了标题。' in text, text)
            changed = await feed.locator('.file-chip').all_inner_texts()
            check('a finished run lists the files it changed', len(changed) == 1 and changed[0].endswith('.dc.html'), changed)
            check('the steps fold away once it is done', await feed.locator('.run-steps').count() == 0)
            await feed.get_by_role('button', name='步').click()
            check('and open again on request', await feed.locator('.run-step').count() >= 4)
            await feed.get_by_role('button', name='撤销这次改动').click()
            await expect(feed).to_contain_text('已撤销', timeout=5000)
            await pg.wait_for_timeout(1500)
            check('undoing the run puts the files back', read('box-console', changed[0]) == original[changed[0]])
            await feed.get_by_role('button', name='收起').click()
            check('the feed can be closed', await feed.count() == 0)

            # a failed run hands the request back
            await box.fill('FAIL 改标题')
            await box.press('Enter')
            await expect(feed).to_contain_text('没能完成', timeout=15000)
            check('a failed run says why', 'overloaded' in await feed.inner_text())
            await feed.get_by_role('button', name='放回输入框').click()
            check('a failed request can be put back in the box', await box.input_value() == 'FAIL 改标题')
            await box.fill('')

            # stopping, and an editor that opens mid-run
            await box.fill('SLOW 改标题')
            await box.press('Enter')
            await expect(feed.locator('.run-step', has_text='搜索')).to_have_count(1, timeout=8000)
            pg2 = await b.new_page(locale='zh-CN', viewport={'width': 1280, 'height': 800})
            await pg2.goto(f'{base}/?p=box-console')
            await expect(pg2.locator('.runfeed .run-ask')).to_have_text('SLOW 改标题', timeout=8000)
            check('an editor opened mid-run sees the steps so far', await pg2.locator('.runfeed .run-step').count() >= 3)
            await pg2.close()
            await pg.locator('.prompt .send', has_text='停止').click()
            await expect(feed).to_contain_text('已停止', timeout=8000)
            check('a stopped run says so', await pg.locator('.prompt .send', has_text='发送').count() == 1)
            st = delete(f'{base}/api/projects/box-console/delegate/nope')
            check('stopping a run that is not running is refused', st == 404, st)

            # every kind gets the same feed
            for proj, kind, unit in [('tingly-intro', 'slides', 'slides/'), ('tingly-ds', 'design-system', 'README.md'), ('box-usage', 'dashboard', 'files/index.html'),
                                     ('design-guide', 'docs', 'tabs/'), ('design-motion', 'motion', 'scenes/')]:
                await pg.goto(f'{base}/?p={proj}')
                await box.wait_for(timeout=10000)
                await pg.wait_for_timeout(800)
                if kind in ('slides', 'motion'):
                    await pg.get_by_role('button', name='Claude Code', exact=True).click()
                n = len(lines(claude_log))
                await box.fill('改一下标题')
                await box.press('Enter')
                await expect(feed.locator('.run-ask')).to_have_text('改一下标题')
                await expect(feed).to_contain_text('Claude Code 完成', timeout=15000)
                chips = await feed.locator('.file-chip').all_inner_texts()
                check(f'{kind}: the feed shows the run and the file it changed', any(c.startswith(unit) for c in chips), chips)
                if kind == 'motion':
                    sent = lines(claude_log)[n]['prompt']
                    check('motion: where the playhead stopped is told to Claude Code but not echoed as the request', '停在场景' in sent and '停在场景' not in await feed.locator('.run-ask').inner_text(), sent[:300])
            check('no page errors', not errs, errs)
            await b.close()
    finally:
        try: server.stdin.close()
        except Exception: pass
        server.wait(timeout=10)
        mock.terminate()
        subprocess.run(['rm', '-rf', tmp])
    passed = sum(ok for _, ok in results)
    print(f'\n{passed}/{len(results)} passed')
    sys.exit(0 if passed == len(results) else 1)

asyncio.run(main())
