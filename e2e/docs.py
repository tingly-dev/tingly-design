"""End-to-end checks for docs: rich-text editing written back block by block, tabs, comments, AI rewrite, export.
Run with `pnpm dev` up: python3 e2e/docs.py  (DC_CHROME=/path/to/chrome to use another Chromium)
The AI rewrite check needs the mock model (see README): it is skipped when the server has no API key."""
import os, asyncio, subprocess, time, json, urllib.request
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(REPO, 'projects/handbook')
CHROME = os.environ.get('DC_CHROME')

def read(path): return open(path, encoding='utf-8').read()
def write(path, text): open(path, 'w', encoding='utf-8').write(text)
def tab(id): return read(os.path.join(DOC, f'tabs/{id}.md'))
def index(): return json.loads(read(os.path.join(DOC, 'doc.json')))
def threads(): return json.loads(read(os.path.join(DOC, 'comments.json')))['threads']
def diff(path='projects/handbook'):
    out = subprocess.run(['git', 'diff', '--unified=0', '--', path], cwd=REPO, capture_output=True, text=True).stdout
    return [l for l in out.splitlines() if l[:1] in '+-' and l[:3] not in ('+++', '---')]
def restore():
    subprocess.run(['git', 'checkout', '--', 'projects/handbook'], cwd=REPO)
    subprocess.run(['git', 'clean', '-fdq', '--', 'projects/handbook'], cwd=REPO)
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
        ctx = await b.new_context(viewport={'width': 1440, 'height': 950})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and '409 (Conflict)' not in m.text and errs.append(m.text))
        body = pg.locator('.docbody')

        # --- reading ----------------------------------------------------------------
        await pg.goto(BASE + '/?p=handbook')
        await expect(body.locator('h1')).to_have_text('Tingly Design 上手手册')
        await expect(pg.locator('.tabrow')).to_have_count(4)
        check('tabs, subtabs and the outline', await pg.locator('.tabrow.sub').count() == 1 and await pg.locator('.outline button').count() == 4)
        check('a table, a task list and a quote render', await body.locator('table tr').count() == 6 and await body.locator('ul[data-type=taskList] li').count() == 5 and await body.locator('blockquote').count() == 1)
        await expect(body.locator('.cmark')).to_have_count(1)
        check('a comment thread is pinned to its words', await body.locator('.cmark').inner_text() == '第一周能独立改一个功能')
        for t in ['开发流程', '代码评审', '常见问题', '概览']:
            await pg.locator('.tabname', has_text=t).click()
            await expect(pg.locator('.tabrow.on .tabname')).to_have_text(t)
        await pg.wait_for_timeout(800)
        check('opening every tab writes nothing', not diff(), '\n'.join(diff()[:5]))
        await pg.screenshot(path=OUT + 'docs-page.png')

        # --- typing writes back only the block that changed ------------------------------
        await body.locator('p').first.click()
        await pg.keyboard.press('End')
        await pg.keyboard.type('欢迎提问。')
        ok = await wait_for(lambda: '第一周能独立改一个功能。欢迎提问。' in tab('overview'))
        d = diff()
        check('typing saves the tab', ok)
        check('…as a one-line diff', len(d) == 2 and d[1].endswith('欢迎提问。'), '\n'.join(d))
        await body.locator('ul[data-type=taskList] li').first.locator('input[type=checkbox]').click()
        ok = await wait_for(lambda: '- [x] 装好 Node 22 和 pnpm 10' in tab('overview'))
        check('ticking a task writes [x]…', ok, tab('overview')[-300:])
        check('…changing that one line of the list', len(diff()) == 4, '\n'.join(diff()))
        await body.locator('td', has_text='组件、资源').click()
        await pg.keyboard.press('End')
        await pg.keyboard.type('、示例')
        ok = await wait_for(lambda: '| 设计系统 | `design-system.json` | `tokens.json`、组件、资源、示例 |' in tab('overview'))
        check('editing a table cell changes that one row', ok and len(diff()) == 6, '\n'.join(diff()))

        # --- formatting, the slash menu ---------------------------------------------------
        h = body.locator('h2', has_text='第一天')
        await h.evaluate("e => e.scrollIntoView({block: 'center'})")  # out from under the floating Claude bar
        await h.click()
        await pg.wait_for_timeout(200)  # the editor takes the new selection from the DOM a moment after the click
        await pg.keyboard.press('End')
        await pg.keyboard.press('Enter')
        await pg.keyboard.type('/h3')
        await expect(pg.locator('.slashmenu button[aria-selected=true]')).to_have_text('标题 3')
        await pg.keyboard.press('Enter')
        await pg.keyboard.type('准备工作')
        ok = await wait_for(lambda: '\n### 准备工作\n' in tab('overview'))
        check('the / menu turns a line into a heading', ok, tab('overview')[-500:])
        await pg.keyboard.press('Enter')
        await pg.keyboard.type('先读 ')
        await pg.keyboard.type('README')
        await pg.keyboard.press('Shift+Home')
        for _ in range(3): await pg.keyboard.press('Shift+ArrowRight')
        await pg.locator('.bubble button[aria-label="粗体"]').click()
        ok = await wait_for(lambda: '先读 **README**' in tab('overview'))
        check('the selection menu makes text bold', ok, [l for l in tab('overview').splitlines() if '先读' in l])

        # --- someone else writes at the same time ------------------------------------------
        before = tab('overview')
        write(os.path.join(DOC, 'tabs/overview.md'), before.replace('## 它是什么', '## 它是做什么的'))
        await expect(body.locator('h2').first).to_have_text('它是做什么的')
        check('an outside edit arrives in the open tab', True)
        await body.locator('h2', has_text='五种项目').click()
        await pg.keyboard.press('End')
        await pg.keyboard.type('一览')
        ok = await wait_for(lambda: '## 五种项目一览' in tab('overview') and '## 它是做什么的' in tab('overview'))
        check('…and my next edit keeps it', ok)

        # --- comments -------------------------------------------------------------------------
        await body.locator('.cmark').click()
        await expect(pg.locator('.cthread.on')).to_contain_text('good first issue')
        await pg.locator('.cthread.on textarea').fill('好主意，我来加。')
        await pg.locator('.cthread.on button', has_text='发送').click()
        ok = await wait_for(lambda: threads()[0]['comments'][-1]['text'] == '好主意，我来加。')
        check('replying writes comments.json', ok)
        await pg.locator('.cthread.on button', has_text='解决').click()
        ok = await wait_for(lambda: threads()[0].get('resolved') is True)
        check('resolving a thread', ok and await body.locator('.cmark').count() == 0)
        await body.locator('blockquote p').dblclick()
        await pg.locator('.bubble button[aria-label="评论"]').click()
        await pg.locator('.crail textarea').fill('这句可以放到 README 里。')
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
        await pg.locator('.tabrow input').fill('术语表')
        await pg.locator('.tabrow input').press('Enter')
        ok = await wait_for(lambda: index()['tabs'][-1]['title'] == '术语表')
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
            await pg.locator('.tabname', has_text='常见问题').click()
            await body.locator('p', has_text='委托会调用').click(click_count=3)
            await pg.locator('.bubble button.spark', has_text='改短一些').click()
            await expect(pg.locator('.sparkpanel .sparktext')).to_contain_text('（已改写）')
            await pg.locator('.sparkpanel button', has_text='替换').click()
            ok = await wait_for(lambda: '版本。（已改写）' in tab('faq') or '再看编辑器右下角的提示。（已改写）' in tab('faq'))
            check('AI rewrite replaces the passage', ok, tab('faq')[-400:])
            check('…and only that block changed', len(diff('projects/handbook/tabs/faq.md')) == 2, '\n'.join(diff('projects/handbook/tabs/faq.md')))
        else:
            print('SKIP AI rewrite (no ANTHROPIC_API_KEY on the server)')

        # --- export -------------------------------------------------------------------------------
        await pg.locator('.dashbar button', has_text='导出').click()
        async with pg.expect_download() as dl:
            await pg.locator('.popmenu button', has_text='整个文档（HTML）').click()
        html = read(await (await dl.value).path())
        check('export the whole doc as HTML', '<h1>常见问题</h1>' in html and '<table>' in html)

        # --- a new doc ----------------------------------------------------------------------------
        await pg.goto(BASE + '/')
        await pg.locator('.picker select').select_option('docs')
        await pg.locator('.picker input').fill('zz-doc')
        await pg.locator('.picker button[type="submit"]').click()
        await expect(body.locator('h1')).to_have_text('zz-doc')
        check('a new doc starts with one tab', os.path.exists(os.path.join(REPO, 'projects/zz-doc/tabs/main.md')))

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    restore()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
