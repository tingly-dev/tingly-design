"""End-to-end checks for projects inside projects (.design/sub-projects.md): a project made at a path inside another
project's folder (the New dialog's Location preset by New sub-project…) is a project of its own, listed like any other,
and the project that holds it leaves it out: its files, card count, file watching, git changes and zip. A project folder
put there by hand, which nobody registered, is left out of the parent's files and watching too. The sub-project's own
files, journal and zip are its own; a name a project keeps its own files in is refused; New sub-project… from the project
menu and from a card's ⋯ starts at the parent's folder.
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
def new_at(folder, kind='design', title=None):
    return call('POST', '/api/projects', {'path': folder, 'title': title or os.path.basename(folder), 'kind': kind})
def files(name): return sorted(call('GET', f'/api/projects/{name}/files')[1]['files'])
def journal_files(name): return {e.get('file') for e in call('GET', f'/api/projects/{name}/journal')[1]}

def cleanup(before_links):
    """The sub-projects this suite linked go off the list again, and its folders go."""
    for name, path in links().items():
        if f'/{PARENT}/' in path and name not in before_links: call('DELETE', f'/api/links/{name}')
    shutil.rmtree(os.path.join(PROJECTS, PARENT), ignore_errors=True)

async def shot(pg, name):
    await pg.screenshot(path=OUT + f'nested-{name}.png')
    if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, f'{name}.png'))

async def main():
    os.makedirs(OUT, exist_ok=True)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    before_links = links()
    cleanup(before_links)

    # --- the parent, and a project made inside its folder ----------------------------------------
    st, r = call('POST', '/api/projects', {'name': PARENT, 'title': 'Zz Nest', 'kind': 'design'})
    check('a parent project is made', st == 200 and r.get('name') == PARENT, str(r))
    parent_dir = os.path.join(PROJECTS, PARENT)
    before = files(PARENT)
    count = cards()[PARENT]['count']
    st, g0 = call('GET', f'/api/projects/{PARENT}/git')
    st, r = new_at(os.path.join(parent_dir, 'logo'), 'design', 'Logo')
    logo = r.get('name', '')
    check('a project is made at a path inside the parent folder', st == 200 and re.fullmatch(r'logo-[0-9a-f]{6}', logo) is not None and os.path.exists(os.path.join(parent_dir, 'logo', 'canvas.json')), str(r))
    c = cards().get(logo, {})
    check('it is listed like any project, with its folder', c.get('title') == 'Logo' and c.get('kind') == 'design' and c.get('path', '').endswith(f'/{PARENT}/logo'), str(c))
    check('and linked by the links file, which holds nothing the suite did not add', set(links()) - set(before_links) == {logo}, str(links()))
    check("the parent's files leave the sub-project's out", files(PARENT) == before and not any(f.startswith('logo/') for f in files(PARENT)), str(files(PARENT)))
    mine = files(logo)
    check("the sub-project's files are its own", 'canvas.json' in mine and any(f.endswith('.dc.html') for f in mine), str(mine))
    check("the parent's card still counts only its own boards", cards()[PARENT]['count'] == count, f"{cards()[PARENT]['count']} vs {count}")

    # --- another kind, a sub of a sub, a reserved name -------------------------------------------
    st, r = new_at(os.path.join(parent_dir, 'words'), 'docs', 'Words')
    words = r.get('name', '')
    check('any kind can be made there', st == 200 and cards().get(words, {}).get('kind') == 'docs', str(r))
    st, r = new_at(os.path.join(parent_dir, 'logo', 'mark'), 'design-system', 'Mark')
    mark = r.get('name', '')
    check("and one inside a sub-project's folder, which the sub-project leaves out in turn", st == 200 and not any(f.startswith('mark/') for f in files(logo)) and not any(f.startswith(('logo/', 'words/')) for f in files(PARENT)), str(r))
    st, r = new_at(os.path.join(parent_dir, 'uploads'), 'design')
    check("a folder a project keeps its own files in is refused", st == 400 and r.get('code') == 'subReserved' and not os.path.exists(os.path.join(parent_dir, 'uploads', 'canvas.json')), str(r))

    # --- a project folder put there by hand: nobody registered it, it is still not the parent's ---
    shutil.copytree(os.path.join(parent_dir, 'words'), os.path.join(parent_dir, 'handmade'), ignore=shutil.ignore_patterns('.*'))
    check("a project folder put inside by hand is left out of the parent's files", files(PARENT) == before, str(files(PARENT)))
    check("and out of its git changes", call('GET', f'/api/projects/{PARENT}/git')[1].get('changes') == g0.get('changes'))
    time.sleep(1.5)
    open(os.path.join(parent_dir, 'handmade', 'tabs', 'extra.md'), 'w').write('typed outside\n')
    open(os.path.join(parent_dir, 'logo', 'Outside.dc.html'), 'w').write('<dc-board title="Outside" width="400" height="300"></dc-board>\n')
    t = time.time()
    while time.time() - t < 8 and 'Outside.dc.html' not in journal_files(logo): time.sleep(0.4)
    check("an edit made outside is the sub-project's journal entry", 'Outside.dc.html' in journal_files(logo))
    time.sleep(1)
    parent_journal = journal_files(PARENT)
    check("and neither the sub-project's nor the hand-placed folder's file is the parent's", not (parent_journal & {'Outside.dc.html', 'logo/Outside.dc.html', 'handmade/tabs/extra.md', 'tabs/extra.md'}), str(parent_journal))
    check("the parent's card still counts only its own boards", cards()[PARENT]['count'] == count)

    # --- git: the parent's changes leave the sub-project's out ------------------------------------
    st, g1 = call('GET', f'/api/projects/{PARENT}/git')
    st, gl = call('GET', f'/api/projects/{logo}/git')
    check("the parent's git changes do not count the sub-project's files", g1.get('changes') == g0.get('changes'), f'{g0} -> {g1}')
    check("the sub-project's own changes are counted for it", gl.get('changes', 0) >= 2, str(gl))

    # --- zip: a sub-project's zip is its own, the parent's carries it ------------------------------
    st, z = call('GET', f'/api/projects/{logo}/archive', raw=True)
    names = zipfile.ZipFile(io.BytesIO(z)).namelist()
    check("a sub-project's zip holds only its own folder", st == 200 and any(n.endswith('/canvas.json') for n in names) and not any('words' in n for n in names), str(names[:8]))
    st, z = call('GET', f'/api/projects/{PARENT}/archive', raw=True)
    names = zipfile.ZipFile(io.BytesIO(z)).namelist()
    check('the parent travels with the sub-projects inside its folder', any(n.endswith('logo/canvas.json') for n in names) and any(n.endswith('words/doc.json') for n in names), str(names[:12]))

    # --- the editor: New sub-project… from the project menu and from a card ----------------------
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(f'{BASE}/?p={PARENT}')
        await pg.get_by_role('button', name='Switch project').click()
        await pg.get_by_role('menuitem', name='New sub-project…').click()
        await expect(pg.locator('[data-under]')).to_be_visible()
        loc = pg.get_by_label('Location')
        check("the project menu's New sub-project… starts at the project's folder", (await loc.input_value()).endswith(f'/projects/{PARENT}'), await loc.input_value())
        await pg.get_by_label('Title').fill('Poster')
        await loc.scroll_into_view_if_needed()
        await shot(pg, 'new-sub')
        await pg.locator('button.primary[type=submit]').click()
        await expect(pg).to_have_url(re.compile(r'\?p=poster-[0-9a-f]{6}'), timeout=15000)
        poster = pg.url.split('?p=')[1].split('&')[0]
        check('creating it opens it, inside the parent folder, and the parent does not list it', os.path.exists(os.path.join(parent_dir, 'poster', 'canvas.json')) and cards().get(poster, {}).get('title') == 'Poster' and not any(f.startswith('poster/') for f in files(PARENT)))

        await pg.goto(BASE + '/')
        await pg.locator(f'[data-more="{PARENT}"]').click()
        await expect(pg.get_by_role('menuitem', name='New sub-project…')).to_be_visible()
        await shot(pg, 'card-menu')
        await pg.get_by_role('menuitem', name='New sub-project…').click()
        await expect(pg.locator('[data-under]')).to_be_visible()
        check("a card's ⋯ offers it too, at the same folder", (await pg.get_by_label('Location').input_value()).endswith(f'/projects/{PARENT}'))
        await pg.keyboard.press('Escape')
        await pg.goto(f'{BASE}/?p={logo}')
        await expect(pg.locator('.board, .artboard, [data-board]').first).to_be_visible(timeout=15000)
        check('a sub-project opens in its own editor', not errs, str(errs))
        await b.close()

    stray = [d for d in os.listdir(PROJECTS) if re.fullmatch(r'(logo|words|mark|handmade|poster)-[0-9a-f]{6}', d)]
    cleanup(before_links)
    for d in stray: shutil.rmtree(os.path.join(PROJECTS, d), ignore_errors=True)
    check('no sub-project left a folder of its own name in the projects folder', not stray, str(stray))
    check('the links file is as it was', links() == before_links, str(links()))
    ok = sum(1 for _, k in results if k)
    print(f'\n{ok}/{len(results)} checks passed')
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
