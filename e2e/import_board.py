"""End-to-end checks for importing from a project: an artboard of a canvas (the sample effect, Glow) comes
into a slide deck and a motion piece through the import menu's 从项目导入…, is copied under uploads/,
recorded in the index, drawn on the stage by the artboard runtime, set from the panel (data-props) and
updated from its canvas; a canvas looks at a moving artboard at any moment from its Tweaks.
Run after `pnpm build`: python3 e2e/import_board.py  (DC_CHROME=/path/to/chrome to use another Chromium)
Starts its own server (production mode, PORT=0) on a fresh copy of the sample projects."""
import os, re, sys, asyncio, json, shutil, subprocess, tempfile, threading, time
from playwright.async_api import async_playwright, expect

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out') + '/'
CHROME = os.environ.get('DC_CHROME')
COPY = 'uploads/box-console-Glow/Glow.dc.html'

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

async def wait_for(pred, timeout=10.0):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if pred(): return True
        except Exception: pass
        await asyncio.sleep(0.15)
    return False

async def toast(pg, text, timeout=15000):
    try:
        await expect(pg.locator('.toast', has_text=text).first).to_be_visible(timeout=timeout)
        return True
    except AssertionError:
        return False

async def board_drawn(pg, timeout=10.0, player=False):
    """The frame of an artboard drawn on the page (the runtime's #dc-app, holding the blobs); `player`: inside the motion player."""
    t = time.time()
    while time.time() - t < timeout:
        for fr in pg.frames:
            try:
                if await fr.evaluate("() => !!document.getElementById('dc-app') && document.querySelectorAll('#dc-app div[style*=radial-gradient]').length >= 3"):
                    if not player or await fr.parent_frame.evaluate("() => !!document.querySelector('.dc-motion-root')"):
                        return fr
            except Exception:
                pass
        await asyncio.sleep(0.2)
    return None

async def pick_glow(pg):
    # the shared Import / Export menu every kind's bar carries
    await pg.locator('button[aria-label="导入 / 导出"]').first.click()
    await pg.locator('.menu .mi', has_text='从项目导入').click()
    await expect(pg.locator('.bpick')).to_be_visible()
    item = pg.locator('.bpick-item[data-pick="Glow.dc.html"]')
    await expect(item).to_be_visible()
    return item

