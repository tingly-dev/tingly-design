"""Claude Code for real: the local `claude` CLI changes a label on the sample canvas through the prompt bar.
Run with `pnpm dev` up and a signed-in `claude` on PATH: python3 e2e/delegate.py (or pnpm e2e --real)."""
import os, asyncio, subprocess, time
from playwright.async_api import async_playwright, expect
BASE = os.environ.get('DC_URL', 'http://localhost:5173')
CHROME = os.environ.get('DC_CHROME')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, 'e2e', 'out') + '/'
FLOW = os.path.join(REPO, 'projects/tingly-box-console-canvas/Flow.dc.html')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def restore(): subprocess.run(['git', 'checkout', '--', 'projects/tingly-box-console-canvas'], cwd=REPO)

async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        pg = await b.new_page(locale='zh-CN', viewport={'width': 1440, 'height': 900})
        await pg.goto(BASE + '/?p=tingly-box-console-canvas')
        await pg.wait_for_timeout(2500)
        flow = pg.frame_locator('[data-board="Flow.dc.html"] iframe')
        await flow.locator('text=Translated').click()
        await expect(pg.locator('.prompt .target')).to_contain_text('Translated')
        await pg.get_by_role('button', name='Claude Code', exact=True).click()
        await pg.locator('.prompt textarea').fill('Change this label to “Live translation” and make it bold')
        await pg.locator('.prompt .send').click()
        t = time.time()
        while time.time() - t < 240 and 'Live translation' not in open(FLOW, encoding='utf-8').read():
            await asyncio.sleep(1)
        check('Claude Code changes the file', 'Live translation' in open(FLOW, encoding='utf-8').read(), f'{time.time() - t:.0f}s')
        try:
            await expect(flow.locator('text=Live translation')).to_be_visible(timeout=5000); ok = True
        except Exception: ok = False
        check('the canvas shows the edit', ok)
        await expect(pg.locator('.runfeed')).to_contain_text('Claude Code 完成', timeout=60000)
        await pg.locator('.syncchip').click()
        top = await pg.locator('.jline').first.inner_text() if await pg.locator('.jline').count() else ''
        check('the change log lists the edit', bool(top), top.replace('\n', ' | '))
        await pg.screenshot(path=OUT + 'delegate-done.png')
        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    raise SystemExit(1 if failed else 0)

restore()
try:
    asyncio.run(main())
finally:
    restore()  # leave the sample canvas as committed, even after a crash
