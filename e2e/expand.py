"""End-to-end checks for expanding an element to edit what it holds: a double-click (or Enter) on a picture, a link, an input or a card opens a form for its parts (a picture's source with a picker of the project's pictures, alt text, a link's address and new-tab switch, the runs of a mixed paragraph, a card's parts), the same form is the Properties panel's Content section, tweak-bound values edit the tweak, script-fed values say why they are read-only, a locked or empty element says so, and slides use the same form. Run with `pnpm dev` up: python3 e2e/expand.py"""
import os, re, asyncio, json, shutil, struct, time, zlib
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')  # a Chromium to use instead of Playwright's own
NAME = 'e2e-expand'
DIR = os.path.join(REPO, 'projects', NAME)
MAIN = os.path.join(DIR, 'Main.dc.html')
DECK_NAME = 'e2e-expand-deck'
DECK_DIR = os.path.join(REPO, 'projects', DECK_NAME)


def png(rgb, size=40):
    """A flat-coloured square, as PNG bytes."""
    raw = b''.join(b'\x00' + bytes(rgb) * size for _ in range(size))
    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


BOARD = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Expand</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<div style="width:640px;height:800px;box-sizing:border-box;padding:24px;display:flex;flex-direction:column;gap:14px;background:#ffffff;font-family:system-ui">
  <img id="logo" src="uploads/a.png" alt="Logo" style="width:80px;height:80px">
  <p id="mixed" style="margin:0">Save <b>20%</b> today</p>
  <a id="buy" href="https://example.com/buy" style="width:max-content">Buy now</a>
  <a id="more" href="/more" style="width:max-content"><b>Read</b> more</a>
  <input id="email" placeholder="Email" style="width:220px">
  <div id="card" style="padding:16px;display:flex;flex-direction:column;gap:6px;background:#f1f5f9;border-radius:8px">
    <h3 style="margin:0">Pro plan</h3>
    <p style="margin:0">All the features</p>
    <button style="width:max-content">Start trial</button>
  </div>
  <img id="brand" src="{{brand}}" alt="Brand" style="width:48px;height:48px">
  <img id="shot" src="{{shot}}" alt="Screenshot" style="width:48px;height:48px">
  <img id="kept" src="uploads/a.png" alt="Kept" data-lock style="width:48px;height:48px">
  <svg id="plain" width="60" height="40" viewBox="0 0 60 40"><rect width="60" height="40" fill="#e2e8f0"/></svg>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"brand":{"default":"uploads/a.png"}}'>
