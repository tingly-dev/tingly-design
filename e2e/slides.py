"""End-to-end checks for the slide editor. Run with `pnpm dev` up: python3 e2e/slides.py"""
import os, re, asyncio, subprocess, time, json
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECK = os.path.join(REPO, 'projects/tingly-intro')
CHROME = os.environ.get('DC_CHROME')  # e.g. /opt/pw-browsers/chromium-1194/chrome-linux/chrome

def src(name): return open(os.path.join(DECK, name), encoding='utf-8').read()
def deck(): return json.loads(src('deck.json'))
def diff(path):
    return subprocess.run(['git', 'diff', '--unified=0', '--', path], cwd=REPO, capture_output=True, text=True).stdout
def changed_lines(path):
    return [l for l in diff(path).splitlines() if l.startswith(('+', '-')) and not l.startswith(('+++', '---'))]
def restore():
    subprocess.run(['git', 'checkout', '--', 'projects/tingly-intro'], cwd=REPO)
    subprocess.run(['git', 'clean', '-fdq', '--', 'projects/tingly-intro'], cwd=REPO)

async def wait_for(pred, timeout=6.0):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if pred(): return True
        except Exception: pass
        await asyncio.sleep(0.1)
    return False

async def wait_for_async(count, timeout=6.0):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if await count(): return True
        except Exception: pass
        await asyncio.sleep(0.1)
    return False

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

STAGE = '.sframe.f-stage'

async def point(pg, css, n=0):
    """Centre of an element inside the stage slide, in page coordinates.
    (Playwright's own clicks ignore the CSS scale on the slide frame.)"""
    fr = pg.frame_locator(f'{STAGE} iframe')
    r = await fr.locator(css).nth(n).evaluate('e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }')
    box = await pg.locator(STAGE).bounding_box()
    k = box['width'] / 1920
    return box['x'] + (r[0] + r[2] / 2) * k, box['y'] + (r[1] + r[3] / 2) * k

async def click_in(pg, css, n=0, count=1):
    x, y = await point(pg, css, n)
    await pg.mouse.click(x, y, click_count=count)

async def stage_ready(pg, slide_id):
    await expect(pg.locator(f'{STAGE} iframe')).to_have_count(1)
    await pg.frame_locator(f'{STAGE} iframe').locator(f'section#{slide_id}').wait_for()
    await pg.wait_for_timeout(300)