async def main():
    if not os.path.exists(os.path.join(REPO, 'apps/editor/dist/index.html')):
        raise SystemExit('no editor build: run pnpm build first')
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='dc-import-board-')
    projects = os.path.join(tmp, 'projects')
    shutil.copytree(os.path.join(REPO, 'projects'), projects)
    P = lambda *a: os.path.join(projects, *a)
    read = lambda *a: open(P(*a)).read()

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
            pg = await b.new_page(locale='zh-CN', viewport={'width': 1440, 'height': 900})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))

            # --- slides: the import menu offers projects; the picker lists canvases' artboards -------
            await pg.goto(base + '/?p=tingly-intro')
            await pg.wait_for_timeout(2000)
            slide_id = json.loads(read('tingly-intro', 'deck.json'))['order'][0]
            slide = lambda: read('tingly-intro', 'slides', f'{slide_id}.html')
            item = await pick_glow(pg)
            check('slides: the picker marks an artboard that moves', await item.locator('.badge', has_text='会动').count() == 1)
            check('…and puts moving artboards first', await pg.locator('.bpick-group').first.locator('.bpick-item').first.get_attribute('data-pick') == 'Glow.dc.html')
            await item.hover()
            await pg.wait_for_timeout(1200)
            await pg.screenshot(path=OUT + 'import-board-picker.png')
            await item.click()
            check('slides: importing says so', await toast(pg, '已把 Glow backdrop (effect) 导入到这一页'))
            ok = await wait_for(lambda: f'src="{COPY}"' in slide())
            check('slides: the artboard goes onto the open slide by src', ok, slide()[:600])
            check('…first, so it sits behind everything', slide().split('>', 1)[1].lstrip().startswith(f'<x-embed src="{COPY}"'), slide()[:300])
            check('…full slide', 'left:0px;top:0px;width:1920px;height:1080px' in slide())
            check('slides: the copy is kept under uploads/', os.path.exists(P('tingly-intro', COPY)))
            imports = json.loads(read('tingly-intro', 'deck.json')).get('imports', [])
            check('slides: deck.json records where it came from', any(r['path'] == COPY and r['from'] == 'projects/box-console' and r['board'] == 'Glow.dc.html' for r in imports), imports)
            check('slides: the stage draws it with the artboard runtime', await board_drawn(pg) is not None)

            # --- the panel: where it came from, and its options as this embed sets them ---------------
            panel = pg.locator('.bembed')
            await expect(panel).to_be_visible()
            check('panel: says where the artboard came from', await panel.locator('.hint', has_text='来自 box-console 的 Glow').count() == 1)
            await panel.locator('.swatches button[aria-label="#7c3aed"]').click()
            ok = await wait_for(lambda: '"accent":"#7c3aed"' in slide().replace('&quot;', '"'))
            check('panel: a tweak is written to the embed’s data-props', ok, slide()[:400])
            await pg.wait_for_timeout(800)
            await pg.screenshot(path=OUT + 'import-board-slide.png')
            await panel.locator('button', has_text='还原').click()
            ok = await wait_for(lambda: 'data-props' not in slide().split('</x-embed>')[0])
            check('panel: 还原 drops what the embed set', ok)

            # --- update from the original: the canvas changes, the copy follows -----------------------
            glow = P('box-console', 'Glow.dc.html')
            text = open(glow).read()
            open(glow, 'w').write(text.replace('<title>Glow backdrop</title>', '<title>Glow backdrop v2</title>'))
            await pg.wait_for_timeout(500)
            await panel.locator('button', has_text='从原画板更新').click()
            check('panel: updating says so', await toast(pg, '已从画布更新'))
            check('…and the copy is the canvas’s artboard again', await wait_for(lambda: 'Glow backdrop v2' in read('tingly-intro', COPY)))

            # --- presenting: the moving artboard loops ---------------------------------------------------
            await pg.keyboard.press('Escape')
            # --- motion: onto the scene under the playhead, seeked with it -------------------------------
            await pg.goto(base + '/?p=design-motion')
            await pg.wait_for_timeout(2000)
            await pg.locator('.mscene', has_text='kind-slides').click()
            await pg.wait_for_timeout(500)
            item = await pick_glow(pg)
            await item.click()
            check('motion: importing says so', await toast(pg, '导入到场景 kind-slides'))
            scene = lambda: read('design-motion', 'scenes', 'kind-slides.html')
            ok = await wait_for(lambda: f'src="{COPY}"' in scene())
            check('motion: the artboard goes onto the scene under the playhead', ok)
            embed = re.search(r'<x-embed[^>]*>', scene()).group(0)
            check('…seeked with the playhead (data-seek), full frame', 'data-seek' in embed and 'width:1920px;height:1080px' in embed, embed)
            check('motion: motion.json records where it came from', any(r['path'] == COPY for r in json.loads(read('design-motion', 'motion.json')).get('imports', [])))
            fr = await board_drawn(pg)
            check('motion: the stage draws it', fr is not None)
            if fr:
                # it is drawn from the time it is handed: two moments differ, the same moment gives the same frame
                pos = "() => document.querySelector('#dc-app div[style*=radial-gradient]').style.left"
                seek = "(t) => new Promise((r) => { const f = document.querySelector('x-embed[data-seek] > iframe'); f.contentWindow.postMessage({ dcMotion: 'seek', t, n: 7 }, '*'); setTimeout(r, 300); })"
                host = fr.parent_frame
                await host.evaluate(seek, 1000); a = await fr.evaluate(pos)
                await host.evaluate(seek, 3000); b2 = await fr.evaluate(pos)
                await host.evaluate(seek, 1000); c = await fr.evaluate(pos)
                check('…drawn from the moment it is handed', a != b2 and a == c, f'{a} {b2} {c}')
            await pg.wait_for_timeout(600)
            await pg.screenshot(path=OUT + 'import-board-motion.png')
            await pg.locator('.mplay').click()
            await pg.wait_for_timeout(1500)
            await pg.locator('.mplay').click()
            check('motion: the player draws it too', await board_drawn(pg, player=True) is not None)

            # --- canvas: look at a moving artboard at any moment ---------------------------------------
            await pg.goto(base + '/?p=box-console')
            await pg.wait_for_timeout(2500)
            await pg.locator('[data-board="Glow.dc.html"] .strip').first.click()
            await pg.locator('[role=tab]', has_text='微调').click()
            row = pg.locator('input[type=range][aria-label="时间"]')
            await expect(row).to_be_visible()
            check('canvas: a moving artboard has a time slider in Tweaks', await row.count() == 1)
            await row.fill('6000')
            await pg.wait_for_timeout(500)
            await pg.screenshot(path=OUT + 'import-board-canvas.png')
            check('…and the file keeps its still', 'Glow backdrop' in read('box-console', 'Glow.dc.html'))

            check('no page errors', not errs, errs)
            await b.close()
    finally:
        server.stdin.close()
        server.wait(timeout=10)
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)

asyncio.run(main())
