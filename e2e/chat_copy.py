"""End-to-end checks that what the conversation says can be selected and copied like text on any page: a drag,
a double click on a word and a triple click on a paragraph select it, and ⌘C / Ctrl+C puts the selected text on
the system clipboard, in the conversation column, in the bottom bar's run card and in the history, in every kind;
while ⌘C / ⌘V of an element on a canvas keeps working (a selected element and no selected text copies the element).
Run after `pnpm build`: python3 e2e/chat_copy.py  (DC_CHROME=/path/to/chrome to use another Chromium)
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

# the stand-in `claude` of run_feed.py, read from there so the two never drift; its answer is made longer
src = open(os.path.join(HERE, 'run_feed.py')).read()
ANSWER = '第一句答案在这里。\nnpm run build 之后重新打开。'
FAKE_CLAUDE = src.split("FAKE_CLAUDE = r'''", 1)[1].split("'''", 1)[0].replace("'result': '改好了标题。'", "'result': " + repr(ANSWER))
assert repr(ANSWER) in FAKE_CLAUDE

async def wait_for(fn, timeout=6.0):
    t = time.time()
    while time.time() - t < timeout:
        if fn(): return True
        await asyncio.sleep(0.1)
    return False

async def main():
    if not os.path.exists(os.path.join(REPO, 'apps/editor/dist/index.html')):
        raise SystemExit('no editor build: run pnpm build first')
    tmp = tempfile.mkdtemp(prefix='dc-copy-')
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
            ctx = await b.new_context(locale='zh-CN', viewport={'width': 1440, 'height': 860})
            await ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=base)
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            box = pg.locator('.chat-composer textarea')

            sel = lambda: pg.evaluate('window.getSelection().toString()')
            clip = lambda: pg.evaluate('navigator.clipboard.readText()')
            plain = lambda s: s.replace(' ', ' ').strip()

            async def drag_over(loc):
                """a mouse drag from just inside the start of an element's first line to the end of its last"""
                bb = await loc.bounding_box()
                await pg.mouse.move(bb['x'] + 2, bb['y'] + 4)
                await pg.mouse.down()
                await pg.mouse.move(bb['x'] + bb['width'] - 2, bb['y'] + bb['height'] - 4, steps=8)
                await pg.mouse.up()

            async def copy_checks(label, scope, answer, prompt=None):
                """select in `scope` (a locator of one turn or run card) by triple click, drag and double click, then copy"""
                ans = scope.locator('.run-result').first
                await ans.scroll_into_view_if_needed()
                await ans.click(click_count=3)
                got = plain(await sel())
                check(f'{label}: a triple click selects a line of the answer', got != '' and got in plain(answer), got)
                await pg.keyboard.press('ControlOrMeta+C')
                await pg.wait_for_timeout(150)
                got = plain(await clip())
                check(f'{label}: ⌘C puts the selected line on the clipboard', got != '' and got == plain(await sel()), got)

                await pg.evaluate('navigator.clipboard.writeText("before")')
                await pg.evaluate('window.getSelection().removeAllRanges()')
                await drag_over(ans)
                got = plain(await sel())
                check(f'{label}: a mouse drag selects the answer', '第一句答案在这里。' in got and '重新打开' in got, got)
                await pg.keyboard.press('ControlOrMeta+C')
                await pg.wait_for_timeout(150)
                got = plain(await clip())
                check(f'{label}: ⌘C after a drag copies the dragged text', '第一句答案在这里。' in got and '重新打开' in got, got)

                await pg.evaluate('window.getSelection().removeAllRanges()')
                bb = await ans.bounding_box()
                await pg.mouse.dblclick(bb['x'] + 6, bb['y'] + 10)
                got = plain(await sel())
                check(f'{label}: a double click selects a word', got != '' and got in answer, got)

                if prompt is not None:
                    bubble = scope.locator('.turn-bubble').first
                    await bubble.click(click_count=3)
                    got = plain(await sel())
                    check(f'{label}: the request is selectable too', prompt in got, got)
                    await pg.keyboard.press('ControlOrMeta+C')
                    await pg.wait_for_timeout(150)
                    check(f'{label}: and copies', prompt in plain(await clip()), await clip())

            # --- the column on the left, canvas --------------------------------------------
            await pg.goto(f'{base}/?p=tingly-box-console-canvas')
            await pg.evaluate("localStorage.setItem('dc.barMode', 'left')")
            await pg.goto(f'{base}/?p=tingly-box-console-canvas')
            await pg.wait_for_selector('.board')
            await pg.wait_for_timeout(800)
            await pg.get_by_role('button', name='Claude Code', exact=True).click()
            await box.fill('把标题改短')
            await box.press('Enter')
            turn = pg.locator('.turn').last
            await expect(turn).to_contain_text('Claude Code 完成', timeout=20000)
            await copy_checks('column', turn, ANSWER, '把标题改短')

            # steps unfolded: the tool lines are text too
            await turn.locator('.run-link').click()
            step = turn.locator('.run-steps li').first
            await step.click(click_count=3)
            check('column: an unfolded step line can be selected', len(plain(await sel())) > 3, await sel())

            # --- the canvas's own copy and paste of an element must keep working ------------
            canvas_dir = os.path.join(projects, 'tingly-box-console-canvas')
            count = lambda: sum(open(os.path.join(canvas_dir, f)).read().count('>Team settings</h1>') for f in os.listdir(canvas_dir) if f.endswith('.dc.html'))
            main = pg.frame_locator('iframe').first
            before = count()
            await main.locator('h1').first.click()
            await pg.wait_for_timeout(300)
            await pg.keyboard.press('ControlOrMeta+C')
            await pg.keyboard.press('ControlOrMeta+V')
            check('canvas: ⌘C ⌘V of a selected element still pastes it', await wait_for(lambda: count() == before + 1), (before, count()))
            await pg.keyboard.press('ControlOrMeta+Z')
            check('canvas: and undo takes it back', await wait_for(lambda: count() == before), (before, count()))

            # text selected in the conversation while an element is selected: ⌘C is the text's, and ⌘V does not paste the element on its own
            await turn.locator('.run-result').click(click_count=3)
            await pg.keyboard.press('ControlOrMeta+C')
            await pg.wait_for_timeout(150)
            got = plain(await clip())
            check('column: with an element selected, selected conversation text still copies as text', got != '' and got == plain(await sel()) and got in plain(ANSWER), got)
            check('…and the element was not duplicated', count() == before, (before, count()))

            # --- the bottom bar: the run card and the history --------------------------------
            await pg.evaluate("localStorage.setItem('dc.barMode', 'float')")
            await pg.goto(f'{base}/?p=tingly-box-console-canvas')
            await pg.wait_for_selector('.board')
            await pg.wait_for_timeout(800)
            bar = pg.locator('.prompt')
            await bar.locator('textarea').fill('再改一次')
            await pg.get_by_role('button', name='Claude Code', exact=True).click()
            await bar.locator('textarea').press('Enter')
            await expect(pg.locator('.runfeed')).to_contain_text('Claude Code 完成', timeout=20000)
            await copy_checks('bottom bar', pg.locator('.runfeed'), ANSWER)
            await bar.get_by_role('button', name='之前的请求').click()
            row = pg.locator('.run-history .hist').first
            await row.locator('.hist-prompt').click()
            await copy_checks('history', row, ANSWER)

            # --- every other kind: the column's answer copies -------------------------------
            await pg.evaluate("localStorage.setItem('dc.barMode', 'left')")
            for proj, kind in [('tingly-design-intro-slides', 'slides'), ('tingly-design-system', 'design-system'), ('tingly-design-guide-doc', 'docs'), ('tingly-box-usage-dashboard', 'dashboard'), ('tingly-design-motion', 'motion')]:
                await pg.goto(f'{base}/?p={proj}')
                await pg.wait_for_selector('.chat-panel', timeout=10000)
                await pg.wait_for_timeout(700)
                if await pg.locator('.chat-tabs').count():
                    await pg.locator('.chat-tabs [role=tab]').nth(1).click()
                if not await pg.locator('.turn').count():
                    # a kind with a fast AI picks who answers; the others only have Claude Code
                    if await pg.get_by_role('button', name='Claude Code', exact=True).count():
                        await pg.get_by_role('button', name='Claude Code', exact=True).click()
                    await box.fill('改一下')
                    await box.press('Enter')
                t_ = pg.locator('.turn').last
                await expect(t_).to_contain_text('Claude Code 完成', timeout=25000)
                ans = t_.locator('.run-result').first
                await ans.click(click_count=3)
                await pg.keyboard.press('ControlOrMeta+C')
                await pg.wait_for_timeout(150)
                got = plain(await clip())
                check(f'{kind}: the answer in the column selects and copies', got != '' and got == plain(await sel()) and got in plain(ANSWER), got)

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
