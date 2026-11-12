"""End-to-end checks for deleting: a whole project (the launcher's trash, Undo, Restore, Delete forever) and a page
inside one (a canvas artboard, a doc tab, a motion scene, a slide: the Delete key, Undo, the last one stays).
Uses only projects this suite makes (zz-del-*). Run with `pnpm dev` up: python3 e2e/delete.py"""
import os, json, time, asyncio, subprocess, urllib.request
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')
PROJECTS = os.path.join(REPO, 'projects')
TRASH = os.path.join(PROJECTS, '.trash')
MADE = ['zz-del-a', 'zz-del-a-2', 'zz-del-b', 'zz-del-canvas', 'zz-del-doc', 'zz-del-motion']

def sweep():
    for n in MADE: subprocess.run(['rm', '-rf', os.path.join(PROJECTS, n)])
    if os.path.isdir(TRASH):
        for d in os.listdir(TRASH):
            if d.startswith('zz-del-'): subprocess.run(['rm', '-rf', os.path.join(TRASH, d)])
    gf = os.path.join(PROJECTS, '.groups.json')
    if os.path.exists(gf):
        kept = {k: v for k, v in json.load(open(gf, encoding='utf-8')).items() if k not in MADE}
        if kept: json.dump(kept, open(gf, 'w', encoding='utf-8'))
        else: os.remove(gf)

