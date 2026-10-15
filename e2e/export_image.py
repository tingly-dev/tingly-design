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

        # docs: this tab
        await pg.goto(BASE + '/?p=design-guide')
        await pg.wait_for_selector('.app', timeout=20000)
        await pg.locator('button[aria-label="Import / Export"]').click()
        await save(pg, 'img-docs.png', lambda: pg.get_by_role('menuitem', name='PNG image').click(), 700, 300)

        # slides: this slide, then every slide
        await pg.goto(BASE + '/?p=tingly-intro')
        await pg.wait_for_selector('.thumb', timeout=20000)
        await pg.wait_for_timeout(1500)
        await pg.locator('button[aria-label="Import / Export"]').click()
        await save(pg, 'img-slide.png', lambda: pg.get_by_role('menuitem', name='PNG image This slide').click(), 1920, 1080)
        await pg.locator('button[aria-label="Import / Export"]').click()
        n = await pg.locator('.thumb:not(.skipped)').count()
        got = []
        pg.on('download', lambda d: got.append(d.suggested_filename))
        await pg.get_by_role('menuitem', name='PNG images').click()
        await pg.wait_for_timeout(15000)
        check(f'every slide: {n} files', len(got) >= n, got)

        # dashboard
        await pg.goto(BASE + '/?p=box-usage')
        await pg.wait_for_selector('.dashframe', timeout=20000)
        await pg.wait_for_timeout(2500)
        await pg.locator('button[aria-label="Import / Export"]').click()
        await save(pg, 'img-dash.png', lambda: pg.get_by_role('menuitem', name='PNG image').click(), 600, 300)

        # design system
        await pg.goto(BASE + '/?p=tingly-ds')
        await pg.wait_for_selector('.dsview', timeout=20000)
        await pg.wait_for_timeout(1000)
        await pg.locator('.dsnav button[aria-label="Import / Export"]').click()
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
