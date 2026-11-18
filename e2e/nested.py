"""End-to-end checks for sub-projects, a project inside a project (.design/sub-projects.md): a project folder directly
inside another project's folder is found by looking and listed under its parent, with a name made from its path and
nothing written to the links file; the parent's files, count, journal, git changes and archive leave it out, and a sub's
own are its own; a sub of a sub; a reserved folder name refused; moving to the trash and back puts it where it was; the
launcher shows the count beside the parent's ⋯ and expands the sub-projects under it; New sub-project… from the card and
from the project menu starts in the parent's folder; the project menu names the parent and the sub-projects; Import
from project lists a sub-project under its parent's name.
Run with `pnpm dev` up: python3 e2e/nested.py (or pnpm e2e nested)"""
import os, re, json, time, shutil, asyncio, zipfile, io, urllib.request, urllib.error
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
CHROME = os.environ.get('DC_CHROME')
SHOTS = os.environ.get('DC_SHOTS')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, 'e2e', 'out') + '/'
PROJECTS = os.path.join(REPO, 'projects')
PARENT = 'zz-nest'
DECK = 'zz-nest-deck'

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def call(method, path, body=None, raw=False):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            data = r.read()
            return r.status, data if raw else json.loads(data or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

def cards(): return {c['name']: c for c in call('GET', '/api/projects')[1]}
def by_path(suffix): return next((c for c in cards().values() if c.get('path', '').endswith(suffix)), None)
def links():
    f = os.path.join(PROJECTS, '.links.json')
    return json.load(open(f)) if os.path.exists(f) else {}
def new_sub(parent_dir, leaf, kind='design', title=None):
    return call('POST', '/api/projects', {'path': os.path.join(parent_dir, leaf), 'title': title or leaf, 'kind': kind})
def put(project, rel, text):
    st, files = call('GET', f'/api/projects/{project}/files')
    cur = files['files'].get(rel)
    return call('PUT', f'/api/projects/{project}/file?path={rel}', {'content': text, 'baseVersion': cur['version'] if cur else None})

def cleanup():
    for d in (PARENT, DECK):
        shutil.rmtree(os.path.join(PROJECTS, d), ignore_errors=True)

async def shot(pg, name):
    await pg.screenshot(path=OUT + f'nested-{name}.png')
    if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, f'{name}.png'))

