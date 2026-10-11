import os, asyncio, subprocess, re, time
from playwright.async_api import async_playwright, expect
BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = REPO + '/projects/demo/Main.dc.html'
def src(): return open(MAIN, encoding='utf-8').read()
def diff():
    return subprocess.run(['git', 'diff', '--unified=0', '--', 'projects/demo/Main.dc.html'], cwd=REPO, capture_output=True, text=True).stdout
async def wait_file(pred, timeout=5):
    t = time.time()
    while time.time() - t < timeout:
        if pred(src()): return True
        await asyncio.sleep(0.1)
    return False
results = []
def check(name, ok, extra=''):
    results.append((name, ok)); print(('PASS ' if ok else 'FAIL ') + name + (' :: ' + extra if extra and not ok else ''))

async def main():
    os.makedirs(OUT, exist_ok=True)
    subprocess.run(['git', 'checkout', '--', 'projects/demo'], cwd=REPO)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and errs.append(m.text))
        await pg.goto(BASE + '/?p=demo')
        await pg.wait_for_timeout(2500)
        main = pg.frame_locator('[data-board="Main.dc.html"] iframe')

        # 1. select the heading inside the sandboxed artboard
        await main.locator('h1').click()
        await expect(pg.locator('.insp h2')).to_contain_text('<h1>')
        check('select element in iframe -> inspector', True)

        # 2. change its color in the inspector -> one-line patch on disk
        await pg.locator('.insp input[aria-label="颜色"]').fill('#15803d')
        await pg.locator('.insp input[aria-label="颜色"]').press('Enter')
        ok = await wait_file(lambda s: 'font-weight:700;color:#15803d">Claude Code</h1>' in s)
        d = diff()
        changed = [l for l in d.splitlines() if l.startswith('+') and not l.startswith('+++')]
        check('style edit writes a minimal patch', ok and len(changed) == 1, d)
        await expect(main.locator('h1')).to_have_css('color', 'rgb(21, 128, 61)')
        check('artboard re-renders with new style', True)

        # 3. double-click the paragraph and retype it in place
        para = main.locator('p')
        await para.dblclick()
        await pg.keyboard.type('在画布上直接改的字')
        await pg.keyboard.press('Enter')
        ok = await wait_file(lambda s: '>在画布上直接改的字</p>' in s)
        check('double-click text edit saved', ok)

        # 4. jQuery mode on the selected button
        await main.locator('button', has_text='保存配置').click()
        await expect(pg.locator('.prompt .target')).to_contain_text('<button>')
        handle = await pg.locator('.prompt .target code').inner_text()
        await pg.locator('.seg button', has_text='jQuery').click()
        await pg.locator('.prompt textarea').fill(f"$('{handle}').css('border-radius', 22)\n.text('保存并应用')")
        await pg.locator('.prompt .send').click()
        ok = await wait_file(lambda s: 'border-radius:22px' in s and '>保存并应用</button>' in s)
        check('jQuery statements write back', ok, src()[src().find('<button'):src().find('</button>')+9])
        check('template holes survive', '{{accent}}' in src() and '<sc-for list="{{agents}}"' in src())

        # 5. an outside edit (Claude Code, a terminal, git) shows up live
        s = src(); open(MAIN, 'w', encoding='utf-8').write(s.replace('恢复默认', '恢复出厂设置'))
        try:
            await expect(main.locator('button', has_text='恢复出厂设置')).to_be_visible(timeout=4000); ok = True
        except Exception: ok = False
        check('outside edit appears on canvas', ok)

        # 6. two editors save the same file at the same time -> both edits survive
        pg2 = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg2.goto(BASE + '/?p=demo')
        await pg2.wait_for_timeout(2500)
        main2 = pg2.frame_locator('[data-board="Main.dc.html"] iframe')
        await main.locator('h1').click()
        await main2.locator('button', has_text='恢复出厂设置').click()
        await expect(pg.locator('.insp h2')).to_contain_text('<h1>')
        await expect(pg2.locator('.insp h2')).to_contain_text('<button>')
        await pg.locator('.insp input[aria-label="字号"]').fill('30px')
        await pg2.locator('.insp input[aria-label="字号"]').fill('17px')
        await asyncio.gather(pg.locator('.insp input[aria-label="字号"]').press('Enter'), pg2.locator('.insp input[aria-label="字号"]').press('Enter'))
        ok = await wait_file(lambda s: 'font-size:30px' in s and re.search(r'font-size:17px[^>]*>恢复出厂设置', s) is not None, 6)
        check('concurrent edits from two editors both kept', ok)
        await pg2.wait_for_timeout(800)
        h1_size = await main2.locator('h1').evaluate('e => getComputedStyle(e).fontSize')
        check('second editor sees first editor\'s change', h1_size == '30px', h1_size)

        # 7. undo the last local edit in page 1
        await pg.locator('.top button[aria-label="撤销"]').click()
        ok = await wait_file(lambda s: 'font-size:30px' not in s and 'font-size:26px' in s and 'font-size:17px' in s)
        check('undo own edit while keeping the other editor\'s', ok)

        # 8. canvas.json edits: drag an artboard by its name strip
        strip = pg.locator('[data-board="Pricing.dc.html"] .strip')
        bb = await strip.bounding_box()
        await pg.mouse.move(bb['x'] + 20, bb['y'] + 10); await pg.mouse.down()
        await pg.mouse.move(bb['x'] + 120, bb['y'] + 60, steps=8); await pg.mouse.up()
        cj = lambda: open(REPO + '/projects/demo/canvas.json').read()
        t = time.time()
        while time.time() - t < 4 and '"x": 1280,\n      "y": 640' in cj().replace(' ', ' '):
            await asyncio.sleep(0.1)
        import json
        pb = json.loads(cj())['boards']['Pricing.dc.html']
        check('drag artboard updates canvas.json', (pb['x'], pb['y']) != (1280, 640), str(pb))

        # 9. play mode: the interactive artboard's own script runs
        await pg.locator('.top button', has_text='播放').click()
        pricing = pg.frame_locator('[data-board="Pricing.dc.html"] iframe')
        await pricing.locator('button', has_text='按年').click()
        try:
            await expect(pricing.locator('text=$16')).to_be_visible(timeout=2000); ok = True
        except Exception: ok = False
        check('play mode runs artboard logic (setState)', ok)
        await pg.keyboard.press('Escape')

        # journal
        await pg.locator('.tabs button', has_text='改动记录').click()
        await pg.wait_for_timeout(300)
        n = await pg.locator('.jline').count()
        check('journal lists edits', n >= 6, str(n))
        await pg.screenshot(path=OUT + 'e2e-final.png')
        await main.locator('h1').click(); await pg.wait_for_timeout(300)
        await pg.screenshot(path=OUT + 'e2e-selected.png')
        print('errors:', errs[:10])
        await b.close()
    print(f"{sum(ok for _, ok in results)}/{len(results)} passed")
asyncio.run(main())
# leave the demo canvas as committed
subprocess.run(['git', 'checkout', '--', 'projects/demo'], cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
