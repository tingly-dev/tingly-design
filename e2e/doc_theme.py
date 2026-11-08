"""End-to-end checks for a doc wearing a design system (.design/doc-design-system.md): the Theme popover with the doc's own look and the
cards of each installed system, installing a built-in look there wears it at once, the editor's page and the HTML export are drawn from the same
values (a light system, a dark one with its own text colours), the files keep only the choice (doc.json's `designSystems` and `theme`), going back
to the own look, and removing the worn system. Uses projects/tingly-design-wechat-doc and puts it back with git.
Run with `pnpm dev` up: python3 e2e/doc_theme.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, asyncio, json, subprocess, time
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
CHROME = os.environ.get('DC_CHROME')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(REPO, 'projects/tingly-design-wechat-doc')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def restore():
    subprocess.run(['git', 'checkout', '--', 'projects/tingly-design-wechat-doc'], cwd=REPO)
    subprocess.run(['git', 'clean', '-fdq', '--', 'projects/tingly-design-wechat-doc'], cwd=REPO)

def index(): return json.load(open(os.path.join(DOC, 'doc.json'), encoding='utf-8'))

async def wait_for(pred, timeout=8.0):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if pred(): return True
        except Exception: pass
        await asyncio.sleep(0.1)
    return False

async def main():
    restore()
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='zh-CN', viewport={'width': 1440, 'height': 950}, accept_downloads=True)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and '409 (Conflict)' not in m.text and errs.append(m.text))
        await pg.goto(BASE + '/?p=tingly-design-wechat-doc')
        await expect(pg.locator('.docbody h1')).to_have_text('一级标题 Heading 1', timeout=15000)

        theme = pg.locator('[data-testid=doc-theme]')

        async def open_theme(systems=False):
            # the popover may still be open from before: the button toggles it
            if await theme.count() == 0:
                await pg.locator('[data-theme-button]').click()
            await expect(theme).to_be_visible()
            if systems and not await theme.locator('.dsbuiltins').is_visible():
                await theme.locator('.th-systems > summary').click()

        async def html_export():
            await pg.locator('.dashbar button[aria-label="导入 / 导出"]').click()
            async with pg.expect_download() as dl:
                await pg.get_by_role('menuitem', name='HTML 网页').click()
            return open(await (await dl.value).path(), encoding='utf-8').read()

        # --- the doc's own look -----------------------------------------------------------------------
        own_html = await html_export()
        check('without a system the doc is drawn by its own look', await pg.locator('.app.docs[data-wears]').count() == 0 and 'a{color:#1d4ed8}' in own_html)
        await open_theme()
        check('the Theme popover offers the doc\'s own look, selected, and the systems to install', await theme.locator('[data-theme-card=original][aria-pressed=true]').count() == 1 and await theme.locator('.dsbuiltins').count() == 1)

        # --- install a built-in look: it is worn at once ---------------------------------------------
        builtins = theme.locator('.dsbuiltins')
        await builtins.locator('summary').click()
        await builtins.locator('[data-group="platform"]').click()
        await builtins.locator('[data-look="wechat"]').click()
        await theme.locator('.faceadd > button', has_text='装入').click()
        await expect(pg.locator('.app.docs[data-wears]')).to_have_count(1, timeout=15000)
        ix = index()
        check('the files keep the choice and the copy of the tokens, never colours', ix.get('theme') == {'system': 'look-wechat', 'theme': 'light'} and any(r.get('artifact') == 'builtin:wechat' for r in ix.get('designSystems', [])) and os.path.exists(os.path.join(DOC, 'ds/look-wechat/tokens.json')) and '07c160' not in open(os.path.join(DOC, 'tabs/all-elements.md'), encoding='utf-8').read())
        readme = os.path.join(DOC, 'ds/look-wechat/README.md')
        text = open(readme, encoding='utf-8').read() if os.path.exists(readme) else ''
        check('a platform look keeps its own description beside the copy of its tokens, without html-ppt\'s credits', '07c160' in text and 'MIT License' not in text)
        look = await pg.evaluate("() => { const l = document.querySelector('.docbody a'); const p = document.querySelector('.docpage'); return { link: getComputedStyle(l).color, page: getComputedStyle(p).backgroundColor, h1: getComputedStyle(document.querySelector('.docbody h1')).fontSize }; }")
        check('the editor\'s page is the system\'s: its page colour and brand-coloured links', look['link'] == 'rgb(7, 193, 96)' and look['page'] == 'rgb(255, 255, 255)' and look['h1'] == '30px', json.dumps(look))
        await expect(theme.locator('[data-theme-card="look-wechat/light"][aria-pressed=true]')).to_have_count(1)

        # --- the HTML export reads the same values --------------------------------------------------
        await pg.keyboard.press('Escape')
        green_html = await html_export()
        check('the HTML export is drawn from the same look', 'a{color:#07c160}' in green_html and 'html,body{background:#ffffff;}' in green_html and 'border-left:3px solid #07c160' in green_html)

        # --- a dark system, with the text colours made for it ---------------------------------------
        await open_theme(systems=True)
        builtins = theme.locator('.dsbuiltins')
        await builtins.locator('summary').click()
        await builtins.locator('[data-group="palette"]').click()
        await builtins.locator('[data-look="nord"]').click()
        await theme.locator('.faceadd > button', has_text='装入').click()
        await expect(theme.locator('[data-theme-card="look-nord/dark"][aria-pressed=true]')).to_have_count(1, timeout=15000)
        dark = await pg.evaluate("() => ({ page: getComputedStyle(document.querySelector('.docpage')).backgroundColor, red: getComputedStyle(document.querySelector('.docbody span[data-color=red]')).color, ink: getComputedStyle(document.querySelector('.docbody p')).color })")
        check('a dark system dresses the page dark, with text colours that read on it', dark['page'] == 'rgb(46, 52, 64)' and dark['red'] == 'rgb(255, 138, 128)' and dark['ink'] != dark['page'], json.dumps(dark))
        check('choosing another theme changes one record', index().get('theme') == {'system': 'look-nord', 'theme': 'dark'})
        await theme.locator('[data-theme-card="look-wechat/light"]').click()
        check('one click goes back to the other system', await wait_for(lambda: index().get('theme', {}).get('system') == 'look-wechat'))

        # --- back to the doc's own look -----------------------------------------------------------
        await theme.locator('[data-theme-card=original]').click()
        check('the doc\'s own look takes the theme away again', await wait_for(lambda: 'theme' not in index()) and await pg.locator('.app.docs[data-wears]').count() == 0)
        await pg.keyboard.press('Escape')
        check('and the export is the doc\'s own again', 'a{color:#1d4ed8}' in await html_export())

        # --- removing the worn system goes back too -------------------------------------------------
        await open_theme()
        await theme.locator('[data-theme-card="look-wechat/light"]').click()
        await expect(pg.locator('.app.docs[data-wears]')).to_have_count(1, timeout=10000)
        await open_theme(systems=True)
        await theme.locator('.dsinst[data-ds="look-wechat"] button', has_text='移除').click()
        check('removing the system it wears puts the doc back to its own look', await wait_for(lambda: 'theme' not in index() and all(r.get('namespace') != 'look-wechat' for r in index().get('designSystems', []))) and await pg.locator('.app.docs[data-wears]').count() == 0)

        check('no page errors', not errs, repr(errs[:5]))
        await b.close()
    restore()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
