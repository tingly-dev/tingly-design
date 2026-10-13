"""End-to-end checks for importing into an open project: the 导入 button, a drop anywhere on the editor
or a paste, in every kind. A page or an SVG becomes artboards beside a canvas's own, pictures land on a
canvas or the open slide, Markdown becomes doc tabs, a CSV a dashboard dataset, fonts and pictures a
design system's own; pictures onto the motion scene under the playhead. Originals a person brings in are kept in uploads/.
Run after `pnpm build`: python3 e2e/import_here.py  (DC_CHROME=/path/to/chrome to use another Chromium)
Starts its own server (production mode, PORT=0) on a fresh copy of the sample projects."""
import os, sys, asyncio, json, shutil, subprocess, tempfile, threading, time
from playwright.async_api import async_playwright, expect

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out') + '/'
CHROME = os.environ.get('DC_CHROME')

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

# a page with a stylesheet and a picture beside it, as a folder
PAGE = '''<!doctype html><html><head><title>Spring launch</title><link rel="stylesheet" href="css/site.css"></head>
<body><header class="hero"><h1>Spring launch</h1><p>Everything new this season.</p><img src="img/dot.png" alt="dot"></header></body></html>'''
CSS = '.hero { padding: 48px; background: #f4efe6; font-family: Georgia, serif; } .hero h1 { color: #b4441c; font-size: 48px; margin: 0; } .hero img { width: 64px; height: 64px; }'
SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120"><rect width="240" height="120" fill="#2f6fed"/><text x="20" y="70" font-size="32" fill="#fff">Badge</text></svg>'
NOTES = '# Field notes\n\nWhat we saw on the visit.\n\n![the site](img/dot.png)\n'
CSV = 'region,signups\nNorth,120\nSouth,95\nEast,143\n'

MAKE_PNG = """async ([w, h, name]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#0e9f6e'; g.fillRect(0, 0, w, h);
  const b = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new File([b], name, { type: 'image/png' });
}"""

async def drop(pg, files, at=(700, 450)):
    """Drop files on the editor: [(name, text | None for a PNG, mime)]; the overlay shows while dragging."""
    await pg.evaluate("""async ([files, make, x, y]) => {
      const dt = new DataTransfer();
      for (const [name, text, mime] of files) dt.items.add(text === null ? await (eval(make))([320, 200, name]) : new File([text], name, { type: mime }));
      window.__dt = dt;
      const el = document.elementFromPoint(x, y) || document.body;
      el.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }""", [files, MAKE_PNG, at[0], at[1]])
    shown = await pg.locator('.importdrop').count() == 1
    await pg.evaluate("""([x, y]) => {
      const el = document.elementFromPoint(x, y) || document.body;
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: window.__dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }""", [at[0], at[1]])
    return shown

async def paste_text(pg, text):
    await pg.evaluate("""(t) => {
      const dt = new DataTransfer(); dt.setData('text/plain', t);
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }""", text)

async def toast(pg, text, timeout=15000):
    try:
        await expect(pg.locator('.toast', has_text=text).first).to_be_visible(timeout=timeout)
        return True
    except AssertionError:
        return False

