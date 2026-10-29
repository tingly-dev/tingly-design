"""End-to-end checks for exporting a whole project as one .zip and importing it again: every kind's Import / Export
menu ends with "Whole project (.zip)" and "Project files only (.zip)"; the whole project of a deck carries its
change log and the design system it installed, beside it, with a manifest; the files-only one carries neither and
no local state; the launcher's New menu imports the .zip as a new project under a free name and opens it; the
launcher card⋯ exports too; dropping a .zip or a CSV on the launcher (and the New menu's table item) opens a project or a dashboard; a .zip with no project is refused in words. English light, then Chinese dark.
Run with `pnpm dev` up: python3 e2e/archive.py"""
import os, re, json, asyncio, shutil, subprocess, zipfile, urllib.request
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/archive-'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def api(path, body=None, method=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), method=method, headers={'content-type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

KINDS = {'canvas': 'tingly-box-console-canvas', 'slides': 'tingly-design-intro-slides', 'design system': 'tingly-design-system', 'dashboard': 'tingly-box-usage-dashboard', 'docs': 'tingly-design-guide-doc', 'motion': 'design-motion'}

PROJECTS = os.path.join(REPO, 'projects')
THERE = set(os.listdir(PROJECTS))  # what was there before; anything new is a project this suite imported

def restore():
    """The deck as committed, without the design system this suite installs, and no project it imported."""
    subprocess.run(['git', 'checkout', '--', 'projects/tingly-design-intro-slides'], cwd=REPO)
    subprocess.run(['git', 'clean', '-fdq', '--', 'projects/tingly-design-intro-slides'], cwd=REPO)
    for name in set(os.listdir(PROJECTS)) - THERE:
        if os.path.isdir(os.path.join(PROJECTS, name)): shutil.rmtree(os.path.join(PROJECTS, name))