def api(method, path, body=None):
    req = urllib.request.Request(BASE + '/api/' + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

def make(name, kind): return api('POST', 'projects', {'name': name, 'title': name, 'kind': kind})
def trashed(): return sorted(d for d in os.listdir(TRASH) if d.startswith('zz-del-') and os.path.isdir(os.path.join(TRASH, d))) if os.path.isdir(TRASH) else []
def exists(*parts): return os.path.exists(os.path.join(PROJECTS, *parts))
def readj(*parts): return json.load(open(os.path.join(PROJECTS, *parts), encoding='utf-8'))

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
    os.makedirs(OUT, exist_ok=True)
    sweep()
    for n, k in (('zz-del-a', 'design'), ('zz-del-b', 'docs'), ('zz-del-canvas', 'design'), ('zz-del-doc', 'docs'), ('zz-del-motion', 'motion')): make(n, k)
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'fonts.g' not in m.text and errs.append(m.text))

        # --- a whole project: the launcher ---------------------------------------------------------------
        await pg.goto(BASE + '/')
        await pg.locator('.lcard[data-project="zz-del-a"]').wait_for()
        before = open(os.path.join(PROJECTS, 'zz-del-a', 'canvas.json'), encoding='utf-8').read()
        await pg.locator('[data-more="zz-del-a"]').click()
        check('a project made here offers Move to trash in its menu', await pg.locator('.menu .mi.danger', has_text='Move to trash').count() == 1)
        await pg.screenshot(path=OUT + 'delete-menu.png')
        await pg.locator('.menu .mi', has_text='Move to trash').click()
        await expect(pg.locator('.lcard[data-project="zz-del-a"]')).to_have_count(0)
        check('the card leaves the launcher at once, with nothing asked', True)
        check('the folder moved into the trash, whole', not exists('zz-del-a') and len(trashed()) == 1 and os.path.exists(os.path.join(TRASH, trashed()[0], 'canvas.json')), str(trashed()))
        await expect(pg.locator('.toast')).to_contain_text('Moved “zz-del-a” to the trash')
        await pg.screenshot(path=OUT + 'delete-toast.png')
        await pg.locator('.toast-act').click()
        await pg.locator('.lcard[data-project="zz-del-a"]').wait_for()
        check('Undo in the toast brings the project back unchanged', exists('zz-del-a') and not trashed() and open(os.path.join(PROJECTS, 'zz-del-a', 'canvas.json'), encoding='utf-8').read() == before)

        # recently deleted: restore, and a name taken meanwhile
        api('PATCH', 'projects/zz-del-a', {'group': 'Del group'})
        await pg.reload()
        await pg.locator('[data-more="zz-del-a"]').click()
        await pg.locator('.menu .mi', has_text='Move to trash').click()
        await expect(pg.locator('[data-trash-open]')).to_be_visible()
        await expect(pg.locator('[data-trash-open] .n')).to_have_text('1')
        check('Recently deleted appears with a count once something is in the trash', True)
        await pg.locator('[data-trash-open]').click()
        dlg = pg.locator('.trashdlg')
        await expect(dlg.locator('[data-trashed="zz-del-a"]')).to_be_visible()
        await pg.screenshot(path=OUT + 'delete-trash.png')
        await dlg.locator('[data-restore="zz-del-a"]').click()
        await pg.locator('.lcard[data-project="zz-del-a"]').wait_for()
        check('Restore puts it back (and the dialog closes when the trash is empty)', exists('zz-del-a') and not trashed() and await pg.locator('.trashdlg').count() == 0)
        status, groups = api('GET', 'projects')
        check('its launcher group comes back with it', next(c for c in groups if c['name'] == 'zz-del-a').get('group') == 'Del group')

        await pg.locator('[data-more="zz-del-a"]').click()
        await pg.locator('.menu .mi', has_text='Move to trash').click()
        await expect(pg.locator('.lcard[data-project="zz-del-a"]')).to_have_count(0)
        make('zz-del-a', 'design')
        await pg.reload()
        await pg.locator('[data-trash-open]').click()
        await pg.locator('.trashdlg [data-restore="zz-del-a"]').click()
        await pg.locator('.lcard[data-project="zz-del-a-2"]').wait_for()
        check('Restore never overwrites: a name in use is restored under the next free one', exists('zz-del-a') and exists('zz-del-a-2'))

        # delete forever asks; cancelling keeps it
        await pg.locator('[data-more="zz-del-b"]').click()
        await pg.locator('.menu .mi', has_text='Move to trash').click()
        await expect(pg.locator('.lcard[data-project="zz-del-b"]')).to_have_count(0)
        await pg.locator('[data-trash-open]').click()
        await pg.locator('.trashdlg [data-forever="zz-del-b"]').click()
        await expect(pg.locator('.confirmdlg')).to_contain_text('Delete “zz-del-b” forever?')
        await pg.locator('.confirmdlg .btn.outline').click()
        check('Delete forever asks first, and Cancel keeps the project in the trash', len(trashed()) == 1)
        await pg.locator('.trashdlg [data-forever="zz-del-b"]').click()
        await pg.locator('.confirmdlg .btn.danger').click()
        ok = await wait_for(lambda: not trashed())
        check('confirmed, Delete forever removes it from the disk', ok)
        await expect(pg.locator('.trashdlg')).to_have_count(0)
        status, _ = api('DELETE', 'projects/zz-del-nothing')
        check('deleting a project that does not exist is a 404', status == 404, str(status))
        status, _ = api('POST', 'trash/not-there/restore')
        check('restoring something that is not in the trash is a 404', status == 404, str(status))

        # --- a page inside a project ---------------------------------------------------------------------
        # canvas: the last artboard stays
        await pg.goto(BASE + '/?p=zz-del-canvas')
        await pg.locator('.layers .lr').first.wait_for()
        boards = list(readj('zz-del-canvas', 'canvas.json')['boards'])
        check('a new canvas starts with one artboard', len(boards) == 1, str(boards))
        await pg.locator(f'.layers .lr[data-key="{boards[0]}"]').click()
        await pg.keyboard.press('Delete')
        await expect(pg.locator('.toast')).to_contain_text('A canvas needs at least one artboard')
        await pg.wait_for_timeout(600)
        check('the last artboard cannot be deleted (Delete key)', exists('zz-del-canvas', boards[0]) and list(readj('zz-del-canvas', 'canvas.json')['boards']) == boards)

        # docs: Delete on a focused tab, Undo, the last tab stays
        await pg.goto(BASE + '/?p=zz-del-doc')
        await pg.locator('.tabrow').first.wait_for()
        await pg.locator('.addtab').click()
        await expect(pg.locator('.tabrow')).to_have_count(2)
        tabs = [t['id'] for t in readj('zz-del-doc', 'doc.json')['tabs']]
        check('two tabs to start', len(tabs) == 2, str(tabs))
        second = pg.locator('.tabrow').nth(1).locator('.tabname')
        await second.focus()
        await pg.keyboard.press('Delete')
        await expect(pg.locator('.tabrow')).to_have_count(1)
        ok = await wait_for(lambda: len(readj('zz-del-doc', 'doc.json')['tabs']) == 1)
        check('Delete on a focused tab deletes it, asking nothing', ok)
        await pg.locator('.toast-act').click()
        await expect(pg.locator('.tabrow')).to_have_count(2)
        check('Undo brings the tab back', await wait_for(lambda: len(readj('zz-del-doc', 'doc.json')['tabs']) == 2))
        await pg.locator('.tabrow').nth(1).locator('.tabname').focus()
        await pg.keyboard.press('Backspace')
        await expect(pg.locator('.tabrow')).to_have_count(1)
        await pg.locator('.tabrow').first.locator('.tabname').focus()
        await pg.keyboard.press('Delete')
        await expect(pg.locator('.toast').last).to_contain_text('at least one tab')
        check('the last tab stays', await pg.locator('.tabrow').count() == 1)

        # motion: a selected scene
        await pg.goto(BASE + '/?p=zz-del-motion')
        await pg.locator('.mscene').first.wait_for()
        n0 = len(readj('zz-del-motion', 'motion.json')['order'])
        await pg.locator('.mscene').first.click(button='right')
        await pg.get_by_role('menuitem', name='Duplicate').click()
        await expect(pg.locator('.mscene')).to_have_count(n0 + 1)
        await pg.locator('.mscene').nth(1).click()
        await pg.keyboard.press('Delete')
        await expect(pg.locator('.mscene')).to_have_count(n0)
        ok = await wait_for(lambda: len(readj('zz-del-motion', 'motion.json')['order']) == n0)
        check('Delete on the selected scene deletes it', ok)
        await pg.locator('.toast-act').click()
        await expect(pg.locator('.mscene')).to_have_count(n0 + 1)
        check('Undo brings the scene back', await wait_for(lambda: len(readj('zz-del-motion', 'motion.json')['order']) == n0 + 1))

        check('no page errors', not errs, '; '.join(errs[:3]))
        await b.close()
    sweep()
    bad = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(bad)}/{len(results)} checks passed')
    raise SystemExit(1 if bad else 0)

asyncio.run(main())
