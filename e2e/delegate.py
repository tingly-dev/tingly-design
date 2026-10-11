import os, asyncio, subprocess, time
from playwright.async_api import async_playwright, expect
BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
FLOW = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'projects/demo/Flow.dc.html')
async def main():
    os.makedirs(OUT, exist_ok=True)
    subprocess.run(['git', 'checkout', '--', 'projects/demo'], cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg.goto(BASE + '/?p=demo')
        await pg.wait_for_timeout(2500)
        flow = pg.frame_locator('[data-board="Flow.dc.html"] iframe')
        await flow.locator('text=实时同步').click()
        await expect(pg.locator('.prompt .target')).to_contain_text('实时同步')
        await pg.locator('.seg button', has_text='Claude Code').click()
        await pg.locator('.prompt textarea').fill('把这个标签改成“自动同步”，并加粗')
        await pg.locator('.prompt .send').click()
        t = time.time(); shot = False
        while time.time() - t < 240:
            if '自动同步' in open(FLOW, encoding='utf-8').read(): break
            if not shot and time.time() - t > 20:
                await pg.screenshot(path=OUT + 'delegate-mid.png'); shot = True
            await asyncio.sleep(1)
        print('file changed after %.0fs' % (time.time() - t), '自动同步' in open(FLOW, encoding='utf-8').read())
        try:
            await expect(flow.locator('text=自动同步')).to_be_visible(timeout=5000); print('PASS canvas shows Claude edit')
        except Exception as e: print('FAIL canvas', e)
        await pg.wait_for_timeout(4000)
        await pg.locator('.tabs button', has_text='改动记录').click()
        print('journal top:', (await pg.locator('.jline').first.inner_text()).replace('\n', ' | '))
        print('ticker:', (await pg.locator('.ticker').inner_text()).replace('\n', ' | ')[:600] if await pg.locator('.ticker').count() else '-')
        await pg.screenshot(path=OUT + 'delegate-done.png')
        await b.close()
asyncio.run(main())
# leave the demo canvas as committed
subprocess.run(['git', 'checkout', '--', 'projects/demo'], cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