async def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    api('/api/projects/tingly-design-intro-slides/design-systems', {'from': 'tingly-design-system'}, 'POST')
    before = {p['name'] for p in api('/api/projects')}
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))

        # --- the same two items in every kind --------------------------------------------------------
        for kind, project in KINDS.items():
            await pg.goto(f'{BASE}/?p={project}')
            await pg.wait_for_timeout(3000)
            await pg.locator('button[aria-label="Import / Export"]').first.click()
            menu = pg.get_by_role('menu', name='Import / Export')
            await expect(menu).to_be_visible()
            names = [re.sub(r'\s+', ' ', (await i.inner_text()).split('\n')[0]) for i in await menu.get_by_role('menuitem').all()]
            check(f'{kind}: the menu ends with the whole project', names[-2:] == ['Whole project (.zip)', 'Project files only (.zip)'], names)
            if kind == 'slides':
                await pg.screenshot(path=OUT + 'menu-en-light.png')
            await pg.keyboard.press('Escape')

        # --- whole project and files only -----------------------------------------------------------
        await pg.goto(f'{BASE}/?p=tingly-design-intro-slides')
        await pg.wait_for_timeout(3000)
        saved = {}
        for label in ('Whole project (.zip)', 'Project files only (.zip)'):
            await pg.locator('button[aria-label="Import / Export"]').first.click()
            async with pg.expect_download() as dl:
                await pg.get_by_role('menuitem', name=label).click()
            d = await dl.value
            path = OUT + d.suggested_filename
            await d.save_as(path)
            saved[label] = path
            names = zipfile.ZipFile(path).namelist()
            if label.startswith('Whole'):
                man = json.loads(zipfile.ZipFile(path).read('tingly-design.json'))
                check('whole: named after the project', d.suggested_filename == 'tingly-design-intro-slides.zip', d.suggested_filename)
                check('whole: a manifest naming the project and its system', man['project'] == 'tingly-design-intro-slides' and man['kind'] == 'slides' and man['systems'] == ['tingly-design-system'], man)
                check('whole: the change log goes in', 'tingly-design-intro-slides/.journal.jsonl' in names)
                check('whole: the design system beside it', 'tingly-design-system/design-system.json' in names and 'tingly-design-system/tokens.json' in names)
            else:
                check('files only: no change log, no system', not any(n.endswith('.journal.jsonl') for n in names) and not any(n.startswith('tingly-design-system/') for n in names), names)
                check('files only: the installed tokens stay (the deck draws with them)', any(n.startswith('tingly-design-intro-slides/ds/') for n in names), names)
            check(f'{label}: no local state', not any(re.search(r'(^|/)(\.git|renders|\.runs\.json)', n) for n in names), names)
        await pg.wait_for_timeout(500)
        check('a toast says it was saved', await pg.get_by_text('Saved tingly-design-intro-slides', exact=False).count() >= 1)

        # --- import from the launcher ---------------------------------------------------------------
        await pg.goto(f'{BASE}/')
        await pg.wait_for_timeout(2000)
        await pg.locator('button[data-new-menu]').click()
        item = pg.get_by_role('menuitem', name='Import a project package (.zip)…')
        await expect(item).to_be_visible()
        await pg.screenshot(path=OUT + 'launcher-en-light.png')
        async with pg.expect_file_chooser() as fc:
            await item.click()
        await (await fc.value).set_files(saved['Whole project (.zip)'])
        await pg.wait_for_url(re.compile(r'\?p=tingly-intro-2'), timeout=10000)
        check('import: opens the project under a free name', 'p=tingly-intro-2' in pg.url, pg.url)
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=OUT + 'imported-en-light.png')
        after = {p['name'] for p in api('/api/projects')}
        check('import: the unchanged system is not duplicated', after - before == {'tingly-intro-2'}, after - before)
        check('import: slides came along', len(api('/api/projects/tingly-intro-2/files')['files']) >= 9)

        # --- the launcher card's ⋯ -------------------------------------------------------------------
        await pg.goto(f'{BASE}/')
        await pg.wait_for_timeout(2000)
        more = pg.locator('button[data-more="tingly-intro-2"]').first
        await more.scroll_into_view_if_needed()
        if await more.count():
            await more.click()
            item = pg.get_by_role('menuitem', name='Export (.zip)')
            check('launcher ⋯: offers Export (.zip)', await item.count() == 1)
            if await item.count():
                async with pg.expect_download() as dl:
                    await item.click()
                check('launcher ⋯: saves the .zip', (await dl.value).suggested_filename.endswith('.zip'))

        # --- a .zip with no project -----------------------------------------------------------------
        bad = OUT + 'nothing.zip'
        with zipfile.ZipFile(bad, 'w') as z:
            z.writestr('notes.txt', 'hello')
        await pg.locator('button[data-new-menu]').click()
        async with pg.expect_file_chooser() as fc:
            await pg.get_by_role('menuitem', name='Import a project package (.zip)…').click()
        await (await fc.value).set_files(bad)
        await expect(pg.get_by_text('There is no Tingly Design project or Claude Design package in this .zip', exact=False)).to_be_visible()
        check('import: a zip with no project is refused in words', True)

        # --- dropping a package and a table on the launcher ------------------------------------------
        async def drop_file(name, data, mime):
            await pg.goto(f'{BASE}/')
            await pg.locator('button[data-new-menu]').wait_for()
            transfer = await pg.evaluate_handle("""p => { const t = new DataTransfer(); t.items.add(new File([new Uint8Array(p.bytes)], p.name, {type: p.mime})); return t; }""", {'name': name, 'bytes': list(data), 'mime': mime})
            surface = pg.locator('.launcher')
            await surface.dispatch_event('dragover', {'dataTransfer': transfer})
            await expect(surface).to_have_class(re.compile(r'\bdropping\b'))
            await surface.dispatch_event('drop', {'dataTransfer': transfer})

        await drop_file('dropped-package.zip', open(saved['Project files only (.zip)'], 'rb').read(), 'application/zip')
        await pg.wait_for_url(re.compile(r'\?p=tingly-intro-'), timeout=10000)
        check('drop: a project .zip opens as a new project', 'p=tingly-intro-' in pg.url, pg.url)
        csv = b'month,calls\nJul,1200\nAug,1350\nSep,990\n'
        await drop_file('zz-calls.csv', csv, 'text/csv')
        await pg.wait_for_url(re.compile(r'\?p=zz-calls'), timeout=10000)
        check('drop: a CSV opens as a new dashboard', 'p=zz-calls' in pg.url, pg.url)
        files = [f['path'] if isinstance(f, dict) else f for f in api('/api/projects/zz-calls/files')['files']]
        check('drop: a dataset reads the CSV kept under data/', os.path.exists(os.path.join(PROJECTS, 'zz-calls', 'data', 'zz-calls.csv')) and 'datasets/zz-calls.json' in files, files)
        await pg.wait_for_timeout(2500)
        await pg.screenshot(path=OUT + 'csv-dashboard-en-light.png')
        await drop_file('zz-empty.tsv', b'', 'text/tab-separated-values')
        await expect(pg.get_by_text('zz-empty.tsv', exact=False).first).to_be_visible()
        await pg.wait_for_timeout(500)
        check('drop: a file that is no table says so and makes no project', not os.path.exists(os.path.join(PROJECTS, 'zz-empty')))
        await pg.goto(f'{BASE}/')
        await pg.locator('button[data-new-menu]').click()
        csv_path = os.path.join(os.path.dirname(OUT), 'zz-picked.csv')
        open(csv_path, 'wb').write(csv)
        async with pg.expect_file_chooser() as fc:
            await pg.get_by_role('menuitem', name='Import a table (.csv)…').click()
        await (await fc.value).set_files(csv_path)
        await pg.wait_for_url(re.compile(r'\?p=zz-picked'), timeout=10000)
        check('menu: Import a table (.csv)… makes a dashboard too', 'p=zz-picked' in pg.url, pg.url)
        await pg.goto(f'{BASE}/')
        await pg.wait_for_timeout(1500)
        await pg.locator('button[data-new-menu]').click()
        await pg.screenshot(path=OUT + 'launcher-menu-en-light.png')

        # --- Chinese, dark ---------------------------------------------------------------------------
        zh = await b.new_context(locale='zh-CN', color_scheme='dark', viewport={'width': 1440, 'height': 900})
        zp = await zh.new_page()
        await zp.goto(f'{BASE}/?p=tingly-design-intro-slides')
        await zp.wait_for_timeout(3000)
        await zp.locator('button[aria-label="导入 / 导出"]').first.click()
        menu = zp.get_by_role('menu', name='导入 / 导出')
        await expect(menu.get_by_role('menuitem', name='整个项目（.zip）')).to_be_visible()
        check('zh: the menu reads 整个项目 and 仅项目文件', await menu.get_by_role('menuitem', name='仅项目文件（.zip）').count() == 1)
        await zp.screenshot(path=OUT + 'menu-zh-dark.png')
        await zp.goto(f'{BASE}/')
        await zp.wait_for_timeout(2000)
        await zp.locator('button[data-new-menu]').click()
        await expect(zp.get_by_role('menuitem', name='导入项目包（.zip）…')).to_be_visible()
        await zp.screenshot(path=OUT + 'launcher-zh-dark.png')

        check('no page errors', not errs, errs)
        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed:
        raise SystemExit(1)

restore()
try:
    asyncio.run(main())
finally:
    restore()
