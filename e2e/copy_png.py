"""End-to-end checks for Copy as PNG: in the canvas context menu an element and a whole artboard land on the
clipboard as PNGs, every kind's Import / Export menu has the item and puts its picture there too, and a browser
without an image clipboard gets the download instead.
Run with `pnpm dev` up: python3 e2e/copy_png.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, asyncio
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
KINDS = {'canvas': 'tingly-box-console-canvas', 'slides': 'tingly-design-intro-slides', 'design system': 'tingly-design-system', 'dashboard': 'tingly-box-usage-dashboard', 'docs': 'tingly-design-guide-doc', 'motion': 'design-motion'}

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
        await fallback(p)
    bad = [n for n, ok in results if not ok]
    print(f'{len(results) - len(bad)}/{len(results)} checks passed')
    raise SystemExit(1 if bad else 0)

asyncio.run(main())
