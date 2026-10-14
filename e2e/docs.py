"""End-to-end checks for docs: rich-text editing written back block by block, tabs, comments, AI rewrite, export.
Run with `pnpm dev` up: python3 e2e/docs.py  (DC_CHROME=/path/to/chrome to use another Chromium)
The AI rewrite check needs the mock model (see README): it is skipped when the server has no API key."""
import os, asyncio, subprocess, time, json, urllib.request
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(REPO, 'projects/design-guide')
CHROME = os.environ.get('DC_CHROME')

def read(path): return open(path, encoding='utf-8').read()
def write(path, text): open(path, 'w', encoding='utf-8').write(text)
def tab(id): return read(os.path.join(DOC, f'tabs/{id}.md'))
def index(): return json.loads(read(os.path.join(DOC, 'doc.json')))
def threads(): return json.loads(read(os.path.join(DOC, 'comments.json')))['threads']
def diff(path='projects/design-guide'):
    out = subprocess.run(['git', 'diff', '--unified=0', '--', path], cwd=REPO, capture_output=True, text=True).stdout
    return [l for l in out.splitlines() if l[:1] in '+-' and l[:3] not in ('+++', '---')]
def restore():
    subprocess.run(['git', 'checkout', '--', 'projects/design-guide'], cwd=REPO)
    subprocess.run(['git', 'clean', '-fdq', '--', 'projects/design-guide'], cwd=REPO)
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
        await pg.goto(BASE + '/?p=design-guide')
        await expect(body.locator('h1')).to_have_text('Tingly Design handbook')
        await expect(pg.locator('.tabrow')).to_have_count(4)
        check('tabs, subtabs and the outline', await pg.locator('.tabrow.sub').count() == 1 and await pg.locator('.outline button').count() == 4)
        check('a table, a task list and a quote render', await body.locator('table tr').count() == 7 and await body.locator('ul[data-type=taskList] li').count() == 5 and await body.locator('blockquote').count() == 1)
        await expect(body.locator('.cmark')).to_have_count(1)
        check('a comment thread is pinned to its words', await body.locator('.cmark').inner_text() == 'the agents working beside them')
        for t in ['Workflow', 'Write-back and sync', 'Project kinds', 'Overview']:
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
        await pg.keyboard.press('Shift+Home')
        for _ in range(4): await pg.keyboard.press('Shift+ArrowRight')
        await pg.locator('.bubble button[aria-label="粗体"]').click()
        ok = await wait_for(lambda: 'See **Workflow**' in tab('overview'))
        check('the selection menu makes text bold', ok, [l for l in tab('overview').splitlines() if 'See ' in l])

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
        await pg.locator('.cthread.on button', has_text='解决').click()
        ok = await wait_for(lambda: threads()[0].get('resolved') is True)
        check('resolving a thread', ok and await body.locator('.cmark').count() == 0)
        await body.locator('blockquote p').dblclick()
        await pg.locator('.bubble button[aria-label="评论"]').click()
        await pg.locator('.crail textarea').fill('Worth quoting on the first slide of the intro deck.')
        await pg.locator('.crail button', has_text='发送').first.click()
        ok = await wait_for(lambda: len(threads()) == 3 and threads()[2]['tab'] == 'overview' and threads()[2]['quote'] in tab('overview'))
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
        pg.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.locator('.tabrow.on .more').click()
        await pg.locator('.tabmenu button', has_text='删除').click()
        ok = await wait_for(lambda: len(index()['tabs']) == 4 and not os.path.exists(os.path.join(DOC, 'tabs/tab.md')))
        check('deleting a tab removes its file', ok)
        await pg.locator('.dashbar button', has_text='版式').click()
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
            check('…and only that block changed', len(diff('projects/design-guide/tabs/kinds.md')) == 2, '\n'.join(diff('projects/design-guide/tabs/kinds.md')))
        else:
            print('SKIP AI rewrite (no ANTHROPIC_API_KEY on the server)')

        # --- export -------------------------------------------------------------------------------
        await pg.locator('.dashbar button', has_text='导出').click()
        async with pg.expect_download() as dl:
            await pg.locator('.popmenu button', has_text='整个文档（HTML）').click()
        html = read(await (await dl.value).path())
        check('export the whole doc as HTML', '<h1>Project kinds</h1>' in html and '<table>' in html)

        # --- a new doc ----------------------------------------------------------------------------
        await pg.goto(BASE + '/')
        await pg.locator('.lstrip [data-new="docs"]').click()
        await pg.locator('[role=dialog] .where .linkish').click()
        await pg.locator('[role=dialog] input[aria-label="新项目名称"]').fill('zz-doc')
        await pg.locator('[role=dialog] button[type="submit"]').click()
        await expect(body.locator('h1')).to_have_text('zz-doc')
        check('a new doc starts with one tab', os.path.exists(os.path.join(REPO, 'projects/zz-doc/tabs/main.md')))

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    restore()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
