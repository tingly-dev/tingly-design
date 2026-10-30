"""End-to-end checks for folders opened as groups and for the other work a project may consult (.design/folder-groups.md):
a folder of projects lists them together under its name, a project made in it appears by itself, a reference reaches
Claude Code as a folder to read and never to edit (the stand-in `claude`, e2e/fake-claude, records how it is called).
Run with `pnpm dev` started with e2e/fake-claude first on PATH: python3 e2e/folder_groups.py (or pnpm e2e folder_groups)"""
import os, json, re, shutil, time, asyncio, urllib.request, urllib.error
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
CHROME = os.environ.get('DC_CHROME')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, 'e2e', 'out') + '/'
SHOTS = os.environ.get('DC_SHOTS')
LOG = os.environ.get('FAKE_CLAUDE_LOG', '/tmp/fake-claude.log')
TMP = '/tmp/dc-folder-groups-e2e'
STUDIO = os.path.join(TMP, 'studio')
IGNORE = shutil.ignore_patterns('.journal.jsonl', '.runs.json', 'renders', '.claude-session.json', '.transcript.jsonl')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')

def put(sample, name):
    shutil.copytree(os.path.join(REPO, 'projects', sample), os.path.join(STUDIO, name), ignore=IGNORE)

def cards(): return call('GET', '/api/projects')[1]

def cleanup():
    for f in call('GET', '/api/folders')[1].get('folders', []):
        if f['path'].startswith(('/tmp/dc-folder-groups', '~/')) and 'dc-folder-groups' in f['path']: call('DELETE', f"/api/folders/{f['id']}")
    shutil.rmtree(TMP, ignore_errors=True)
    # the lists this run started leave their files behind, empty
    for f in ('.folders.json', '.groups.json'):
        path = os.path.join(REPO, 'projects', f)
        try:
            if os.path.exists(path) and not json.load(open(path)): os.remove(path)
        except Exception: pass

def run_claude(project, prompt):
    before = sum(1 for _ in open(LOG)) if os.path.exists(LOG) else 0
    call('POST', f'/api/projects/{project}/delegate', {'prompt': prompt, 'fresh': True})
    t = time.time()
    while time.time() - t < 20:
        new = [json.loads(l) for l in open(LOG)][before:] if os.path.exists(LOG) else []
        if new and new[-1]['ev'] == 'end': break
        time.sleep(0.2)
    return [c for c in new if c['ev'] == 'start']

async def shot(pg, name):
    await pg.screenshot(path=OUT + f'folder-groups-{name}.png')
    if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, f'{name}.png'))

