"""End-to-end checks for docs: rich-text editing written back block by block, tabs, comments, AI rewrite, export.
Run with `pnpm dev` up: python3 e2e/docs.py  (DC_CHROME=/path/to/chrome to use another Chromium)
The AI rewrite check needs the mock model (see README): it is skipped when the server has no API key."""
import re, os, shutil, asyncio, subprocess, time, json, urllib.request
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(REPO, 'projects/tingly-design-guide-doc')
CHROME = os.environ.get('DC_CHROME')

def read(path): return open(path, encoding='utf-8').read()
def write(path, text): open(path, 'w', encoding='utf-8').write(text)
def tab(id): return read(os.path.join(DOC, f'tabs/{id}.md'))
def index(): return json.loads(read(os.path.join(DOC, 'doc.json')))
def threads(): return json.loads(read(os.path.join(DOC, 'comments.json')))['threads']
def diff(path='projects/tingly-design-guide-doc'):
    out = subprocess.run(['git', 'diff', '--unified=0', '--', path], cwd=REPO, capture_output=True, text=True).stdout
    return [l for l in out.splitlines() if l[:1] in '+-' and l[:3] not in ('+++', '---')]
def restore():
    subprocess.run(['git', 'checkout', '--', 'projects/tingly-design-guide-doc'], cwd=REPO)
    subprocess.run(['git', 'clean', '-fdq', '--', 'projects/tingly-design-guide-doc'], cwd=REPO)
    subprocess.run(['rm', '-rf', os.path.join(REPO, 'projects/zz-doc')])

async def wait_for(pred, timeout=6.0):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if pred(): return True
        except Exception: pass
        await asyncio.sleep(0.1)
    return False

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

