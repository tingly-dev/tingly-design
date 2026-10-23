"""End-to-end checks for projects kept outside the projects folder. Run with `pnpm dev` up: python3 e2e/folders.py"""
import os, re, asyncio, subprocess, json, shutil, time, urllib.request
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
API = os.environ.get('DC_API', 'http://localhost:8787')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
SHOTS = os.environ.get('DC_SHOTS')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')
TMP = '/tmp/dc-folders-e2e'
SAMPLES = {'box-console': 'design', 'tingly-intro': 'slides', 'tingly-ds': 'design-system', 'box-usage': 'dashboard', 'design-guide': 'docs', 'design-motion': 'motion'}

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

def links():
    f = os.path.join(REPO, 'projects', '.links.json')
    return json.load(open(f)) if os.path.exists(f) else {}

def cleanup():
    for name, path in links().items():
        if path.startswith(TMP): call('DELETE', f'/api/links/{name}')
    shutil.rmtree(TMP, ignore_errors=True)

async def shot(pg, name):
    await pg.screenshot(path=OUT + f'folders-{name}.png')
    if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, f'{name}.png'))

async def main():
    os.makedirs(OUT, exist_ok=True)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    cleanup()
    os.makedirs(TMP)

    # --- every kind opens from a folder elsewhere ----------------------------------------------
    named = {}
    for sample, kind in SAMPLES.items():
        dst = os.path.join(TMP, 'work', f'my {sample}')
        shutil.copytree(os.path.join(REPO, 'projects', sample), dst, ignore=shutil.ignore_patterns('.journal.jsonl', '.runs.json', 'renders'))
        st, r = call('POST', '/api/links', {'path': dst})
        named[kind] = r.get('name')
        check(f'a {kind} folder elsewhere is linked under a name made from its path', st == 200 and re.fullmatch(f'my-{sample}-[0-9a-f]{{6}}', r.get('name', '')) is not None, str(r))
    st, again = call('POST', '/api/links', {'path': os.path.join(TMP, 'work', 'my box-console') + '/'})
    check('linking the same folder again gives the same name', again.get('name') == named['design'], str(again))
    # two folders with the same name are two projects, each named from its own path
    twin = os.path.join(TMP, 'work', 'twin', 'my box-console')
    shutil.copytree(os.path.join(TMP, 'work', 'my box-console'), twin, ignore=shutil.ignore_patterns('.journal.jsonl', '.runs.json', 'renders'))
    st, other = call('POST', '/api/links', {'path': twin})
    check('a folder with the same name as a linked one gets a name of its own', st == 200 and other.get('name') not in (None, named['design']) and other['name'].startswith('my-box-console-'), str(other))
    st, r = call('GET', '/api/resolve/' + named['design'])
    check('a current name resolves to itself', r.get('name') == named['design'], str(r))
    st, r = call('GET', '/api/resolve/box-console')
    check('a name in the projects folder resolves to itself', r.get('name') == 'box-console', str(r))
    st, cards = call('GET', '/api/projects')
    by = {c['name']: c for c in cards}
    check('linked projects are listed with their kind and their folder', all(by.get(n, {}).get('kind') == k and by[n].get('path', '').startswith(TMP) for k, n in named.items()))
    check('projects in the projects folder carry no path', by['box-console'].get('path') is None)
    st, r = call('POST', '/api/links', {'path': TMP})
    check('a folder with no project is refused', st == 404 and r.get('code') == 'noProjectInFolder', str(r))
    st, r = call('POST', '/api/links', {'path': 'work/site'})
    check('a relative path is refused', st == 400 and r.get('code') == 'badFolderPath', str(r))

    # --- writes land in the linked folder, outside edits come back ------------------------------
    n = named['docs']
    st, files = call('GET', f'/api/projects/{n}/files')
    tab = next(f for f in files['files'] if f.startswith('tabs/'))
    cur = files['files'][tab]
    st, r = call('PUT', f'/api/projects/{n}/file?path={tab}', {'content': cur['content'] + '\nWritten from the editor.\n', 'baseVersion': cur['version']})
    on_disk = open(os.path.join(TMP, 'work', 'my design-guide', tab)).read()
    check('a write through the server lands in the linked folder', st == 200 and on_disk.endswith('Written from the editor.\n'), str(r))
    with open(os.path.join(TMP, 'work', 'my design-guide', tab), 'a') as f: f.write('Typed in a terminal.\n')
    seen = False
    for _ in range(30):
        await asyncio.sleep(0.2)
        st, j = call('GET', f'/api/projects/{n}/journal')
        if any(e.get('actor') == 'external' and e.get('file') == tab for e in j): seen = True; break
    check('an outside edit in a linked folder is seen by the watcher', seen)

    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        for lang, scheme in (('zh-CN', 'light'), ('en-US', 'dark')):
            ctx = await b.new_context(locale=lang, viewport={'width': 1440, 'height': 900}, color_scheme=scheme)
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            tag = f"{lang[:2]}-{scheme}"
            await pg.goto(BASE + '/')
            await pg.locator('.lcard[data-project]').first.wait_for()
            if lang == 'zh-CN':
                for kind, name in named.items():
                    await pg.goto(BASE + f'/?p={name}')
                    await pg.locator('header.topbar').wait_for(timeout=15000)
                    check(f'the linked {kind} project opens in its editor', await pg.locator('header.topbar').count() == 1)
                await pg.goto(BASE + '/')
                await pg.locator('.lcard[data-project]').first.wait_for()
            card = pg.locator(f'.lcard[data-project="{named["design"]}"] .lpath')
            await expect(card).to_contain_text('/tmp/dc-folders-e2e/work/my box-console')
            check(f'[{tag}] a linked card shows its real folder', True)
            await pg.locator(f'.lcard[data-project="{named["design"]}"]').scroll_into_view_if_needed()
            await pg.wait_for_timeout(2500)
            await shot(pg, f'card-{tag}')

            # --- open a folder ----------------------------------------------------------------
            target = os.path.join(TMP, f'brand-motion-{lang[:2]}')
            shutil.copytree(os.path.join(REPO, 'projects', 'design-motion'), target, ignore=shutil.ignore_patterns('.journal.jsonl', 'renders'))
            await pg.locator('.lnewbtn').click()
            news = await pg.locator('.menu [data-new]').evaluate_all('cs => cs.map(c => c.dataset.new)')
            check(f'[{tag}] the New project menu ends with open a folder', news[-1] == 'folder', str(news))
            await pg.locator('.menu [data-new="folder"] [role=menuitem], .menu [data-new="folder"] button').first.click()
            dlg = pg.locator('.ldialog.lopen')
            await dlg.wait_for()
            await dlg.locator('input').fill('work/site')
            await expect(dlg.locator('.folder-state')).not_to_be_empty()
            check(f'[{tag}] a relative path asks for a full one', await dlg.locator('button[type=submit]').is_disabled())
            await dlg.locator('input').fill(target)
            await expect(dlg.locator('.folder-state[data-state="project"]')).to_be_visible()
            await shot(pg, f'open-found-{tag}')
            await dlg.locator('button[type=submit]').click()
            await pg.wait_for_url('**/?p=brand-motion-*')
            await pg.locator('header.topbar').wait_for()
            check(f'[{tag}] Open adds the folder and opens the project', any(v == target for v in links().values()))

            # --- a folder with no project leads to New project, aimed there -------------------
            await pg.goto(BASE + '/')
            await pg.locator('.lcard[data-project]').first.wait_for()
            fresh = os.path.join(TMP, f'site {lang[:2]}', 'design')
            await pg.locator('.lnewbtn').click()
            await pg.locator('.menu [data-new="folder"] [role=menuitem], .menu [data-new="folder"] button').first.click()
            dlg = pg.locator('.ldialog.lopen')
            await dlg.locator('input').fill(fresh)
            await expect(dlg.locator('.folder-state[data-state="free"]')).to_be_visible()
            await dlg.locator('button[type=submit]').click()
            nd = pg.locator('.ldialog[aria-label]:not(.lopen)')
            await nd.wait_for()
            await nd.locator('[role=radio][data-kind="docs"]').click()
            await nd.locator('input').first.fill('Site notes' if lang == 'en-US' else '站点笔记')
            await expect(nd.locator('.where-hint')).to_contain_text(os.path.basename(os.path.dirname(fresh)))
            check(f'[{tag}] New project opens with the folder filled in and says where it will go', await nd.locator('.folder .input').input_value() == fresh)
            await shot(pg, f'new-at-path-{tag}')
            await nd.locator('button[type=submit]').click()
            await pg.wait_for_url('**/?p=design*')
            await pg.locator('header.topbar').wait_for()
            check(f'[{tag}] the new doc is written into that folder', os.path.exists(os.path.join(fresh, 'doc.json')))

            # --- a busy folder is refused before creating -------------------------------------
            await pg.goto(BASE + '/')
            await pg.locator('.lcard[data-project]').first.wait_for()
            busy = os.path.join(TMP, 'busy')
            os.makedirs(busy, exist_ok=True)
            open(os.path.join(busy, 'notes.txt'), 'w').write('x')
            await pg.locator('.lnewbtn').click()
            await pg.locator('.menu [data-new="design"] [role=menuitem], .menu [data-new="design"] button').first.click()
            nd = pg.locator('.ldialog')
            await nd.locator('.where .linkish').click()
            await nd.locator('.folder .input').fill(busy)
            await expect(nd.locator('.problem.on')).to_be_visible()
            check(f'[{tag}] a folder with other files in it is refused', await nd.locator('button[type=submit]').is_disabled())
            check(f'[{tag}] the projects/ prefix leaves when a full path is typed', await nd.locator('.folder .pre').count() == 0)
            await nd.locator('.folder .input').fill('plain-name')
            check(f'[{tag}] a plain name keeps the projects/ prefix', await nd.locator('.folder .pre').count() == 1)
            await pg.keyboard.press('Escape')

            # --- remove from list, undo ------------------------------------------------------
            if lang == 'zh-CN':
                name = named['dashboard']
                await pg.locator(f'[data-more="{name}"]').click()
                await pg.locator('.menu').get_by_text('从列表移除').click()
                await expect(pg.locator(f'.lcard[data-project="{name}"]')).to_have_count(0)
                check('remove from list takes the card away and keeps the folder', name not in links() and os.path.exists(os.path.join(TMP, 'work', 'my box-usage', 'dash.json')))
                await pg.locator('.toast button, .toasts button').first.click()
                await expect(pg.locator(f'.lcard[data-project="{name}"]')).to_have_count(1)
                check('undo lists it again', name in links())
                await pg.locator(f'[data-more="box-console"]').click()
                check('a project in the projects folder has no remove from list', await pg.locator('.menu').get_by_text('从列表移除').count() == 0)
                await pg.keyboard.press('Escape')
            check(f'[{tag}] no page errors', not errs, str(errs[:3]))
            await ctx.close()
        await b.close()
    cleanup()
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed: raise SystemExit(1)

asyncio.run(main())
