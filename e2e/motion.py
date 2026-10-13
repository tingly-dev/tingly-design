"""End-to-end checks for motion pieces: the player, formats, the cover, editing on the stage
(selecting at a time, retyping, resizing, per-format overrides, sizes), a new piece.
Run with `pnpm dev` up: python3 e2e/motion.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, re, asyncio, subprocess
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')

SAMPLE = 'projects/design-motion'
def restore():
    subprocess.run(['rm', '-rf', os.path.join(REPO, 'projects/zz-motion')])
    subprocess.run(['git', 'checkout', '--', SAMPLE], cwd=REPO)
def read(rel): return open(os.path.join(REPO, SAMPLE, rel)).read()

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

async def main():
    os.makedirs(OUT, exist_ok=True)
    restore()
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(viewport={'width': 1440, 'height': 1000})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'fonts.g' not in m.text and errs.append(m.text))

        # --- the sample opens on its cover --------------------------------------------------------
        await pg.goto(BASE + '/?p=design-motion')
        await expect(pg.locator('.dashtitle')).to_have_text('Tingly Design')
        stage = pg.frame_locator('.medit iframe')
        await expect(stage.locator('section#poster')).to_be_visible()
        await expect(pg.locator('.mtime')).to_contain_text('/ 36.')
        check('the sample opens on its cover, 36 s long at its speed', await pg.locator('.mscene').count() == 12)
        await pg.screenshot(path=OUT + 'motion.png')

        # --- play, seek, scenes ----------------------------------------------------------------------
        await pg.locator('.mplay').click()
        await expect(pg.locator('.medit')).not_to_have_class('mlayer medit on')
        await pg.wait_for_timeout(1200)
        t = float((await pg.locator('.mtime').inner_text()).split('/')[0])
        check('play runs the clock', t > 0.5, str(t))
        await pg.locator('.mplay').click()
        await expect(pg.locator('.medit.on')).to_have_count(1)
        check('pausing puts the editable stage back', True)
        await pg.locator('.mplay').click()
        await pg.locator('.mcatch').click()
        await expect(pg.locator('.medit.on')).to_have_count(1)
        check('clicking the playing stage pauses back into editing', await pg.locator('.mplay[aria-label="播放"]').count() == 1)
        await pg.locator('.mscene', has_text='outro').click()
        await expect(pg.locator('.mscene.on')).to_have_text('outro')
        await expect(stage.locator('section#outro')).to_be_visible()
        check('a scene button jumps to that scene', True)

        # --- editing on the stage --------------------------------------------------------------------
        await pg.locator('.mscene', has_text='kind-slides').click()
        h2 = stage.locator('section#kind-slides h2')
        await expect(h2).to_be_visible()
        await expect(h2).not_to_have_attribute('data-dc-off', '')
        await expect(h2).to_have_attribute('data-dc-rest', '')
        await expect(pg.locator('.mwhere')).to_have_text('kind-slides · 0.0 s · 落定')
        check('a scene opens on its first moment, drawn landed like a page', True)
        await h2.click()
        await expect(pg.locator('.mfmt-where')).to_contain_text('所有尺寸')
        await expect(pg.locator('.prompt .target')).to_contain_text('Slides')
        check('a scene takes clicks like a slide', True)

        await h2.dblclick()
        await pg.keyboard.press('ControlOrMeta+a')
        await pg.keyboard.type('Decks')
        await pg.keyboard.press('Enter')
        await expect(h2).to_have_text('Decks')
        await pg.wait_for_timeout(600)
        check('double-click retypes text into the scene file', '>Decks</h2>' in read('scenes/kind-slides.html'))

        await h2.click()
        hb = await h2.bounding_box()
        x, y = hb['x'] + hb['width'], hb['y'] + hb['height'] / 2
        await pg.mouse.move(x, y)
        await pg.mouse.down()
        await pg.mouse.move(x - 40, y, steps=4)
        await pg.mouse.move(x - 80, y, steps=4)
        await pg.mouse.up()
        await pg.wait_for_timeout(600)
        src = read('scenes/kind-slides.html')
        h2src = src[src.index('<h2'):src.index('</h2>')]
        check('the right handle resizes an element and writes its width', 'width:' in h2src.split('data-tall')[0], h2src[:200])

        # the tall format: style edits go to data-tall, the shared style stays
        await pg.locator('.mseg button', has_text='tall').click()
        await expect(pg.locator('.mfmt-where')).to_contain_text('仅 tall')
        size = pg.locator('input[aria-label="字号"]')
        await size.fill('90')
        await size.press('Enter')
        await pg.wait_for_timeout(600)
        src = read('scenes/kind-slides.html')
        h2src = src[src.index('<h2'):src.index('</h2>')]
        check('in the tall format a style change goes to data-tall only', 'data-tall="font-size:90px' in h2src and 'font-size:112px' in h2src, h2src[:300])
        await pg.locator('.mover .chip', has_text='font-size').click()
        await pg.wait_for_timeout(600)
        src = read('scenes/kind-slides.html')
        h2src = src[src.index('<h2'):src.index('</h2>')]
        check('"use the shared value" drops the override', 'font-size:90px' not in h2src and 'font-size:104px' not in h2src, h2src[:300])
        await pg.locator('.mseg button', has_text='wide').click()

        # at a time: off-screen elements take no clicks; a selected one is drawn landed
        await pg.locator('.mscene', has_text='kind-slides').click()
        scrub = pg.locator('.mscrub')
        # the scene opens on its start (played at 1.5×)
        start = int(await scrub.get_attribute('value')) * 1.5
        at = lambda ms: str(round((start + ms) / 1.5))
        await pg.keyboard.press('Escape')
        await scrub.fill(at(100))
        await expect(h2).to_have_attribute('data-dc-off', '')
        check('before it enters, an element takes no clicks', True)
        await scrub.fill(at(600))
        await expect(h2).not_to_have_attribute('data-dc-off', '')
        mid = float(await h2.evaluate('e => getComputedStyle(e).opacity'))
        await h2.click()
        await expect(h2).to_have_attribute('data-dc-rest', '')
        rest = float(await h2.evaluate('e => getComputedStyle(e).opacity'))
        check('selected mid-entrance, an element is drawn landed', mid < 0.99 and rest == 1, f'{mid} {rest}')
        await expect(pg.locator('.lr.away').first).to_be_visible()
        check('layers fade what is not on screen yet', 'S 入场' in (await pg.locator('.lr.away .rt').first.inner_text()).upper().replace('MS', 'S'))
        await pg.keyboard.press('Escape')

        # sizes set by hand
        await pg.locator('.mstage').click(position={'x': 5, 'y': 5})
        await pg.locator('button', has_text='添加尺寸').click()
        await pg.locator('.maddfmt button', has_text='方形').click()
        await expect(pg.locator('.mseg button', has_text='square')).to_have_count(1)
        await pg.wait_for_timeout(500)
        check('a size added in the panel lands in motion.json', '"square"' in read('motion.json'))
        await pg.locator('input[aria-label="square 宽"]').fill('1200')
        await pg.locator('input[aria-label="square 宽"]').press('Enter')
        await pg.wait_for_timeout(500)
        check('a size is edited by hand', '1200' in read('motion.json'))
        pg.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.locator('button[aria-label="删除尺寸 square"]').click()
        await expect(pg.locator('.mseg button', has_text='square')).to_have_count(0)
        await pg.wait_for_timeout(500)
        check('a size is removed', '"square"' not in read('motion.json'))

        # --- formats and speed --------------------------------------------------------------------------
        await pg.locator('.mseg button', has_text='tall').click()
        await expect(pg).to_have_url(BASE + '/?p=design-motion&f=tall')
        box = await pg.locator('.medit .sframe').bounding_box()
        check('the tall format plays standing up', box and box['height'] > box['width'], str(box))
        await pg.locator('.mspeed select').select_option('1')
        await expect(pg.locator('.mtime')).to_contain_text('/ 54.')
        check('speed changes the length without touching the files', True)
        await pg.screenshot(path=OUT + 'motion-tall.png')

        # --- a new piece --------------------------------------------------------------------------------
        await pg.goto(BASE + '/')
        await pg.locator('.lstrip [data-new="motion"]').click()
        await pg.locator('[role=dialog] input[aria-label="新项目名称"]').fill('zz-motion')
        await pg.locator('[role=dialog] button[type="submit"]').click()
        await expect(pg.locator('.dashtitle')).to_have_text('zz-motion')
        await expect(pg.frame_locator('.medit iframe').locator('section#title h1')).to_have_text('zz-motion')
        check('a new motion piece starts with one titled scene',
              os.path.exists(os.path.join(REPO, 'projects/zz-motion/motion.json')) and os.path.exists(os.path.join(REPO, 'projects/zz-motion/scenes/title.html')))

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    restore()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
