"""End-to-end checks for the canvas's files pane: the folder listed live, previews, copy path, put on canvas. Run with `pnpm dev` up: python3 e2e/files.py"""
import os, base64, inspect, asyncio, subprocess, time
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read(path): return open(os.path.join(REPO, 'projects', path), encoding='utf-8').read()
def restore():
    subprocess.run(['git', 'checkout', '--', 'projects'], cwd=REPO)
    subprocess.run(['git', 'clean', '-fdq', '--', 'projects'], cwd=REPO)
def write(path, text):
    p = os.path.join(REPO, 'projects', path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(text)

async def wait_for(pred, timeout=8.0):
    t = time.time()
    while time.time() - t < timeout:
        try:
            r = pred()
            if inspect.isawaitable(r): r = await r
            if r: return True
        except Exception: pass
        await asyncio.sleep(0.1)
    return False

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

# a 1x1 png, enough for the pane's thumbnail and a note
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')

async def main():
    restore()
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': os.environ['DC_CHROME']} if os.environ.get('DC_CHROME') else {}))
        ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 900})
        await ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        pg = await ctx.new_page()

        # --- the listing ----------------------------------------------------------------
        await pg.goto(BASE + '/?p=tingly-box-console-canvas')
        await pg.wait_for_timeout(2500)
        await pg.locator('[data-pane="files"]').click()
        pane = pg.locator('.filespane')
        await expect(pane).to_be_visible()
        await expect(pane.locator('.frow', has_text='canvas.json')).to_be_visible()
        check('canvas: the pane lists the project folder', await pane.locator('.frow', has_text='Main.dc.html').count() >= 1)
        text = await pane.inner_text()
        check('canvas: dot files are never listed', 'journal' not in text and '.claude' not in text and '.transcript' not in text)

        # --- a file a tool just wrote shows up live ---------------------------------------
        async def pane_has(s): return s in await pane.inner_text()
        async def row_there(): return await row.count() >= 1
        write('tingly-box-console-canvas/notes.txt', 'hello from the terminal\n')
        ok = await wait_for(lambda: pane_has('notes.txt'))
        check('canvas: a file written beside the editor shows up live', ok)

        # --- preview: text, read only ------------------------------------------------------
        await pane.locator('.frow', has_text='notes.txt').locator('.fname').click()
        dialog = pg.locator('.ldialog.files-preview')
        await expect(dialog).to_be_visible()
        try:
            await expect(dialog.locator('pre')).to_contain_text('hello from the terminal', timeout=8000)
            ok = True
        except AssertionError:
            ok = False
        check('canvas: a text file previews read only', ok)
        await pg.keyboard.press('Escape')
        await expect(dialog).to_have_count(0)

        # --- an image in uploads/: thumbnail, menu, put on canvas ---------------------------
        r = await ctx.request.post(f'{BASE}/api/projects/tingly-box-console-canvas/assets?name=poster.png&dir=uploads', data=PNG)
        check('canvas: upload for the pane worked', r.ok, str(r.status))
        up = (await r.json())['path']
        row = pane.locator('.frow', has_text='poster-')
        ok = await wait_for(lambda: row_there())
        check('canvas: an upload appears in the list', ok and await row.locator('.fthumb').count() == 1)
        await row.locator('.more').click()
        menu = pg.locator('[role=menu]')
        await expect(menu).to_be_visible()
        check('canvas: an image row offers put on canvas', await menu.get_by_text('Put on canvas').count() == 1)
        await menu.get_by_text('Copy path').click()
        path = await pg.evaluate('navigator.clipboard.readText()')
        check('canvas: copy path copies the folder-relative path', path == up, path)
        await row.locator('.more').click()
        await pg.locator('[role=menu]').get_by_text('Put on canvas').click()
        ok = await wait_for(lambda: up in read('tingly-box-console-canvas/canvas.json') and '"kind": "image"' in read('tingly-box-console-canvas/canvas.json'))
        check('canvas: put on canvas adds the picture as a note by its folder path', ok)

        # --- the read-only entry route ------------------------------------------------------
        r = await ctx.request.get(f'{BASE}/api/projects/tingly-box-console-canvas/entry?path=notes.txt')
        ok = r.ok and 'hello from the terminal' in (await r.text())
        check('server: /entry serves a listed file', ok, str(r.status))
        r = await ctx.request.get(f'{BASE}/api/projects/tingly-box-console-canvas/entry?path=.claude-session.json')
        check('server: /entry refuses internal files', r.status == 400, str(r.status))
        r = await ctx.request.get(f'{BASE}/api/projects/tingly-box-console-canvas/entries')
        listed = [e['path'] for e in (await r.json())['entries']] if r.ok else []
        check('server: /entries lists files with size and mtime and no dot files', r.ok and 'notes.txt' in listed and not any(p.startswith('.') for p in listed) and all('size' in e and 'mtime' in e for e in (await r.json())['entries']), str(listed))

        restore()
        await b.close()
    bad = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    raise SystemExit(1 if bad else 0)

asyncio.run(main())
