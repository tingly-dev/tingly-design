"""End-to-end checks for saving a project as a PNG image, in every kind: canvas (artboard menu),
slides (this slide, every slide), docs (this tab), dashboard, design system, motion (frame at the playhead).
Run with `pnpm dev` up: python3 e2e/export_image.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, struct, asyncio, json, shutil
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
CHROME = os.environ.get('DC_CHROME')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def png_size(path):
    d = open(path, 'rb').read(32)
    return (struct.unpack('>I', d[16:20])[0], struct.unpack('>I', d[20:24])[0]) if d[:8] == b'\x89PNG\r\n\x1a\n' else None

async def save(pg, name, click, minw=100, minh=100):
    async with pg.expect_download(timeout=60000) as dl:
        await click()
    d = await dl.value
    path = OUT + name
    await d.save_as(path)
    size = png_size(path)
    check(f'{name}: a PNG at least {minw}x{minh} ({d.suggested_filename}, {size})', size and size[0] >= minw and size[1] >= minh)
    return path

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIECE = os.path.join(REPO, 'projects/zz-export-image')
BOARD = os.path.join(REPO, 'projects/zz-export-board')
PNG1 = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f645400000000049454e44ae426082')

async def main():
    os.makedirs(OUT, exist_ok=True)
    shutil.rmtree(PIECE, ignore_errors=True)
    os.makedirs(PIECE + '/scenes')
    open(PIECE + '/motion.json', 'w').write(json.dumps({'v': 1, 'title': 'zz-export-image', 'formats': {'wide': {'size': [1280, 720]}}, 'fps': 30, 'order': ['title'], 'audio': [], 'faces': {}}))
    open(PIECE + '/scenes/title.html', 'w').write('<section id="title" data-duration="2s" style="background:#14161c;color:#f4f1ea;font-family:Arial,sans-serif;padding:96px"><h1 style="font-size:96px">Frame</h1><p style="font-size:36px;color:#a9a59c">Saved as an image</p></section>')
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))

        # canvas: an artboard with a PNG and an SVG from uploads/ (and one picture that is missing: the toast names it)
        shutil.rmtree(BOARD, ignore_errors=True)
        os.makedirs(BOARD + '/uploads')
        open(BOARD + '/uploads/pic.png', 'wb').write(PNG1)
        open(BOARD + '/uploads/logo.svg', 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="36" fill="#e05"/></svg>')
        open(BOARD + '/canvas.json', 'w').write(json.dumps({'v': 3, 'title': 'zz', 'launch': {'view': 'canvas'}, 'pages': [], 'boards': {'Main.dc.html': {'x': 0, 'y': 0, 'w': 400, 'h': 300, 'title': 'Main'}}}))
        page = lambda extra: '<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc><div style="width:400px;height:300px;background:#fff"><img src="uploads/pic.png" width="100"><img src="uploads/logo.svg" width="100">' + extra + '</div></x-dc></body></html>'
        open(BOARD + '/Main.dc.html', 'w').write(page(''))
        await pg.goto(BASE + '/?p=zz-export-board')
        await pg.wait_for_selector('iframe', timeout=20000)
        await pg.wait_for_timeout(2000)
        await pg.get_by_label('Export Main').click()
        await save(pg, 'img-canvas.png', lambda: pg.get_by_role('menuitem', name='PNG', exact=True).click(), 400, 300)
        open(BOARD + '/Main.dc.html', 'w').write(page('<img src="uploads/missing.png">'))
        await pg.wait_for_timeout(2000)
        await pg.get_by_label('Export Main').click()
        await pg.get_by_role('menuitem', name='PNG', exact=True).click()
        await expect(pg.get_by_text('missing.png').first).to_be_visible(timeout=10000)
        check('canvas: a missing picture is named in the error', True)
        shutil.rmtree(BOARD, ignore_errors=True)

        # docs: this tab
        await pg.goto(BASE + '/?p=tingly-design-guide-doc')
        await pg.wait_for_selector('.app', timeout=20000)
        await pg.locator('button[aria-label="Import / Export"]').click()
        await save(pg, 'img-docs.png', lambda: pg.get_by_role('menuitem', name='PNG image').click(), 700, 300)

        # slides: this slide, then every slide
        await pg.goto(BASE + '/?p=tingly-design-intro-slides')
        await pg.wait_for_selector('.thumb', timeout=20000)
        await pg.wait_for_timeout(1500)
        await pg.locator('button[aria-label="Import / Export"]').click()
        await save(pg, 'img-slide.png', lambda: pg.get_by_role('menuitem', name='PNG image', exact=True).click(), 1920, 1080)
        await pg.locator('button[aria-label="Import / Export"]').click()
        n = await pg.locator('.thumb:not(.skipped)').count()
        got = []
        pg.on('download', lambda d: got.append(d.suggested_filename))
        await pg.get_by_role('menuitem', name='PNG images').click()
        await pg.wait_for_timeout(15000)
        check(f'every slide: {n} files', len(got) >= n, got)

        # dashboard
        await pg.goto(BASE + '/?p=tingly-box-usage-dashboard')
        await pg.wait_for_selector('.dashframe', timeout=20000)
        await pg.wait_for_timeout(2500)
        await pg.locator('button[aria-label="Import / Export"]').click()
        await save(pg, 'img-dash.png', lambda: pg.get_by_role('menuitem', name='PNG image').click(), 600, 300)

        # design system
        await pg.goto(BASE + '/?p=tingly-design-system')
        await pg.wait_for_selector('.dsview', timeout=20000)
        await pg.wait_for_timeout(1000)
        await pg.locator('header.topbar button[aria-label="Import / Export"]').click()
        await save(pg, 'img-ds.png', lambda: pg.get_by_role('menuitem', name='PNG image').click(), 600, 300)

        # motion: frame at the playhead
        await pg.goto(BASE + '/?p=zz-export-image')
        btn = pg.locator('button[aria-label="Import / Export"]')
        await expect(btn).to_be_enabled(timeout=20000)
        await pg.wait_for_timeout(1500)
        await btn.click()
        await save(pg, 'img-motion.png', lambda: pg.get_by_role('menuitem', name='PNG image').click(), 1280, 720)

        shutil.rmtree(PIECE, ignore_errors=True)
        check('no page errors', not errs, errs)
        await b.close()
    bad = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    raise SystemExit(1 if bad else 0)

asyncio.run(main())
