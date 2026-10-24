"""End-to-end checks for dashboards: data, filters, data mode, Sources, editing.
Run with `pnpm dev` up: python3 e2e/dash.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, asyncio, subprocess, time, json
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DASH = os.path.join(REPO, 'projects/tingly-box-usage-dashboard')
CHROME = os.environ.get('DC_CHROME')

def read(path): return open(path, encoding='utf-8').read()
def write(path, text): open(path, 'w', encoding='utf-8').write(text)
def dataset(id): return json.loads(read(os.path.join(DASH, f'datasets/{id}.json')))
def restore():
    subprocess.run(['git', 'checkout', '--', 'projects/tingly-box-usage-dashboard'], cwd=REPO)
    subprocess.run(['git', 'clean', '-fdq', '--', 'projects/tingly-box-usage-dashboard'], cwd=REPO)
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
        ctx = await b.new_context(locale='zh-CN', viewport={'width': 1440, 'height': 1000})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and '409 (Conflict)' not in m.text and '404 (Not Found)' not in m.text and errs.append(m.text))  # the 404 is the missing file the test points a dataset at
        fr = pg.frame_locator('.dashframe')

        # --- the page and its data ----------------------------------------------------
        await pg.goto(BASE + '/?p=tingly-box-usage-dashboard')
        # a source opened before the page's first report (this once looped forever)
        await pg.locator('.srow').first.click()
        await expect(pg.locator('.sview h2')).to_be_visible()
        await pg.locator('.sview button', has_text='所有来源').click()
        await expect(fr.locator('#providerBody tr')).to_have_count(5)
        await expect(fr.locator('#kpis .v').first).to_have_text('359,161')
        check('a query, a CSV and a JSON file all load', await fr.locator('#memberBody tr').count() == 10 and await fr.locator('#goalChart rect').count() == 4)
        await expect(pg.locator('.srow')).to_have_count(8)
        check('every marked number agrees with its data', await pg.locator('.sproblems').count() == 0, await pg.locator('.dashside').inner_text())
        check('a dataset only a calc reads is not "unused"', await pg.locator('.srow .tag').count() == 0)
        check('the frame is sandboxed without same-origin', await pg.locator('.dashframe').get_attribute('sandbox') == 'allow-scripts')
        check('d3 and the theme tokens are there', await fr.locator('#dailyChart svg rect').count() > 90)
        await pg.screenshot(path=OUT + 'dash-page.png')

        # --- filters ----------------------------------------------------------------------
        await fr.locator('#tbProvider').select_option('OpenAI')
        await expect(fr.locator('#kpis .v').first).to_have_text('74,436')
        await expect(pg.locator('.dashfilters .chip')).to_have_text('provider：OpenAI')
        check('a filter re-runs the query that names it', True)
        await fr.locator('#providerBody tr', has_text='DeepSeek').click()
        await expect(fr.locator('#kpis .v').first).to_have_text('50,321')
        check('a click on a row sets the filter', await fr.locator('#tbPicked').inner_text() == 'DeepSeek ×')
        await pg.locator('.dashfilters button', has_text='重置筛选').click()
        await expect(fr.locator('#kpis .v').first).to_have_text('359,161')
        check('reset returns to dash.json\'s defaults', await pg.locator('.dashfilters').count() == 0)

        # --- data mode -----------------------------------------------------------------------
        await pg.locator('.dashbar button[aria-label="数据模式"]').click()
        await fr.locator('#providerBody tr', has_text='OpenAI').locator('td').nth(7).click()
        await expect(pg.locator('.sview h2')).to_have_text('Usage by provider and month')
        check('a clicked table cell opens its source at that cell', await pg.locator('.scard .big').inner_text() == '520.38' and await pg.locator('.stable td.cell').inner_text() == '520.38')
        await fr.locator('#kpis .v').nth(2).click()
        await expect(pg.locator('.sview h2')).to_have_text('Usage totals')
        check('a calculation shows its formula and inputs', '输入：daily' in await pg.locator('.sview').inner_text())
        await pg.screenshot(path=OUT + 'dash-data-mode.png')
        await pg.keyboard.press('Escape')
        await pg.locator('.sview button', has_text='所有来源').click()

        # --- a query edited, tested and saved --------------------------------------------------
        await pg.locator('.srow', has_text='Usage by provider and month').click()
        await pg.locator('.sview button', has_text='编辑查询').click()
        sql = pg.locator('textarea[aria-label="参数 sql"]')
        await sql.fill('DELETE FROM providers')
        await pg.locator('.seditq button', has_text='试运行').click()
        await expect(pg.locator('.seditq .badline')).to_contain_text('SELECT or WITH')
        check('the read-only rules refuse a write', True)
        original = dataset('by_provider')['source']['args']['sql']
        await sql.fill(original.replace('ORDER BY month, cost_usd DESC', 'ORDER BY month, p.provider'))
        await pg.locator('.seditq button', has_text='试运行').click()
        await expect(pg.locator('.seditq .okline')).to_contain_text('15 行')
        await pg.locator('.seditq button', has_text='保存').click()
        ok = await wait_for(lambda: dataset('by_provider')['source']['args']['sql'].endswith('ORDER BY month, p.provider'))
        check('saving writes datasets/<id>.json', ok)
        await expect(fr.locator('#providerBody tr').nth(1)).to_contain_text('DeepSeek')
        await expect(fr.locator('#providerBody tr').nth(3)).to_contain_text('OpenAI')

        # --- pause and resume -----------------------------------------------------------------
        await pg.locator('.sview button', has_text='停止自动刷新').click()
        ok = await wait_for(lambda: dataset('by_provider')['source']['kind'] == 'file' and os.path.exists(os.path.join(DASH, 'data/by_provider.json')))
        d = dataset('by_provider')
        check('pausing keeps the rows as a file and the query as request', ok and d.get('request', {}).get('tool') == 'query' and len(json.loads(read(os.path.join(DASH, 'data/by_provider.json')))['rows']) == 15, json.dumps(d)[:300])
        await expect(pg.locator('.sview summary', has_text='查询（不自动刷新）')).to_be_visible()
        await pg.locator('.sview button', has_text='所有来源').click()
        await expect(pg.locator('.srow', has_text='Usage by provider and month').locator('.tag')).to_have_text('不自动刷新')
        await expect(fr.locator('#providerBody tr')).to_have_count(5)
        await pg.locator('.srow', has_text='Usage by provider and month').click()
        await pg.locator('.sview button', has_text='恢复实时查询').click()
        ok = await wait_for(lambda: dataset('by_provider')['source']['kind'] == 'query' and 'request' not in dataset('by_provider'))
        check('resuming makes it live again', ok)
        await pg.locator('.sview button', has_text='所有来源').click()

        # --- an outside edit to a data file and to the page --------------------------------------
        csv = os.path.join(DASH, 'data/team.csv')
        write(csv, read(csv).replace('Mei,Claude Code,15874,55595130,664809305,9339075', 'Mei,Claude Code,15874,55595130,99999999999,9339075'))
        await expect(fr.locator('#memberBody tr').first).to_contain_text('100.06B')
        await expect(fr.locator('#memberBody tr').first).to_contain_text('Mei')
        check('a data file changed on disk reloads what reads it', True)
        page = os.path.join(DASH, 'files/index.html')
        write(page, read(page).replace('<h1>Gateway usage · Q3 2026</h1>', '<h1>Gateway usage</h1>').replace(
            '<p class="tb-foot">', '<p class="tb-foot"><b data-source="q3" data-field="cost" data-row="0">1</b> '))
        await expect(fr.locator('h1')).to_have_text('Gateway usage')
        check('the page reloads when its file changes', True)
        await expect(pg.locator('.sproblems')).to_contain_text('页面显示 1，数据里是')
        check('a mark that disagrees with its data is reported', True)
        runs = os.path.join(DASH, '.runs.json')
        ok = await wait_for(lambda: json.loads(read(runs))['flagged'] == 1)
        check('…and written to .runs.json for Claude Code', ok)
        check('…which git ignores', subprocess.run(['git', 'check-ignore', '-q', 'projects/tingly-box-usage-dashboard/.runs.json'], cwd=REPO).returncode == 0)

        # --- a broken dataset ----------------------------------------------------------------------
        t = dataset('budgets')
        t['source']['url'] = 'data/nope.json'
        write(os.path.join(DASH, 'datasets/budgets.json'), json.dumps(t, ensure_ascii=False, indent=2))
        await expect(fr.locator('#goalChart .tb-fail')).to_be_visible()
        check('a failed source shows as failed on the page, and its calc too', 'no file data/nope.json' in await pg.locator('.sproblems').inner_text())
        check('…stamped on its marks', await fr.locator('#takeaway b[data-source=goal]').first.get_attribute('data-dash-source-state') == 'error')

        # --- code panel ------------------------------------------------------------------------------
        await pg.locator('.dashbar button[aria-label="代码"]').click()
        check('the code pane replaces the sources pane (one side pane at a time)', await pg.locator('.dashbar button[data-pane=code]').get_attribute('aria-pressed') == 'true' and await pg.locator('.dashbar button[data-pane=sources]').get_attribute('aria-pressed') == 'false')
        ed = pg.locator('textarea.dashcode')
        await ed.fill(read(page).replace('<h1>Gateway usage</h1>', '<h1>Gateway usage overview</h1>'))
        await ed.press('Control+s')
        ok = await wait_for(lambda: '<h1>Gateway usage overview</h1>' in read(page))
        check('the code panel saves the page', ok)
        await expect(fr.locator('h1')).to_have_text('Gateway usage overview')

        # --- upload and a new dashboard -----------------------------------------------------------------
        restore()
        await pg.goto(BASE + '/')
        await pg.locator('.lnewbtn').click()
        await pg.locator('.menu [data-new="dashboard"] .mi').click()
        await pg.locator('[role=dialog] input[aria-label="名称"]').fill('zz-dash')
        await pg.locator('[role=dialog] button[type="submit"]').click()
        await expect(pg.locator('.dashtitle')).to_have_text('zz-dash')
        await expect(fr.locator('h1')).to_have_text('zz-dash')
        check('a new dashboard starts with a page and no data', os.path.exists(os.path.join(REPO, 'projects/zz-dash/dash.json')) and await pg.locator('.srow').count() == 0)

        # --- what the page drew wrong: NaN, an empty chart, labels over each other or cut off ---------------
        zz = os.path.join(REPO, 'projects/zz-dash')
        os.makedirs(os.path.join(zz, 'data'), exist_ok=True); os.makedirs(os.path.join(zz, 'datasets'), exist_ok=True)
        write(os.path.join(zz, 'data/none.csv'), 'member,requests\n')
        write(os.path.join(zz, 'datasets/none.json'), json.dumps({'title': 'Nothing yet', 'description': 'No rows.', 'source': {'kind': 'file', 'url': 'data/none.csv', 'name': 'none.csv'}, 'updated': {'at': '2026-10-01T09:00:00Z', 'by': 'Sample data'}}))
        write(os.path.join(zz, 'files/index.html'), '''<div style="padding:20px;font:14px sans-serif">
<p>Total: <span id="t">—</span></p>
<div id="empty" data-source="none"><svg width="400" height="120"><path class="domain" d="M0,100H400" stroke="#999"/></svg></div>
<svg id="over" width="400" height="60"><text x="10" y="30">January sales</text><text x="60" y="30">February sales</text></svg>
</div>
<script>
dash.onData(() => {
  if (dash.data('none').status !== 'ok') return;
  document.getElementById('t').textContent = Math.round(Number(undefined));
});
</script>''')
        runs = os.path.join(zz, '.runs.json')
        await pg.goto(BASE + '/?p=zz-dash')
        if await pg.locator('.dashbar button[data-pane=sources]').get_attribute('aria-pressed') != 'true': await pg.locator('.dashbar button[data-pane=sources]').click()
        await expect(pg.locator('.sproblems li', has_text='NaN')).to_be_visible(timeout=15000)
        await expect(pg.locator('.sproblems li', has_text='什么也没画')).to_be_visible()
        await expect(pg.locator('.sproblems li', has_text='叠在一起')).to_be_visible()
        check('Sources → 问题 lists a NaN, an empty chart and overlapping labels', True)
        await pg.screenshot(path=OUT + 'dash-drawn.png')
        ok = await wait_for(lambda: len(json.loads(read(runs)).get('drawn', [])) >= 3, 8)
        drawn = json.loads(read(runs)).get('drawn', []) if os.path.exists(runs) else []
        check('.runs.json carries what was drawn wrong, each naming its element', ok and {d['rule'] for d in drawn} >= {'nan', 'empty', 'labelOverlap'} and all(d['element'] for d in drawn), json.dumps(drawn)[:300])
        check('the empty chart names its dataset', any(d['rule'] == 'empty' and d.get('source') == 'none' for d in drawn), json.dumps(drawn)[:300])

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    restore()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