async def main():
    os.makedirs(OUT, exist_ok=True)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    cleanup()
    before_links = links()

    # --- the parent, and a sub-project made in its folder ----------------------------------------
    st, r = call('POST', '/api/projects', {'name': PARENT, 'title': 'Zz Nest', 'kind': 'design'})
    check('a parent project is made', st == 200 and r.get('name') == PARENT, str(r))
    parent_dir = os.path.join(PROJECTS, PARENT)
    st, before = call('GET', f'/api/projects/{PARENT}/files')
    parent_files = sorted(before['files'])
    pcard = cards()[PARENT]
    st, g0 = call('GET', f'/api/projects/{PARENT}/git')
    st, r = new_sub(parent_dir, 'logo', 'design', 'Logo')
    logo = r.get('name', '')
    check('a project is made inside the parent folder, named from its path', st == 200 and re.fullmatch(r'logo-[0-9a-f]{6}', logo) is not None, str(r))
    check('its folder is inside the parent', os.path.exists(os.path.join(parent_dir, 'logo', 'canvas.json')))
    check('it is not written into the links file', links() == before_links, str(links()))
    card = cards().get(logo, {})
    check('its card says whose it is', card.get('parent') == PARENT and card.get('kind') == 'design' and card.get('title') == 'Logo', str(card))
    check('a top-level project has no parent', 'parent' not in cards()[PARENT])
    st, now = call('GET', f'/api/projects/{PARENT}/files')
    check("the parent's files leave the sub-project's out", sorted(now['files']) == parent_files and not any(f.startswith('logo/') for f in now['files']), str(sorted(now['files'])))
    st, mine = call('GET', f'/api/projects/{logo}/files')
    check("the sub-project's files are its own", st == 200 and 'canvas.json' in mine['files'] and any(f.endswith('.dc.html') for f in mine['files']), str(sorted(mine['files'])))
    check("the parent's card counts only its own boards", cards()[PARENT]['count'] == pcard['count'], f"{cards()[PARENT]['count']} vs {pcard['count']}")

    # --- a sub of a sub, another kind, a reserved folder ----------------------------------------
    st, r = new_sub(os.path.join(parent_dir, 'logo'), 'mark', 'design-system', 'Mark')
    mark = r.get('name', '')
    check('a sub-project of a sub-project is found too', st == 200 and cards().get(mark, {}).get('parent') == logo, str(r))
    st, r = new_sub(parent_dir, 'words', 'docs', 'Words')
    words = r.get('name', '')
    check('any kind can be a sub-project', st == 200 and cards().get(words, {}).get('kind') == 'docs' and cards()[words]['parent'] == PARENT, str(r))
    for leaf, kind in (('deck', 'slides'), ('numbers', 'dashboard'), ('promo', 'motion')):
        st, r = new_sub(parent_dir, leaf, kind, leaf)
        c = cards().get(r.get('name', ''), {})
        check(f'a {kind} can be a sub-project too, opened by its own name', st == 200 and c.get('kind') == kind and c.get('parent') == PARENT and call('GET', f"/api/projects/{r['name']}/files")[0] == 200, str(r))
    st, r = new_sub(parent_dir, 'uploads', 'design')
    check("a folder a project keeps its own files in cannot be a sub-project's", st == 400 and r.get('code') == 'subReserved', str(r))
    check('and leaves no project behind', not os.path.exists(os.path.join(parent_dir, 'uploads', 'canvas.json')))
    st, files = call('GET', f'/api/projects/{PARENT}/files')
    check("the parent's file list never holds a sub's, at any depth", not any(f.startswith(('logo/', 'words/')) for f in files['files']))

    # --- found by looking: a folder made by hand ------------------------------------------------
    shutil.copytree(os.path.join(parent_dir, 'words'), os.path.join(parent_dir, 'notes'), ignore=shutil.ignore_patterns('.*'))
    byhand = by_path('/zz-nest/notes')
    check('a project folder put inside by hand appears without anyone registering it', byhand is not None and byhand['parent'] == PARENT)
    shutil.rmtree(os.path.join(parent_dir, 'notes'))
    check('and goes when the folder does', by_path('/zz-nest/notes') is None)

    # --- editing: the write lands in the sub, the events are the sub's ---------------------------
    st, r = put(logo, 'Extra.dc.html', '<dc-board title="Extra" width="400" height="300"></dc-board>\n')
    check('a file is written into the sub-project', st == 200 and os.path.exists(os.path.join(parent_dir, 'logo', 'Extra.dc.html')) and not os.path.exists(os.path.join(parent_dir, 'Extra.dc.html')), str(r))
    open(os.path.join(parent_dir, 'logo', 'Outside.dc.html'), 'w').write('<dc-board title="Outside" width="400" height="300"></dc-board>\n')
    t = time.time(); seen = []
    while time.time() - t < 8 and not seen:
        time.sleep(0.4)
        seen = [e for e in call('GET', f'/api/projects/{logo}/journal')[1] if e.get('file') == 'Outside.dc.html']
    check("an edit made outside is the sub-project's journal entry", bool(seen))
    check("and not the parent's", not any(e.get('file') == 'Outside.dc.html' for e in call('GET', f'/api/projects/{PARENT}/journal')[1]))
    check("the parent's card still counts only its own boards", cards()[PARENT]['count'] == pcard['count'])

    # --- git: the parent's changes leave the sub-project's out ------------------------------------
    st, g1 = call('GET', f'/api/projects/{PARENT}/git')
    st, gl = call('GET', f'/api/projects/{logo}/git')
    check("the parent's changes do not count the sub-project's files", g1.get('changes') == g0.get('changes'), f'{g0} -> {g1}')
    check("the sub-project's own changes are counted for it", gl.get('changes', 0) >= 2, str(gl))

    # --- archive: a sub-project's zip is its own, the parent's carries it ------------------------
    st, z = call('GET', f'/api/projects/{logo}/archive', raw=True)
    names = zipfile.ZipFile(io.BytesIO(z)).namelist()
    check("a sub-project's zip holds only its own folder", st == 200 and not any('words' in n or 'zz-nest/canvas.json' in n for n in names) and any(n.endswith('/canvas.json') for n in names), str(names[:8]))
    st, z = call('GET', f'/api/projects/{PARENT}/archive', raw=True)
    names = zipfile.ZipFile(io.BytesIO(z)).namelist()
    check('the parent travels with its sub-projects in one zip', any(n.endswith('logo/canvas.json') for n in names) and any(n.endswith('words/doc.json') for n in names), str(names[:12]))

    # --- trash: back where it was ---------------------------------------------------------------
    st, r = call('DELETE', f'/api/projects/{words}')
    check('a sub-project moves to the trash like any project', st == 200 and words not in cards() and not os.path.exists(os.path.join(parent_dir, 'words')), str(r))
    st, back = call('POST', f"/api/trash/{r['id']}/restore")
    check('and restoring puts it back under its parent, with the same name', st == 200 and back.get('name') == words and cards().get(words, {}).get('parent') == PARENT and os.path.exists(os.path.join(parent_dir, 'words', 'doc.json')), str(back))

    # --- the editor ---------------------------------------------------------------------------
    call('POST', '/api/projects', {'name': DECK, 'title': 'Zz Deck', 'kind': 'slides'})
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/')
        cell = pg.locator('.lcell', has=pg.locator(f'[data-project="{PARENT}"]'))
        await expect(cell).to_be_visible(timeout=15000)
        check('the launcher lists the parent with a count of its sub-projects', (await cell.locator('.lsubs').inner_text()).strip() == '5')
        check('and not its sub-projects on their own', await pg.locator(f'[data-project="{logo}"]').count() == 0)
        await pg.locator(f'[data-project="{PARENT}"]').scroll_into_view_if_needed()
        await shot(pg, 'launcher-collapsed')
        await cell.locator('.lsubs').click()
        sub = pg.locator('.lcell.lsub', has=pg.locator(f'[data-project="{logo}"]'))
        await expect(sub).to_be_visible()
        check('the count shows them right under the parent, one level in', await sub.get_attribute('data-depth') == '1')
        await expect(pg.locator(f'[data-project="{mark}"]')).to_have_count(0)
        await pg.locator('.lcell', has=pg.locator(f'[data-project="{logo}"]')).locator('.lsubs').click()
        await expect(pg.locator('.lcell.lsub', has=pg.locator(f'[data-project="{mark}"]'))).to_have_attribute('data-depth', '2')
        check('a sub of a sub opens in turn, a level further in', True)
        await shot(pg, 'launcher-expanded')
        await pg.goto(BASE + '/')
        await expect(pg.locator(f'[data-project="{logo}"]')).to_be_visible()
        check('the open state is remembered by the browser', True)

        # a search finds a sub-project on its own and says whose it is
        await pg.locator('.lsearch input').fill('Logo')
        await expect(pg.locator(f'[data-project="{logo}"]')).to_be_visible()
        await pg.locator('.lsearch input').fill('')

        # New sub-project… from the card's ⋯, in the parent's folder
        await pg.locator(f'[data-more="{PARENT}"]').click()
        await pg.get_by_role('menuitem', name='New sub-project…').click()
        dlg = pg.locator('[data-under]')
        await expect(dlg).to_be_visible()
        loc = pg.get_by_label('Location')
        check("New sub-project starts at the parent's folder", (await loc.input_value()).endswith('/projects/' + PARENT), await loc.input_value())
        await pg.get_by_label('Title').fill('Poster')
        await loc.scroll_into_view_if_needed()
        await shot(pg, 'new-sub')
        await pg.locator('button.primary[type=submit]').click()
        await expect(pg).to_have_url(re.compile(r'\?p=poster-[0-9a-f]{6}'), timeout=15000)
        poster = pg.url.split('?p=')[1].split('&')[0]
        check('creating it opens it, inside the parent folder', os.path.exists(os.path.join(parent_dir, 'poster', 'canvas.json')) and cards().get(poster, {}).get('parent') == PARENT)
        check('and nothing was added to the links file', links() == before_links)

        # the project menu: where it sits, what is in it
        await pg.get_by_role('button', name='Switch project').click()
        await expect(pg.get_by_role('menuitem', name='Part of Zz Nest')).to_be_visible()
        await shot(pg, 'menu-sub')
        await pg.keyboard.press('Escape')
        await pg.goto(f'{BASE}/?p={PARENT}')
        await pg.get_by_role('button', name='Switch project').click()
        await expect(pg.get_by_text('Inside this project')).to_be_visible()
        await expect(pg.get_by_role('menuitem', name='Poster')).to_be_visible()
        check('the parent\'s project menu lists what is inside it', await pg.get_by_role('menuitem', name='Logo').count() == 1)
        await pg.get_by_role('menuitem', name='New sub-project…').click()
        await expect(pg.locator('[data-under]')).to_be_visible()
        check('and offers New sub-project… too', True)
        await pg.keyboard.press('Escape')

        # a sub-project opens and edits like any project
        await pg.goto(f'{BASE}/?p={logo}')
        await expect(pg.locator('.board, .artboard, [data-board]').first).to_be_visible(timeout=15000)
        check('a sub-project opens in its own editor', not errs, str(errs))

        # Import from project: the parent is named
        await pg.goto(f'{BASE}/?p={DECK}')
        await pg.locator('button[aria-label="Import / Export"]').first.click()
        await pg.get_by_role('menuitem', name='Import from a project…').click()
        await expect(pg.locator('.bpick-group h3', has_text='Zz Nest / Logo')).to_be_visible(timeout=15000)
        check('Import from project lists a sub-project under its parent\'s name', True)
        await shot(pg, 'import-source')
        await b.close()

    cleanup()
    ok = sum(1 for _, k in results if k)
    print(f'\n{ok}/{len(results)} checks passed')
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