async def main():
    if not os.path.exists(os.path.join(REPO, 'apps/editor/dist/index.html')):
        raise SystemExit('no editor build: run pnpm build first')
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='dc-import-here-')
    projects = os.path.join(tmp, 'projects')
    shutil.copytree(os.path.join(REPO, 'projects'), projects)
    folder = os.path.join(tmp, 'spring'); os.makedirs(os.path.join(folder, 'css')); os.makedirs(os.path.join(folder, 'img'))
    open(os.path.join(folder, 'index.html'), 'w').write(PAGE)
    open(os.path.join(folder, 'css', 'site.css'), 'w').write(CSS)
    notes = os.path.join(tmp, 'field-notes'); os.makedirs(os.path.join(notes, 'img'))
    open(os.path.join(notes, 'notes.md'), 'w').write(NOTES)
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
            pg = await b.new_page(locale='zh-CN', viewport={'width': 1440, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            # the folder's picture is made in the page, so the PNG is real
            png = await pg.evaluate("""async (make) => { const f = await (eval(make))([64, 64, 'dot.png']); return Array.from(new Uint8Array(await f.arrayBuffer())); }""", MAKE_PNG)
            for d in (folder, notes): open(os.path.join(d, 'img', 'dot.png'), 'wb').write(bytes(png))

            # --- canvas: a page folder becomes artboards beside what is there ------------------------
            await pg.goto(base + '/?p=box-console')
            await pg.wait_for_timeout(2500)
            before = json.loads(read('box-console', 'canvas.json'))
            right = max(bd['x'] + bd['w'] for bd in before['boards'].values())
            btn = pg.locator('.bar.left button[aria-label="导入到这个画布"]')
            check('canvas: an import button in the toolbar', await btn.count() == 1)
            await btn.click()
            check('…which says what a canvas takes', await pg.locator('.menu .mhint', has_text='网页和 SVG 变成新的画板').count() == 1)
            await pg.screenshot(path=OUT + 'import-here-menu.png')
            async with pg.expect_file_chooser() as fc:
                await pg.locator('.menu .mi', has_text='选择文件夹').click()
            await (await fc.value).set_files(folder)
            check('canvas: importing a folder says so', await toast(pg, '已导入 index.html'))
            ok = await wait_for(lambda: 'SpringLaunch.dc.html' in json.loads(read('box-console', 'canvas.json'))['boards'])
            after = json.loads(read('box-console', 'canvas.json'))
            check('canvas: the page became an artboard named after it', ok, list(after['boards']))
            nb = after['boards'].get('SpringLaunch.dc.html', {})
            check('…to the right of everything already there', nb.get('x', 0) > right and nb.get('imported', {}).get('from') == 'html', nb)
            check('…and nothing already there moved', all(after['boards'][f] == bd for f, bd in before['boards'].items()))
            kept = [os.path.relpath(os.path.join(r, f), P('box-console')) for r, _, fs in os.walk(P('box-console', 'uploads')) for f in fs]
            check('canvas: the folder is kept in uploads/ with its tree', any(k.endswith('/css/site.css') for k in kept) and any(k.endswith('/img/dot.png') for k in kept), kept)
            src = read('box-console', 'SpringLaunch.dc.html')
            check('…and the artboard points at the kept picture', '/img/dot.png' in src and 'uploads/' in src and '#b4441c' in src)
            await pg.wait_for_timeout(800)
            await pg.screenshot(path=OUT + 'import-here-canvas.png')

            # pasted SVG markup: one more artboard
            await paste_text(pg, SVG)
            ok = await wait_for(lambda: any(f.startswith('Imported') or f.startswith('Pasted') or 'Badge' in read('box-console', f) for f in json.loads(read('box-console', 'canvas.json'))['boards'] if f not in after['boards']))
            check('canvas: pasting SVG adds an artboard', ok)

            # the real ⌘V: the system clipboard's SVG reaches the import, not the in-app clipboard
            boards = set(json.loads(read('box-console', 'canvas.json'))['boards'])
            await pg.evaluate("(t) => navigator.clipboard.writeText(t)", SVG.replace('Badge', 'Stamp'))
            await pg.mouse.click(1300, 820)
            await pg.keyboard.press('ControlOrMeta+V')
            ok = await wait_for(lambda: any('Stamp' in read('box-console', f) for f in json.loads(read('box-console', 'canvas.json'))['boards'] if f not in boards))
            check('canvas: ⌘V with SVG on the clipboard adds an artboard', ok)

            # a file dragged over an artboard is not swallowed by its frame
            frame = await pg.evaluate("() => { const r = document.querySelector('iframe')?.getBoundingClientRect(); return r ? [r.x + r.width / 2, r.y + Math.min(r.height / 2, 200)] : null; }")
            if frame:
                await pg.evaluate("() => { const d = new DataTransfer(); d.items.add(new File(['x'], 'a.png', { type: 'image/png' })); window.__dt = d; document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: d, bubbles: true })); }")
                hit = await pg.evaluate("([x, y]) => document.elementFromPoint(x, y)?.tagName", frame)
                await pg.evaluate("() => document.body.dispatchEvent(new DragEvent('dragleave', { dataTransfer: window.__dt, bubbles: true }))")
                check('canvas: while dragging, artboard frames let the drop through', hit != 'IFRAME', hit)

            # a picture dropped on the canvas lands where it was dropped
            shown = await drop(pg, [('photo.png', None, 'image/png')], at=(600, 400))
            check('canvas: dragging files shows where they will go', shown)
            check('canvas: a dropped picture says so', await toast(pg, '已放上 photo.png'))
            ok = await wait_for(lambda: any(n.get('kind') == 'image' for n in json.loads(read('box-console', 'canvas.json'))['notes'].values()))
            img = next((n for n in json.loads(read('box-console', 'canvas.json'))['notes'].values() if n.get('kind') == 'image'), {})
            check('…as an image item kept in uploads/', ok and img.get('src', '').startswith('uploads/photo-'), img)
            loaded = await pg.wait_for_function("() => [...document.querySelectorAll('img')].some((i) => i.src.includes('/raw/uploads/photo-') && i.naturalWidth > 0)", timeout=8000)
            check('…and it shows on the canvas', bool(loaded))

            # ⌘C ⌘V of the picture still uses the in-app clipboard: nothing to import, so the item is copied
            count = lambda: sum(1 for n in json.loads(read('box-console', 'canvas.json'))['notes'].values() if n.get('kind') == 'image')
            n0 = count()
            await pg.keyboard.press('ControlOrMeta+C')
            await pg.wait_for_timeout(300)
            await pg.keyboard.press('ControlOrMeta+V')
            check('canvas: ⌘V with the in-app clipboard still pastes the item', await wait_for(lambda: count() == n0 + 1), count())

            # what a canvas does not take is refused, naming what it does
            await drop(pg, [('notes.md', NOTES, 'text/markdown')])
            check('canvas: Markdown is refused with what it takes', await toast(pg, '这里能导入的是'))

            # --- slides: a picture onto the open slide ---------------------------------------------
            await pg.goto(base + '/?p=tingly-intro')
            await pg.wait_for_timeout(2500)
            deck = json.loads(read('tingly-intro', 'deck.json'))
            first = deck['order'][0]
            await drop(pg, [('chart.png', None, 'image/png')])
            check('slides: a dropped picture says so', await toast(pg, '已放上 chart.png'))
            ok = await wait_for(lambda: 'src="uploads/chart-' in read('tingly-intro', 'slides', f'{first}.html'))
            check('slides: …onto the open slide, kept in uploads/', ok)

            # --- docs: a Markdown folder becomes a tab, its picture kept ------------------------------
            await pg.goto(base + '/?p=design-guide')
            await pg.wait_for_timeout(2500)
            tabs = len(json.loads(read('design-guide', 'doc.json'))['tabs'])
            await pg.locator('.dashbar button', has_text='导入').click()
            async with pg.expect_file_chooser() as fc:
                await pg.locator('.menu .mi', has_text='选择文件夹').click()
            await (await fc.value).set_files(notes)
            check('docs: importing Markdown says so', await toast(pg, '已把 notes.md 加成新的标签页'))
            doc = json.loads(read('design-guide', 'doc.json'))
            ok = await wait_for(lambda: len(json.loads(read('design-guide', 'doc.json'))['tabs']) == tabs + 1)
            doc = json.loads(read('design-guide', 'doc.json'))
            check('docs: …a new tab titled by its heading', ok and doc['tabs'][-1]['title'] == 'Field notes', doc['tabs'][-1])
            tab = read('design-guide', 'tabs', doc['tabs'][-1]['id'] + '.md') if ok else ''
            check('docs: …its picture kept in uploads/ and linked from the tab', '](../uploads/field-notes-' in tab and '/img/dot.png)' in tab, repr(tab))
            await expect(pg.locator('.docbody h1')).to_have_text('Field notes')
            loaded = await pg.wait_for_function("() => [...document.querySelectorAll('.docbody img')].some((i) => i.naturalWidth > 0)", timeout=8000)
            check('docs: …and it opens, picture showing', bool(loaded))
            await pg.screenshot(path=OUT + 'import-here-docs.png')

            # --- dashboard: a CSV becomes a dataset, opened in Sources ---------------------------------
            await pg.goto(base + '/?p=box-usage')
            await pg.wait_for_timeout(2500)
            await drop(pg, [('signups.csv', CSV, 'text/csv')])
            check('dashboard: a dropped CSV says so', await toast(pg, '加成数据集 signups'))
            ok = await wait_for(lambda: os.path.exists(P('box-usage', 'datasets', 'signups.json')))
            ds = json.loads(read('box-usage', 'datasets', 'signups.json')) if ok else {}
            check('dashboard: …a dataset reading data/signups.csv', ds.get('source') == {'kind': 'file', 'url': 'data/signups.csv', 'name': 'signups.csv', 'format': 'csv'}, ds)
            check('dashboard: …the file is in data/', os.path.exists(P('box-usage', 'data', 'signups.csv')))
            await pg.wait_for_timeout(1000)
            await pg.screenshot(path=OUT + 'import-here-dash.png')
            await drop(pg, [('broken.json', '{"just": "a value"}', 'application/json')])
            check('dashboard: JSON that is not a table is refused', await toast(pg, '读不出表格'))

            # --- design system: a font and a picture into its own files -------------------------------
            await pg.goto(base + '/?p=tingly-ds')
            await pg.wait_for_timeout(2500)
            await drop(pg, [('Brand-Bold.woff2', 'wOF2fake', 'font/woff2'), ('mark.svg', SVG, 'image/svg+xml')])
            check('design system: says what it added', await toast(pg, '已加入 1 个字体、1 个素材'))
            ok = await wait_for(lambda: 'fonts/Brand-Bold.woff2' in read('tingly-ds', 'tokens.json'))
            check('design system: the font is registered in tokens.json', ok)
            check('design system: the SVG is an asset in assets/Other', os.path.exists(P('tingly-ds', 'assets', 'Other', 'mark.svg')))

            # --- motion: a picture onto the scene under the playhead, entering there --------------------
            await pg.goto(base + '/?p=design-motion')
            await pg.wait_for_timeout(2500)
            check('motion: an import button in the top bar', await pg.locator('button[aria-label^="导入到这个"]').count() == 1)
            await pg.locator('.mscene', has_text='kind-slides').click()
            await pg.wait_for_timeout(500)
            await drop(pg, [('still.png', None, 'image/png')])
            check('motion: a dropped picture says so', await toast(pg, '已放上 still.png'))
            scene = lambda: read('design-motion', 'scenes', 'kind-slides.html')
            ok = await wait_for(lambda: 'src="uploads/still-' in scene())
            check('motion: …onto the scene under the playhead, kept in uploads/', ok)
            check('…entering at the playhead (the scene start)', 'data-in="fade 300ms @0s"' in scene(), scene()[-400:])
            stage = pg.frame_locator('.medit iframe')
            img = stage.locator('img[src*="uploads/still-"]')
            await expect(img).to_be_visible()
            check('…and it shows on the stage', await img.evaluate('i => i.complete && i.naturalWidth > 0'))
            await pg.locator('.mplay').click()
            await pg.wait_for_timeout(800)
            await pg.locator('.mplay').click()
            shown = False
            for fr in pg.frames:
                try:
                    if await fr.evaluate("() => [...document.querySelectorAll('.dc-motion-root img')].some((i) => i.src.includes('/uploads/still-') && i.naturalWidth > 0)"):
                        shown = True
                except Exception:
                    pass
            check('…and the player loads it too', shown)

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
