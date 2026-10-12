"""End-to-end checks for dashboards: data, filters, data mode, Sources, editing.
Run with `pnpm dev` up: python3 e2e/dash.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, asyncio, subprocess, time, json
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DASH = os.path.join(REPO, 'projects/revenue-dash')
CHROME = os.environ.get('DC_CHROME')

def read(path): return open(path, encoding='utf-8').read()
def write(path, text): open(path, 'w', encoding='utf-8').write(text)
def dataset(id): return json.loads(read(os.path.join(DASH, f'datasets/{id}.json')))
def restore():
    subprocess.run(['git', 'checkout', '--', 'projects/revenue-dash'], cwd=REPO)
    subprocess.run(['git', 'clean', '-fdq', '--', 'projects/revenue-dash'], cwd=REPO)
    subprocess.run(['rm', '-rf', os.path.join(REPO, 'projects/zz-dash')])

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
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(viewport={'width': 1440, 'height': 1000})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and '409 (Conflict)' not in m.text and '404 (Not Found)' not in m.text and errs.append(m.text))  # the 404 is the missing file the test points a dataset at
        fr = pg.frame_locator('.dashframe')

        # --- the page and its data ----------------------------------------------------
        await pg.goto(BASE + '/?p=revenue-dash')
        # a source opened before the page's first report (this once looped forever)
        await pg.locator('.srow').first.click()
        await expect(pg.locator('.sview h2')).to_be_visible()
        await pg.locator('.sview button', has_text='所有来源').click()
        await expect(fr.locator('#regionBody tr')).to_have_count(3)
        await expect(fr.locator('#kpis .v').first).to_have_text('$13.28M')
        check('a query, a CSV and a JSON file all load', await fr.locator('#itemBody tr').count() == 10 and await fr.locator('#goalChart rect').count() == 3)
        await expect(pg.locator('.srow')).to_have_count(8)
        check('every marked number agrees with its data', await pg.locator('.sproblems').count() == 0, await pg.locator('.dashside').inner_text())
        check('a dataset only a calc reads is not "unused"', await pg.locator('.srow .tag').count() == 0)
        check('the frame is sandboxed without same-origin', await pg.locator('.dashframe').get_attribute('sandbox') == 'allow-scripts')
        check('d3 and the theme tokens are there', await fr.locator('#dailyChart svg rect').count() > 90)
        await pg.screenshot(path=OUT + 'dash-page.png')

        # --- filters ----------------------------------------------------------------------
        await fr.locator('#mxRegion').select_option('EMEA')
        await expect(fr.locator('#kpis .v').first).to_have_text('$3.89M')
        await expect(pg.locator('.dashfilters .chip')).to_have_text('region：EMEA')
        check('a filter re-runs the query that names it', True)
        await fr.locator('#regionBody tr', has_text='APAC').click()
        await expect(fr.locator('#kpis .v').first).to_have_text('$2.05M')
        check('a click on a row sets the filter', await fr.locator('#cfPicked').inner_text() == 'APAC ×')
        await pg.locator('.dashfilters button', has_text='重置筛选').click()
        await expect(fr.locator('#kpis .v').first).to_have_text('$13.28M')
        check('reset returns to dash.json\'s defaults', await pg.locator('.dashfilters').count() == 0)

        # --- data mode -----------------------------------------------------------------------
        await pg.locator('.dashbar button', has_text='数据模式').click()
        await fr.locator('#regionBody tr', has_text='EMEA').locator('td').nth(3).click()
        await expect(pg.locator('.sview h2')).to_have_text('Revenue by region and month')
        check('a clicked table cell opens its source at that cell', await pg.locator('.scard .big').inner_text() == '1257789.78' and await pg.locator('.stable td.cell').inner_text() == '1257789.78')
        await fr.locator('#kpis .v').nth(2).click()
        await expect(pg.locator('.sview h2')).to_have_text('Revenue and invoice totals')
        check('a calculation shows its formula and inputs', '输入：daily' in await pg.locator('.sview').inner_text())
        await pg.screenshot(path=OUT + 'dash-data-mode.png')
        await pg.keyboard.press('Escape')
        await pg.locator('.sview button', has_text='所有来源').click()

        # --- a query edited, tested and saved --------------------------------------------------
        await pg.locator('.srow', has_text='Revenue by region and month').click()
        await pg.locator('.sview button', has_text='编辑查询').click()
        sql = pg.locator('textarea[aria-label="参数 sql"]')
        await sql.fill('DELETE FROM regions')
        await pg.locator('.seditq button', has_text='试运行').click()
        await expect(pg.locator('.seditq .badline')).to_contain_text('SELECT or WITH')
        check('the read-only rules refuse a write', True)
        original = dataset('by_region')['source']['args']['sql']
        await sql.fill(original.replace('ORDER BY month, revenue DESC', 'ORDER BY month, r.region'))
        await pg.locator('.seditq button', has_text='试运行').click()
        await expect(pg.locator('.seditq .okline')).to_contain_text('9 行')
        await pg.locator('.seditq button', has_text='保存').click()
        ok = await wait_for(lambda: dataset('by_region')['source']['args']['sql'].endswith('ORDER BY month, r.region'))
        check('saving writes datasets/<id>.json', ok)
        await expect(fr.locator('#regionBody tr').first).to_contain_text('APAC')
        await expect(fr.locator('#regionBody tr').nth(1)).to_contain_text('EMEA')

        # --- pause and resume -----------------------------------------------------------------
        await pg.locator('.sview button', has_text='停止自动刷新').click()
        ok = await wait_for(lambda: dataset('by_region')['source']['kind'] == 'file' and os.path.exists(os.path.join(DASH, 'data/by_region.json')))
        d = dataset('by_region')
        check('pausing keeps the rows as a file and the query as request', ok and d.get('request', {}).get('tool') == 'query' and len(json.loads(read(os.path.join(DASH, 'data/by_region.json')))['rows']) == 9, json.dumps(d)[:300])
        await expect(pg.locator('.sview summary', has_text='查询（不自动刷新）')).to_be_visible()
        await pg.locator('.sview button', has_text='所有来源').click()
        await expect(pg.locator('.srow', has_text='Revenue by region and month').locator('.tag')).to_have_text('不自动刷新')
        await expect(fr.locator('#regionBody tr')).to_have_count(3)
        await pg.locator('.srow', has_text='Revenue by region and month').click()
        await pg.locator('.sview button', has_text='恢复实时查询').click()
        ok = await wait_for(lambda: dataset('by_region')['source']['kind'] == 'query' and 'request' not in dataset('by_region'))
        check('resuming makes it live again', ok)
        await pg.locator('.sview button', has_text='所有来源').click()

        # --- an outside edit to a data file and to the page --------------------------------------
        csv = os.path.join(DASH, 'data/plans.csv')
        write(csv, read(csv).replace('Growth seats (monthly),Growth,seat-month,20,49300', 'Growth seats (monthly),Growth,seat-month,20,999999'))
        await expect(fr.locator('#itemBody tr').first).to_contain_text('$19,999,980')
        check('a data file changed on disk reloads what reads it', True)
        page = os.path.join(DASH, 'files/index.html')
        write(page, read(page).replace('<h1>Revenue · Q3 2026</h1>', '<h1>Revenue</h1>').replace(
            '<p class="mx-foot cf-foot">', '<p class="mx-foot cf-foot"><b data-source="q3" data-field="revenue" data-row="0">1</b> '))
        await expect(fr.locator('h1')).to_have_text('Revenue')
        check('the page reloads when its file changes', True)
        await expect(pg.locator('.sproblems')).to_contain_text('页面显示 1，数据里是')
        check('a mark that disagrees with its data is reported', True)
        runs = os.path.join(DASH, '.runs.json')
        ok = await wait_for(lambda: json.loads(read(runs))['flagged'] == 1)
        check('…and written to .runs.json for Claude Code', ok)
        check('…which git ignores', subprocess.run(['git', 'check-ignore', '-q', 'projects/revenue-dash/.runs.json'], cwd=REPO).returncode == 0)

        # --- a broken dataset ----------------------------------------------------------------------
        t = dataset('targets')
        t['source']['url'] = 'data/nope.json'
        write(os.path.join(DASH, 'datasets/targets.json'), json.dumps(t, ensure_ascii=False, indent=2))
        await expect(fr.locator('#goalChart .mx-fail')).to_be_visible()
        check('a failed source shows as failed on the page, and its calc too', 'no file data/nope.json' in await pg.locator('.sproblems').inner_text())
        check('…stamped on its marks', await fr.locator('#takeaway b[data-source=goal]').first.get_attribute('data-dash-source-state') == 'error')

        # --- code panel ------------------------------------------------------------------------------
        await pg.locator('.dashbar button', has_text='代码').click()
        ed = pg.locator('textarea.dashcode')
        await ed.fill(read(page).replace('<h1>Revenue</h1>', '<h1>Revenue overview</h1>'))
        await ed.press('Control+s')
        ok = await wait_for(lambda: '<h1>Revenue overview</h1>' in read(page))
        check('the code panel saves the page', ok)
        await expect(fr.locator('h1')).to_have_text('Revenue overview')

        # --- upload and a new dashboard -----------------------------------------------------------------
        restore()
        await pg.goto(BASE + '/')
        await pg.locator('.picker select').select_option('dashboard')
        await pg.locator('.picker input').fill('zz-dash')
        await pg.locator('.picker button[type="submit"]').click()
        await expect(pg.locator('.dashtitle')).to_have_text('zz-dash')
        await expect(fr.locator('h1')).to_have_text('zz-dash')
        check('a new dashboard starts with a page and no data', os.path.exists(os.path.join(REPO, 'projects/zz-dash/dash.json')) and await pg.locator('.srow').count() == 0)

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    restore()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
