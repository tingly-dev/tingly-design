"""End-to-end checks for motion pieces: the player, formats, the cover, editing on the stage
(selecting at a time, retyping, resizing, per-format overrides, sizes), a new piece in a picked size, notes.
Run with `pnpm dev` up: python3 e2e/motion.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, re, asyncio, subprocess
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')

SAMPLE = 'projects/design-motion'
def restore():
    for n in ('zz-motion', 'zz-motion-2'): subprocess.run(['rm', '-rf', os.path.join(REPO, 'projects', n)])
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
        ctx = await b.new_context(locale='zh-CN', viewport={'width': 1440, 'height': 1000})
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
        await expect(pg.locator('.mscene.on .mname')).to_have_text('outro')
        await expect(stage.locator('section#outro')).to_be_visible()
        check('a scene button jumps to that scene', True)

        # click: a clip's start; double-click: its end
        await pg.locator('.mscene', has_text='kind-slides').click()
        t0 = float((await pg.locator('.mtime').inner_text()).split('/')[0])
        await pg.locator('.mscene', has_text='kind-slides').dblclick()
        t1 = float((await pg.locator('.mtime').inner_text()).split('/')[0])
        await expect(pg.locator('.mscene.on .mname')).to_have_text('kind-slides')
        check('double-clicking a clip jumps to its end, still inside that scene', t1 > t0 + 1, f'{t0} {t1}')
        await pg.locator('.mscene', has_text='kind-slides').click()
        t2 = float((await pg.locator('.mtime').inner_text()).split('/')[0])
        check('a single click goes back to its start', abs(t2 - t0) < 0.15, f'{t0} {t2}')

        # the cover sits before 0 s: its clip, and the way to have none
        check('the cover is a clip before 0 s', await pg.locator('.mcoverclip.on').count() == 0 and await pg.locator('.mcoverclip').count() == 1)
        await pg.locator('.mcoverclip').click()
        await expect(stage.locator('section#poster')).to_be_visible()
        await expect(pg.locator('.mcoverclip.on')).to_have_count(1)
        check('clicking the cover clip shows the cover on the stage', True)
        await pg.locator('.mcoverx').click(force=True)
        await pg.wait_for_timeout(600)
        check('removing the cover unsets it in motion.json', '"cover": "poster"' not in read('motion.json'))
        await expect(pg.locator('.mcoverclip.add')).to_have_count(1)
        await pg.locator('.mcoverclip.add').click()
        await expect(pg.locator('.mcoverclip.on')).to_have_count(1)
        await pg.wait_for_timeout(600)
        check('adding a cover takes the old poster scene back', '"cover": "poster"' in read('motion.json'))
        await pg.locator('.mscene', has_text='kind-slides').click()

        # a scene's length: the field in the bar and the clip's right edge
        dur = pg.locator('.mdur input')
        await dur.fill('2')
        await dur.press('Enter')
        await pg.wait_for_timeout(700)
        check('the length field in the bar writes data-duration', 'data-duration="3s"' in read('scenes/kind-slides.html'), read('scenes/kind-slides.html')[:160])
        grip = pg.locator('.mgrip').nth(await pg.locator('.mscene').evaluate_all("els => els.findIndex(e => e.textContent.includes('kind-slides'))"))
        gb = await grip.bounding_box()
        gx, gy = gb['x'] + gb['width'] / 2, gb['y'] + gb['height'] / 2
        await pg.mouse.move(gx, gy)
        await pg.mouse.down()
        await pg.mouse.move(gx + 30, gy, steps=5)
        await pg.mouse.move(gx + 60, gy, steps=5)
        await pg.mouse.up()
        await pg.wait_for_timeout(700)
        check('dragging a clip edge changes its length', 'data-duration="3s"' not in read('scenes/kind-slides.html') and 'data-duration=' in read('scenes/kind-slides.html'), read('scenes/kind-slides.html')[:160])

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

        # --- a new piece, in the size picked -----------------------------------------------------------
        await pg.goto(BASE + '/')
        await pg.evaluate("localStorage.removeItem('dc.motionSizes')")
        await pg.locator('.lstrip [data-new="motion"]').click()
        dlg = pg.locator('[role=dialog]')
        check('the new-motion dialog asks for a size, 16:9 the first time', await dlg.locator('.szopt[aria-checked=true]').get_attribute('data-size') == 'wide')
        check('the sizes are the presets and a custom one', await dlg.locator('.szopt').count() == 7)
        await dlg.locator('.szopt[data-size=tall]').click()
        await expect(dlg.locator('.szfor')).to_contain_text('抖音')
        check('a preset names the platforms that take it', True)
        await dlg.locator('.where .linkish').click()
        await dlg.locator('input[aria-label="新项目名称"]').fill('zz-motion')
        await pg.screenshot(path=OUT + 'motion-new-size.png')
        await dlg.locator('button[type="submit"]').click()
        await expect(pg.locator('.dashtitle')).to_have_text('zz-motion')
        await expect(pg.frame_locator('.medit iframe').locator('section#title h1')).to_have_text('zz-motion')
        check('a new motion piece starts with one titled scene',
              os.path.exists(os.path.join(REPO, 'projects/zz-motion/motion.json')) and os.path.exists(os.path.join(REPO, 'projects/zz-motion/scenes/title.html')))
        import json
        made = json.load(open(os.path.join(REPO, 'projects/zz-motion/motion.json')))
        check('and is made in the picked size', made['formats'] == {'tall': {'size': [1080, 1920]}}, str(made['formats']))
        box = await pg.locator('.medit .sframe').bounding_box()
        check('the stage stands up for a vertical piece', box and box['height'] > box['width'], str(box))

        # the last size is the next default; a custom one is kept in the person's own
        await pg.goto(BASE + '/')
        await pg.locator('.lstrip [data-new="motion"]').click()
        check('the next piece starts in the size used last', await dlg.locator('.szopt[aria-checked=true]').get_attribute('data-size') == 'tall')
        await dlg.locator('.szopt[data-size=custom]').click()
        await dlg.locator('input[aria-label="宽（像素）"]').fill('1280')
        await dlg.locator('input[aria-label="高（像素）"]').fill('720')
        await dlg.locator(".where .linkish").click()
        await dlg.locator('input[aria-label="新项目名称"]').fill('zz-motion-2')
        await dlg.locator('button[type="submit"]').click()
        await expect(pg.locator('.dashtitle')).to_have_text('zz-motion-2')
        made = json.load(open(os.path.join(REPO, 'projects/zz-motion-2/motion.json')))
        check('a custom size is written as its own format', made['formats'] == {'s1280x720': {'size': [1280, 720]}}, str(made['formats']))
        await pg.goto(BASE + '/')
        await pg.locator('.lstrip [data-new="motion"]').click()
        check('and kept as the person\'s own size, picked by default', await dlg.locator('.szopt[aria-checked=true]').get_attribute('data-size') == 'mine')
        await dlg.locator('.szx').click()
        check('which they can remove', await dlg.locator('.szmine').count() == 0 and await dlg.locator('.szopt[aria-checked=true]').get_attribute('data-size') == 'wide')
        await pg.keyboard.press('Escape')

        # --- notes: on the piece and on a scene ---------------------------------------------------------
        await pg.goto(BASE + '/?p=design-motion')
        await expect(pg.locator('.mtime')).to_contain_text('/ 36.')
        await pg.locator('.mscene').nth(1).click()
        await pg.locator('[data-notes-toggle]').click()
        await pg.locator('.mnotes textarea').first.fill('For the launch page. Upbeat, no voice-over.')
        await pg.locator('.mnotes textarea').nth(1).fill('Open on the logo, hold it a beat.')
        await pg.locator('.mnotes textarea').nth(1).blur()
        await asyncio.sleep(1.2)
        check('a note on the piece is saved in motion.json', 'For the launch page' in read('motion.json'))
        sid = await pg.locator('.mnotes label span').nth(1).inner_text()
        scene_id = sid.replace('场景', '').strip()
        check('a note on a scene is the scene\'s last child, an aside', re.search(r'<aside>Open on the logo[^<]*</aside>\s*</section>', read(f'scenes/{scene_id}.html')) is not None)
        check('the scene\'s clip carries a dot', await pg.locator('.mscene.on .mnotedot').count() == 1)
        await pg.screenshot(path=OUT + 'motion-notes.png')
        await pg.locator('.mnotes textarea').nth(1).fill('')
        await pg.locator('.mnotes textarea').nth(1).blur()
        await asyncio.sleep(1.0)
        check('emptying a note removes it', '<aside' not in read(f'scenes/{scene_id}.html'))

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    restore()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
