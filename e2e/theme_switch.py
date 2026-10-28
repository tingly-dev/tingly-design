"""End-to-end checks for the Theme tab of a canvas and a deck: one card per theme of every installed design system plus the original look, a click recolours every artboard (or every slide, or this slide) with ordinary values and writes a `theme` record, Undo and the Original look bring the old colours back, a project that never wore a system takes its page, text and accent colours as the roles, and a canvas without a system says how to install one. Run with `pnpm dev` up: python3 e2e/theme_switch.py"""
import os, asyncio, json, shutil, time, urllib.request
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')  # a Chromium to use instead of Playwright's own
CANVAS = 'e2e-theme-canvas'
PLAIN = 'e2e-theme-plain'
DECK = 'e2e-theme-deck'
EMPTY = 'e2e-theme-empty'
NAMES = [CANVAS, PLAIN, DECK, EMPTY]


def path(p, *f): return os.path.join(REPO, 'projects', p, *f)
def src(p, f): return open(path(p, f), encoding='utf-8').read()
def index(p, f): return json.loads(src(p, f))


def board(title, body):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
{body}
</x-dc>
</body>
</html>
"""

# the colours of the Tingly design system's light theme, written as a person would
THEMED = board('Main', '<div style="width:400px;height:200px;background:#F7F7F4;color:#16181D;padding:24px"><div style="background:#ffffff;border:1px solid #E5E5E0;padding:12px"><b style="color:#2563eb">Hello</b></div></div>')
THEMED2 = board('Other', '<div style="width:400px;height:200px;background:#f7f7f4;color:#4a4f5a;padding:24px">Second</div>')
# colours that belong to no system
ORIGINAL = board('Main', '<div style="width:400px;height:200px;background:#fdf2e9;color:#3b2a1a;padding:24px"><b style="color:#c0392b">Hello</b><i style="color:#3b2a1a">there</i></div>')


def write_canvas(p, files, ds=False):
    shutil.rmtree(path(p), ignore_errors=True)
    os.makedirs(path(p))
    for f, s in files.items(): open(path(p, f), 'w', encoding='utf-8').write(s)
    boards = {f: {'x': i * 500, 'y': 0, 'w': 400, 'h': 200} for i, f in enumerate(files)}
    open(path(p, 'canvas.json'), 'w', encoding='utf-8').write(json.dumps({'v': 3, 'title': p, 'boards': boards, 'order': list(files), 'notes': {}, 'pages': [], 'launch': {'view': 'canvas'}, 'designSystems': []}))


def install(p, **body):
    req = urllib.request.Request(BASE + f'/api/projects/{p}/design-systems', data=json.dumps(body).encode(), headers={'content-type': 'application/json'}, method='POST')
    return json.load(urllib.request.urlopen(req))


async def wait_for(pred, timeout=8.0):
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


async def open_theme(pg, name):
    await pg.goto(BASE + f'/?p={name}')
    await pg.wait_for_timeout(2000)
    await pg.get_by_role('tab', name='Theme').click()


async def main():
    for n in NAMES: shutil.rmtree(path(n), ignore_errors=True)
    write_canvas(CANVAS, {'Main.dc.html': THEMED, 'Other.dc.html': THEMED2})
    write_canvas(PLAIN, {'Main.dc.html': ORIGINAL})
    write_canvas(EMPTY, {'Main.dc.html': ORIGINAL})
    shutil.copytree(path('tingly-intro'), path(DECK))
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 900})
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(BASE + '/')
            install(CANVAS, **{'from': 'tingly-ds'})
            install(PLAIN, **{'from': 'tingly-ds'})
            install(DECK, **{'from': 'tingly-ds'})

            # ---- a canvas that already uses the system's colours
            await open_theme(pg, CANVAS)
            cards = pg.locator('.themetab [data-theme-card]')
            check('a card for the original look and one per theme', await cards.count() == 3, await cards.count())
            light = pg.locator('[data-theme-card="tingly/light"]')
            dark = pg.locator('[data-theme-card="tingly/dark"]')
            check('the theme it wears is lit', await light.get_attribute('aria-pressed') == 'true' and await dark.get_attribute('aria-pressed') == 'false')
            check('and said in words', 'Light' in await pg.locator('.th-now').inner_text())
            check('its colours are listed by role, with contrast', await pg.locator('.th-group').count() >= 3 and await pg.locator('.th-contrast li').count() >= 2)
            check('the original look has nowhere to go back to', await pg.locator('[data-theme-card="original"]').is_disabled())

            await dark.click()
            check('one click rewrites every artboard', await wait_for(lambda: '#111317' in src(CANVAS, 'Main.dc.html') and '#111317' in src(CANVAS, 'Other.dc.html')), src(CANVAS, 'Main.dc.html'))
            main = src(CANVAS, 'Main.dc.html')
            check('with ordinary colours, by role', 'background:#1a1d23' in main and 'color:#eceef2' in main and 'border:1px solid #2b2f37' in main and 'var(' not in main)
            check('the index records the theme', await wait_for(lambda: index(CANVAS, 'canvas.json').get('theme', {}).get('theme') == 'dark'), index(CANVAS, 'canvas.json'))
            check('the dark card is lit now', await dark.get_attribute('aria-pressed') == 'true')
            await expect(pg.locator('.toast').filter(has_text='Switched to')).to_have_count(1)
            await pg.locator('.toast button').filter(has_text='Undo').click()
            check('Undo brings every colour back', await wait_for(lambda: src(CANVAS, 'Main.dc.html') == THEMED and src(CANVAS, 'Other.dc.html') == THEMED2))
            check('and the record', await wait_for(lambda: 'theme' not in index(CANVAS, 'canvas.json')))

            await dark.click()
            await wait_for(lambda: '#111317' in src(CANVAS, 'Main.dc.html') and '#111317' in src(CANVAS, 'Other.dc.html'))
            await pg.evaluate('document.activeElement && document.activeElement.blur()')
            await pg.locator('body').press('Control+z')
            check('⌘Z takes the whole switch back in one step', await wait_for(lambda: src(CANVAS, 'Main.dc.html') == THEMED and src(CANVAS, 'Other.dc.html') == THEMED2 and 'theme' not in index(CANVAS, 'canvas.json')))
            await pg.locator('body').press('Control+Shift+z')
            check('and ⇧⌘Z does it again', await wait_for(lambda: '#111317' in src(CANVAS, 'Main.dc.html') and '#111317' in src(CANVAS, 'Other.dc.html') and index(CANVAS, 'canvas.json').get('theme', {}).get('theme') == 'dark'))
            await light.click()
            check('switching back is the same one click', await wait_for(lambda: src(CANVAS, 'Main.dc.html').lower() == THEMED.lower() or ('#f7f7f4' in src(CANVAS, 'Main.dc.html').lower() and '#111317' not in src(CANVAS, 'Main.dc.html'))))

            # ---- a canvas that never wore a system: page, text and accent are the roles
            await open_theme(pg, PLAIN)
            check('nothing is lit but the original look', await pg.locator('[data-theme-card="original"]').get_attribute('aria-pressed') == 'true')
            await pg.locator('[data-theme-card="tingly/dark"]').click()
            check('its page, text and accent colours become the system\'s', await wait_for(lambda: '#111317' in src(PLAIN, 'Main.dc.html') and '#eceef2' in src(PLAIN, 'Main.dc.html') and '#6d9bff' in src(PLAIN, 'Main.dc.html')), src(PLAIN, 'Main.dc.html'))
            check('what they were is remembered', await wait_for(lambda: index(PLAIN, 'canvas.json').get('theme', {}).get('base', {}).get('colors', {}).get('page') == '#fdf2e9'), index(PLAIN, 'canvas.json'))
            await pg.locator('[data-theme-card="tingly/light"]').click()
            await wait_for(lambda: '#f7f7f4' in src(PLAIN, 'Main.dc.html').lower())
            check('the original look is on offer', await pg.locator('[data-theme-card="original"]').is_enabled())
            await pg.locator('[data-theme-card="original"]').click()
            check('and puts the old colours back, after any number of switches', await wait_for(lambda: src(PLAIN, 'Main.dc.html') == ORIGINAL), src(PLAIN, 'Main.dc.html'))
            check('with no record left', await wait_for(lambda: 'theme' not in index(PLAIN, 'canvas.json')))

            # ---- no design system installed
            await open_theme(pg, EMPTY)
            check('without a design system the tab says how to install one', await pg.locator('.themetab .dsinst, .themetab .faceadd').count() >= 1 and await pg.locator('.themetab [data-theme-card]').count() == 0)

            # ---- a deck: every slide, or this one
            await open_theme(pg, DECK)
            slide_files = sorted(f for f in os.listdir(path(DECK, 'slides')) if f.endswith('.html'))
            before = {f: src(DECK, 'slides/' + f) for f in slide_files}
            # the cover is dark already, the rest of the deck is light
            check('the deck wears the theme most of its colours are', await pg.locator('[data-theme-card="tingly/light"]').get_attribute('aria-pressed') == 'true')
            await pg.locator('.themetab .seg button', has_text='This slide').click()
            check('the open slide, on its own, wears the dark theme', await pg.locator('[data-theme-card="tingly/dark"]').get_attribute('aria-pressed') == 'true')
            await pg.locator('[data-theme-card="tingly/light"]').click()
            await wait_for(lambda: any(src(DECK, 'slides/' + f) != before[f] for f in slide_files))
            changed = [f for f in slide_files if src(DECK, 'slides/' + f) != before[f]]
            check('This slide changes only the open slide', changed == ['cover.html'], changed)
            check('and leaves the deck without a record', 'theme' not in index(DECK, 'deck.json'))
            await pg.locator('.toast button').filter(has_text='Undo').click()
            check('Undo restores it', await wait_for(lambda: all(src(DECK, 'slides/' + f) == before[f] for f in slide_files)))
            await pg.locator('.themetab .seg button', has_text='All slides').click()
            await pg.locator('[data-theme-card="tingly/light"]').click()
            check('the lit card still evens out a deck that is half dark: the dark cover turns light', await wait_for(lambda: '#f7f7f4' in src(DECK, 'slides/cover.html').lower()), src(DECK, 'slides/cover.html')[:200])
            await pg.locator('[data-theme-card="tingly/dark"]').click()
            check('All slides changes every one', await wait_for(lambda: all('#111317' in src(DECK, 'slides/' + f).lower() for f in slide_files if '#f7f7f4' in before[f].lower())))
            check('and the deck records the theme', await wait_for(lambda: index(DECK, 'deck.json').get('theme', {}).get('theme') == 'dark'))
            await b.close()
        bad = [n for n, ok in results if not ok]
        print(f'\n{len(results) - len(bad)}/{len(results)} passed' + (f'; errors: {errs[:3]}' if errs else ''))
        raise SystemExit(1 if bad or errs else 0)
    finally:
        for n in NAMES: shutil.rmtree(path(n), ignore_errors=True)

asyncio.run(main())
