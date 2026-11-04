"""End-to-end checks for the corner action bar on an active docs block: a table, a csv fence and a
mermaid diagram get their export actions at the block's corner, only while the cursor is in the
block (.design/block-corner-bar.md).
Run with `pnpm dev` up: python3 e2e/block_bar.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, asyncio, subprocess, time
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(REPO, 'projects/tingly-design-guide-doc')
CHROME = os.environ.get('DC_CHROME')

def read(path): return open(path, encoding='utf-8').read()
def write(path, text): open(path, 'w', encoding='utf-8').write(text)
def tab(id): return read(os.path.join(DOC, f'tabs/{id}.md'))
def restore():
    subprocess.run(['git', 'checkout', '--', 'projects/tingly-design-guide-doc'], cwd=REPO)
    subprocess.run(['git', 'clean', '-fdq', '--', 'projects/tingly-design-guide-doc'], cwd=REPO)

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

async def main():
    os.makedirs(OUT, exist_ok=True)
    restore()
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='zh-CN', viewport={'width': 1440, 'height': 950})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        body = pg.locator('.docbody')

        await pg.goto(BASE + '/?p=tingly-design-guide-doc')
        await expect(body.locator('h1')).to_have_text('Tingly Design handbook')
        check('nothing is active on load, so no bar', await pg.locator('.cbar').count() == 0)

        # --- a native table: three actions at its corner -----------------------------------------
        cell = body.locator('td', has_text='Live data pages')
        await cell.evaluate("e => e.scrollIntoView({block: 'center'})")
        await cell.click()
        bar = pg.locator('.cbar')
        await expect(bar).to_have_count(1)
        check('the table gets a bar with three actions', await bar.locator('button').count() == 3)
        labels = [await bar.locator('button').nth(i).get_attribute('aria-label') for i in range(3)]
        check('the words are the shared ones', labels == ['把这个表格下载为 CSV', '复制为 PNG', '保存为 PNG'], str(labels))
        table = await cell.evaluate("e => e.closest('table').getBoundingClientRect()")
        barbox = await bar.bounding_box()
        check('the bar hangs above the block, at its right corner',
              barbox['y'] + barbox['height'] <= table['top'] + 2 and barbox['x'] + barbox['width'] <= table['right'] + 20,
              f"bar {barbox} table {table}")
        async with pg.expect_download() as dl:
            await bar.locator('button[aria-label="把这个表格下载为 CSV"]').click()
        d = await dl.value
        csv = read(await d.path())
        check('the CSV downloads with the table in it', d.suggested_filename.endswith('.csv') and 'Dashboard' in csv and 'Project kinds' in csv, d.suggested_filename)
        await expect(bar).to_have_count(1)  # the click kept the cursor in the block
        async with pg.expect_download() as dl:
            await bar.locator('button[aria-label="保存为 PNG"]').click()
        d = await dl.value
        png = await d.path()
        check('a picture of the table downloads', d.suggested_filename.endswith('.png') and os.path.getsize(png) > 1000, d.suggested_filename)
        await body.locator('h1').click()
        await expect(bar).to_have_count(0)
        check('leaving the block takes the bar away', True)

        # --- a csv fence: its source is the file --------------------------------------------------
        before = tab('overview')
        write(os.path.join(DOC, 'tabs/overview.md'), before.rstrip('\n') + "\n\n```csv\nname,qty\nNails,240\nScrews,80\n```\n")
        fence = body.locator('.richcode[data-kind=table]')
        await expect(fence.locator('.rc-view td')).to_have_text('Nails', timeout=8000)
        await fence.locator('.rc-view td').first.click()
        await expect(bar).to_have_count(1)
        check('a drawn csv fence gets the bar too', await bar.locator('button').count() == 3)
        async with pg.expect_download() as dl:
            await bar.locator('button[aria-label="把这个表格下载为 CSV"]').click()
        d = await dl.value
        csv = read(await d.path())
        check('the fence hands its source over as the file', d.suggested_filename.endswith('.csv') and 'Nails,240' in csv, d.suggested_filename)
        async with pg.expect_download() as dl:
            await bar.locator('button[aria-label="保存为 PNG"]').click()
        d = await dl.value
        check('the drawn fence saves as a PNG named after the doc', d.suggested_filename.endswith('-table.png'), d.suggested_filename)

        # --- a mermaid diagram: only the picture pair ----------------------------------------------
        await pg.locator('.tabname', has_text='Architecture').click()
        diagram = body.locator('.richcode[data-kind=diagram]')
        await expect(diagram.locator('.rc-view svg')).to_have_count(1, timeout=8000)
        await diagram.locator('.rc-view svg').first.click()
        await expect(bar).to_have_count(1)
        labels = [await bar.locator('button').nth(i).get_attribute('aria-label') for i in range(await bar.locator('button').count())]
        check('a diagram gets only the picture pair', labels == ['复制为 PNG', '保存为 PNG'], str(labels))
        async with pg.expect_download() as dl:
            await bar.locator('button[aria-label="保存为 PNG"]').click()
        d = await dl.value
        check('the diagram saves as a PNG', d.suggested_filename.endswith('-diagram.png'), d.suggested_filename)
        await body.locator('h1').click()
        await expect(bar).to_have_count(0)

        check('no page errors', not errs, '; '.join(errs[:3]))
        await pg.screenshot(path=OUT + 'block-bar.png')
        await b.close()
    restore()
    print(f"\n{sum(1 for _, ok in results if ok)}/{len(results)} checks passed")
    raise SystemExit(0 if all(ok for _, ok in results) else 1)

asyncio.run(main())