async def main():
    os.makedirs(OUT, exist_ok=True)
    restore()
    health = json.loads(urllib.request.urlopen(BASE.replace('5173', '8787') + '/api/health').read())
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='zh-CN', viewport={'width': 1440, 'height': 950})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and '409 (Conflict)' not in m.text and errs.append(m.text))
        body = pg.locator('.docbody')

        # --- reading ----------------------------------------------------------------
        await pg.goto(BASE + '/?p=tingly-design-guide-doc')
        await expect(body.locator('h1')).to_have_text('Tingly Design handbook')
        await expect(pg.locator('.tabrow')).to_have_count(5)
        check('tabs, subtabs and the outline', await pg.locator('.tabrow.sub').count() == 1 and await pg.locator('.outline button').count() == 4)
        check('a table, a task list and a quote render', await body.locator('table tr').count() == 7 and await body.locator('ul[data-type=taskList] li').count() == 5 and await body.locator('blockquote').count() == 1)
        await expect(body.locator('.cmark')).to_have_count(1)
        await pg.locator('button[data-more]').click()
        await pg.locator('[role=menuitem]:has-text("快捷键")').click()
        dlg = pg.locator('.shortcutsdlg')
        check('Keyboard shortcuts lists the keys of a doc and the common ones', await dlg.locator('kbd').filter(has_text='⌘↵').count() == 1 and await dlg.locator('kbd', has_text=re.compile(r'^⌘Z$')).count() == 1)
        await pg.keyboard.press('Escape')
        await expect(dlg).to_have_count(0)
        await pg.evaluate('document.activeElement && document.activeElement.blur()')
        await pg.keyboard.press('?')
        check('? opens the same list', await dlg.count() == 1)
        await pg.keyboard.press('Escape')
        check('a comment thread is pinned to its words', await body.locator('.cmark').inner_text() == 'the agents working beside them')
        # a link opens with ⌘/Ctrl-click, or with the selection menu's open button (issue #342); the target is stubbed so nothing leaves the machine
        await ctx.route('**github.com/tingly-dev/tingly-box**', lambda r: asyncio.ensure_future(r.fulfill(status=200, body='')))
        async with ctx.expect_page() as pop:
            await body.locator('a', has_text='Tingly Box').first.click(modifiers=['Meta'])
        opened = await pop.value
        await opened.wait_for_url(re.compile(r'^https://github\.com/tingly-dev/tingly-box'))  # a new tab starts at about:blank
        check('a link opens with ⌘/Ctrl-click', opened.url.startswith('https://github.com/tingly-dev/tingly-box'), opened.url)
        await opened.close()
        # double-click within the first word (the link's centre is the space between them), as with comments
        await body.locator('a', has_text='Tingly Box').first.dblclick(position={'x': 5, 'y': 9})
        await expect(pg.locator('.bubble button[aria-label="打开链接"]')).to_be_visible()
        async with ctx.expect_page() as pop:
            await pg.locator('.bubble button[aria-label="打开链接"]').click()
        opened = await pop.value
        await opened.wait_for_url(re.compile(r'^https://github\.com/tingly-dev/tingly-box'))
        check('the selection menu opens the link too', opened.url.startswith('https://github.com/tingly-dev/tingly-box'), opened.url)
        await opened.close()
        await ctx.unroute('**github.com/tingly-dev/tingly-box**')
        for t in ['Workflow', 'Write-back and sync', 'Project kinds', 'Architecture', 'Overview']:
            await pg.locator('.tabname', has_text=t).click()
            await expect(pg.locator('.tabrow.on .tabname')).to_have_text(t)
        await pg.wait_for_timeout(800)
        check('opening every tab writes nothing', not diff(), '\n'.join(diff()[:5]))
        await pg.screenshot(path=OUT + 'docs-page.png')

        # --- typing writes back only the block that changed ------------------------------
        await body.locator('p').first.click()
        await pg.keyboard.press('End')
        await pg.keyboard.type(' Comments welcome.')
        ok = await wait_for(lambda: 'the agents working beside them. Comments welcome.' in tab('overview'))
        d = diff()
        check('typing saves the tab', ok)
        check('…as a one-line diff', len(d) == 2 and d[1].endswith('Comments welcome.'), '\n'.join(d))
        await body.locator('ul[data-type=taskList] li').first.locator('input[type=checkbox]').click()
        ok = await wait_for(lambda: '- [x] Run `pnpm install`, then `pnpm dev`, and open `localhost:5173`' in tab('overview'))
        check('ticking a task writes [x]…', ok, tab('overview')[-300:])
        check('…changing that one line of the list', len(diff()) == 4, '\n'.join(diff()))
        await body.locator('td', has_text='Live data pages').click()
        await pg.keyboard.press('End')
        await pg.keyboard.type(', with checked numbers')
        ok = await wait_for(lambda: '| Dashboard | Live data pages, with checked numbers | `dash.json`, `datasets/`, `files/index.html` | `dashboard` |' in tab('overview'))
        check('editing a table cell changes that one row', ok and len(diff()) == 6, '\n'.join(diff()))

        # --- formatting, the slash menu ---------------------------------------------------
        h = body.locator('h2', has_text='Before your first edit')
        await h.evaluate("e => e.scrollIntoView({block: 'center'})")  # out from under the floating Claude bar
        await h.click()
        await pg.wait_for_timeout(200)  # the editor takes the new selection from the DOM a moment after the click
        await pg.keyboard.press('End')
        await pg.keyboard.press('Enter')
        await pg.keyboard.type('/h3')
        await expect(pg.locator('.slashmenu button[aria-selected=true]')).to_have_text('标题 3')
        await pg.keyboard.press('Enter')
        await pg.keyboard.type('Where files live')
        ok = await wait_for(lambda: '\n### Where files live\n' in tab('overview'))
        check('the / menu turns a line into a heading', ok, tab('overview')[-500:])
        await pg.keyboard.press('Enter')
        await pg.keyboard.type('See ')
        await pg.keyboard.type('Workflow')
        # Home means document-start on macOS, not line-start. Select only the
        # word with platform-independent character movement before using the menu.
        for _ in 'Workflow': await pg.keyboard.press('Shift+ArrowLeft')
        assert await pg.evaluate('window.getSelection().toString()') == 'Workflow'
        await pg.locator('.bubble button[aria-label="粗体"]').click()
        ok = await wait_for(lambda: 'See **Workflow**' in tab('overview'))
        check('the selection menu makes text bold', ok, [l for l in tab('overview').splitlines() if 'See ' in l])

        # --- text colour -----------------------------------------------------------------------
        await pg.keyboard.press('ArrowRight')  # collapse the selection to its end, then select the word again
        for _ in 'Workflow': await pg.keyboard.press('Shift+ArrowLeft')
        await pg.locator('.bubble button[aria-label="文字颜色"]').click()
        await pg.locator('.bubble .swatch[data-color=red]').click()
        ok = await wait_for(lambda: 'See <span data-color="red">**Workflow**</span>' in tab('overview') or 'See **<span data-color="red">Workflow</span>**' in tab('overview'))
        check('the selection menu colours text, kept as a span in the Markdown', ok, [l for l in tab('overview').splitlines() if 'See ' in l])
        await expect(body.locator('span[data-color=red]')).to_have_text('Workflow')
        css = await body.locator('span[data-color=red]').evaluate('e => getComputedStyle(e).color')
        check('the colour is drawn from a theme token', css != await body.locator('p').last.evaluate('e => getComputedStyle(e).color'), css)
        await pg.locator('.bubble button[aria-label="文字颜色"]').click()
        await pg.locator('.bubble button[aria-label="清除颜色"]').click()
        ok = await wait_for(lambda: 'data-color' not in tab('overview'))
        check('clearing the colour takes the span out', ok, [l for l in tab('overview').splitlines() if 'See ' in l])

        before = tab('overview')
        write(os.path.join(DOC, 'tabs/overview.md'), before.rstrip('\n') + "\n\nWritten by Claude Code: <span data-color='blue'>a blue phrase</span>.\n")
        await expect(body.locator('span[data-color=blue]')).to_have_text('a blue phrase')
        check('a span written outside the editor is drawn coloured', True)

        # --- someone else writes at the same time ------------------------------------------
        before = tab('overview')
        write(os.path.join(DOC, 'tabs/overview.md'), before.replace('## What Tingly Design is', '## What Tingly Design does'))
        await expect(body.locator('h2').first).to_have_text('What Tingly Design does')
        check('an outside edit arrives in the open tab', True)
        await body.locator('h2', has_text='Six project kinds').click()
        await pg.wait_for_timeout(200)  # as above: let the editor take the new selection
        await pg.keyboard.press('End')
        await pg.keyboard.type(' and their files')
        ok = await wait_for(lambda: '## Six project kinds and their files' in tab('overview') and '## What Tingly Design does' in tab('overview'))
        check('…and my next edit keeps it', ok, [l for l in tab('overview').splitlines() if l.startswith('#')])

        # --- comments -------------------------------------------------------------------------
        await body.locator('.cmark').click()
        await expect(pg.locator('.cthread.on')).to_contain_text('claude command')
        await pg.locator('.cthread.on textarea').fill('Agreed. Workflow now names Claude Code and the file watcher.')
        await pg.locator('.cthread.on button', has_text='发送').click()
        ok = await wait_for(lambda: threads()[0]['comments'][-1]['text'] == 'Agreed. Workflow now names Claude Code and the file watcher.')
        check('replying writes comments.json', ok)
        await pg.locator('.cthread.on [aria-label="添加表情回应"]').last.click()
        await pg.locator('.cthread.on .creact.pick[aria-label="👍"]').click()
        ok = await wait_for(lambda: bool(threads()[0]['comments'][-1].get('reactions', {}).get('👍')))
        check('a reaction is written on the comment', ok, json.dumps(threads()[0]['comments'][-1], ensure_ascii=False))
        await expect(pg.locator('.cthread.on .creact.mine').last).to_contain_text('1')
        await pg.locator('.cthread.on .creact.mine').last.click()
        ok = await wait_for(lambda: 'reactions' not in threads()[0]['comments'][-1])
        check('clicking my reaction takes it back', ok)
        await pg.locator('.cthread.on button', has_text='解决').click()
        ok = await wait_for(lambda: threads()[0].get('resolved') is True)
        check('resolving a thread', ok and await body.locator('.cmark').count() == 0)
        # The block's centre can be empty space after a wrapped line; double-click
        # within the first word so the comment is anchored to visible text.
        await body.locator('blockquote p').dblclick(position={'x': 20, 'y': 10})
        quote = await pg.evaluate('window.getSelection().toString()')
        assert quote.strip(), f'Expected selected comment text, got {quote!r}'
        await pg.locator('.bubble button[aria-label="评论"]').click()
        await pg.locator('.crail textarea').fill('Worth quoting on the first slide of the intro deck.')
        await pg.locator('.crail button', has_text='发送').first.click()
        ok = await wait_for(lambda: len(threads()) == 3 and threads()[2]['tab'] == 'overview' and threads()[2]['quote'] == quote and quote in tab('overview'))
        check('a new comment pinned to the selected words', ok, json.dumps(threads()[-1], ensure_ascii=False)[:300])
        await expect(body.locator('.cmark')).to_have_count(1)

        # --- tabs ---------------------------------------------------------------------------
        await pg.locator('.addtab').click()
        ok = await wait_for(lambda: any(t['title'] == '新的标签页' for t in index()['tabs']) and os.path.exists(os.path.join(DOC, 'tabs/tab.md')))
        check('adding a tab writes doc.json and tabs/<id>.md', ok, json.dumps(index()['tabs'], ensure_ascii=False))
        await expect(body.locator('h1')).to_have_text('新的标签页')
        await pg.locator('.tabrow.on .tabname').dblclick()
        await pg.locator('.tabrow input').fill('Glossary')
        await pg.locator('.tabrow input').press('Enter')
        ok = await wait_for(lambda: index()['tabs'][-1]['title'] == 'Glossary')
        check('renaming a tab', ok)
        await pg.locator('.tabrow.on .more').click()
        await pg.locator('.menu .mi', has_text='删除').click()
        ok = await wait_for(lambda: len(index()['tabs']) == 5 and not os.path.exists(os.path.join(DOC, 'tabs/tab.md')))
        check('deleting a tab removes its file', ok)
        # nothing asked: the toast's Undo brings the tab back with its text
        await pg.locator('.toast-act').click()
        ok = await wait_for(lambda: len(index()['tabs']) == 6 and os.path.exists(os.path.join(DOC, 'tabs/tab.md')))
        check('Undo in the toast brings a deleted tab back', ok, json.dumps(index()['tabs'], ensure_ascii=False))
        await pg.locator('.tabrow.on .more').click()
        await pg.locator('.menu .mi', has_text='删除').click()
        ok = await wait_for(lambda: len(index()['tabs']) == 5 and not os.path.exists(os.path.join(DOC, 'tabs/tab.md')))
        # the tab menu's duplicate (the same entry every kind's list menu has): a copy of the text right after the tab
        await pg.locator('.tabrow', has_text='Overview').first.hover()
        await pg.locator('.tabrow', has_text='Overview').first.locator('.more').click()
        await pg.locator('.menu .mi', has_text='复制').click()
        ok = await wait_for(lambda: len(index()['tabs']) == 6 and index()['tabs'][1]['title'] == 'Overview 副本' and tab(index()['tabs'][1]['id']) == tab('overview'))
        check('duplicating a tab copies its text right after it', ok, json.dumps(index()['tabs'], ensure_ascii=False))
        await pg.locator('.tabrow.on .more').click()
        await pg.locator('.menu .mi', has_text='删除').click()
        check('the copy can be deleted again', await wait_for(lambda: len(index()['tabs']) == 5))
        await pg.locator('.dashbar button[aria-label="版式"]').click()
        await pg.locator('.popmenu.settings .seg').nth(2).locator('button', has_text='宽').click()
        ok = await wait_for(lambda: index()['settings']['width'] == 'wide')
        check('layout settings write doc.json', ok and await pg.locator('.app.docs[data-width=wide]').count() == 1)

        # --- AI rewrite -------------------------------------------------------------------------
        if health.get('fastEdit'):
            await pg.locator('.tabname', has_text='Project kinds').click()
            await body.locator('p', has_text='Fast AI edits one artboard or passage').click(click_count=3)
            await pg.locator('.bubble button.spark', has_text='改短一些').click()
            await expect(pg.locator('.sparkpanel .sparktext')).to_contain_text('（已改写）')
            await pg.locator('.sparkpanel button', has_text='替换').click()
            ok = await wait_for(lambda: 'which edits them directly.（已改写）' in tab('kinds'))
            check('AI rewrite replaces the passage', ok, tab('kinds')[-400:])
            check('…and only that block changed', len(diff('projects/tingly-design-guide-doc/tabs/kinds.md')) == 2, '\n'.join(diff('projects/tingly-design-guide-doc/tabs/kinds.md')))
        else:
            print('SKIP AI rewrite (no ANTHROPIC_API_KEY on the server)')

        # --- code blocks that draw themselves -----------------------------------------------------
        await pg.locator('.tabname', has_text='Architecture').click()
        rc = body.locator('.richcode[data-kind=diagram]')
        await expect(rc.locator('.rc-view svg')).to_have_count(1, timeout=30000)
        check('a mermaid fence draws a diagram and hides its source', await rc.locator('pre').is_hidden())
        await rc.locator('.rc-view svg').click()
        await expect(rc.locator('pre')).to_be_visible()
        check('a click on the diagram brings the source back', 'flowchart' in await rc.locator('pre').inner_text())
        await body.locator('p', has_text='Both share one connection').click(click_count=3)
        await expect(body.locator('.richcode.rc-active')).to_have_count(0)
        await pg.keyboard.press('End')
        await pg.keyboard.press('Enter')
        await pg.keyboard.type('/formula')
        await pg.wait_for_timeout(400)
        await pg.keyboard.press('Enter')
        await expect(body.locator('.richcode[data-kind=math] .katex')).to_have_count(1, timeout=30000)
        check('/formula inserts a latex block that draws a formula', True)
        await pg.keyboard.type(' \\frac{')
        await expect(body.locator('.richcode.rc-error .rc-msg')).to_be_visible(timeout=10000)
        check('a broken formula says so and keeps its source', await body.locator('.richcode[data-kind=math] pre').is_visible())
        await pg.wait_for_timeout(800)
        md = read(os.path.join(DOC, 'tabs/architecture.md'))
        check('the file keeps plain fences', '```mermaid' in md and '```latex' in md, md[-300:])
        await pg.screenshot(path=OUT + 'docs-code-blocks.png')

        # --- earlier versions ---------------------------------------------------------------------
        shutil.rmtree(os.path.join(DOC, '.history'), ignore_errors=True)  # earlier runs leave copies, and one a minute is kept
        await pg.locator('.tabname', has_text='Overview').click()
        await body.locator('p').first.click()
        await pg.keyboard.press('End')
        await pg.keyboard.type(' ZZEDITED')
        ok = await wait_for(lambda: 'ZZEDITED' in tab('overview'))
        check('an edit is saved to the tab file', ok)
        await pg.locator('.dashbar button[data-versions]').click()
        await expect(pg.locator('.popmenu.versions .vlist button').first).to_be_visible()
        check('the text an edit replaced is kept as an earlier version', os.path.isdir(os.path.join(DOC, '.history')))
        await pg.locator('.popmenu.versions .vlist button').first.click()
        await expect(pg.locator('.popmenu.versions .vtext')).not_to_contain_text('ZZEDITED')
        await pg.locator('.popmenu.versions button.primary').click()
        ok = await wait_for(lambda: 'ZZEDITED' not in tab('overview'))
        check('restoring an earlier version writes it back', ok, tab('overview')[:300])
        shutil.rmtree(os.path.join(DOC, '.history'), ignore_errors=True)

        # --- a table as CSV -----------------------------------------------------------------------
        await pg.locator('.tabname', has_text='Overview').click()
        await body.locator('table td').first.click()
        async with pg.expect_download() as dl:
            await pg.get_by_role('button', name='把这个表格下载为 CSV').click()
        csv = read(await (await dl.value).path())
        check('a table downloads as CSV with its header row', csv.lstrip('\ufeff').startswith('Kind,') and csv.count('\n') == 7, csv[:120])

        # --- what Claude Code is told about the view ------------------------------------------------
        if health.get('claudeCli') is False:
            print('SKIP view context (no Claude Code CLI: the bar is disabled)')
        else:
            sent = []
            async def grab(route):
                sent.append(json.loads(route.request.post_data or '{}'))
                await route.fulfill(status=200, content_type='application/json', body='{"id":"e2e-ctx"}')
            await pg.route('**/api/projects/*/delegate', grab)
            await pg.locator('.tabname', has_text='Workflow').click()
            await body.locator('p').first.click()
            await pg.locator('.dsask textarea').fill('what is here?')
            await pg.locator('.dsask button[aria-label="发送"]').click()
            await wait_for(lambda: sent)
            ctx = (sent[0].get('context') or '') if sent else ''
            check('Claude Code is told the open tab and the block the cursor is in', 'tabs/workflow.md' in ctx and 'The cursor is in this paragraph' in ctx, ctx[:300])
            await pg.unroute('**/api/projects/*/delegate')

        # --- export -------------------------------------------------------------------------------
        await pg.locator('.dashbar button[aria-label="导入 / 导出"]').click()
        async with pg.expect_download() as dl:
            await pg.get_by_role('menuitem', name='HTML 网页').click()
        html = read(await (await dl.value).path())
        check('export the whole doc as HTML', '<h1>Project kinds</h1>' in html and '<table>' in html and 'overflow-x:auto' in html)

        # --- a new doc ----------------------------------------------------------------------------
        await pg.goto(BASE + '/')
        await pg.locator('.lnewbtn').click()
        await pg.locator('.menu [data-new="docs"] .mi').click()
        await pg.locator('[role=dialog] input[aria-label="名称"]').fill('zz-doc')
        await pg.locator('[role=dialog] button[type="submit"]').click()
        await expect(body.locator('h1')).to_have_text('zz-doc')
        check('a new doc starts with one tab', os.path.exists(os.path.join(REPO, 'projects/zz-doc/tabs/main.md')))

        # a table wider than the page scrolls in place; the page itself does not (issue #341)
        await body.locator('h1').click()
        await pg.keyboard.press('End')
        await pg.keyboard.press('Enter')
        await pg.keyboard.type('/table')
        await expect(pg.locator('.slashmenu button[aria-selected=true]')).to_have_text('表格')
        await pg.keyboard.press('Enter')
        await expect(body.locator('table')).to_have_count(1)
        await body.locator('table td').first.click()
        await pg.keyboard.type('x' * 240)
        wide = await pg.evaluate(
            "() => ({ wrap: getComputedStyle(document.querySelector('.docbody .tableWrapper')).overflowX,"
            " page: document.querySelector('.docscroll').scrollWidth - document.querySelector('.docscroll').clientWidth })")
        check('a table wider than the page scrolls in place', wide['wrap'] == 'auto' and wide['page'] <= 1, json.dumps(wide))

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    restore()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
