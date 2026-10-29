"""End-to-end checks for the side columns: every one has an edge the person drags to make it wider or
narrower, arrow keys do the same, a double click gives it back its own width, and the width is remembered
(the right panel of canvas, slides and motion, the slide strip, a doc's tabs and comments, a design system's
navigation, a dashboard's data sources). The conversation column's own edge is checked in chat_panel.py.
Run after `pnpm build`: python3 e2e/side_resize.py  (DC_CHROME=/path/to/chrome to use another Chromium)
Starts its own server (production mode, PORT=0) on a fresh projects folder."""
import os, sys, asyncio, json, subprocess, tempfile, threading, time, shutil
from playwright.async_api import async_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

# project, the column's id, the column's selector, the side its edge is on, what has to be open first
COLUMNS = [
    ('tingly-box-console-canvas', 'inspector', '.panel', 'start', None),
    ('tingly-design-intro-slides', 'strip', '.strip', 'end', None),
    ('tingly-design-intro-slides', 'inspector', '.panel', 'start', None),
    ('tingly-design-system', 'dsnav', '.dsnav', 'end', None),
    ('tingly-design-guide-doc', 'doctabs', '.doctabs', 'end', None),
    ('tingly-design-guide-doc', 'docrail', '.crail', 'start', 'comments'),
    ('tingly-box-usage-dashboard', 'dashside', '.dashside', 'start', None),
    ('design-motion', 'inspector', '.panel', 'start', None),
]

async def main():
    if not os.path.exists(os.path.join(REPO, 'apps/editor/dist/index.html')):
        raise SystemExit('no editor build: run pnpm build first')
    tmp = tempfile.mkdtemp(prefix='dc-side-')
    projects = os.path.join(tmp, 'projects')
    shutil.copytree(os.path.join(REPO, 'projects'), projects)
    server = subprocess.Popen(
        [os.path.join(REPO, 'apps/server/node_modules/.bin/tsx'), 'src/index.ts'], cwd=os.path.join(REPO, 'apps/server'),
        env={**os.environ, 'NODE_ENV': 'production', 'PORT': '0', 'DC_PROJECTS': projects, 'DC_EXIT_WITH_STDIN': '1'},
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
            for proj, side, sel, edge, opener in COLUMNS:
                label = f'{proj} {side}'
                await pg.goto(f'{base}/?p={proj}')
                await pg.wait_for_selector('.topbar', timeout=10000)
                await pg.wait_for_timeout(700)
                if opener == 'comments' and not await pg.locator(sel).count():
                    await pg.get_by_role('button', name='评论').first.click()
                col = pg.locator(sel).first
                await col.wait_for(state='visible', timeout=8000)
                sep = pg.locator(f'[role=separator][data-side={side}]')
                width = lambda: col.evaluate('e => e.getBoundingClientRect().width')
                w0 = await width()
                check(f'{label}: the column has an edge to drag', await sep.count() == 1)
                bb = await sep.bounding_box()
                grow = 80 if edge == 'end' else -80
                await pg.mouse.move(bb['x'] + bb['width'] / 2, 400); await pg.mouse.down(); await pg.mouse.move(bb['x'] + bb['width'] / 2 + grow, 400, steps=6); await pg.mouse.up()
                w1 = await width()
                check(f'{label}: dragging it widens the column', 60 < w1 - w0 < 100, f'{w0} -> {w1}')
                await pg.reload(); await pg.wait_for_selector('.topbar'); await pg.wait_for_timeout(700)
                if opener == 'comments' and not await pg.locator(sel).count():
                    await pg.get_by_role('button', name='评论').first.click()
                await col.wait_for(state='visible', timeout=8000)
                check(f'{label}: the width is remembered', abs(await width() - w1) < 2, f'{await width()} vs {w1}')
                await sep.focus(); await pg.keyboard.press('ArrowRight' if edge == 'end' else 'ArrowLeft')
                check(f'{label}: an arrow key widens it', await width() > w1)
                await sep.dblclick()
                check(f'{label}: a double click gives it back its own width', abs(await width() - w0) < 2, f'{await width()} vs {w0}')
                # the work still has room: nothing was pushed out of the window
                check(f'{label}: the page does not scroll sideways', await pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
            check('no page errors', not errs, errs)
            await b.close()
    finally:
        try: server.stdin.close()
        except Exception: pass
        try: server.wait(timeout=10)
        except Exception: server.kill()
    failed = [n for n, ok in results if not ok]
    print(f'{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)

asyncio.run(main())
