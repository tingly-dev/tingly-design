"""End-to-end checks for decks (Slides). Run with `pnpm dev` up: python3 e2e/slides.py

Works on projects/slides-demo (or $DC_PROJECTS/slides-demo when the server
runs on another folder); the deck is snapshotted first and put back after.
"""
import os, asyncio, re, time, json, shutil, tempfile, base64
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECK = os.path.join(os.environ.get('DC_PROJECTS', os.path.join(REPO, 'projects')), 'slides-demo')
SNAP = os.path.join(tempfile.mkdtemp(), 'slides-demo')

def src(name): return open(os.path.join(DECK, name), encoding='utf-8').read()
def slide(i): return src(f'slides/{i}.html')
def deck(): return json.loads(src('deck.json'))
def exists(name): return os.path.exists(os.path.join(DECK, name))
def restore():
    shutil.rmtree(DECK, ignore_errors=True)
    shutil.copytree(SNAP, DECK)

async def wait_for(pred, timeout=5.0):
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

# a 2×2 PNG
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==')

async def at(pg, loc, frame='.slide-stage iframe'):
    """Screen point of an element inside a scaled slide frame (Playwright's own
    clicks ignore the CSS scale on the iframe itself)."""
    x, y = await loc.evaluate('e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }')
    box = await pg.locator(frame).bounding_box()
    k = box['width'] / 1920
    return box['x'] + x * k, box['y'] + y * k

async def click(pg, loc, **kw):
    x, y = await at(pg, loc)
    await pg.mouse.click(x, y, **kw)

async def main():
    os.makedirs(OUT, exist_ok=True)
    shutil.copytree(DECK, SNAP)
    try:
        await run()
    finally:
        restore()
    print(f"{sum(ok for _, ok in results)}/{len(results)} passed")