class Component extends DCLogic {
  renderVals() {
    return { brand: this.props.brand ?? 'uploads/a.png', shot: 'uploads/a.png' };
  }
}
</script>
</body>
</html>
'''
CANVAS = {'v': 3, 'title': 'Expand', 'boards': {'Main.dc.html': {'x': 0, 'y': 0, 'w': 640, 'h': 800}}, 'order': ['Main.dc.html'], 'notes': {}, 'pages': [], 'launch': {'view': 'canvas'}, 'designSystems': []}
SLIDE = '<section id="s1" style="background:#ffffff;color:#16181d;padding:96px;display:flex;flex-direction:column;gap:24px"><h1 style="font-size:64px;margin:0">Hello</h1><img id="pic" src="uploads/a.png" alt="Old" style="width:200px;height:200px"></section>\n'
DECK = {'v': 4, 'title': 'Expand deck', 'cover': 's1', 'order': ['s1'], 'sections': {}}

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

def write(path, data, mode='w'):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, mode + ('b' if isinstance(data, bytes) else ''), **({} if isinstance(data, bytes) else {'encoding': 'utf-8'})) as f: f.write(data)

async def main():
    for d in (DIR, DECK_DIR): shutil.rmtree(d, ignore_errors=True)
    write(MAIN, BOARD)
    write(os.path.join(DIR, 'canvas.json'), json.dumps(CANVAS))
    write(os.path.join(DIR, 'uploads', 'a.png'), png((220, 60, 60)))
    write(os.path.join(DIR, 'uploads', 'b.png'), png((60, 120, 220)))
    write(os.path.join(DECK_DIR, 'deck.json'), json.dumps(DECK))
    write(os.path.join(DECK_DIR, 'slides', 's1.html'), SLIDE)
    write(os.path.join(DECK_DIR, 'uploads', 'a.png'), png((220, 60, 60)))
    write(os.path.join(DECK_DIR, 'uploads', 'b.png'), png((60, 120, 220)))
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 1100})
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(BASE + f'/?p={NAME}')
            await pg.wait_for_timeout(2500)
            f = pg.frame_locator('[data-board="Main.dc.html"] iframe')
            pop = pg.locator('.cpop')

            # --- a picture
            await f.locator('#logo').dblclick()
            await expect(pop).to_be_visible()
            check('double-clicking a picture opens its form', True)
            check('the form shows the picture, its source and its alt', await pop.locator('.cpic .thumb img').count() == 1 and await pop.locator('input[aria-label="Source"]').input_value() == 'uploads/a.png' and await pop.locator('input[aria-label="Alt text"]').input_value() == 'Logo')
            await pop.get_by_role('button', name='Replace…').click()
            tiles = pop.locator('.cpicker .tile[role="option"]')
            await expect(tiles).to_have_count(2)
            check('the picker lists the project\'s own pictures, the current one marked', await pop.locator('.cpicker .tile[aria-selected="true"]').count() == 1)
            before = src()
            await pop.locator('.cpicker .tile[title="uploads/b.png"]').click()
            check('choosing a picture changes only its source', await wait_for(lambda: src() == before.replace('id="logo" src="uploads/a.png"', 'id="logo" src="uploads/b.png"')))
            await expect(f.locator('#logo')).to_have_attribute('src', re.compile(r'uploads/b\.png'))
            check('the artboard shows the new picture', True)
            await pop.locator('input[aria-label="Alt text"]').fill('Company logo')
            await pop.locator('input[aria-label="Alt text"]').press('Enter')
            check('alt text is written as the alt attribute', await wait_for(lambda: 'alt="Company logo"' in src()))
            await pop.get_by_role('button', name='Replace…').click()
            await pop.locator('input[type=file]').set_input_files({'name': 'c.png', 'mimeType': 'image/png', 'buffer': png((60, 200, 90))})
            check('uploading a picture keeps it under uploads/ and uses it', await wait_for(lambda: 'id="logo" src="uploads/' in src() and 'uploads/b.png" alt' not in src().split('id="logo"')[1].split('>')[0]))
            kept = src().split('id="logo" src="')[1].split('"')[0]
            check('and the file is in the project', os.path.exists(os.path.join(DIR, kept)), kept)
            await pg.keyboard.press('Escape')
            await expect(pop).to_have_count(0)
            check('Escape closes the form', True)

            # --- undo is one step per change
            await pg.mouse.click(5, 5)
            await f.locator('#logo').click()
            await pg.keyboard.press('Control+z')
            check('undo takes the last change back', await wait_for(lambda: 'src="uploads/b.png"' in src().split('id="logo"')[1].split('>')[0]), src().split('id="logo"')[1][:90])

            # --- a mixed paragraph: the run that was clicked is the field that has the cursor
            await f.locator('#mixed').dblclick(position={'x': 8, 'y': 8})
            await expect(pop).to_be_visible()
            runs = pop.locator('textarea.crun')
            check('a paragraph with a styled word has a field for each run', await runs.count() == 3 and await runs.nth(1).input_value() == '20%')
            await pg.wait_for_timeout(150)
            check('the field of the clicked run has the cursor', await runs.nth(0).evaluate('e => e === document.activeElement'))
            await pg.keyboard.type('Take')
            await pg.keyboard.press('Enter')
            check('retyping a run keeps the styled word', await wait_for(lambda: '<p id="mixed" style="margin:0">Take <b>20%</b> today</p>' in src()), src().split('id="mixed"')[1][:80])
            await pg.keyboard.press('Escape')

            # --- a link: double-click retypes its label in place; the address is in the panel's Content section
            await f.locator('#buy').click()
            await pg.wait_for_timeout(400)
            sec = pg.locator('.panel .sec.content')
            check('a link\'s address is in the Content section of its properties', await sec.count() == 1 and await sec.locator('input[aria-label="Address"]').input_value() == 'https://example.com/buy')
            await sec.locator('input[aria-label="Address"]').fill('https://example.com/pricing')
            await sec.locator('input[aria-label="Address"]').press('Enter')
            check('changing it writes the href', await wait_for(lambda: 'href="https://example.com/pricing"' in src()))
            await sec.get_by_label('Open in a new tab').check()
            check('open in a new tab writes target and rel together', await wait_for(lambda: 'target="_blank" rel="noopener"' in src()))
            await sec.get_by_label('Open in a new tab').uncheck()
            check('and takes both away', await wait_for(lambda: 'target=' not in src() and 'rel=' not in src()))
            await f.locator('#buy').dblclick()
            await pg.wait_for_timeout(300)
            check('double-clicking a plain link still retypes its label in place', await pop.count() == 0)
            await pg.keyboard.press('Control+a')
            await pg.keyboard.type('Buy today')
            await pg.keyboard.press('Enter')
            check('the label is retyped', await wait_for(lambda: '>Buy today</a>' in src()))
            more = await f.locator('#more').bounding_box()
            await f.locator('#more').dblclick(position={'x': more['width'] - 4, 'y': more['height'] / 2})
            await expect(pop).to_be_visible()
            check('a link with a styled word opens its form: both runs and the address, in one block', await pop.locator('.cblock.link textarea.crun').count() == 2 and await pop.locator('input[aria-label="Address"]').input_value() == '/more')
            await pg.keyboard.press('Escape')

            # --- an input
            await f.locator('#email').dblclick()
            await pop.locator('input[aria-label="Placeholder"]').fill('Work email')
            await pop.locator('input[aria-label="Placeholder"]').press('Enter')
            check('an input\'s placeholder is editable', await wait_for(lambda: 'placeholder="Work email"' in src()))
            await pg.keyboard.press('Escape')

            # --- a card expands into its parts
            await f.locator('#card').dblclick(position={'x': 6, 'y': 6})
            await expect(pop).to_be_visible()
            check('a card expands into the parts it holds, in reading order', await pop.locator('textarea.crun').count() == 3 and await pop.locator('textarea.crun').nth(0).input_value() == 'Pro plan')
            await pop.locator('textarea.crun').nth(2).fill('Start free trial')
            await pop.locator('textarea.crun').nth(2).press('Enter')
            check('a part of the card is retyped from the form', await wait_for(lambda: '>Start free trial</button>' in src()))
            await pop.locator('textarea.crun').nth(0).hover()
            await pg.wait_for_timeout(300)
            check('the part under the pointer is outlined on the artboard', 'border:1px solid' in await f.locator('div[aria-hidden="true"]').first.inner_html())
            await pg.keyboard.press('Escape')

            # --- values that come from the template
            await f.locator('#brand').dblclick()
            await expect(pop).to_be_visible()
            check('a picture shown by a text tweak says so', await pop.get_by_text('Set by the tweak “brand”').count() == 1)
            await pop.get_by_role('button', name='Replace…').click()
            await pop.locator('.cpicker .tile[title="uploads/b.png"]').click()
            check('choosing a picture changes the tweak, not the template', await wait_for(lambda: '"brand":{"default":"uploads/b.png"}' in src()) and 'src="{{brand}}"' in src())
            await pg.keyboard.press('Escape')
            await f.locator('#shot').dblclick()
            await expect(pop).to_be_visible()
            check('a picture fed by the script is read-only and says why', await pop.get_by_text('Comes from the artboard’s script').count() == 1 and await pop.locator('input[aria-label="Source"]').evaluate('e => e.readOnly || e.disabled || e.closest(".ro") !== null'))
            await pg.keyboard.press('Escape')

            # --- nothing to edit, locked
            await f.locator('#plain').dblclick()
            await expect(pg.get_by_text('nothing to edit by hand')).to_be_visible()
            check('an element with nothing to edit says so', await pop.count() == 0)
            await f.locator('#kept').dblclick()
            await expect(pg.get_by_text('This element is locked').first).to_be_visible()
            check('a locked element says so and does not open', await pop.count() == 0)

            # --- the Properties panel carries the same form; Enter opens it
            await pg.mouse.click(5, 5)
            await f.locator('#logo').click()
            await pg.wait_for_timeout(400)
            sec = pg.locator('.panel .sec.content')
            check('the Properties panel has a Content section for a picture', await sec.count() == 1 and await sec.locator('input[aria-label="Source"]').count() == 1)
            await sec.locator('input[aria-label="Alt text"]').fill('Logo again')
            await sec.locator('input[aria-label="Alt text"]').press('Enter')
            check('and it edits the same attributes', await wait_for(lambda: 'alt="Logo again"' in src()))
            await pg.mouse.click(5, 5)
            await f.locator('#logo').click()
            await pg.keyboard.press('Enter')
            await expect(pop).to_be_visible()
            check('Enter on a selected picture opens its form', True)
            await pg.keyboard.press('Escape')
            await f.locator('h3').click()
            await pg.wait_for_timeout(300)
            check('text that can be retyped in place gets no Content section', await pg.locator('.panel .sec.content').count() == 0)

            # --- slides share the form
            await pg.goto(BASE + f'/?p={DECK_NAME}')
            await pg.wait_for_timeout(2500)
            sf = pg.frame_locator('.stage iframe').first
            await sf.locator('#pic').dblclick()
            await expect(pop).to_be_visible()
            await pop.locator('input[aria-label="Alt text"]').fill('New')
            await pop.locator('input[aria-label="Alt text"]').press('Enter')
            slide = os.path.join(DECK_DIR, 'slides', 's1.html')
            check('a slide\'s picture opens the same form and writes its alt', await wait_for(lambda: 'alt="New"' in open(slide, encoding='utf-8').read()))
            await b.close()
        bad = [n for n, ok in results if not ok]
        print(f'\n{len(results) - len(bad)}/{len(results)} passed' + (f'; errors: {errs[:3]}' if errs else ''))
        raise SystemExit(1 if bad or errs else 0)
    finally:
        for d in (DIR, DECK_DIR): shutil.rmtree(d, ignore_errors=True)

asyncio.run(main())