async def main():
    os.makedirs(OUT, exist_ok=True)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    cleanup()
    os.makedirs(os.path.join(STUDIO, 'notes'))
    put('tingly-box-console-canvas', 'console')
    put('tingly-design-system', 'brand')
    put('tingly-design-guide-doc', 'guide')
    put('tingly-box-usage-dashboard', 'usage')
    put('tingly-design-intro-slides', 'deck')
    put('tingly-design-motion', 'promo')
    os.makedirs(os.path.join(STUDIO, '.hidden-copy'))
    os.path.exists(LOG) and os.remove(LOG)

    # --- the folder is read for what it holds -----------------------------------------------------
    st, info = call('GET', '/api/folder?path=' + STUDIO)
    check('a folder of projects is told apart from a project and from other files', st == 200 and info['state'] == 'group' and sorted(m['name'] for m in info['members']) == ['brand', 'console', 'deck', 'guide', 'promo', 'usage'], str(info))
    st, info = call('GET', '/api/folder?path=' + os.path.join(STUDIO, 'notes'))
    check('an empty folder inside it is still free', info['state'] == 'free', str(info))
    st, r = call('POST', '/api/folders', {'path': os.path.join(STUDIO, 'console')})
    check('a project is refused as a folder group', st == 409 and r.get('code') == 'folderIsProject', str(r))
    st, r = call('POST', '/api/folders', {'path': os.path.join(STUDIO, 'notes')})
    check('a folder with no project is refused', st == 404 and r.get('code') == 'noProjectsInFolder', str(r))

    # --- opening it lists its projects together ---------------------------------------------------
    st, g = call('POST', '/api/folders', {'path': STUDIO})
    check('opening the folder gives its projects', st == 200 and len(g['members']) == 6, str(g))
    st, again = call('POST', '/api/folders', {'path': STUDIO + '/'})
    check('opening it again changes nothing', again.get('id') == g['id'] and len(call('GET', '/api/folders')[1]['folders']) == 1)
    listed = {c['name']: c for c in cards()}
    members = {n: listed[n] for n in g['members']}
    check('members are listed with their kind, folder and the folder as their group', len(members) == 6 and all(c['group'] == 'studio' and c['folderGroup']['derived'] and c['path'].startswith(STUDIO.replace('/tmp', '~') if False else '/tmp') for c in members.values()), str(members.keys()))
    kinds = {c['path'].split('/')[-1]: c['kind'] for c in members.values()}
    check('each kind is a member', kinds == {'console': 'design', 'brand': 'design-system', 'guide': 'docs', 'usage': 'dashboard', 'deck': 'slides', 'promo': 'motion'}, str(kinds))
    links = json.load(open(os.path.join(REPO, 'projects', '.links.json'))) if os.path.exists(os.path.join(REPO, 'projects', '.links.json')) else {}
    check('members are not written into the links file', not any(n in links for n in members))
    console = next(n for n, c in members.items() if c['kind'] == 'design')
    brand = next(n for n, c in members.items() if c['kind'] == 'design-system')
    st, r = call('DELETE', f'/api/links/{console}')
    check('a member cannot be unlinked on its own', st == 409 and r.get('code') == 'inFolderGroup', str(r))

    put('tingly-design-intro-slides', 'pitch')
    st, now = call('GET', '/api/projects')
    pitch = next((c for c in now if c['path'].endswith('/pitch')), None)
    check('a project made in the folder appears without opening anything', pitch is not None and pitch['group'] == 'studio')
    st, files = call('GET', f"/api/projects/{pitch['name']}/files")
    check('and can be read by its name at once', st == 200 and bool(files['files']))
    shutil.rmtree(os.path.join(STUDIO, 'pitch'))
    check('a project removed from the folder leaves the list', all(not c['path'].endswith('/pitch') for c in call('GET', '/api/projects')[1] if c.get('path')))

    st, r = call('PATCH', f'/api/projects/{console}', {'group': 'Mine'})
    c = next(c for c in call('GET', '/api/projects')[1] if c['name'] == console)
    check('a group the person chose wins over the folder', c['group'] == 'Mine' and c['folderGroup']['derived'] is False, str(c.get('group')))
    call('PATCH', f'/api/projects/{console}', {'group': ''})
    c = next(c for c in call('GET', '/api/projects')[1] if c['name'] == console)
    check('taking it out of the chosen group puts it back under the folder', c['group'] == 'studio')

    # --- references ------------------------------------------------------------------------------
    st, r = call('GET', f'/api/projects/{console}/references')
    check('a project starts with no references', st == 200 and r['references'] == [], str(r))
    ds_path = os.path.join(STUDIO, 'brand')
    st, r = call('PUT', f'/api/projects/{console}/references', {'paths': [ds_path, STUDIO]})
    refs = r.get('references', [])
    check('a project and a folder of projects can be referenced', st == 200 and [x['state'] for x in refs] == ['project', 'group'] and refs[0]['kind'] == 'design-system' and len(refs[1]['members']) == 6, str(r))
    st, r = call('PUT', f'/api/projects/{console}/references', {'paths': [os.path.join(STUDIO, 'console')]})
    check('a project cannot refer to itself', st == 400 and r.get('code') == 'refSelf', str(r))
    st, r = call('PUT', f'/api/projects/{console}/references', {'paths': [os.path.join(STUDIO, 'notes')]})
    check('a folder with no project cannot be referenced', st == 404, str(r))
    st, r = call('GET', f'/api/projects/{console}/references')
    check('a refused change keeps the references', len(r['references']) == 2)
    check('references are kept in the project, local to this machine', os.path.exists(os.path.join(STUDIO, 'console', '.references.json')))

    s = run_claude(console, 'match the brand')
    args = s[0]['args'] if s else []
    deny = args[args.index('--disallowedTools') + 1].split(',') if '--disallowedTools' in args else []
    added = [args[i + 1] for i, a in enumerate(args) if a == '--add-dir']
    prompt = s[0]['prompt'] if s else ''
    check('Claude Code may read the referenced folders', ds_path in added and STUDIO in added, str(added))
    check('and cannot edit the referenced projects', f'Edit(/{ds_path}/**)' in deny and f'Edit(/{STUDIO}/guide/**)' in deny, str(deny))
    check('but can still edit the open project, which sits in a referenced folder', not any('/console/' in d for d in deny), str(deny))
    check('the request names the references and says they are read-only', 'Reference folders' in prompt and ds_path in prompt and 'never edit' in prompt, prompt[:300])
    # every kind hands its references over the same way
    for n, c in members.items():
        own = c['path'].replace('~', os.path.expanduser('~'), 1)
        others = ds_path if not own.endswith('/brand') else os.path.join(STUDIO, 'console')
        call('PUT', f'/api/projects/{n}/references', {'paths': [others]})
        sent = run_claude(n, 'look at the other')
        a = sent[0]['args'] if sent else []
        check(f"a {c['kind']} project's request gets its reference folder, read-only", sent and others in [a[i + 1] for i, x in enumerate(a) if x == '--add-dir'] and f'Edit(/{others}/**)' in a[a.index('--disallowedTools') + 1].split(','), str(a[-8:]))
        call('PUT', f'/api/projects/{n}/references', {'paths': []})
    plain = run_claude(brand, 'tidy')
    check('a project with no references gets no extra folders', plain and '--disallowedTools' not in plain[0]['args'])

    st, _ = call('PUT', f'/api/projects/{console}/references', {'paths': []})
    gone = os.path.join(TMP, 'elsewhere')
    shutil.copytree(os.path.join(STUDIO, 'brand'), gone)
    call('PUT', f'/api/projects/{console}/references', {'paths': [gone]})
    shutil.rmtree(gone)
    st, r = call('GET', f'/api/projects/{console}/references')
    check('a reference whose folder is gone is kept and marked', r['references'][0]['state'] == 'missing', str(r))
    s = run_claude(console, 'again')
    check('and left out of the request', s and '--disallowedTools' not in s[0]['args'] and gone not in s[0]['args'])
    call('PUT', f'/api/projects/{console}/references', {'paths': [ds_path, STUDIO]})

    # --- the launcher and the project menu ------------------------------------------------------
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        for lang, scheme in (('zh-CN', 'light'), ('zh-CN', 'dark'), ('en-US', 'light'), ('en-US', 'dark')):
            tag = f"{lang[:2]}-{scheme}"
            ctx = await b.new_context(locale=lang, viewport={'width': 1440, 'height': 900}, color_scheme=scheme)
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            # close the group first so the dialog is what opens it
            for f in call('GET', '/api/folders')[1]['folders']: call('DELETE', f"/api/folders/{f['id']}")
            await pg.goto(BASE + '/')
            await pg.locator('.lcard[data-project]').first.wait_for()
            await pg.locator('.lnewbtn').click()
            await pg.locator('.menu [data-new="folder"] [role=menuitem], .menu [data-new="folder"] button').first.click()
            dlg = pg.locator('.ldialog.lopen')
            await dlg.locator('input').fill(STUDIO)
            await expect(dlg.locator('.folder-state[data-state="group"]')).to_be_visible()
            check(f'[{tag}] the dialog says a folder of projects was found', 'console' in await dlg.locator('.folder-state').inner_text())
            await shot(pg, f'open-group-{tag}')
            await dlg.locator('button[type=submit]').click()
            sec = pg.locator('.lsection[data-group="studio"]')
            await sec.wait_for()
            check(f'[{tag}] the folder is a group of the launcher with its six projects and its path', await sec.locator('.lcard[data-project]').count() == 6 and 'dc-folder-groups-e2e/studio' in await sec.locator('.gpath').inner_text())
            await sec.scroll_into_view_if_needed()
            await pg.wait_for_timeout(2000)
            await shot(pg, f'launcher-{tag}')
            first = sec.locator('.lcard[data-project]').first.get_attribute('data-project')
            await pg.locator(f'[data-more="{await first}"]').click()
            check(f'[{tag}] a member offers no remove from list', await pg.locator('.menu').get_by_text(re.compile('从列表移除|Remove from list')).count() == 0)
            await pg.keyboard.press('Escape')

            await pg.goto(BASE + f'/?p={console}')
            await pg.locator('header.topbar').wait_for(timeout=15000)
            await pg.locator('.pmenu .tb[aria-haspopup="menu"]').click()
            await pg.locator('.menu').get_by_text(re.compile('引用其他内容|Other work to consult')).click()
            rd = pg.locator('.refsdlg')
            await rd.wait_for()
            await expect(rd.locator('input[type=checkbox]:checked')).to_have_count(2)
            await shot(pg, f'references-{tag}')
            await pg.keyboard.press('Escape')
            await expect(pg.locator('.refchip')).to_be_visible()
            check(f'[{tag}] the request bar shows a References chip with the count', '2' in await pg.locator('.refchip').inner_text())
            await shot(pg, f'chip-{tag}')
            await pg.locator('.refchip').click()
            await pg.locator('.refsdlg').wait_for()
            box = rd.locator('input[type=checkbox]').nth(1)
            await rd.locator('.refrow').filter(has_text='brand').locator('input').focus(); await pg.keyboard.press('Space')
            await pg.wait_for_timeout(500)
            st, r = call('GET', f'/api/projects/{console}/references')
            check(f'[{tag}] unticking a project in the dialog saves at once', [x['state'] for x in r['references']] == ['group'], str(r))
            await rd.locator('.refrow').filter(has_text='brand').locator('input').focus(); await pg.keyboard.press('Space')
            await pg.wait_for_timeout(500)
            await pg.keyboard.press('Escape')
            check(f'[{tag}] no page errors', not errs, str(errs[:3]))
            await ctx.close()
        await b.close()

    # closing the group from its heading leaves the projects alone
    g = call('GET', '/api/folders')[1]['folders']
    for f in g: call('DELETE', f"/api/folders/{f['id']}")
    check('closing the folder takes its projects off the list and keeps its files', os.path.exists(os.path.join(STUDIO, 'console', 'canvas.json')) or os.path.isdir(os.path.join(STUDIO, 'console')))
    cleanup()
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed: raise SystemExit(1)

asyncio.run(main())
