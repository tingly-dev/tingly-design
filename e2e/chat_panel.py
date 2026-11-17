"""End-to-end checks for the conversation pane (.design/chat-panel.md): the request bar at the bottom by
default; the top bar's Conversation button opening the conversation as the leftmost column, with the kind's
own list moved to its right and the right pane (Properties, Comments, Sources) staying where it is; the
record kept as a transcript (every turn with its steps, answer and files, the same after a reload, requests
from the command line included); undo on the newest turn only; the column's right edge dragged and
remembered; a draft surviving the column opening and closing; a window too narrow disabling the button with
an explanation instead of moving anything; the old left-column setting migrated once; two independent left
columns in every kind; one run in every kind.
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

def transcript(base, project):
    return json.load(urllib.request.urlopen(f'{base}/api/projects/{project}/transcript'))

async def wait_turns(pg, base, project, n, timeout=30):
    """Wait for the project's record to hold `n` turns (the pane may be closed, so no DOM says so)."""
    for _ in range(int(timeout * 10)):
        if len(transcript(base, project)) >= n: return True
        await pg.wait_for_timeout(100)
    return False

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
            pane = pg.locator('.chat-pane')
            box = pg.locator('.chat-composer textarea')
            async def open_chat():
                if not await pane.count(): await pg.locator('[data-pane=chat]').click()
            panel_w = lambda: pane.evaluate('e => e.getBoundingClientRect().width')
            panel_left = lambda: pane.evaluate('e => e.getBoundingClientRect().left')
            pane_pref = lambda: pg.evaluate("localStorage.getItem('dc.chat')")
            send = lambda text: box.fill(text)

            await pg.goto(f'{base}/?p=tingly-box-console-canvas')
            await pg.wait_for_selector('.board')
            await pg.wait_for_timeout(800)

            # the default is the bar at the bottom, as it always was
            check('the prompt starts as the bar at the bottom of the stage', await pg.locator('.prompt:not(.chat-composer)').count() == 1 and await pane.count() == 0)
            check('the conversation button is one of the top bar panes', await pg.locator('[data-pane=chat]').count() == 1)
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

            # a draft typed at the bottom follows the bar into the pane and back
            await pg.locator('.prompt:not(.chat-composer) textarea').fill('写到一半的话')
            await open_chat()
            await expect(pane).to_have_count(1)
            check('the conversation opens at the left edge', abs(await panel_left()) < 2, await panel_left())
            check('it is 340 wide by default', abs(await panel_w() - 340) < 2, await panel_w())
            check('the work starts after the conversation', await pg.locator('.stage').evaluate('e => e.getBoundingClientRect().left') >= await panel_w() - 1)
            check('the properties pane stays: the conversation and it are independent', await pg.locator('.panel').count() == 1)
            check('the bar moved to the pane foot', await pg.locator('.prompt:not(.chat-composer)').count() == 0 and await pg.locator('.chat-composer').count() == 1)
            check('the choice is remembered for every kind', await pane_pref() == '1')
            check('the draft survived opening the pane', await box.input_value() == '写到一半的话')
            await pane.get_by_role('button', name='关闭对话').click()
            await expect(pane).to_have_count(0)
            check('closing brings the bottom bar back with the same draft', await pg.locator('.prompt textarea').input_value() == '写到一半的话')
            check('closing moves nothing else by itself', await pg.locator('.panel').count() == 1)
            await pg.locator('.prompt textarea').fill('')
            await open_chat()
            await expect(pane).to_have_count(1)

            # the record kept the request made at the bottom
            await expect(pg.locator('.turn')).to_have_count(1)
            check('the earlier turn is in the record with its answer', '把标题改短' in await pg.locator('.turn').inner_text() and '改好了标题。' in await pg.locator('.turn').inner_text())
            check('and its steps are folded to a count', await pg.locator('.turn .run-link').count() == 1)
            check('the history button is not in the pane', await pg.get_by_role('button', name='之前的请求').count() == 0)

            # a run in the pane: what it is doing, the stop button, then the answer, files and undo
            await pg.get_by_role('button', name='Claude Code', exact=True).click()
            await send('SLOW 再改一下')
            await box.press('Enter')
            await expect(pg.locator('.turn')).to_have_count(2)
            await expect(pg.locator('.turn').last.locator('.run-stop')).to_be_visible(timeout=8000)
            check('while it runs the pane says so and offers to stop', 'Claude Code 正在' in await pg.locator('.turn').last.inner_text())
            check('the box becomes a stop button too', await pg.locator('.chat-composer .send.stop').count() == 1)
            await pg.locator('.turn').last.locator('.run-stop').click()
            await expect(pg.locator('.turn').last).to_contain_text('已停止', timeout=10000)
            check('stopping leaves the turn in the record', True)
            # Start again inside the stopped run's watcher grace period. Its delayed cleanup must
            # not clear the new run's attribution: an Edit step alone gives a chip, but not undo.
            before_retry = {f: open(os.path.join(projects, 'tingly-box-console-canvas', f)).read()
                            for f in os.listdir(os.path.join(projects, 'tingly-box-console-canvas')) if f.endswith('.dc.html')}
            await send('把标题再改短')
            await box.press('Enter')
            await expect(pg.locator('.turn').last).to_contain_text('Claude Code 完成', timeout=20000)
            check('a finished turn has its answer', '改好了标题。' in await pg.locator('.turn').last.inner_text())
            check('the answer in the record is read as Markdown', await pg.locator('.turn').last.locator('.run-result.md p', has_text='改好了标题。').count() == 1)
            check('and a chip for the file it changed', await pg.locator('.turn').last.locator('.file-chip').count() >= 1)
            await expect(pg.locator('.turn').last.get_by_role('button', name='撤销这次改动')).to_have_count(1)  # it appears a moment after the chip
            check('undo is offered on the newest turn only', await pg.get_by_role('button', name='撤销这次改动').count() == 1 and await pg.locator('.turn').last.get_by_role('button', name='撤销这次改动').count() == 1)
            changed_file = await pg.locator('.turn').last.locator('.file-chip').first.inner_text()
            journal = json.load(urllib.request.urlopen(f'{base}/api/projects/tingly-box-console-canvas/journal'))
            check('the run after stopping is credited to Claude, not an outside edit', next(e for e in reversed(journal) if e['file'] == changed_file)['actor'] == 'claude')
            await pg.locator('.turn').last.get_by_role('button', name='撤销这次改动').click()
            await expect(pg.locator('.turn').last).to_contain_text('已撤销')
            for _ in range(50):
                if open(os.path.join(projects, 'tingly-box-console-canvas', changed_file)).read() == before_retry[changed_file]: break
                await pg.wait_for_timeout(100)
            check('undo after stopping restores the next run\'s actual file change', open(os.path.join(projects, 'tingly-box-console-canvas', changed_file)).read() == before_retry[changed_file])
            check('every turn can be put back in the box', await pg.get_by_role('button', name='放回输入框').count() == 3)
            await pg.locator('.turn').first.get_by_role('button', name='放回输入框').click()
            check('putting a request back fills the box', await box.input_value() == '把标题改短')
            await box.fill('')

            # a request from the command line is in the record, marked as such; with the pane closed it lights the button
            await pane.get_by_role('button', name='关闭对话').click()
            await expect(pane).to_have_count(0)
            post(f'{base}/api/projects/tingly-box-console-canvas/delegate', {'prompt': '来自终端的请求', 'source': 'cli', 'fresh': True})
            await expect(pg.locator('[data-pane=chat] .badge')).to_have_count(1, timeout=8000)
            check('a run from elsewhere lights the conversation button', True)
            check('it finishes while the pane is closed', await wait_turns(pg, base, 'tingly-box-console-canvas', 4))
            await open_chat()
            await expect(pane).to_have_count(1)
            await expect(pg.locator('.turn')).to_have_count(4, timeout=8000)
            await expect(pg.locator('[data-pane=chat] .badge')).to_have_count(0)
            check('opening the pane clears the button', True)
            check('a request from the command line shows up with its source', '来自命令行' in await pg.locator('.turn').last.inner_text())
            check('a new conversation is a divider in the record, not a clear', await pg.locator('.turn-divider').count() == 1 and await pg.locator('.turn').count() == 4, f'{await pg.locator(".turn-divider").count()} dividers, {await pg.locator(".turn").count()} turns')
            await expect(pg.locator('.turn').last).to_contain_text('Claude Code 完成', timeout=20000)

            # reload: the record is the server's, not the page's, and the pane is remembered
            await pg.reload(); await pg.wait_for_selector('.board'); await expect(pg.locator('.turn')).to_have_count(4, timeout=8000)
            check('the record is still there after a reload', '再改' in await pg.locator('.chat-feed').inner_text() and '来自终端的请求' in await pg.locator('.chat-feed').inner_text())
            check('the conversation pane is remembered', await pane.count() == 1)
            stored = json.load(urllib.request.urlopen(f'{base}/api/projects/tingly-box-console-canvas/transcript'))
            check('the server keeps it in the project folder as local state', len(stored) == 4 and os.path.exists(os.path.join(projects, 'tingly-box-console-canvas', '.transcript.jsonl')))
            check('and not in the files git or a zip would carry', all(not f.endswith('.transcript.jsonl') for f in json.load(urllib.request.urlopen(f'{base}/api/projects/tingly-box-console-canvas/files'))['files']))

            # the conversation's width: dragged by its right edge, remembered, back with a double click
            sep = pg.get_by_role('separator', name='调整对话的宽度')
            bb = await sep.bounding_box()
            await pg.mouse.move(bb['x'] + bb['width'] / 2, 300); await pg.mouse.down(); await pg.mouse.move(bb['x'] + 100, 300, steps=5); await pg.mouse.up()
            w = await panel_w()
            check('dragging its right edge widens the conversation', 430 < w < 450, w)
            await pg.reload(); await pg.wait_for_selector('.chat-pane')
            check('the width is remembered', abs(await panel_w() - w) < 2)
            await sep.focus(); await pg.keyboard.press('ArrowRight')
            check('arrow keys move it too', await panel_w() > w)
            await sep.dblclick()
            check('a double click gives it back its width', abs(await panel_w() - 340) < 2)

            # a narrow window does not move anything by itself; once closed, the button says why it cannot open
            await pg.set_viewport_size({'width': 1000, 'height': 760})
            await expect(pane).to_have_count(1)
            check('a narrow window leaves the open conversation where it is', True)
            await pane.get_by_role('button', name='关闭对话').click()
            await expect(pane).to_have_count(0)
            check('the bar is back at the bottom', await pg.locator('.prompt:not(.chat-composer)').count() == 1)
            chat_btn = pg.locator('[data-pane=chat]')
            check('the conversation button is disabled with an explanation', await chat_btn.is_disabled() and '窗口再宽一点' in (await chat_btn.get_attribute('title') or ''), await chat_btn.get_attribute('title'))
            await pg.set_viewport_size({'width': 1440, 'height': 860})
            await expect(chat_btn).to_be_enabled()
            await expect(pane).to_have_count(0)
            check('widening restores the button but does not reopen the conversation', True)

            # the old left-column setting migrates once into the pane
            await pg.evaluate("localStorage.setItem('dc.barMode', 'left'); localStorage.setItem('dc.chat', '0')")
            await pg.reload(); await pg.wait_for_selector('.chat-pane')
            check('the old left setting opens the conversation beside the work', True)
            check('and is cleared after migrating', await pg.evaluate("localStorage.getItem('dc.barMode')") == '')
            await pg.reload(); await pg.wait_for_selector('.chat-pane')
            check('the conversation stays open after migrating, as a remembered choice', True)
            await pg.evaluate("localStorage.setItem('dc.chat', '0')")

            # every kind: the conversation at the far left, the kind's own list moved to its right
            await pg.goto(f'{base}/?p=tingly-box-console-canvas'); await pg.wait_for_timeout(300)
            for proj, kind, lst, work in [
                ('tingly-design-intro-slides', 'slides', '.strip', '.stage'),
                ('tingly-design-system', 'design-system', '.dsnav', '.dsmain'),
                ('tingly-design-guide-doc', 'docs', '.doctabs', '.docmain'),
                ('tingly-box-usage-dashboard', 'dashboard', None, '.dashmain'),
                ('tingly-design-motion', 'motion', None, '.mmain'),
            ]:
                await pg.goto(f'{base}/?p={proj}')
                await pg.wait_for_selector('.topbar', timeout=10000)
                await pg.wait_for_timeout(500)
                await open_chat()
                await expect(pane).to_have_count(1)
                check(f'{kind}: the conversation opens at the left edge', abs(await panel_left()) < 2)
                if lst:
                    check(f'{kind}: its own list is still there, moved to the right of the conversation', await pg.locator(lst).is_visible() and await pg.locator(lst).evaluate('e => e.getBoundingClientRect().left') >= await panel_w() - 1)
                    check(f'{kind}: the list is not inside the conversation column', await pg.locator(f'.chat-pane {lst}').count() == 0)
                if await pg.locator(work).count():
                    check(f'{kind}: the work sits between the kind\'s list and the right pane', await pg.locator(work).evaluate('e => e.getBoundingClientRect().left') >= await panel_w() - 1)
                if kind == 'motion':
                    check('motion: no empty slot under the timeline while the pane is open', await pg.locator('.mprompt').count() == 0 or not await pg.locator('.mprompt').is_visible())
                if await pg.locator('.chat-composer .seg').count(): await pg.locator('.chat-composer .seg').get_by_role('button', name='Claude Code', exact=True).click()
                await box.fill('把标题改短'); await box.press('Enter')
                await expect(pg.locator('.turn').last).to_contain_text('Claude Code 完成', timeout=25000)
                check(f'{kind}: the run is in the pane\'s record', '把标题改短' in await pg.locator('.turn').last.inner_text())
                # a run from the command line while the pane is closed lights the button instead of opening it
                await pane.get_by_role('button', name='关闭对话').click()
                await expect(pane).to_have_count(0)
                post(f'{base}/api/projects/{proj}/delegate', {'prompt': '终端里的请求', 'source': 'cli', 'fresh': True})
                await expect(pg.locator('[data-pane=chat] .badge')).to_have_count(1, timeout=10000)
                check(f'{kind}: a run from elsewhere shows on the button without opening the pane', await pane.count() == 0)
                check(f'{kind}: the run finished while the pane was closed', await wait_turns(pg, base, proj, 2))
                await open_chat()
                await expect(pg.locator('[data-pane=chat] .badge')).to_have_count(0)
                await expect(pg.locator('.turn').last).to_contain_text('Claude Code 完成', timeout=25000)
                check(f'{kind}: reading the pane clears the button', True)

            # canvas at the end: the pane opens and closes from the top bar, the menus stay inside the window
            await pg.set_viewport_size({'width': 1440, 'height': 800})
            await pg.goto(f'{base}/?p=tingly-box-console-canvas')
            await pg.wait_for_selector('.board', timeout=10000)
            await pg.wait_for_timeout(500)
            await open_chat()
            await expect(pane).to_have_count(1)
            check('canvas: the conversation pane opens from the top bar', True)
            await pane.get_by_role('button', name='关闭对话').click()
            await expect(pane).to_have_count(0)
            check('canvas: closing it puts the bottom bar back', await pg.locator('.prompt:not(.chat-composer)').count() == 1)
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