"""End-to-end checks for motion pieces: the player, formats, the cover, a new piece.
Run with `pnpm dev` up: python3 e2e/motion.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, asyncio, subprocess
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')

def restore(): subprocess.run(['rm', '-rf', os.path.join(REPO, 'projects/zz-motion')])

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
        cover = pg.frame_locator('.mcover iframe')
        await expect(cover.locator('section#poster')).to_be_visible()
        await expect(pg.locator('.mtime')).to_contain_text('/ 36.')
        check('the sample opens on its cover, 36 s long at its speed', await pg.locator('.mscene').count() == 12)
        await pg.screenshot(path=OUT + 'motion.png')

        # --- play, seek, scenes ----------------------------------------------------------------------
        await pg.locator('.mplay').click()
        await expect(pg.locator('.mcover')).to_have_count(0)
        await pg.wait_for_timeout(1200)
        t = float((await pg.locator('.mtime').inner_text()).split('/')[0])
        check('play runs the clock', t > 0.5, str(t))
        await pg.locator('.mplay').click()
        await pg.locator('.mscene', has_text='outro').click()
        await expect(pg.locator('.mscene.on')).to_have_text('outro')
        await expect(pg.frame_locator('.mstack > .mframe iframe').locator('section#outro')).to_be_visible()
        check('a scene button jumps to that scene', True)

        # --- formats and speed --------------------------------------------------------------------------
        await pg.locator('.mseg button', has_text='tall').click()
        await expect(pg).to_have_url(BASE + '/?p=design-motion&f=tall')
        box = await pg.locator('.mstack > .mframe').bounding_box()
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
        await expect(pg.frame_locator('.mstack > .mframe iframe').locator('section#title h1')).to_have_text('zz-motion')
        check('a new motion piece starts with one titled scene',
              os.path.exists(os.path.join(REPO, 'projects/zz-motion/motion.json')) and os.path.exists(os.path.join(REPO, 'projects/zz-motion/scenes/title.html')))

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    restore()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
