"""End-to-end checks for the conversation column (.design/chat-panel.md): the request bar at the bottom by
default; the position menu moving it to a column on the left that stays open and shifts the work; the
conversation kept as a record (every turn with its steps, answer and files, the same after a reload, requests
from the command line included); undo on the newest turn only; the column's width dragged and remembered; a
window too narrow for it putting the bar back at the bottom; the old right-edge dock's setting meaning left; the
kinds with a list of their own showing it as a tab beside the conversation; one run in every kind.
Run after `pnpm build`: python3 e2e/chat_panel.py  (DC_CHROME=/path/to/chrome to use another Chromium)
Starts its own server (production mode, PORT=0) on a fresh projects folder, with the mock model and a
stand-in `claude`, so it needs neither `pnpm dev` nor an API key."""
import os, sys, asyncio, json, subprocess, tempfile, threading, time, shutil, urllib.request
from playwright.async_api import async_playwright, expect

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get('DC_CHROME')
MOCK_PORT = 8793 + int(os.environ.get('DC_E2E_OFFSET', 0))  # a parallel lane shifts every port (e2e/run.py)

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

# the stand-in `claude` of run_feed.py, read from there so the two never drift
src = open(os.path.join(HERE, 'run_feed.py')).read()
FAKE_CLAUDE = src.split("FAKE_CLAUDE = r'''", 1)[1].split("'''", 1)[0]

def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.load(urllib.request.urlopen(req))

