"""End-to-end checks for where the prompt lives: the bar at the bottom by default (its run card one line until the pointer is on it),
moved to the right as a side dock: hidden on the right edge with only its tab showing, opened by
the pointer on the tab or the cursor in the box, let go of when the person clicks the work, pinned open with the
editor given the rest of the width, floating (the old bar), and the choice remembered. One run in every kind.
Run after `pnpm build`: python3 e2e/dock.py  (DC_CHROME=/path/to/chrome to use another Chromium)
Starts its own server (production mode, PORT=0) on a fresh projects folder, with the mock model and a
stand-in `claude`, so it needs neither `pnpm dev` nor an API key."""
import os, sys, asyncio, json, subprocess, tempfile, threading, time, shutil
from playwright.async_api import async_playwright, expect

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get('DC_CHROME')
MOCK_PORT = 8793

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

# the stand-in `claude` of run_feed.py, read from there so the two never drift
src = open(os.path.join(HERE, 'run_feed.py')).read()
FAKE_CLAUDE = src.split("FAKE_CLAUDE = r'''", 1)[1].split("'''", 1)[0]

async def main():
    if not os.path.exists(os.path.join(REPO, 'apps/editor/dist/index.html')):
        raise SystemExit('no editor build: run pnpm build first')
    tmp = tempfile.mkdtemp(prefix='dc-dock-')
    projects = os.path.join(tmp, 'projects')
    shutil.copytree(os.path.join(REPO, 'projects'), projects)
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
            pg = await b.new_page(locale='zh-CN', viewport={'width': 1280, 'height': 800})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            dock = pg.locator('.agent-dock')
            box = dock.locator('textarea[aria-label="请求"]')
            x = lambda loc: loc.evaluate('e => e.getBoundingClientRect().left')
            await pg.goto(f'{base}/?p=box-console')
            await pg.wait_for_selector('.board')
            await pg.wait_for_timeout(800)

            # the default is the bar at the bottom, as it always was; its run card folds to one line when the person goes back to the work
            check('the prompt starts as the bar at the bottom of the stage', await pg.locator('.prompt:not(.agent-dock)').count() == 1 and await dock.count() == 0)
            bar = pg.locator('.prompt')
            await pg.get_by_role('button', name='Claude Code', exact=True).click()
            await bar.locator('textarea').fill('把标题改短')
            await bar.locator('textarea').press('Enter')
            await expect(pg.locator('.runfeed')).to_contain_text('Claude Code 完成', timeout=15000)
            check('with the cursor in the box the card shows the answer', '改好了标题。' in await pg.locator('.runfeed').inner_text())
            await pg.mouse.click(400, 300)
            await pg.mouse.move(400, 300)
            await pg.wait_for_function("!document.querySelector('.runfeed .run-say') || getComputedStyle(document.querySelector('.runfeed .run-say')).display === 'none' || !document.querySelector('.runfeed .run-say').offsetParent", timeout=3000)
            check('a click on the work folds the card to its one line', 'Claude Code 完成' in await pg.locator('.runfeed .run-head').inner_text() and await pg.locator('.runfeed').evaluate('e => e.getBoundingClientRect().height') < 70)
            await bar.hover()
            await expect(pg.locator('.runfeed')).to_contain_text('改好了标题。', timeout=3000)
            check('the pointer on the bar brings the answer back', True)
            await pg.mouse.move(400, 300)
            await pg.locator('.runfeed').get_by_role('button', name='撤销这次改动').click()
            await pg.wait_for_timeout(600)

            # moved to the right: a dock, hidden at the edge with only its tab showing
            await pg.get_by_role('button', name='移到右侧').click()
            await expect(dock).to_have_count(1)
            await pg.mouse.move(300, 300)
            await pg.wait_for_function("document.querySelector('.agent-dock').getBoundingClientRect().left > 1270", timeout=3000)
            check('moving it to the right makes a dock on the right edge', 'auto' in await dock.get_attribute('class'))
            check('hidden, it is off the screen but for its tab', await x(dock) >= 1279 and await x(pg.locator('.dock-tab')) < 1280 - 20)
            check('no floating bar over the stage', await pg.locator('.prompt:not(.agent-dock)').count() == 0)

            # the pointer on the tab opens it, leaving closes it
            await pg.locator('.dock-tab').hover()
            await expect(box).to_be_visible()
            await pg.wait_for_function("document.querySelector('.agent-dock').getBoundingClientRect().left < 1280 - 300", timeout=3000)
            check('the pointer on the tab slides the dock in', True)
            await pg.mouse.move(300, 300)
            await pg.wait_for_function("document.querySelector('.agent-dock').getBoundingClientRect().left > 1270", timeout=3000)
            check('moving away lets it go', True)

            # the cursor in the box keeps it open; a click on the work lets it go
            await pg.keyboard.press('Control+j')
            await pg.wait_for_function("document.querySelector('.agent-dock').getBoundingClientRect().left < 1280 - 300", timeout=3000)
            check('Ctrl J puts the cursor in the box and opens the dock', await pg.evaluate("document.activeElement && document.activeElement.getAttribute('aria-label') === '请求'"))
            await pg.mouse.move(300, 300)
            await pg.wait_for_timeout(900)
            check('with the cursor in the box it stays open while the pointer is elsewhere', await x(dock) < 1280 - 300)
            await pg.mouse.click(400, 300)
            await pg.wait_for_function("document.querySelector('.agent-dock').getBoundingClientRect().left > 1270", timeout=3000)
            check('a click on the work lets it go', True)
            await pg.keyboard.press('Control+j')
            await pg.keyboard.press('Escape')
            await pg.wait_for_function("document.querySelector('.agent-dock').getBoundingClientRect().left > 1270", timeout=3000)
            check('Esc in the box lets it go', True)

            # a run: the tab shows it going and how it ended, the dock is not forced open
            await pg.locator('.dock-tab').hover()
            await box.fill('把标题再改短')
            await box.press('Enter')
            await pg.mouse.click(400, 300)
            await expect(pg.locator('.dock-tab.running')).to_have_count(1, timeout=8000)
            await pg.wait_for_function("document.querySelector('.agent-dock').getBoundingClientRect().left > 1270", timeout=3000)
            check('hidden, the tab shows a run going', True)
            await expect(pg.locator('.dock-tab.done')).to_have_count(1, timeout=15000)
            check('and that it finished, with the dock still hidden', await x(dock) > 1270)
            await pg.locator('.dock-tab').hover()
            await expect(dock.locator('.runfeed')).to_contain_text('Claude Code 完成', timeout=5000)
            check('opening the dock shows the answer', '改好了标题。' in await dock.locator('.runfeed').inner_text())
            await pg.mouse.move(300, 300)

            # pinned: the editor gives up the width, nothing is covered
            app_w = await pg.locator('.app').evaluate('e => e.getBoundingClientRect().width')
            await pg.locator('.dock-tab').hover()
            await dock.get_by_role('button', name='固定在侧边').click()
            await pg.mouse.move(300, 300)
            await pg.wait_for_timeout(500)
            check('pinned, the dock stays', await x(dock) < 1280 - 300 and 'pinned' in await dock.get_attribute('class'))
            check('and the editor is narrower by the dock', await pg.locator('.app').evaluate('e => e.getBoundingClientRect().width') <= app_w - 340)
            check('the dock does not overlap the editor', await pg.locator('.app').evaluate('e => e.getBoundingClientRect().right') <= await x(dock) + 1)
            await pg.reload(); await pg.wait_for_selector('.board'); await pg.wait_for_timeout(600)
            check('pinned is remembered', 'pinned' in (await dock.get_attribute('class') or ''))
            await dock.get_by_role('button', name='恢复自动隐藏').click()
            await pg.mouse.move(300, 300)
            await pg.wait_for_function("document.querySelector('.agent-dock').getBoundingClientRect().left > 1270", timeout=3000)
            check('unpinning goes back to hiding and gives the width back', await pg.locator('.app').evaluate('e => e.getBoundingClientRect().width') >= app_w - 1)

            # floating: the old bar, and the fold to a pill
            await pg.locator('.dock-tab').hover()
            await dock.get_by_role('button', name='移到底部').click()
            await expect(pg.locator('.prompt:not(.agent-dock)')).to_have_count(1)
            check('moving it to the bottom puts the bar back', await pg.locator('.agent-dock').count() == 0)
            await pg.reload(); await pg.wait_for_selector('.board')
            check('floating is remembered', await pg.locator('.prompt:not(.agent-dock)').count() == 1)
            await pg.get_by_role('button', name='移到右侧').click()
            await expect(pg.locator('.agent-dock')).to_have_count(1)
            check('docking again from the floating bar', True)

            # a narrow window floats whatever was chosen, and the dock button is not offered
            await pg.set_viewport_size({'width': 900, 'height': 700})
            await expect(pg.locator('.prompt:not(.agent-dock)')).to_have_count(1)
            check('a narrow window floats the bar', await pg.get_by_role('button', name='移到右侧').count() == 0)
            await pg.set_viewport_size({'width': 1280, 'height': 800})
            await expect(pg.locator('.agent-dock')).to_have_count(1)
            check('and widening brings the dock back', True)

            # every kind gets the same dock; motion gives up its prompt slot
            for proj, kind in [('tingly-intro', 'slides'), ('tingly-ds', 'design-system'), ('box-usage', 'dashboard'), ('design-guide', 'docs'), ('design-motion', 'motion')]:
                await pg.goto(f'{base}/?p={proj}')
                await pg.wait_for_selector('.agent-dock', state='attached', timeout=10000)
                await pg.wait_for_timeout(500)
                check(f'{kind}: the same dock, hidden', await pg.locator('.agent-dock').count() == 1 and await x(dock) >= 1279)
                await pg.locator('.dock-tab').hover()
                await expect(box).to_be_visible()
                check(f'{kind}: the box is there when it opens', True)
                await pg.mouse.move(300, 300)
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
