import os, asyncio, subprocess, time, json
from playwright.async_api import async_playwright, expect
BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(REPO, 'projects/demo/Main.dc.html')
src = lambda: open(MAIN, encoding='utf-8').read()
async def main():
    os.makedirs(OUT, exist_ok=True)
    subprocess.run(['git', 'checkout', '--', 'projects/demo'], cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    open(OUT + 'mock.log', 'w').close()
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': os.environ['DC_CHROME']} if os.environ.get('DC_CHROME') else {}))
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/?p=demo')
        await pg.wait_for_timeout(2500)
        main = pg.frame_locator('[data-board="Main.dc.html"] iframe')
        await main.locator('h1').click()
        await expect(pg.locator('.prompt .target')).to_contain_text('<h1>')
        await pg.locator('.seg button', has_text='快速 AI').click()
        await pg.locator('.prompt textarea').fill('标题换成紫色，下面加一个三条的要点列表')
        await pg.locator('.prompt .send').click()
        # mid-stream: the draft shows on the artboard before anything is saved
        await pg.wait_for_timeout(250)
        await pg.screenshot(path=OUT + 'fast-mid.png')
        await expect(pg.locator('.ticker')).to_contain_text('已保存', timeout=10000)
        await pg.wait_for_timeout(500)
        s = src()
        print('ticker:', (await pg.locator('.ticker').inner_text()).replace('\n', ' | '))
        print('PASS' if 'color:#7c3aed' in s and '<li style="font-size: 14px">保留每个 Agent 的覆盖</li>' in s and 'b42318' not in s else 'FAIL', 'retried reply saved, failed attempt fully undone')
        print('PASS' if 'id="dc' not in s else 'FAIL', 'no handle ids leaked into the file')
        log = [json.loads(l) for l in open(OUT + 'mock.log')]
        print('model calls:', [(x['n'], x['last'][:90].replace('\n', ' ')) for x in log])
        await expect(main.locator('li').nth(2)).to_have_text('改动写入 journal')
        print('PASS rendered on artboard')
        await pg.screenshot(path=OUT + 'fast-done.png')
        print(subprocess.run(['git', 'diff', '--stat', '--', 'projects/demo'], cwd=REPO, capture_output=True, text=True).stdout)
        print('errors:', errs)
        await b.close()
asyncio.run(main())
# leave the demo canvas as committed
subprocess.run(['git', 'checkout', '--', 'projects/demo'], cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
