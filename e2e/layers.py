"""End-to-end checks for the layers tree: one tree in canvas, slides and motion, with hide and lock on every row. Run with `pnpm dev` up: python3 e2e/layers.py"""
import os, asyncio, subprocess, time, json
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')  # a Chromium to use instead of Playwright's own

def read(path): return open(os.path.join(REPO, 'projects', path), encoding='utf-8').read()
def restore():
    subprocess.run(['git', 'checkout', '--', 'projects'], cwd=REPO)
    subprocess.run(['git', 'clean', '-fdq', '--', 'projects'], cwd=REPO)

async def wait_for(pred, timeout=6.0):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if pred(): return True
        except Exception: pass
        await asyncio.sleep(0.1)
    return False

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

async def click_at(pg, iframe, frame, css):
    """Click the centre of an element inside a (scaled) sandbox frame."""
    r = await frame.locator(css).first.evaluate('e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height, innerWidth]; }')
    box = await pg.locator(iframe).first.bounding_box()
    k = box['width'] / r[4]
    await pg.mouse.click(box['x'] + (r[0] + r[2] / 2) * k, box['y'] + (r[1] + r[3] / 2) * k)

SEL = '.layers .lr[aria-selected="true"]'

async def element_switches(pg, kind, iframe, frame, css, file):
    """Pick an element on the stage, then hide / show / lock / unlock it from its tree row."""
    await click_at(pg, iframe, frame, css)
    await expect(pg.locator(SEL)).to_have_count(1)
    row = pg.locator(SEL)
    key = await row.get_attribute('data-key')
    check(f'{kind}: every element row has a hide and a lock switch', await row.locator('.sw').count() == 2)

    await row.locator('.sw[aria-label="Hide"]').click()
    ok = await wait_for(lambda: 'data-hide' in read(file))
    await expect(frame.locator(css).first).to_be_hidden()
    check(f'{kind}: hide writes data-hide and the element leaves the stage', ok)
    check(f'{kind}: the row says Show once hidden', await pg.locator(f'.layers .lr[data-key="{key}"] .sw[aria-label="Show"]').count() == 1)
    await pg.locator(f'.layers .lr[data-key="{key}"] .sw[aria-label="Show"]').click()
    ok = await wait_for(lambda: 'data-hide' not in read(file))
    await expect(frame.locator(css).first).to_be_visible()
    check(f'{kind}: show takes it back', ok)

    await pg.locator(f'.layers .lr[data-key="{key}"] .sw[aria-label="Lock"]').click()
    ok = await wait_for(lambda: 'data-lock' in read(file))
    check(f'{kind}: lock writes data-lock', ok)
    await pg.locator(f'.layers .lr[data-key="{key}"]').click()
    await expect(pg.locator('.locknote')).to_be_visible()
    check(f'{kind}: a locked element\'s properties are off', await pg.locator('fieldset.pset').evaluate('e => e.disabled'))
    before = read(file)
    await pg.keyboard.press('Delete')
    await pg.wait_for_timeout(300)
    check(f'{kind}: Delete leaves a locked element alone', read(file) == before)
    await pg.mouse.click(5, 5)
    await click_at(pg, iframe, frame, css)
    await pg.wait_for_timeout(300)
    now = await pg.locator(SEL).first.get_attribute('data-key') if await pg.locator(SEL).count() else None
    check(f'{kind}: a click on a locked element lands on what holds it', now != key, f'{now} == {key}')
    await pg.locator(f'.layers .lr[data-key="{key}"] .sw[aria-label="Unlock"]').click()
    ok = await wait_for(lambda: 'data-lock' not in read(file))
    check(f'{kind}: unlock takes it back', ok)

