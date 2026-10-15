import os, asyncio, subprocess, time
from playwright.async_api import async_playwright, expect
BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
FLOW = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'projects/box-console/Flow.dc.html')
async def main():
    os.makedirs(OUT, exist_ok=True)
    subprocess.run(['git', 'checkout', '--', 'projects/box-console'], cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(locale='zh-CN', viewport={'width': 1440, 'height': 900})
        await pg.add_init_script("try{localStorage.setItem('dc.barMode','float')}catch(e){}")  # the floating bar; e2e/dock.py covers the side dock
        await pg.goto(BASE + '/?p=box-console')
        await pg.wait_for_timeout(2500)
        flow = pg.frame_locator('[data-board="Flow.dc.html"] iframe')
        await flow.locator('text=Translated').click()
        await expect(pg.locator('.prompt .target')).to_contain_text('Translated')
        await pg.locator('.seg button', has_text='Claude Code').click()
        await pg.locator('.prompt textarea').fill('Change this label to “Live translation” and make it bold')
        await pg.locator('.prompt .send').click()
        t = time.time(); shot = False
        while time.time() - t < 240:
            if 'Live translation' in open(FLOW, encoding='utf-8').read(): break
            if not shot and time.time() - t > 20:
                await pg.screenshot(path=OUT + 'delegate-mid.png'); shot = True
            await asyncio.sleep(1)
        print('file changed after %.0fs' % (time.time() - t), 'Live translation' in open(FLOW, encoding='utf-8').read())
        try:
            await expect(flow.locator('text=Live translation')).to_be_visible(timeout=5000); print('PASS canvas shows Claude edit')
        except Exception as e: print('FAIL canvas', e)
        await pg.wait_for_timeout(4000)
        await pg.locator('.tabs button', has_text='改动记录').click()
        print('journal top:', (await pg.locator('.jline').first.inner_text()).replace('\n', ' | '))
        print('ticker:', (await pg.locator('.runfeed').inner_text()).replace('\n', ' | ')[:600] if await pg.locator('.runfeed').count() else '-')
        await pg.screenshot(path=OUT + 'delegate-done.png')
        await b.close()
asyncio.run(main())
# leave the sample canvas as committed
subprocess.run(['git', 'checkout', '--', 'projects/box-console'], cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