async def main():
    os.makedirs(OUT, exist_ok=True)
    restore()
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='zh-CN', viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and '409 (Conflict)' not in m.text and errs.append(m.text))
        await pg.goto(BASE + '/?p=tingly-intro&s=box')
        await stage_ready(pg, 'box')

        # --- the deck -------------------------------------------------------------
        check('strip lists every slide', await pg.locator('.thumb').count() == 8)
        check('strip shows the sections', await pg.locator('.shead .d').count() == 4)
        check('the stage shows the slide in the URL', await pg.locator('.thumb.on').get_attribute('data-slide') == 'box')
        check('embeds run on the stage', await pg.frame_locator(f'{STAGE} iframe').locator('x-embed iframe').count() == 1)
        check('thumbnails keep embeds still', await pg.frame_locator('.thumb[data-slide="box"] iframe').locator('x-embed iframe').count() == 0)
        # a frame that loads again (reloaded or moved in the DOM) is drawn again, not left blank
        await pg.locator('.thumb[data-slide="team"] iframe').evaluate("f => { const d = f.srcdoc; f.srcdoc = ''; f.srcdoc = d; }")
        check('a reloaded thumbnail is drawn again', await wait_for_async(lambda: pg.frame_locator('.thumb[data-slide="team"] iframe').locator('section').count()))
        await pg.screenshot(path=OUT + 's1-deck.png')

        # --- selection and text ------------------------------------------------------
        await click_in(pg, 'h2')
        await expect(pg.locator('.lr[aria-selected="true"]')).to_contain_text('Any agent')
        await expect(pg.locator('.prompt .target')).to_contain_text('<h2>')
        await click_in(pg, 'h2', count=2)
        await pg.wait_for_timeout(200)
        await pg.keyboard.press('Control+a')
        await pg.keyboard.type('One endpoint for every agent')
        await pg.keyboard.press('Enter')
        ok = await wait_for(lambda: 'One endpoint for every agent</h2>' in src('slides/box.html'))
        lines = changed_lines('projects/tingly-intro/slides/box.html')
        check('double-click retypes text, minimal write-back', ok and len(lines) == 2, '\n'.join(lines))
        await pg.wait_for_timeout(400)

        # --- panel: a style edit -------------------------------------------------------
        await click_in(pg, 'h2')
        await pg.keyboard.press('Delete')
        ok = await wait_for(lambda: 'One endpoint for every agent' not in src('slides/box.html'))
        check('Delete removes the selected element', ok)
        await pg.keyboard.press('Control+z')
        ok = await wait_for(lambda: 'One endpoint for every agent</h2>' in src('slides/box.html'))
        check('undo brings it back', ok)

        # --- dragging a pinned element ------------------------------------------------
        restore()
        await pg.reload()
        await stage_ready(pg, 'box')
        x, y = await point(pg, 'p', 4)  # the pinned footer
        await pg.mouse.click(x, y)
        await pg.mouse.move(x, y)
        await pg.mouse.down()
        await pg.mouse.move(x + 40, y - 30, steps=6)
        await pg.mouse.up()
        ok = await wait_for(lambda: 'bottom:64px' in src('slides/box.html') and 'top:' in src('slides/box.html').split('Meet Tingly · 02')[0].split('<p ')[-1])
        footer = src('slides/box.html').split('Meet Tingly · 02')[0].split('<p ')[-1]
        check('dragging a pinned element moves it by its offsets', ok and 'margin' not in footer, footer)

        # --- notes -----------------------------------------------------------------
        notes = pg.locator('.snotes')
        await notes.fill('新的备注')
        await click_in(pg, 'h2')
        ok = await wait_for(lambda: '<aside>新的备注</aside>' in src('slides/box.html'))
        check('speaker notes write the <aside>', ok)

        # --- paging ---------------------------------------------------------------
        await pg.keyboard.press('Escape')
        await pg.keyboard.press('Escape')
        await pg.keyboard.press('PageDown')
        await expect(pg.locator('.thumb.on')).to_have_attribute('data-slide', 'team')
        await pg.keyboard.press('PageUp')
        await expect(pg.locator('.thumb.on')).to_have_attribute('data-slide', 'box')

        # --- adding, duplicating, reordering and removing slides -----------------------
        await pg.locator('.addslide').click()
        ok = await wait_for(lambda: 'slide-9' in deck()['order'] and os.path.exists(os.path.join(DECK, 'slides/slide-9.html')))
        check('new slide: file written and placed after the current one', ok and deck()['order'].index('slide-9') == deck()['order'].index('box') + 1)
        new_src = src('slides/slide-9.html')
        check('new slide copies its neighbour\'s look', 'background:#F7F7F4' in new_src, new_src[:200])
        await stage_ready(pg, 'slide-9')
        await pg.locator('.bar.left [aria-label="插入文字"]').click()
        ok = await wait_for(lambda: '新的文字' in src('slides/slide-9.html'))
        check('text tool inserts a pinned text box', ok and 'position:absolute' in src('slides/slide-9.html'))
        await pg.locator('.thumb[data-slide="slide-9"]').drag_to(pg.locator('.thumb[data-slide="cover"]'))
        ok = await wait_for(lambda: deck()['order'][0] == 'slide-9')
        check('dragging a thumbnail reorders the deck', ok, str(deck()['order']))
        await pg.locator('.thumb[data-slide="slide-9"]').click(button='right')
        await pg.get_by_role('menuitem', name='删除这一页').click()
        ok = await wait_for(lambda: 'slide-9' not in deck()['order'] and not os.path.exists(os.path.join(DECK, 'slides/slide-9.html')))
        check('deleting a slide removes its file and its place', ok)
        check('sections survive add/move/delete', len(deck()['sections']) == 4 and deck()['sections']['s1']['start'] == 'cover', json.dumps(deck()['sections']))

        # --- the subset check shows edits made outside -----------------------------------
        with open(os.path.join(DECK, 'slides/powerups.html'), 'r+', encoding='utf-8') as f:
            s = f.read().replace('<h2 style="', '<h2 style="margin:12px;', 1)
            f.seek(0); f.write(s); f.truncate()
        await pg.locator('.thumb[data-slide="powerups"]').click()
        await expect(pg.locator('.issues.err')).to_contain_text('1 处')
        await expect(pg.locator('.thumb[data-slide="powerups"] .tag.err')).to_have_text('1')
        subprocess.run(['git', 'checkout', '--', 'projects/tingly-intro/slides/powerups.html'], cwd=REPO)
        await expect(pg.locator('.issues')).to_have_count(0)

        # --- jQuery runs on a slide too, from the Code tab ---------------------------------
        await pg.keyboard.press('Escape')
        await pg.locator('.panel [role="tab"]', has_text='代码').click()
        await expect(pg.locator('.panel textarea[aria-label="幻灯片源文件"]')).to_have_value(re.compile('<h2'))
        await pg.locator('.jqbox textarea').fill("$('h2').css('color', '#ff5c8a')")
        await pg.locator('.jqbox button', has_text='执行').click()
        ok = await wait_for(lambda: '#ff5c8a' in src('slides/powerups.html'))
        check('jQuery statements edit the slide', ok)
        await pg.locator('.panel [role="tab"]', has_text='属性').click()

        # --- presenting -----------------------------------------------------------------
        await pg.locator('.thumb[data-slide="box"]').click()
        await pg.keyboard.press('F5')
        await expect(pg.locator('.present')).to_be_visible()
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=OUT + 's2-present.png')
        first = await pg.locator('.pbar span').text_content()
        await pg.keyboard.press('ArrowRight')
        await pg.wait_for_timeout(300)
        await pg.keyboard.press('ArrowRight')
        await pg.wait_for_timeout(900)
        second = await pg.locator('.pbar span').text_content()
        check('present starts at the cover and pages through builds and slides', first.startswith('1 /') and second.startswith('2 /'), f'{first} → {second}')
        await pg.keyboard.press('Escape')
        await expect(pg.locator('.present')).to_have_count(0)

        # --- export -------------------------------------------------------------------
        await pg.locator('.bar.right [aria-label="导入 / 导出"]').click()
        async with pg.expect_download() as dl:
            await pg.get_by_role('menuitem', name='HTML 网页').click()
        path = await (await dl.value).path()
        html = open(path, encoding='utf-8').read()
        check('HTML export holds every slide, embeds sandboxed, images inline',
              html.count('class="dc-slide-host"') == 8 and 'sandbox="allow-scripts"' in html and 'z-index' in html)

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    restore()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
