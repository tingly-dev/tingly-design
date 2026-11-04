"""End-to-end checks for Copy as PNG: in the canvas context menu an element and a whole artboard land on the
clipboard as PNGs, Save as PNG downloads the element's picture as a file, a picture element's original file
is copied and saved in its own bytes, every kind's Import / Export menu has the item and puts its picture
there too, and a browser without an image clipboard gets the download instead.
Run with `pnpm dev` up: python3 e2e/copy_png.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, asyncio, json, shutil
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
CHROME = os.environ.get('DC_CHROME')
SHOTS = os.environ.get('DC_SHOTS')  # a folder to keep menu screenshots in

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

CLIP = '''async () => { const [it] = await navigator.clipboard.read(); if (!it.types.includes('image/png')) return null;
  const bm = await createImageBitmap(await it.getType('image/png')); return [bm.width, bm.height]; }'''

async def run(p, locale, theme):
    zh = locale.startswith('zh')
    label, done = ('复制为 PNG', '已复制为 PNG') if zh else ('Copy as PNG', 'Copied as PNG')
    b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
    ctx = await b.new_context(locale=locale, viewport={'width': 1440, 'height': 900}, accept_downloads=True, permissions=['clipboard-read', 'clipboard-write'])
    pg = await ctx.new_page()
    await pg.goto(f'{BASE}/?p=tingly-box-console-canvas&theme={theme}')
    await pg.wait_for_timeout(2500)
    main = pg.frame_locator('[data-board="Main.dc.html"] iframe')
    tag = f'{locale}-{theme}'
    await pg.locator('[data-board="Main.dc.html"] .strip').click()
    await pg.keyboard.press('Shift+2')
    await pg.wait_for_timeout(800)

    await main.locator('h1').click()
    await main.locator('h1').click(button='right')
    await expect(pg.locator('.menu .mi', has_text=label)).to_be_visible()
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        await pg.screenshot(path=f'{SHOTS}/menu-element-{tag}.png')
    await pg.locator('.menu .mi', has_text=label).click()
    await expect(pg.locator('.toast', has_text=done)).to_be_visible(timeout=20000)
    el = await pg.evaluate(CLIP)
    check(f'{tag}: an element lands on the clipboard as a PNG', el and el[0] > 10 and el[1] > 10, el)

    # the same picture as a file: Save as PNG, right under Copy as PNG in the same menu
    save = '保存为 PNG' if zh else 'Save as PNG'
    await main.locator('h1').click(button='right')
    async with pg.expect_download(timeout=30000) as dl:
        await pg.locator('.menu .mi', has_text=save).click()
    d = await dl.value
    check(f'{tag}: Save as PNG downloads the element as a PNG file', d.suggested_filename.endswith('@2x.png'), d.suggested_filename)

    await pg.keyboard.press('Escape')
    await pg.wait_for_timeout(300)
    root = main.locator('[data-dc-tid]').first  # the artboard's own root: its picture is the whole artboard
    await root.click(position={'x': 4, 'y': 4})
    await root.click(position={'x': 4, 'y': 4}, button='right')
    await expect(pg.locator('.menu .mi', has_text=label)).to_be_visible()
    if SHOTS:
        await pg.screenshot(path=f'{SHOTS}/menu-board-{tag}.png')
    await pg.locator('.menu .mi', has_text=label).click()
    await expect(pg.locator('.toast', has_text=done).last).to_be_visible(timeout=20000)
    bd = el
    for _ in range(40):  # the first toast may still be up: wait for the clipboard itself to change
        bd = await pg.evaluate(CLIP)
        if bd != el: break
        await pg.wait_for_timeout(250)
    check(f'{tag}: the whole artboard is bigger than the element', el and bd and bd[0] > el[0] and bd[1] > el[1], (el, bd))
    await b.close()

# kind → project: each one's Import / Export menu copies what its PNG item saves
KINDS = {'canvas': 'tingly-box-console-canvas', 'slides': 'tingly-design-intro-slides', 'design system': 'tingly-design-system', 'dashboard': 'tingly-box-usage-dashboard', 'docs': 'tingly-design-guide-doc', 'motion': 'tingly-design-motion'}

async def menus(p):
    b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
    ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
    pg = await ctx.new_page()
    for kind, project in KINDS.items():
        await pg.goto(f'{BASE}/?p={project}')
        await pg.wait_for_timeout(3500)
        if kind == 'canvas':
            await pg.mouse.click(400, 300)  # an artboard element, so the selected-artboard items show
        await pg.locator('button[aria-label="Import / Export"]').first.click()
        await pg.get_by_role('menuitem', name='Copy as PNG').click()
        await expect(pg.locator('.toast', has_text='Copied as PNG')).to_be_visible(timeout=30000)
        size = await pg.evaluate(CLIP)
        check(f'{kind}: the Import / Export menu copies its picture as a PNG', size and size[0] > 50 and size[1] > 50, size)
    await b.close()

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOARD = os.path.join(REPO, 'projects/zz-export-board')
# the same 1x1 PNG `export_image.py` puts in its board, byte for byte: what the original-image items must give back
PNG1 = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f645400000000049454e44ae426082')

async def original(p):
    """A selected <img> hands back the file it points at: the same bytes on the clipboard and on disk."""
    shutil.rmtree(BOARD, ignore_errors=True)
    os.makedirs(BOARD + '/uploads')
    open(BOARD + '/uploads/pic.png', 'wb').write(PNG1)
    open(BOARD + '/canvas.json', 'w').write(json.dumps({'v': 3, 'title': 'zz', 'launch': {'view': 'canvas'}, 'pages': [], 'boards': {'Main.dc.html': {'x': 0, 'y': 0, 'w': 400, 'h': 300, 'title': 'Main'}}}))
    open(BOARD + '/Main.dc.html', 'w').write('<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script></head><body><x-dc><div style="width:400px;height:300px;background:#fff"><img src="uploads/pic.png" width="100"></div></x-dc></body></html>')
    b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
    ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 900}, accept_downloads=True, permissions=['clipboard-read', 'clipboard-write'])
    pg = await ctx.new_page()
    await pg.goto(BASE + '/?p=zz-export-board')
    await pg.wait_for_selector('iframe', timeout=20000)
    await pg.wait_for_timeout(2000)
    img = pg.frame_locator('[data-board="Main.dc.html"] iframe').locator('img')
    await img.click()
    await img.click(button='right')
    await expect(pg.locator('.menu .mi', has_text='Copy original image')).to_be_visible()
    hexes = '''async () => { const [it] = await navigator.clipboard.read(); if (!it.types.includes('image/png')) return null;
      const buf = await (await it.getType('image/png')).arrayBuffer(); return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join(''); }'''
    await pg.locator('.menu .mi', has_text='Copy original image').click()
    for _ in range(40):  # the clipboard may still hold the previous picture
        got = await pg.evaluate(hexes)
        if got == PNG1.hex(): break
        await pg.wait_for_timeout(250)
    check('an img element: the clipboard holds the original file, byte for byte', got == PNG1.hex(), (len(got or ''), len(PNG1.hex())))

    await img.click(button='right')
    async with pg.expect_download(timeout=30000) as dl:
        await pg.locator('.menu .mi', has_text='Save original image').click()
    d = await dl.value
    path = OUT + 'original-' + d.suggested_filename
    await d.save_as(path)
    check('an img element: Save original image downloads the file under its own name and bytes',
          d.suggested_filename == 'pic.png' and open(path, 'rb').read() == PNG1, d.suggested_filename)
    await b.close()

async def fallback(p):
    b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
    ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    await ctx.add_init_script('delete window.ClipboardItem')
    pg = await ctx.new_page()
    await pg.goto(f'{BASE}/?p=tingly-box-console-canvas')
    await pg.wait_for_timeout(2500)
    await pg.locator('[data-board="Main.dc.html"] .strip').click()
    await pg.keyboard.press('Shift+2')
    await pg.wait_for_timeout(800)
    h1 = pg.frame_locator('[data-board="Main.dc.html"] iframe').locator('h1')
    await h1.click()
    await h1.click(button='right')
    async with pg.expect_download(timeout=30000) as dl:
        await pg.locator('.menu .mi', has_text='Copy as PNG').click()
    d = await dl.value
    check('no image clipboard: the PNG is downloaded instead', d.suggested_filename.endswith('.png'), d.suggested_filename)
    await expect(pg.locator('.toast', has_text='downloaded')).to_be_visible()
    await b.close()

async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        for locale, theme in [('en-US', 'light'), ('zh-CN', 'light'), ('en-US', 'dark'), ('zh-CN', 'dark')]:
            await run(p, locale, theme)
        await menus(p)
        await original(p)
        await fallback(p)
    bad = [n for n, ok in results if not ok]
    print(f'{len(results) - len(bad)}/{len(results)} checks passed')
    raise SystemExit(1 if bad else 0)

asyncio.run(main())
