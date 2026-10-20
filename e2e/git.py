"""End-to-end checks for committing a project to git. Run with `pnpm dev` up: python3 e2e/git.py"""
import os, asyncio, subprocess, json, shutil, urllib.request
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
API = os.environ.get('DC_API', 'http://localhost:8787')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
SHOTS = os.environ.get('DC_SHOTS')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')
TMP = '/tmp/dc-git-e2e'
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

def git(cwd, *args):
    return subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True).stdout.strip()

def links():
    f = os.path.join(REPO, 'projects', '.links.json')
    return json.load(open(f)) if os.path.exists(f) else {}

def cleanup():
    for name, path in links().items():
        if path.startswith(TMP): call('DELETE', f'/api/links/{name}')
    shutil.rmtree(TMP, ignore_errors=True)

def copy(sample, dst):
    shutil.copytree(os.path.join(REPO, 'projects', sample), dst, ignore=shutil.ignore_patterns('.journal.jsonl', '.runs.json', 'renders'))
    return call('POST', '/api/links', {'path': dst})[1]['name']

async def shot(pg, name):
    await pg.screenshot(path=OUT + f'git-{name}.png')
    if SHOTS: await pg.screenshot(path=os.path.join(SHOTS, f'{name}.png'))

async def open_commit(pg, name):
    await pg.goto(BASE + f'/?p={name}')
    await pg.locator('header.topbar').wait_for(timeout=15000)
    await pg.locator('.syncchip').click()
    await pg.locator('[data-commit]').click()
    dlg = pg.locator('.ldialog.lcommit')
    await expect(dlg.locator('.commit-where:not([data-state="checking"])')).to_be_visible()
    return dlg

