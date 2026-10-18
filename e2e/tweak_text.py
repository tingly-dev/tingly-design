"""End-to-end checks for what an artboard's template manages: text that shows a text tweak ({{heading}}) is retyped in place by changing the tweak, and the Tweaks tab lists every prop in data-props. Run with `pnpm dev` up: python3 e2e/tweak_text.py"""
import os, asyncio, json, shutil, time
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')  # a Chromium to use instead of Playwright's own
NAME = 'e2e-tweak-text'
DIR = os.path.join(REPO, 'projects', NAME)
MAIN = os.path.join(DIR, 'Main.dc.html')

BOARD = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Tweak text</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<div style="width:600px;height:300px;box-sizing:border-box;padding:32px;display:flex;flex-direction:column;gap:16px;background:#ffffff">
  <h2 style="margin:0;font-size:28px;color:{{accent}}">{{heading}}</h2>
  <p style="margin:0">Literal copy</p>
  <p style="margin:0">Hello {{name}}!</p>
  <sc-for list="{{plans}}" as="plan" hint-placeholder-count="2">
    <div style="padding:8px">{{plan.name}}</div>
  </sc-for>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"accent":{"editor":"color","default":"#2f6fed"},"heading":{"default":"Welcome"},"name":{"editor":"text","default":"Ann"},"compact":{"default":false}}'>
class Component extends DCLogic {
  renderVals() {
    return { accent: this.props.accent ?? '#2f6fed', heading: this.props.heading ?? 'Welcome', name: this.props.name ?? 'Ann', plans: [{ name: 'Solo' }, { name: 'Pro' }] };
  }
}
</script>
</body>
</html>
'''
CANVAS = {'v': 3, 'title': 'Tweak text', 'boards': {'Main.dc.html': {'x': 0, 'y': 0, 'w': 600, 'h': 300}}, 'order': ['Main.dc.html'], 'notes': {}, 'pages': [], 'launch': {'view': 'canvas'}, 'designSystems': []}

def src(): return open(MAIN, encoding='utf-8').read()

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
    open(MAIN, 'w', encoding='utf-8').write(BOARD)
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
            f = pg.frame_locator('[data-board="Main.dc.html"] iframe')

            await f.locator('h2').dblclick()
            await pg.wait_for_timeout(300)
            await pg.keyboard.type('Changed')
            await pg.keyboard.press('Enter')
            check('retyping text bound to a text tweak sets the tweak', await wait_for(lambda: '"heading":{"default":"Changed"}' in src()))
            check('the template keeps its hole', '<h2 style="margin:0;font-size:28px;color:{{accent}}">{{heading}}</h2>' in src())
            await expect(f.locator('h2')).to_have_text('Changed')
            check('the artboard shows the new text', True)

            await f.locator('p', has_text='Hello').dblclick()
            await pg.keyboard.type('x')
            await pg.keyboard.press('Escape')
            await pg.wait_for_timeout(500)
            check('text that mixes copy and a hole is still not retyped', '"name":{"editor":"text","default":"Ann"}' in src() and 'Hello {{name}}!' in src())

            await pg.keyboard.press('Escape')
            await pg.locator('.lr', has_text='Main.dc.html').click()
            await pg.get_by_role('tab', name='Tweaks').click()
            await pg.wait_for_timeout(500)
            rows = await pg.locator('.panel .sec .r').count()
            check('the Tweaks tab lists every prop, with or without an editor', rows == 4, rows)
            await pg.locator('.panel input[aria-label="heading"]').fill('Again')
            await pg.locator('.panel input[aria-label="heading"]').press('Enter')
            check('a prop with no editor is edited as text', await wait_for(lambda: '"heading":{"default":"Again"}' in src()))
            await pg.locator('.panel input[type="checkbox"]').check()
            check('a boolean default is a switch', await wait_for(lambda: '"compact":{"default":true}' in src()))
            await b.close()
        bad = [n for n, ok in results if not ok]
        print(f'\n{len(results) - len(bad)}/{len(results)} passed' + (f'; errors: {errs[:3]}' if errs else ''))
        raise SystemExit(1 if bad or errs else 0)
    finally:
        shutil.rmtree(DIR, ignore_errors=True)

asyncio.run(main())
