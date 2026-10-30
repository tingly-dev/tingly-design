"""End-to-end checks for a canvas's template values: with nothing selected the right panel lists every artboard's data-props values grouped by artboard, edits write back to that artboard's default and undo, the group name selects the artboard, the groups fold, an artboard's Tweaks links to them, a name shared by artboards is listed once and set for all in one undo step, and a canvas with no values says how to declare one. Run with `pnpm dev` up: python3 e2e/template_values.py"""
import os, asyncio, json, shutil, time
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')  # a Chromium to use instead of Playwright's own
NAME = 'e2e-template-values'
DIR = os.path.join(REPO, 'projects', NAME)
MAIN = os.path.join(DIR, 'Main.dc.html')


def board(title, props, heading):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<div style="width:400px;height:200px;box-sizing:border-box;padding:24px;background:#ffffff"><h2 style="margin:0;color:{{{{accent}}}}">{{{{heading}}}}</h2></div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{props}'>
class Component extends DCLogic {{
  renderVals() {{ return {{ accent: this.props.accent ?? '#2f6fed', heading: this.props.heading ?? '{heading}' }}; }}
}}
</script>
</body>
</html>
"""

COVER = board('Cover', '{"heading":{"default":"Spring launch"},"accent":{"editor":"color","default":"#e8590c"},"dark":{"default":false}}', 'Spring launch')
POSTER = board('Poster', '{"heading":{"default":"Open studio"}}', 'Open studio')
PLAIN = '<!doctype html><html><head><meta charset="utf-8"><title>Plain</title></head><body><x-dc><div style="width:200px;height:100px;background:#fff">Plain</div></x-dc></body></html>'
FILES = {'Cover.dc.html': COVER, 'Poster.dc.html': POSTER, 'Plain.dc.html': PLAIN}
BOARDS = {f: {'x': i * 500, 'y': 0, 'w': 400, 'h': 200} for i, f in enumerate(FILES)}
CANVAS = {'v': 3, 'title': 'Values', 'boards': BOARDS, 'order': list(FILES), 'notes': {}, 'pages': [], 'launch': {'view': 'canvas'}, 'designSystems': []}

def src(f): return open(os.path.join(DIR, f), encoding='utf-8').read()

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

async def main():
    shutil.rmtree(DIR, ignore_errors=True)
    os.makedirs(DIR)
    for f, s in FILES.items(): open(os.path.join(DIR, f), 'w', encoding='utf-8').write(s)
    open(os.path.join(DIR, 'canvas.json'), 'w', encoding='utf-8').write(json.dumps(CANVAS))
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 900})
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(BASE + f'/?p={NAME}')
            await pg.wait_for_timeout(2500)
            sec = pg.locator('.panel .tvals')
            await expect(sec.locator('h3')).to_have_text('Template values')
            check('nothing selected lists a section of template values', True)
            groups = sec.locator('.tvgroup')
            check('one group per artboard that declares values, none for the plain one', await groups.count() == 2 and await sec.locator('[role=group][aria-label="Plain"]').count() == 0, await groups.count())
            check('groups follow the canvas order', await groups.nth(0).get_attribute('aria-label') == 'Cover' and await groups.nth(1).get_attribute('aria-label') == 'Poster')
            check('the count is in the header', 'values' in (await groups.nth(0).inner_text()) and '3' in (await groups.nth(0).inner_text()))
            check('a filter is left out for a few values', await sec.locator('input[type=search]').count() == 0)

            cover = sec.locator('[role=group][aria-label="Cover"]')
            await cover.locator('input[aria-label="heading"]').fill('Autumn sale')
            await cover.locator('input[aria-label="heading"]').press('Enter')
            check('editing a value writes that artboard\'s default', await wait_for(lambda: '"heading":{"default":"Autumn sale"}' in src('Cover.dc.html')))
            check('the other artboard keeps its own value', '"default":"Open studio"' in src('Poster.dc.html'))
            await expect(pg.frame_locator('[data-board="Cover.dc.html"] iframe').locator('h2')).to_have_text('Autumn sale')
            check('the artboard on the canvas shows it', True)
            await cover.locator('input[type=checkbox]').check()
            check('a boolean default is a switch', await wait_for(lambda: '"dark":{"default":true}' in src('Cover.dc.html')))

            await pg.evaluate('document.activeElement && document.activeElement.blur()')
            await pg.locator('body').press('Control+z')
            check('the edit can be undone', await wait_for(lambda: '"dark":{"default":false}' in src('Cover.dc.html')))

            await cover.get_by_role('button', name='Fold Cover').click()
            check('a group folds', await cover.locator('input').count() == 0)
            await cover.get_by_role('button', name='Unfold Cover').click()
            check('and unfolds', await cover.locator('input[aria-label="heading"]').count() == 1)

            await cover.get_by_role('button', name='Cover', exact=True).first.click()
            await pg.wait_for_timeout(500)
            check('the group name selects the artboard and shows its Tweaks', await pg.get_by_role('tab', name='Tweaks').get_attribute('aria-selected') == 'true' and await pg.locator('.panel .tvals').count() == 0)
            check('whose fields are the same', await pg.locator('.panel input[aria-label="heading"]').count() == 1)

            # from an artboard's Tweaks the rest are one click away, and a shared name is set once for all
            link = pg.locator('.panel .tvall')
            check('an artboard\'s Tweaks points at the other artboards\' values', await link.count() == 1 and 'See the values of all artboards' in await link.inner_text())
            await link.click()
            await expect(pg.locator('.panel .tvals')).to_have_count(1)
            check('the link goes to the whole canvas\'s values', True)
            sec = pg.locator('.panel .tvals')
            await sec.locator('.seg button').nth(1).click()
            heading = sec.locator('[role=group][aria-label="heading"]')
            check('by name lists a name once with every artboard that has it', await heading.count() == 1 and await heading.locator('input[aria-label="heading"]').count() == 3)
            check('a shared name whose values differ says so', await heading.locator('.hint').count() == 1)
            await heading.locator('.tvall-row input[aria-label="heading"]').fill('Everywhere')
            await heading.locator('.tvall-row input[aria-label="heading"]').press('Enter')
            check('Set all writes every artboard', await wait_for(lambda: '"heading":{"default":"Everywhere"}' in src('Cover.dc.html') and '"default":"Everywhere"' in src('Poster.dc.html')))
            await pg.evaluate('document.activeElement && document.activeElement.blur()')
            await pg.locator('body').press('Control+z')
            check('and is one undo step', await wait_for(lambda: 'Everywhere' not in src('Cover.dc.html') and 'Everywhere' not in src('Poster.dc.html')))
            await sec.locator('.seg button').nth(0).click()

            # past 30 values a filter appears and groups start folded
            await pg.keyboard.press('Escape')
            many = ','.join(f'"v{i}":{{"default":"x"}}' for i in range(30))
            open(os.path.join(DIR, 'Poster.dc.html'), 'w', encoding='utf-8').write(board('Poster', '{' + many + ',"heading":{"default":"Open studio"}}', 'Open studio'))
            await pg.locator('body').click(position={'x': 600, 'y': 180})
            try:
                await expect(pg.locator('.panel .tvals input[type=search]')).to_have_count(1, timeout=8000)
                check('a filter appears past 30 values', True)
            except AssertionError:
                check('a filter appears past 30 values', False)
            check('and the groups start folded', await pg.locator('.panel .tvals input[aria-label="heading"]').count() == 0)
            await pg.locator('.panel .tvals input[type=search]').fill('v1')
            check('filtering by name opens the matching groups', await pg.locator('.panel .tvals input[aria-label="v10"]').count() == 1 and await pg.locator('.panel .tvals input[aria-label="v2"]').count() == 0)

            # a canvas that declares nothing says how to
            for f in ('Cover.dc.html', 'Poster.dc.html'): open(os.path.join(DIR, f), 'w', encoding='utf-8').write(PLAIN)
            await pg.keyboard.press('Escape')
            await pg.wait_for_timeout(300)
            await pg.locator('body').click(position={'x': 600, 'y': 180})
            try:
                await expect(pg.locator('.panel .tvals .hint').filter(has_text='data-props')).to_have_count(1, timeout=8000)
                check('with no values declared the section says how to declare one', True)
            except AssertionError:
                check('with no values declared the section says how to declare one', False)
            await b.close()
        bad = [n for n, ok in results if not ok]
        print(f'\n{len(results) - len(bad)}/{len(results)} passed' + (f'; errors: {errs[:3]}' if errs else ''))
        raise SystemExit(1 if bad or errs else 0)
    finally:
        shutil.rmtree(DIR, ignore_errors=True)

asyncio.run(main())