async def main():
    os.makedirs(OUT, exist_ok=True)
    if SHOTS: os.makedirs(SHOTS, exist_ok=True)
    cleanup()
    os.makedirs(TMP)
    loose = copy('design-guide', os.path.join(TMP, 'notes'))
    code = os.path.join(TMP, 'code')
    os.makedirs(code)
    git(code, 'init', '-q', '-b', 'main')
    open(os.path.join(code, 'README.md'), 'w').write('code\n')
    git(code, 'add', '.'); git(code, 'commit', '-q', '-m', 'start')
    inside = copy('box-console', os.path.join(code, 'design'))
    open(os.path.join(code, 'README.md'), 'a').write('work in progress\n')

    st, g = call('GET', f'/api/projects/{loose}/git')
    check('a folder in no repository says so, with the folder a new one would go in', g.get('repo') is None and g.get('folder', '').endswith('/notes'), str(g))
    st, g = call('GET', f'/api/projects/{inside}/git')
    check('a folder inside a code repository names that repository and its branch', g.get('repo') == code and g.get('branch') == 'main' and g.get('changes', 0) > 0, str(g))
    st, r = call('POST', f'/api/projects/{loose}/commit', {'message': 'x'})
    check('committing with no repository and no consent changes nothing', not r.get('ok') and not os.path.exists(os.path.join(TMP, 'notes', '.git')), str(r))

    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        for lang, scheme in (('zh-CN', 'light'), ('en-US', 'dark')):
            ctx = await b.new_context(locale=lang, viewport={'width': 1440, 'height': 900}, color_scheme=scheme)
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            tag = f'{lang[:2]}-{scheme}'
            if lang == 'zh-CN':
                # --- no repository: the first commit creates one, in one confirmation ------------
                dlg = await open_commit(pg, loose)
                await expect(dlg.locator('.commit-where')).to_contain_text('/tmp/dc-git-e2e/notes')
                check('the commit dialog says a repository will be created in the project folder', await dlg.locator('.commit-where[data-state="new"]').count() == 1)
                await shot(pg, f'commit-new-{tag}')
                await dlg.locator('button[type=submit]').click()
                await expect(dlg).to_have_count(0)
                check('confirming creates the repository and makes the first commit', git(os.path.join(TMP, 'notes'), 'rev-list', '--count', 'HEAD') == '1')
                dlg = await open_commit(pg, loose)
                check('with nothing changed, commit is disabled and says why', await dlg.locator('button[type=submit]').is_disabled() and await dlg.locator('.commit-changes').count() == 1)
                await pg.keyboard.press('Escape')
                tab = next(f for f in os.listdir(os.path.join(TMP, 'notes', 'tabs')))
                open(os.path.join(TMP, 'notes', 'tabs', tab), 'a').write('\nA new line.\n')
                dlg = await open_commit(pg, loose)
                await expect(dlg.locator('.commit-changes')).to_contain_text('1')
                await dlg.locator('input').fill('docs: a new line')
                await dlg.locator('button[type=submit]').click()
                await expect(dlg).to_have_count(0)
                check('the next commit lands in the project\'s own repository', git(os.path.join(TMP, 'notes'), 'log', '-1', '--format=%s') == 'docs: a new line')

            # --- inside someone's repository: say where, commit only the project -----------------
            dlg = await open_commit(pg, inside)
            await expect(dlg.locator('.commit-where')).to_contain_text('main')
            await expect(dlg.locator('.commit-where')).to_contain_text(code)
            check(f'[{tag}] the dialog names the repository and branch it commits to', True)
            await shot(pg, f'commit-repo-{tag}')
            if lang == 'zh-CN':
                await dlg.locator('button[type=submit]').click()
                await expect(dlg).to_have_count(0)
                changed = git(code, 'show', '--name-only', '--format=', 'HEAD').split('\n')
                check('only the project folder is committed; other work in the repository stays as it was', all(f.startswith('design/') for f in changed) and 'README.md' in git(code, 'status', '--porcelain'), str(changed))
            else:
                await pg.keyboard.press('Escape')

            # --- every kind has the commit button ------------------------------------------------
            if lang == 'zh-CN':
                for sample, kind in SAMPLES.items():
                    await pg.goto(BASE + f'/?p={sample}')
                    await pg.locator('header.topbar').wait_for(timeout=15000)
                    await pg.locator('.syncchip').click()
                    check(f'the {kind} editor has commit in its change log', await pg.locator('[data-commit]').count() == 1)

            # --- new project: optional repository from the start ---------------------------------
            await pg.goto(BASE + '/')
            await pg.locator('.lcard[data-project]').first.wait_for()
            await pg.locator('.lnewbtn').click()
            await pg.locator('.menu [data-new="docs"] [role=menuitem], .menu [data-new="docs"] button').first.click()
            nd = pg.locator('.ldialog')
            check(f'[{tag}] in the projects folder (already a repository) the checkbox is not offered', await nd.locator('[data-git]').count() == 0)
            await nd.locator('.where .linkish').click()
            await nd.locator('.folder .input').fill(os.path.join(code, 'more'))
            await expect(nd.locator('.where-hint')).to_contain_text('more')
            check(f'[{tag}] inside another repository it is not offered either', await nd.locator('[data-git]').count() == 0)
            fresh = os.path.join(TMP, f'fresh-{lang[:2]}')
            await nd.locator('.folder .input').fill(fresh)
            await expect(nd.locator('[data-git]')).to_be_visible()
            await nd.locator('[data-git] input').check()
            await nd.locator('input').first.fill('Brief' if lang == 'en-US' else '简报')
            await shot(pg, f'new-git-{tag}')
            await nd.locator('button[type=submit]').click()
            await pg.wait_for_url('**/?p=fresh*')
            await pg.locator('header.topbar').wait_for()
            check(f'[{tag}] ticking it creates the project with a repository and a first commit', git(fresh, 'rev-list', '--count', 'HEAD') == '1')
            check(f'[{tag}] no page errors', not errs, str(errs[:3]))
            await ctx.close()
        await b.close()
    cleanup()
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed: raise SystemExit(1)

asyncio.run(main())