async def run():
    async with async_playwright() as p:
        exe = os.environ.get('CHROME')
        b = await p.chromium.launch(executable_path=exe) if exe else await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'favicon' not in m.text and '409 (Conflict)' not in m.text and 'fonts.g' not in m.text and errs.append(m.text))
        await pg.goto(BASE + '/?p=slides-demo')
        await pg.wait_for_timeout(2500)
        stage = pg.frame_locator('.slide-stage iframe')

        # --- the deck opens ---------------------------------------------------
        n = await pg.locator('.rail .thumb').count()
        heads = await pg.locator('.rail .sec-head input').count()
        check('deck opens with a thumbnail per slide and its sections', n == 6 and heads == 3, f'{n} thumbs, {heads} sections')
        await expect(stage.locator('h1')).to_contain_text('幻灯片')
        check('cover slide on stage', True)

        # --- select, panel, retype --------------------------------------------
        await click(pg, stage.locator('h1'))
        await expect(pg.locator('.lr[aria-selected="true"]')).to_have_text(re.compile('文字.*幻灯片，也是文件'))
        check('click on the stage selects and the layer tree follows', True)
        before = slide('cover')
        await pg.locator('input[aria-label="文字颜色"]').fill('#e0703a')
        await pg.locator('input[aria-label="文字颜色"]').press('Enter')
        ok = await wait_for(lambda: 'width:900px;color:#e0703a">幻灯片，也是文件</h1>' in slide('cover'))
        changed = [l for l in slide('cover').split('\n') if l not in before.split('\n')]
        check('panel colour edit is a one-line patch of the slide file', ok and len(changed) == 1, str(changed))

        await click(pg, stage.locator('p', has_text='人、快速 AI'), click_count=2)
        await pg.keyboard.press('ControlOrMeta+a')
        await pg.keyboard.type('三方改的是同一份源码。')
        await pg.keyboard.press('Enter')
        ok = await wait_for(lambda: 'width:820px">三方改的是同一份源码。</p>' in slide('cover'))
        check('double-click retypes text in place', ok)

        # --- slide navigation and notes ----------------------------------------
        await pg.keyboard.press('Escape')
        await pg.keyboard.press('Escape')
        await pg.keyboard.press('ArrowDown')
        await expect(stage.locator('h2')).to_contain_text('一页一个想法')
        check('arrow keys page through slides', True)
        if not await pg.locator('.notes-pane').count():
            await pg.locator('button[aria-label="演讲者备注"]').click()
        await pg.locator('#slide-notes').fill('先停一下，让大家读。')
        await pg.locator('#slide-notes').blur()
        ok = await wait_for(lambda: '<aside>先停一下，让大家读。</aside>\n</section>' in slide('why'))
        check('speaker notes become the slide’s last <aside>', ok, slide('why')[-120:])

        # --- insert ---------------------------------------------------------------
        await pg.locator('button[aria-label="文本框"]').click()
        await pg.wait_for_timeout(600)
        await pg.keyboard.type('新的文本框')
        await pg.keyboard.press('Enter')
        ok = await wait_for(lambda: re.search(r'<p style="position:absolute;[^"]*">新的文本框</p>\n<aside>', slide('why')) is not None)
        check('text tool adds a pinned text box before the notes, ready to type', ok, slide('why')[-300:])
        await pg.locator('button[aria-label="形状"]').click()
        await pg.locator('.menu .mi', has_text='椭圆').click()
        ok = await wait_for(lambda: '<x-shape kind="ellipse"' in slide('why'))
        check('shape menu inserts an <x-shape>', ok)
        await pg.locator('button[aria-label="图标"]').click()
        await pg.locator('.menu .mi', has_text='Lightbulb').click()
        ok = await wait_for(lambda: '<x-icon name="Lightbulb"' in slide('why'))
        await expect(stage.locator('x-icon[name="Lightbulb"] svg')).to_be_visible()
        check('icon menu inserts a drawn <x-icon>', ok)
        async with pg.expect_file_chooser() as fc:
            await pg.locator('button[aria-label="图片"]').click()
        await (await fc.value).set_files({'name': 'dot.png', 'mimeType': 'image/png', 'buffer': PNG})
        ok = await wait_for(lambda: '<img src="assets/dot.png"' in slide('why') and exists('assets/dot.png'))
        loaded = False
        if ok:
            try:
                await expect(stage.locator('img[alt="dot"]')).to_be_visible(timeout=3000)
                loaded = await stage.locator('img[alt="dot"]').evaluate('i => i.complete && i.naturalWidth === 2')
            except Exception: pass
        check('image upload saves into assets/ and shows on the slide', ok and loaded)

        # --- slides: add, duplicate, reorder, skip, delete -------------------------
        await pg.locator('.rail .add-slide').click()
        ok = await wait_for(lambda: exists('slides/slide.html') and deck()['order'][-1] == 'slide')
        check('new slide: a file plus its id in order', ok, str(deck()['order']))
        await pg.locator('.rail .thumb[data-slide="parts"]').click(button='right')
        await pg.locator('.menu .mi', has_text='复制幻灯片').click()
        ok = await wait_for(lambda: exists('slides/parts-copy.html') and deck()['order'].index('parts-copy') == deck()['order'].index('parts') + 1)
        ok = ok and slide('parts-copy').startswith('<section id="parts-copy"')
        check('duplicate slide copies the file with a new section id', ok)
        await pg.locator('.rail .thumb[data-slide="why"]').drag_to(pg.locator('.rail .thumb[data-slide="cover"]'), target_position={'x': 60, 'y': 8})
        ok = await wait_for(lambda: deck()['order'][:2] == ['why', 'cover'])
        check('dragging a thumbnail reorders the deck', ok, str(deck()['order']))
        await pg.locator('.rail .thumb[data-slide="table"]').click()
        await pg.locator('label.check', has_text='演示时跳过').locator('input').check()
        ok = await wait_for(lambda: re.match(r'<section id="table"[^>]* hidden=""', slide('table')) is not None)
        check('skip writes hidden on the section', ok, slide('table')[:120])
        await pg.locator('.rail .thumb[data-slide="slide"]').click(button='right')
        await pg.locator('.menu .mi', has_text='删除幻灯片').click()
        ok = await wait_for(lambda: not exists('slides/slide.html') and 'slide' not in deck()['order'])
        check('delete removes the file and its id', ok)

        # --- canvas (grid) view ------------------------------------------------------
        await pg.locator('button[aria-label="总览视图"]').click()
        # why now sits before the first section: an untitled opening run plus the three sections
        runs = await pg.locator('.grid-run').count()
        inp = pg.locator('.grid-run input[aria-label="章节描述"]').first
        await inp.fill('开场：先说结论')
        await inp.press('Enter')
        ok = await wait_for(lambda: deck()['sections']['s1']['description'] == '开场：先说结论')
        check('grid view lists sections and edits their description', runs == 4 and ok, str(runs))
        await pg.screenshot(path=OUT + 'slides-grid.png')
        await pg.locator('button[aria-label="单页视图"]').click()

        # --- present -------------------------------------------------------------------
        await pg.locator('.rail .thumb[data-slide="flow"]').click()
        await pg.locator('button[aria-label="演示"]').click()
        await expect(pg.locator('.presenter')).to_be_visible()
        hud = pg.locator('.p-hud span').first
        start = await hud.inner_text()
        cur = pg.frame_locator('.p-layer.on iframe')
        boxes = cur.locator('[data-build-in]')
        await expect(boxes.first).to_be_hidden()
        await pg.wait_for_timeout(1200)
        await pg.keyboard.press('ArrowRight')
        await pg.keyboard.press('ArrowRight')
        await pg.keyboard.press('ArrowRight')
        await pg.wait_for_timeout(300)
        shown = await boxes.evaluate_all('els => els.filter(e => getComputedStyle(e).visibility !== "hidden").length')
        same = await hud.inner_text() == start
        check('present: builds come in one click at a time before the next slide', shown == 3 and same, f'{shown} shown, {start} → {await hud.inner_text()}')
        await pg.keyboard.press('ArrowRight')
        await pg.wait_for_timeout(800)
        after = await hud.inner_text()
        await expect(pg.frame_locator('.p-layer.on iframe').locator('h2')).to_contain_text('谢谢')
        # shown: why cover parts parts-copy flow end — the skipped table slide is left out
        check('present: next slide after the builds; skipped slides left out', start == '5 / 6' and after == '6 / 6', f'{start} → {after}')
        await pg.screenshot(path=OUT + 'slides-present.png')
        await pg.keyboard.press('Escape')
        await expect(pg.locator('.presenter')).to_have_count(0)
        check('Esc leaves the presentation', True)

        # --- outside edit -----------------------------------------------------------------
        await pg.locator('.rail .thumb[data-slide="cover"]').click()
        text = slide('cover').replace('三方改的是同一份源码。', '从终端改的')
        open(os.path.join(DECK, 'slides/cover.html'), 'w', encoding='utf-8').write(text)
        try:
            await expect(stage.locator('p', has_text='从终端改的')).to_be_visible(timeout=4000); ok = True
        except Exception: ok = False
        check('outside edit of a slide file shows up on stage', ok)

        await pg.screenshot(path=OUT + 'slides-final.png')
        check('no page errors', not errs, '; '.join(errs[:3]))
        await b.close()

asyncio.run(main())