async def main():
    restore()
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and '409 (Conflict)' not in m.text and errs.append(m.text))

        # --- canvas ------------------------------------------------------------------
        await pg.goto(BASE + '/?p=tingly-box-console-canvas')
        await pg.wait_for_timeout(2500)
        main = pg.frame_locator('[data-board="Main.dc.html"] iframe')
        await element_switches(pg, 'canvas', '[data-board="Main.dc.html"] iframe', main, 'h1', 'tingly-box-console-canvas/Main.dc.html')
        board = pg.locator('.layers .lr[data-key="Main.dc.html"]')
        await board.hover()
        await board.locator('.sw[aria-label="Hide"]').click()
        ok = await wait_for(lambda: json.loads(read('tingly-box-console-canvas/canvas.json'))['boards']['Main.dc.html'].get('hidden') is True)
        await expect(pg.locator('[data-board="Main.dc.html"]')).to_have_count(0)
        check('canvas: an artboard row hides the artboard (hidden in canvas.json)', ok)
        await board.hover()
        await board.locator('.sw[aria-label="Show"]').click()
        await expect(pg.locator('[data-board="Main.dc.html"]')).to_have_count(1)
        await board.hover()
        await board.locator('.sw[aria-label="Lock"]').click()
        ok = await wait_for(lambda: json.loads(read('tingly-box-console-canvas/canvas.json'))['boards']['Main.dc.html'].get('locked') is True)
        check('canvas: an artboard row locks the artboard (locked in canvas.json)', ok)
        await pg.wait_for_timeout(300)
        x0 = (await pg.locator('[data-board="Main.dc.html"]').bounding_box())['x']
        strip = pg.locator('[data-board="Main.dc.html"] .strip .t')
        sb = await strip.bounding_box()
        await pg.mouse.move(sb['x'] + 10, sb['y'] + 8)
        await pg.mouse.down()
        await pg.mouse.move(sb['x'] + 120, sb['y'] + 60, steps=6)
        await pg.mouse.up()
        await pg.wait_for_timeout(400)
        check('canvas: a locked artboard stays put when dragged', (await pg.locator('[data-board="Main.dc.html"]').bounding_box())['x'] == x0)

        # a lock holds in the panel and on the keyboard too
        await pg.locator('.layers .lr[data-key="Main.dc.html"]').click()
        await expect(pg.locator('.locknote')).to_be_visible()
        check('canvas: a locked artboard says so in the panel and its fields are off', await pg.locator('fieldset.pset').evaluate('e => e.disabled'))
        await pg.keyboard.press('Delete')
        await pg.wait_for_timeout(300)
        check('canvas: Delete leaves a locked artboard alone', 'Main.dc.html' in json.loads(read('tingly-box-console-canvas/canvas.json'))['boards'])
        await pg.locator('.locknote button').click()
        ok = await wait_for(lambda: json.loads(read('tingly-box-console-canvas/canvas.json'))['boards']['Main.dc.html'].get('locked') is None)
        await expect(pg.locator('.locknote')).to_have_count(0)
        check('canvas: the notice\'s Unlock takes the lock off and frees the fields', ok and not await pg.locator('fieldset.pset').evaluate('e => e.disabled'))

        # several layers at once, and Alt on an eye
        file = 'tingly-box-console-canvas/Main.dc.html'
        rows = pg.locator('.layers .lr[data-key^="Main.dc.html#"]')
        if not await rows.count(): await pg.locator('.layers .lr[data-key="Main.dc.html"] .tw').click()
        await rows.nth(0).click()
        await rows.nth(1).click(modifiers=['Control'])
        await expect(pg.locator('.marks')).to_contain_text('2 layers')
        before = read(file).count('data-lock')
        await pg.locator('.marks button', has_text='Lock').click()
        ok = await wait_for(lambda: read(file).count('data-lock') == before + 2)
        check('canvas: lock on a ticked pair locks both in one go', ok)
        await pg.locator('.marks button', has_text='Unlock').click()
        ok = await wait_for(lambda: read(file).count('data-lock') == before)
        check('canvas: and unlocks both again', ok)
        await rows.nth(0).click()
        await expect(pg.locator('.marks')).to_have_count(0)
        check('canvas: a plain click drops the ticks', await pg.locator('.layers .lr.marked').count() == 0)
        top = pg.locator('.layers .lr[data-key^="Main.dc.html#"]').first
        await top.hover()
        await top.locator('.sw[aria-label="Hide"]').click(modifiers=['Alt'])
        ok = await wait_for(lambda: read(file).count('data-hide') >= 1)
        check('canvas: Alt-click on an eye hides its siblings and keeps that one', ok and await top.locator('.sw[aria-label="Hide"]').count() == 1)
        restore()

        # --- slides ------------------------------------------------------------------
        await pg.goto(BASE + '/?p=tingly-design-intro-slides&s=box')
        stage = pg.frame_locator('.sframe.f-stage iframe')
        await stage.locator('section#box').wait_for()
        await pg.wait_for_timeout(400)
        await element_switches(pg, 'slides', '.sframe.f-stage iframe', stage, 'h2', 'tingly-design-intro-slides/slides/box.html')
        check('slides: the slide itself has no hide or lock row (skipping is its own switch)', await pg.locator('.layers .lr').first.locator('.sw').count() == 0)
        restore()

        # --- motion ------------------------------------------------------------------
        await pg.goto(BASE + '/?p=design-motion')
        await pg.wait_for_timeout(2000)
        await pg.locator('.mscene', has_text='kind-slides').click()
        await pg.wait_for_timeout(800)
        mframe = pg.frame_locator('.medit iframe')
        await mframe.locator('h2').first.wait_for()
        await element_switches(pg, 'motion', '.medit iframe', mframe, 'h2', 'design-motion/scenes/kind-slides.html')
        restore()

        await b.close()
    bad = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed' + (f'; errors: {errs[:3]}' if errs else ''))
    raise SystemExit(1 if bad or errs else 0)

asyncio.run(main())
