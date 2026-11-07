"""End-to-end checks for the WeChat Official Account export of a doc: the menu item and its tab twin, the
preview (the issues above, the article at the platform's column width below, the doc's own look by default), Copy putting inline-styled rich text (pictures inside, the
Mermaid block drawn into a picture) on the clipboard, Save as HTML, and the tab scope.
The sample doc with every element (projects/tingly-design-wechat-doc) is opened for the visual part, and pictures of it in
both looks are kept in e2e/out/.
Run with `pnpm dev` up: python3 e2e/wechat.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, asyncio, json, re, subprocess, time
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
CHROME = os.environ.get('DC_CHROME')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(REPO, 'projects/tingly-design-wechat-doc')

def restore():
    subprocess.run(['git', 'checkout', '--', 'projects/tingly-design-wechat-doc'], cwd=REPO)
    subprocess.run(['git', 'clean', '-fdq', '--', 'projects/tingly-design-wechat-doc'], cwd=REPO)
OUT = os.path.join(REPO, 'e2e', 'out') + '/'
CLIP = '''async () => { const [it] = await navigator.clipboard.read(); if (!it.types.includes('text/html')) return null;
  return { types: it.types, html: await (await it.getType('text/html')).text(), text: it.types.includes('text/plain') ? await (await it.getType('text/plain')).text() : '' }; }'''

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

async def shoot(ctx, dlg, name):
    # the whole article at the platform's column width, on a page of its own: what a reader of it sees
    html = await dlg.locator('iframe').get_attribute('srcdoc')
    page = await ctx.new_page()
    await page.set_viewport_size({'width': 677, 'height': 900})
    await page.set_content(html)
    await page.wait_for_timeout(300)
    await page.screenshot(path=OUT + name, full_page=True)
    await page.close()

async def open_menu(pg):
    await pg.locator('.dashbar button[aria-label="导入 / 导出"]').click()

async def main():
    restore()
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='zh-CN', viewport={'width': 1440, 'height': 950}, accept_downloads=True, permissions=['clipboard-read', 'clipboard-write'])
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and '409 (Conflict)' not in m.text and errs.append(m.text))
        await pg.goto(BASE + '/?p=tingly-design-guide-doc')
        await expect(pg.locator('.docbody h1')).to_have_text('Tingly Design handbook')

        # --- the menu ------------------------------------------------------------------------------
        await open_menu(pg)
        check('the Export menu has the WeChat item and its tab twin', await pg.get_by_role('menuitem', name=re.compile('微信公众号')).count() == 2)

        # --- the preview of the whole doc ----------------------------------------------------------------
        await pg.locator('[role=menuitem]:has-text("微信公众号…")').first.click()
        dlg = pg.locator('[data-testid=wechat-preview]')
        await expect(dlg).to_be_visible()
        frame = dlg.locator('iframe')
        await expect(frame).to_have_count(1, timeout=30000)
        doc = await frame.get_attribute('srcdoc')
        box = await dlg.locator('.wp-frame').bounding_box()
        check('the preview is wide enough to read (the platform column, not a phone)', box and box['width'] >= 600, box)
        head = await dlg.locator('.wp-issues').bounding_box()
        check('the issues sit above the article, not beside it', head and head['y'] + head['height'] <= box['y'] + 1 and head['width'] >= box['width'] - 2, (head, box))
        check('it follows the doc: the doc\'s own look, nothing added', '文档自己的样子' in await dlg.locator('[data-testid=wechat-style]').inner_text() and '#07c160' not in doc.lower())
        check('the article carries only inline styles', doc and '<style' not in doc and 'var(' not in doc and re.sub(r'class="(code-snippet|ProseMirror-trailingBreak)[^"]*"', '', doc).count(' class=') == 0 and doc.count('style="') > 40, (doc or '')[:200])
        check('the headings, the table and the code are in it', doc and '<h1 style="' in doc and '<table style="' in doc and 'code-snippet' in doc and 'data-lang=' in doc)
        check('the Mermaid block became a picture', doc and re.search(r'<img src="data:image/png;base64,', doc) is not None)
        check('the issue list says what changed', await dlg.locator('[data-testid=wechat-issues] li').count() >= 1)
        check('the scope line says the whole doc', '整篇文档' in await dlg.locator('.wp-scope').inner_text())

        # --- Copy ------------------------------------------------------------------------------------
        await dlg.get_by_role('button', name='复制', exact=True).click()
        got = None
        for _ in range(40):
            got = await pg.evaluate(CLIP)
            if got: break
            await asyncio.sleep(0.25)
        check('Copy puts rich text on the clipboard', got and 'text/html' in got['types'] and 'text/plain' in got['types'], got and got['types'])
        check('the clipboard article is inline-styled with its pictures inside', got and '<style' not in got['html'] and 'data:image/png' in got['html'] and 'style="' in got['html'])
        check('its plain twin carries the words', got and 'Status: Draft for review' in got['text'] and 'style=' not in got['text'], got and got['text'][:200])

        # --- Save as HTML ------------------------------------------------------------------------------
        async with pg.expect_download() as dl:
            await dlg.get_by_role('button', name='保存为 HTML').click()
        d = await dl.value
        saved = open(await d.path(), encoding='utf-8').read()
        check('Save as HTML downloads the page named after the doc', d.suggested_filename.endswith('-wechat.html') and saved.startswith('<!doctype html>') and 'data:image/png' in saved, d.suggested_filename)
        await pg.keyboard.press('Escape')
        await expect(dlg).to_have_count(0)

        # --- one tab ---------------------------------------------------------------------------------
        await pg.locator('.tabname', has_text='Workflow').click()
        await open_menu(pg)
        await pg.locator('[role=menuitem]:has-text("微信公众号（当前标签页）…")').click()
        await expect(dlg.locator('iframe')).to_have_count(1, timeout=30000)
        scope = await dlg.locator('.wp-scope').inner_text()
        tabdoc = await dlg.locator('iframe').get_attribute('srcdoc')
        check('the tab scope names the tab', 'Workflow' in scope, scope)
        check('and holds that tab only', tabdoc and len(tabdoc) < len(doc) and 'Tingly Design handbook' not in tabdoc, (len(tabdoc or ''), len(doc or '')))
        await pg.keyboard.press('Escape')

        # --- a Mermaid block ---------------------------------------------------------------------------
        await pg.locator('.tabname', has_text='Architecture').click()
        await open_menu(pg)
        await pg.locator('[role=menuitem]:has-text("微信公众号（当前标签页）…")').click()
        await expect(dlg.locator('iframe')).to_have_count(1, timeout=30000)
        arch = await dlg.locator('iframe').get_attribute('srcdoc')
        # the tab has one picture of its own and one Mermaid block: both are pictures in the article
        check('a Mermaid block is drawn into a picture beside the tab\'s own', arch and arch.count('<img src="data:image/png;base64,') == 2 and '<svg' not in arch, arch and arch.count('<img'))
        check('and nothing is left for the person to fix', 'Nothing' in await dlg.locator('[data-testid=wechat-issues]').inner_text() or '没有需要手工处理' in await dlg.locator('[data-testid=wechat-issues]').inner_text())
        await pg.keyboard.press('Escape')

        # --- the sample doc with every element, and the WeChat look as a design system the doc wears --------------------
        # (projects/tingly-design-wechat-doc: two tabs, so the whole-doc article also shows the divider between them)
        await pg.goto(BASE + '/?p=tingly-design-wechat-doc')
        await expect(pg.locator('.docbody h1')).to_have_text('一级标题 Heading 1', timeout=15000)
        await open_menu(pg)
        await pg.locator('[role=menuitem]:has-text("微信公众号…")').first.click()
        await expect(dlg.locator('iframe')).to_have_count(1, timeout=60000)
        plain = await dlg.locator('iframe').get_attribute('srcdoc')
        tags = ['<h1 ', '<h2 ', '<h3 ', '<h4 ', '<h5 ', '<h6 ', '<blockquote ', '<ul ', '<ol ', '<table ', '<th ', '<pre ', '<hr ', '<sup ', '<br>']
        check('every element of the sample doc is in the article', plain and all(t in plain for t in tags), [t for t in tags if t not in (plain or '')])
        check('both drawn blocks and the local picture are pictures; the csv is a table', plain and plain.count('<img src="data:image/') == 3 and plain.count('<table ') == 2, plain and plain.count('<img'))
        check('the tabs are joined by one divider and their names are not in the article', plain and '怎么用这份文档' in plain and 'All elements' not in plain and 'How to use' not in plain)
        issues = await dlg.locator('[data-testid=wechat-issues]').inner_text()
        check('the issue list names the links and the raw HTML', '链接' in issues and 'HTML' in issues, issues)
        check('there is no look picker of its own: the style is the doc\'s, with a way to change it', await dlg.locator('.seg').count() == 0 and await dlg.locator('[data-wechat-change]').count() == 1 and await dlg.locator('[data-wechat-look]').count() == 1)
        await dlg.locator('.wp-frame').screenshot(path=OUT + 'wechat-all-doc.png')
        # one step: the WeChat look is installed and worn, in the editor and in the article
        await dlg.locator('[data-wechat-look]').click()
        await expect(dlg.locator('[data-testid=wechat-style]')).to_contain_text('WeChat', timeout=15000)
        green = await dlg.locator('iframe').get_attribute('srcdoc')
        check('wearing the WeChat look turns the article green and gives it its page', green and '#07c160' in green.lower() and 'background-color:#ffffff' in green.lower() and '#07c160' not in plain.lower())
        check('the doc keeps the choice in its files, not colours', json.load(open(os.path.join(SAMPLE, 'doc.json')))['theme'] == {'system': 'look-wechat', 'theme': 'light'} and os.path.exists(os.path.join(SAMPLE, 'ds/look-wechat/tokens.json')))
        check('the choice button goes away once a system is worn', await dlg.locator('[data-wechat-look]').count() == 0)
        await dlg.locator('.wp-frame').screenshot(path=OUT + 'wechat-all-green.png')
        await pg.reload()
        await expect(pg.locator('.docbody h1')).to_have_text('一级标题 Heading 1', timeout=15000)
        check('the editor shows the same look, from the same values', await pg.locator('.app.docs[data-wears]').count() == 1 and await pg.locator('.docbody a').first.evaluate('e => getComputedStyle(e).color') == 'rgb(7, 193, 96)')
        await open_menu(pg)
        await pg.locator('[role=menuitem]:has-text("微信公众号…")').first.click()
        await expect(dlg.locator('iframe')).to_have_count(1, timeout=60000)
        check('the look is still worn after a reload', 'WeChat' in await dlg.locator('[data-testid=wechat-style]').inner_text())
        await dlg.locator('[data-wechat-change]').click()
        await expect(pg.locator('[data-testid=doc-theme]')).to_be_visible()
        check('Change… opens the doc\'s Theme', await pg.locator('[data-theme-card="look-wechat/light"][aria-pressed=true]').count() == 1)

        check('no page errors', not errs, repr(errs[:5]))
        await b.close()
    restore()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
