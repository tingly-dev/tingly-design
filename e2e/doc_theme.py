"""End-to-end checks for a doc wearing a design system (.design/doc-design-system.md): the Theme popover with the doc's own look and the
cards of each installed system, installing a built-in look there wears it at once, the editor's page and the HTML export are drawn from the same
values (a light system, a dark one with its own text colours), the files keep only the choice (doc.json's `designSystems` and `theme`), going back
to the own look, and removing the worn system. Uses projects/tingly-design-wechat-doc and puts it back with git.
Run with `pnpm dev` up: python3 e2e/doc_theme.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, re, asyncio, json, subprocess, time
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
        look = await pg.evaluate("() => { const l = document.querySelector('.docbody a'); const p = document.querySelector('.docpage'); return { link: getComputedStyle(l).color, page: getComputedStyle(p).backgroundColor, h1: getComputedStyle(document.querySelector('.docbody h1')).fontSize, column: getComputedStyle(p).maxWidth, body: getComputedStyle(document.querySelector('.docbody p')).fontSize + '/' + getComputedStyle(document.querySelector('.docbody p')).lineHeight }; }")
        check('the editor\'s page is the system\'s: its page colour, brand-coloured links, its heading and body sizes, line height and column', look['link'] == 'rgb(7, 193, 96)' and look['page'] == 'rgb(255, 255, 255)' and look['h1'] == '24px' and look['column'] == '805px' and look['body'] == '16px/28.8px', json.dumps(look))
        await expect(theme.locator('[data-theme-card="look-wechat/light"][aria-pressed=true]')).to_have_count(1)
        roles = await pg.evaluate("() => { const q = document.querySelector('.docbody blockquote'); const t = document.querySelector('.docbody th'); const pre = document.querySelector('.docbody pre'); const p = document.querySelector('.docbody > p'); return { quote: getComputedStyle(q).backgroundColor, bar: getComputedStyle(q).borderLeftColor, th: getComputedStyle(t).backgroundColor, code: getComputedStyle(pre).fontSize, gap: getComputedStyle(p).marginTop }; }")
        check('the doc roles the system gives reach the page: quote ground and bar, table head, code size, paragraph gap', roles == {'quote': 'rgb(249, 249, 249)', 'bar': 'rgb(7, 193, 96)', 'th': 'rgb(246, 248, 250)', 'code': '13px', 'gap': '13px'}, json.dumps(roles))

        # --- a system's own decoration of elements: a bar beside a heading, a frame round a picture -----------------
        copy = os.path.join(DOC, 'ds/look-wechat/tokens.json')
        tk = json.load(open(copy, encoding='utf-8'))
        tk['doc'] = {'tokens': [
            {'name': 'h1', 'value': 'border-left: 6px solid {accent}; padding-left: 12px'},
            {'name': 'img', 'value': 'background-color: #ffffff; padding: 8px 8px 28px; border: 1px solid {line}'},
            {'name': 'hr', 'value': 'box-shadow: 0 0 4px #000'},
        ]}
        open(copy, 'w', encoding='utf-8').write(json.dumps(tk, indent=2, ensure_ascii=False) + '\n')
        await expect(pg.locator('.docbody h1').first).to_have_css('border-left-width', '6px', timeout=10000)
        deco = await pg.evaluate("() => { const h = getComputedStyle(document.querySelector('.docbody h1')); const i = document.querySelector('.docbody img'); const f = i ? getComputedStyle(i) : null; return { bar: h.borderLeftColor, pad: h.paddingLeft, frame: f && f.paddingBottom, frameBg: f && f.backgroundColor, shadow: getComputedStyle(document.querySelector('.docbody hr')).boxShadow }; }")
        check('a system\'s doc decoration dresses the page: a bar beside the heading, a frame round the picture, and nothing the platform drops', deco['bar'] == 'rgb(7, 193, 96)' and deco['pad'] == '12px' and deco['frame'] == '28px' and deco['frameBg'] == 'rgb(255, 255, 255)' and deco['shadow'] == 'none', json.dumps(deco))
        await pg.keyboard.press('Escape')
        deco_html = await html_export()
        check('the HTML export applies the same decoration', 'h1{border-left:6px solid #07c160;padding-left:12px}' in deco_html and 'box-shadow' not in deco_html)
        await pg.locator('.dashbar button[aria-label="导入 / 导出"]').click()
        await pg.get_by_role('menuitem', name='微信公众号…').first.click()
        wx = pg.locator('[data-testid=wechat-preview] iframe')
        await expect(wx).to_have_count(1, timeout=60000)
        wx_html = await wx.get_attribute('srcdoc')
        check('and so does the WeChat article, written inline', re.search(r'<h1 style="[^"]*border-left:6px solid #07c160;padding-left:12px', wx_html) is not None and re.search(r'<img [^>]*style="[^"]*padding:8px 8px 28px', wx_html) is not None and 'box-shadow' not in wx_html)
        await pg.keyboard.press('Escape')
        await open_theme()

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
