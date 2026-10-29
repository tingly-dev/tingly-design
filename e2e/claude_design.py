"""End-to-end checks for Claude Design packages, the original Claude types' files: canvas, slides, design system and
dashboard menus offer "Claude Design package (.zip)" just before the whole-project items (docs and motion do not);
the zip holds the original layout (project/… or the dashboard's store documents) and a README for Claude Code; a
package made by hand the way Claude Code saves an original artifact (pictures as /_blob ids beside project/) opens
from the launcher's Import a project as the matching kind, named after its title, with its pictures brought into
uploads/; a Claude Docs .md opens as a doc; docs and motion are refused by the API in words. English light, then
Chinese dark. Run with `pnpm dev` up: python3 e2e/claude_design.py"""
import os, re, json, asyncio, shutil, io, zipfile, urllib.request, urllib.error
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/claude_design-'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def get(path):
    with urllib.request.urlopen(BASE + path) as r:
        return r.read()

def api(path):
    return json.loads(get(path))

def post_zip(path, data):
    req = urllib.request.Request(BASE + path, data=data, method='POST', headers={'content-type': 'application/zip'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

PROJECTS = os.path.join(REPO, 'projects')
THERE = set(os.listdir(PROJECTS))

def restore():
    for name in set(os.listdir(PROJECTS)) - THERE:
        if os.path.isdir(os.path.join(PROJECTS, name)): shutil.rmtree(os.path.join(PROJECTS, name))

KINDS = {'canvas': 'tingly-box-console-canvas', 'slides': 'tingly-design-intro-slides', 'design system': 'tingly-design-system', 'dashboard': 'tingly-box-usage-dashboard'}
NO = {'docs': 'tingly-design-guide-doc', 'motion': 'design-motion'}

PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300090402b6c4a6f60000000049454e44ae426082')
ID = 'a1' * 16

def made_by_hand():
    """What Claude Code leaves in a folder after reading an original canvas: project/ and the asset named by its id."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('abc123/project/canvas.json', json.dumps({'v': 3, 'title': 'Spring menu poster', 'launch': {'view': 'canvas'}, 'boards': {'Main.dc.html': {'x': 0, 'y': 0, 'w': 800, 'h': 500}}, 'order': ['Main.dc.html'], 'notes': {}, 'pages': [], 'designSystems': []}))
        z.writestr('abc123/project/Main.dc.html', '<!doctype html><html><head><meta charset="utf-8"><title>Main</title></head><body><x-dc><div style="width:800px;height:500px;background:#fff7e8;padding:40px;font:32px sans-serif">Spring menu <img src="/_blob/%s" style="width:120px"></div></x-dc></body></html>' % ID)
        z.writestr('abc123/assets/%s.png' % ID, PNG)
        z.writestr('abc123/index.html', '<html></html>')
    return buf.getvalue()

async def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    try:
        # --- the files, through the API ---------------------------------------------------------------
        z = zipfile.ZipFile(io.BytesIO(get('/api/projects/tingly-box-console-canvas/claude-design')))
        names = z.namelist()
        check('canvas: the index and boards sit under project/', 'project/canvas.json' in names and 'project/Main.dc.html' in names, names)
        check('canvas: a README for Claude Code beside project/', 'README.md' in names and b'create a Design artifact' in z.read('README.md'))
        z = zipfile.ZipFile(io.BytesIO(get('/api/projects/tingly-design-intro-slides/claude-design')))
        check('slides: deck.json and slides/ under project/', 'project/deck.json' in z.namelist() and any(n.startswith('project/slides/') for n in z.namelist()))
        z = zipfile.ZipFile(io.BytesIO(get('/api/projects/tingly-design-system/claude-design')))
        check('design system: project/design-system.json and tokens.json', 'project/design-system.json' in z.namelist() and 'project/tokens.json' in z.namelist())
        z = zipfile.ZipFile(io.BytesIO(get('/api/projects/tingly-box-usage-dashboard/claude-design')))
        names = z.namelist()
        check('dashboard: the store documents', 'dash/meta.json' in names and any(n.startswith('datasets/') for n in names) and 'files/index.html' in names, names)
        check('dashboard: attached data under blobs/, no local database', any(n.startswith('blobs/') for n in names) and not any(n.endswith('.db') for n in names), names)
        # a SQLite query's rows go with the package: blobs/<id>.csv, the dataset pointed at it, the call kept in request
        daily = json.loads(z.read('datasets/daily.json'))
        check('dashboard: a query dataset carries its rows as blobs/<id>.csv',
              'blobs/daily.csv' in names and z.read('blobs/daily.csv').decode().startswith('day,requests')
              and daily['source'] == {'kind': 'file', 'url': 'blobs/daily.csv', 'name': 'daily.csv'}
              and daily.get('request', {}).get('args', {}).get('db') == 'data/box.db',
              {'blobs': [n for n in names if n.startswith('blobs/')], 'source': daily.get('source'), 'request': daily.get('request')})
        check('dashboard: both sqlite queries materialized', 'blobs/by_provider.csv' in names, [n for n in names if n.startswith('blobs/')])
        for kind, p in NO.items():
            try:
                get(f'/api/projects/{p}/claude-design')
                check(f'{kind}: refused', False)
            except urllib.error.HTTPError as e:
                check(f'{kind}: refused in words', e.code == 400 and b'Claude Design' in e.read())

        async with async_playwright() as p:
            b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 900}, accept_downloads=True)
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))

            # --- the menus ------------------------------------------------------------------------------
            for kind, project in {**KINDS, **NO}.items():
                await pg.goto(f'{BASE}/?p={project}')
                await pg.wait_for_timeout(3000)
                await pg.locator('button[aria-label="Import / Export"]').first.click()
                menu = pg.get_by_role('menu', name='Import / Export')
                await expect(menu).to_be_visible()
                names = [re.sub(r'\s+', ' ', (await i.inner_text()).split('\n')[0]) for i in await menu.get_by_role('menuitem').all()]
                if kind in KINDS:
                    check(f'{kind}: the Claude Design item sits before the whole-project items', names[-3:] == ['Claude Design package (.zip)', 'Whole project (.zip)', 'Project files only (.zip)'], names)
                else:
                    check(f'{kind}: no Claude Design item', not any('Claude Design' in n for n in names), names)
                if kind == 'slides':
                    await pg.wait_for_timeout(500)
                    await pg.screenshot(path=OUT + 'menu-en-light.png')
                await pg.keyboard.press('Escape')

            # --- saving one ----------------------------------------------------------------------------
            await pg.goto(f'{BASE}/?p=tingly-design-intro-slides')
            await pg.wait_for_timeout(3000)
            await pg.locator('button[aria-label="Import / Export"]').first.click()
            async with pg.expect_download() as dl:
                await pg.get_by_role('menuitem', name='Claude Design package (.zip)').click()
            d = await dl.value
            check('saved under the project name', d.suggested_filename == 'tingly-intro-claude-design.zip', d.suggested_filename)
            await pg.wait_for_timeout(500)
            check('a toast says it was saved', await pg.get_by_text('Saved tingly-intro-claude-design.zip', exact=False).count() >= 1)

            # --- opening one made the way Claude Code leaves an original canvas ------------------------------
            await pg.goto(f'{BASE}/')
            await pg.wait_for_timeout(2000)
            hand = OUT + 'Spring.zip'
            open(hand, 'wb').write(made_by_hand())
            await pg.locator('button[data-new-menu]').click()
            await pg.wait_for_timeout(500)
            await pg.screenshot(path=OUT + 'launcher-en-light.png')
            async with pg.expect_file_chooser() as fc:
                await pg.get_by_role('menuitem', name='Import a project package (.zip)…').click()
            await (await fc.value).set_files(hand)
            await pg.wait_for_url(re.compile(r'\?p=Spring-menu-poster'), timeout=10000)
            check('named after its title and opened', 'p=Spring-menu-poster' in pg.url, pg.url)
            await pg.wait_for_timeout(3000)
            up = os.path.join(PROJECTS, 'Spring-menu-poster', 'uploads')
            check('the picture came into uploads/', os.path.isdir(up) and any(f.startswith(ID) for f in os.listdir(up)), os.listdir(os.path.join(PROJECTS, 'Spring-menu-poster')))
            check('the artboard points at it', ('uploads/' + ID) in open(os.path.join(PROJECTS, 'Spring-menu-poster', 'Main.dc.html')).read())
            await pg.screenshot(path=OUT + 'imported-en-light.png')

            # --- a Claude Docs Markdown export ---------------------------------------------------------------
            md = os.path.join(os.path.dirname(OUT), 'Quarter-plan.md')
            open(md, 'w').write('# Quarter plan\n\nShip the **Claude Design** import.\n')
            await pg.goto(f'{BASE}/')
            await pg.wait_for_timeout(2000)
            await pg.locator('button[data-new-menu]').click()
            async with pg.expect_file_chooser() as fc:
                await pg.get_by_role('menuitem', name='Import Markdown (.md)…').click()
            await (await fc.value).set_files(md)
            await pg.wait_for_url(re.compile(r'\?p=Quarter-plan'), timeout=10000)
            await pg.wait_for_timeout(2500)
            check('a Markdown export opens as a doc', await pg.get_by_text('Ship the').count() >= 1)

            # --- a zip with nothing in it ------------------------------------------------------------------
            bad = OUT + 'nothing.zip'
            with zipfile.ZipFile(bad, 'w') as zf:
                zf.writestr('notes.txt', 'hello')
            await pg.goto(f'{BASE}/')
            await pg.wait_for_timeout(2000)
            await pg.locator('button[data-new-menu]').click()
            async with pg.expect_file_chooser() as fc:
                await pg.get_by_role('menuitem', name='Import a project package (.zip)…').click()
            await (await fc.value).set_files(bad)
            await expect(pg.get_by_text('Claude Design package', exact=False).first).to_be_visible()
            check('a zip with nothing is refused in words', True)

            # --- Chinese, dark ---------------------------------------------------------------------------------
            zh = await b.new_context(locale='zh-CN', color_scheme='dark', viewport={'width': 1440, 'height': 900})
            zp = await zh.new_page()
            await zp.goto(f'{BASE}/?p=tingly-box-console-canvas')
            await zp.wait_for_timeout(3000)
            await zp.locator('button[aria-label="导入 / 导出"]').first.click()
            menu = zp.get_by_role('menu', name='导入 / 导出')
            await expect(menu.get_by_role('menuitem', name='Claude Design 包（.zip）')).to_be_visible()
            check('zh: the menu reads Claude Design 包', True)
            await zp.wait_for_timeout(500)
            await zp.screenshot(path=OUT + 'menu-zh-dark.png')

            check('no page errors', not errs, errs)
            await b.close()
    finally:
        restore()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed:
        print('FAILED:', failed)
        raise SystemExit(1)

asyncio.run(main())