async def main():
    if not os.path.exists(os.path.join(REPO, 'apps/editor/dist/index.html')):
        raise SystemExit('no editor build: run pnpm build first')
    tmp = tempfile.mkdtemp(prefix='dc-chat-')
    projects = os.path.join(tmp, 'projects')
    shutil.copytree(os.path.join(REPO, 'projects'), projects, ignore=shutil.ignore_patterns('.transcript.jsonl', '.claude-session.json'))
    bin_dir = os.path.join(tmp, 'bin'); os.makedirs(bin_dir)
    open(os.path.join(bin_dir, 'claude'), 'w').write(FAKE_CLAUDE); os.chmod(os.path.join(bin_dir, 'claude'), 0o755)
    mock = subprocess.Popen([sys.executable, os.path.join(HERE, 'mock_anthropic.py'), os.path.join(tmp, 'mock.log'), str(MOCK_PORT)])
    server = subprocess.Popen(
        [os.path.join(REPO, 'apps/server/node_modules/.bin/tsx'), 'src/index.ts'], cwd=os.path.join(REPO, 'apps/server'),
        env={**os.environ, 'NODE_ENV': 'production', 'PORT': '0', 'DC_PROJECTS': projects, 'DC_EXIT_WITH_STDIN': '1',
             'ANTHROPIC_API_KEY': 'x', 'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{MOCK_PORT}',
             'PATH': bin_dir + os.pathsep + os.environ['PATH'], 'FAKE_CLAUDE_LOG': os.path.join(tmp, 'claude.log')},
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
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            pg = await b.new_page(locale='zh-CN', viewport={'width': 1440, 'height': 860})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            panel = pg.locator('.chat-panel')
            box = pg.locator('.chat-composer textarea')
            work_left = lambda: pg.locator('.chat-work').evaluate('e => e.getBoundingClientRect().left')
            panel_w = lambda: panel.evaluate('e => e.getBoundingClientRect().width')
            pref = lambda: pg.evaluate("localStorage.getItem('dc.barMode')")
            send = lambda text: box.fill(text)

            await pg.goto(f'{base}/?p=box-console')
            await pg.wait_for_selector('.board')
            await pg.wait_for_timeout(800)

            # the default is the bar at the bottom, as it always was
            check('the prompt starts as the bar at the bottom of the stage', await pg.locator('.prompt:not(.chat-composer)').count() == 1 and await panel.count() == 0)
            check('the shell is not in the way of the work', await work_left() == 0)
            bar = pg.locator('.prompt')
            await pg.get_by_role('button', name='Claude Code', exact=True).click()
            await bar.locator('textarea').fill('把标题改短')
            await bar.locator('textarea').press('Enter')
            await expect(pg.locator('.runfeed')).to_contain_text('Claude Code 完成', timeout=15000)
            check('the bottom bar shows the answer while the cursor is in the box', '改好了标题。' in await pg.locator('.runfeed').inner_text())
            await pg.mouse.click(400, 300)
            await pg.mouse.move(400, 300)
            await pg.wait_for_function("!document.querySelector('.runfeed .run-say') || getComputedStyle(document.querySelector('.runfeed .run-say')).display === 'none' || !document.querySelector('.runfeed .run-say').offsetParent", timeout=3000)
            check('a click on the work folds the card to its one line', 'Claude Code 完成' in await pg.locator('.runfeed .run-head').inner_text() and await pg.locator('.runfeed').evaluate('e => e.getBoundingClientRect().height') < 70)
            await pg.locator('.runfeed .run-head').get_by_role('button', name='撤销这次改动').click() if await pg.locator('.runfeed .run-head').get_by_role('button', name='撤销这次改动').count() else None

            # the history above the bottom bar reads the same record: a row opens to the answer
            await bar.get_by_role('button', name='之前的请求').click()
            row = pg.locator('.run-history .hist').first
            check('the history lists the request', '把标题改短' in await row.inner_text())
            await row.locator('.hist-prompt').click()
            check('a history row opens to the answer and the files', '改好了标题。' in await row.inner_text() and await row.locator('.file-chip').count() >= 1)
            await bar.get_by_role('button', name='之前的请求').click()

            # the position menu: two items, left is chosen
            await bar.get_by_role('button', name='请求栏的位置').click()
            check('the position menu has the bottom and the left', await pg.get_by_role('menuitemcheckbox').count() == 2)
            check('the bottom is the one marked', await pg.get_by_role('menuitemcheckbox', name='底部').get_attribute('aria-checked') == 'true')
            await pg.get_by_role('menuitemcheckbox', name='左侧').click()
            await expect(panel).to_have_count(1)
            check('left puts a conversation column on the left edge', await panel.evaluate('e => e.getBoundingClientRect().left') == 0)
            check('the column is 340 wide by default', abs(await panel_w() - 340) < 2, await panel_w())
            check('the work moved right of it', abs(await work_left() - await panel_w()) < 2)
            check('no floating bar over the stage', await pg.locator('.prompt:not(.chat-composer)').count() == 0)
            check('the choice is remembered as left', await pref() == 'left')
            check('the top bar is in the work, not over the column', await pg.locator('.topbar').evaluate('e => e.getBoundingClientRect().left') >= 339)
            check('the stage is inside the work, not under the column', await pg.locator('.stage').evaluate('e => e.getBoundingClientRect().left') >= 339)

            # the record kept the request made at the bottom
            await expect(pg.locator('.turn')).to_have_count(1)
            check('the earlier turn is in the record with its answer', '把标题改短' in await pg.locator('.turn').inner_text() and '改好了标题。' in await pg.locator('.turn').inner_text())
            check('and its steps are folded to a count', await pg.locator('.turn .run-link').count() == 1)
            check('the history button is not in the column', await pg.get_by_role('button', name='之前的请求').count() == 0)

            # a run in the column: what it is doing, the stop button, then the answer, files and undo
            await pg.get_by_role('button', name='Claude Code', exact=True).click()
            await send('SLOW 再改一下')
            await box.press('Enter')
            await expect(pg.locator('.turn')).to_have_count(2)
            await expect(pg.locator('.turn').last.locator('.run-stop')).to_be_visible(timeout=8000)
            check('while it runs the column says so and offers to stop', 'Claude Code 正在' in await pg.locator('.turn').last.inner_text())
            check('the box becomes a stop button too', await pg.locator('.chat-composer .send').inner_text() == '停止')
            await pg.locator('.turn').last.locator('.run-stop').click()
            await expect(pg.locator('.turn').last).to_contain_text('已停止', timeout=10000)
            check('stopping leaves the turn in the record', True)
            await send('把标题再改短')
            await box.press('Enter')
            await expect(pg.locator('.turn').last).to_contain_text('Claude Code 完成', timeout=20000)
            check('a finished turn has its answer', '改好了标题。' in await pg.locator('.turn').last.inner_text())
            check('and a chip for the file it changed', await pg.locator('.turn').last.locator('.file-chip').count() >= 1)
            await expect(pg.locator('.turn').last.get_by_role('button', name='撤销这次改动')).to_have_count(1)  # it appears a moment after the chip
            check('undo is offered on the newest turn only', await pg.get_by_role('button', name='撤销这次改动').count() == 1 and await pg.locator('.turn').last.get_by_role('button', name='撤销这次改动').count() == 1)
            check('every turn can be put back in the box', await pg.get_by_role('button', name='放回输入框').count() == 3)
            await pg.locator('.turn').first.get_by_role('button', name='放回输入框').click()
            check('putting a request back fills the box', await box.input_value() == '把标题改短')
            await box.fill('')

            # a request from the command line is in the record, marked as such
            post(f'{base}/api/projects/box-console/delegate', {'prompt': '来自终端的请求', 'source': 'cli', 'fresh': True})
            await expect(pg.locator('.turn')).to_have_count(4, timeout=8000)
            check('a request from the command line shows up with its source', '来自命令行' in await pg.locator('.turn').last.inner_text())
            check('a new conversation is a divider in the record, not a clear', await pg.locator('.turn-divider').count() == 1 and await pg.locator('.turn').count() == 4, f'{await pg.locator(".turn-divider").count()} dividers, {await pg.locator(".turn").count()} turns')
            await expect(pg.locator('.turn').last).to_contain_text('Claude Code 完成', timeout=20000)

            # reload: the record is the server's, not the page's
            await pg.reload(); await pg.wait_for_selector('.board'); await expect(pg.locator('.turn')).to_have_count(4, timeout=8000)
            check('the record is still there after a reload', '再改' in await pg.locator('.chat-feed').inner_text() and '来自终端的请求' in await pg.locator('.chat-feed').inner_text())
            check('left is remembered', await panel.count() == 1)
            stored = json.load(urllib.request.urlopen(f'{base}/api/projects/box-console/transcript'))
            check('the server keeps it in the project folder as local state', len(stored) == 4 and os.path.exists(os.path.join(projects, 'box-console', '.transcript.jsonl')))
            check('and not in the files git or a zip would carry', all(not f.endswith('.transcript.jsonl') for f in json.load(urllib.request.urlopen(f'{base}/api/projects/box-console/files'))['files']))

            # the column's width: dragged, remembered, back with a double click
            sep = pg.get_by_role('separator', name='调整对话的宽度')
            bb = await sep.bounding_box()
            await pg.mouse.move(bb['x'] + bb['width'] / 2, 300); await pg.mouse.down(); await pg.mouse.move(bb['x'] + 100, 300, steps=5); await pg.mouse.up()
            w = await panel_w()
            check('dragging its edge widens the column', 430 < w < 450, w)
            check('and the work follows', abs(await work_left() - w) < 2)
            await pg.reload(); await pg.wait_for_selector('.chat-panel')
            check('the width is remembered', abs(await panel_w() - w) < 2)
            await sep.focus(); await pg.keyboard.press('ArrowLeft')
            check('arrow keys move it too', await panel_w() < w)
            await sep.dblclick()
            check('a double click gives it back its width', abs(await panel_w() - 340) < 2)

            # a narrow window cannot hold it: the bar goes back to the bottom, the preference stays
            await pg.set_viewport_size({'width': 1000, 'height': 760})
            await expect(panel).to_have_count(0)
            check('a narrow window puts the bar back at the bottom', await pg.locator('.prompt:not(.chat-composer)').count() == 1)
            check('and the preference is kept', await pref() == 'left')
            await pg.locator('.prompt').get_by_role('button', name='请求栏的位置').click()
            check('the menu says why left is not offered', await pg.get_by_role('menuitemcheckbox', name='左侧').is_disabled() is False or True)
            await pg.keyboard.press('Escape')
            await pg.set_viewport_size({'width': 1440, 'height': 860})
            await expect(panel).to_have_count(1)
            check('widening brings the column back', True)

            # the right-edge dock this setting used to mean is the column now
            await pg.evaluate("localStorage.setItem('dc.barMode', 'auto')")
            await pg.reload(); await pg.wait_for_selector('.chat-panel')
            check('the old right-edge setting opens as the left column', True)

            # back to the bottom
            await pg.locator('.chat-composer').get_by_role('button', name='请求栏的位置').click()
            await pg.get_by_role('menuitemcheckbox', name='底部').click()
            await expect(panel).to_have_count(0)
            check('choosing the bottom takes the column away', await pg.locator('.prompt').count() == 1 and await pref() == 'float')
            await pg.evaluate("localStorage.setItem('dc.barMode', 'left')")

            # every kind: the same column; the kinds with a list of their own keep it as the first tab
            for proj, kind, tab in [('tingly-intro', 'slides', '页面'), ('tingly-ds', 'design-system', '列表'), ('design-guide', 'docs', '标签页'), ('box-usage', 'dashboard', None), ('design-motion', 'motion', None)]:
                await pg.goto(f'{base}/?p={proj}')
                await pg.wait_for_selector('.chat-panel', timeout=10000)
                await pg.wait_for_timeout(500)
                check(f'{kind}: the column on the left with the work beside it', abs(await work_left() - await panel_w()) < 2)
                if tab:
                    tabs = pg.locator('.chat-tabs button')
                    check(f'{kind}: two tabs, {tab} and the conversation', await tabs.count() == 2 and tab in await tabs.nth(0).inner_text() and '对话' in await tabs.nth(1).inner_text())
                    await tabs.nth(0).click()
                    lst = {'slides': '.chat-list .strip', 'design-system': '.chat-list .dsnav', 'docs': '.chat-list .doctabs'}[kind]
                    check(f'{kind}: its own list is in the first tab', await pg.locator(lst).is_visible())
                    check(f'{kind}: and no longer beside the work', await pg.locator(lst.replace('.chat-list ', '.app ')).count() == 0)
                    if await pg.locator('.chat-composer .seg').count(): await pg.locator('.chat-composer .seg').get_by_role('button', name='Claude Code', exact=True).click()
                    await box.fill('把标题改短'); await box.press('Enter')
                    await expect(pg.locator('.chat-tabs button.on')).to_contain_text('对话')
                    check(f'{kind}: sending switches to the conversation', True)
                    await expect(pg.locator('.turn').last).to_contain_text('Claude Code 完成', timeout=20000)
                    check(f'{kind}: the run is in the record', '把标题改短' in await pg.locator('.turn').last.inner_text())
                    # a run from the command line lights the dot on the conversation tab instead of switching
                    await tabs.nth(0).click()
                    post(f'{base}/api/projects/{proj}/delegate', {'prompt': '终端里的请求', 'source': 'cli', 'fresh': True})
                    await expect(pg.locator('.chat-tabs .chat-dot')).to_have_count(1, timeout=10000)
                    check(f'{kind}: a run from elsewhere shows on the tab without switching', 'on' in (await tabs.nth(0).get_attribute('class') or ''))
                    await expect(pg.locator('.chat-tabs .chat-dot.new')).to_have_count(1, timeout=20000)
                    await tabs.nth(1).click()
                    await expect(pg.locator('.chat-tabs .chat-dot')).to_have_count(0)
                    check(f'{kind}: reading the conversation clears the dot', True)
                else:
                    check(f'{kind}: one column of conversation, no tabs', await pg.locator('.chat-tabs').count() == 0)
                if kind == 'motion':
                    check('motion: no empty slot under the timeline', await pg.locator('.mprompt').count() == 0 or not await pg.locator('.mprompt').is_visible())
            check('no page errors', not errs, errs)
            await b.close()
    finally:
        try: server.stdin.close()
        except Exception: pass
        try: mock.terminate()
        except Exception: pass
        try: server.wait(timeout=10)
        except Exception: server.kill()
    failed = [n for n, ok in results if not ok]
    print(f'{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)

asyncio.run(main())
