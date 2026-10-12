"""Fast AI on a slide, against e2e/mock_anthropic.py: a thrown line is undone and retried, and a reply
that leaves the slide subset (margin) is undone and sent back to the model with the reasons.
Run: python3 e2e/mock_anthropic.py &  then  ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:8790 pnpm dev"""
import os, asyncio, subprocess, json
from playwright.async_api import async_playwright, expect
BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARR = os.path.join(REPO, 'projects/q3-review/slides/arr.html')
CHROME = os.environ.get('DC_CHROME')
src = lambda: open(ARR, encoding='utf-8').read()

async def main():
    os.makedirs(OUT, exist_ok=True)
    subprocess.run(['git', 'checkout', '--', 'projects/q3-review'], cwd=REPO)
    open(OUT + 'mock.log', 'w').close()
    ok = True
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/?p=q3-review&s=arr')
        await pg.frame_locator('.sframe.f-stage iframe').locator('section#arr').wait_for()
        await pg.wait_for_timeout(500)
        # select the heading (coordinates by hand: the slide frame is scaled)
        fr = pg.frame_locator('.sframe.f-stage iframe')
        r = await fr.locator('h2').evaluate('e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }')
        box = await pg.locator('.sframe.f-stage').bounding_box()
        k = box['width'] / 1920
        await pg.mouse.click(box['x'] + (r[0] + r[2] / 2) * k, box['y'] + (r[1] + r[3] / 2) * k)
        await expect(pg.locator('.prompt .target')).to_contain_text('<h2>')
        await pg.locator('.seg button', has_text='快速 AI').click()
        await pg.locator('.prompt textarea').fill('标题换成紫色，下面加三条要点')
        await pg.locator('.prompt .send').click()
        await expect(pg.locator('.ticker')).to_contain_text('已保存', timeout=15000)
        await pg.wait_for_timeout(500)
        s = src()
        log = [json.loads(l) for l in open(OUT + 'mock.log')]
        print('model calls:', [(x['n'], x['last'][:70].replace('\n', ' ')) for x in log])
        checks = [
            ('the model sees the deck outline and this slide', len(log) == 3 and '8 slides, 1920×1080' in log[0]['last']),
            ('a thrown line is undone and retried', 'failed with' in log[1]['last']),
            ('a reply outside the subset is undone and explained', 'slide subset' in log[2]['last'] and 'margin' in log[2]['last']),
            ('the clean reply is saved', 'color:#7c3aed' in s and '<li>保留每个 Agent 的覆盖</li>' in s and 'margin: 0 0 8px' not in s and 'b42318' not in s),
            ('no handle ids leaked', 'id="dc' not in s),
            ('no page errors', not errs),
        ]
        for name, good in checks:
            print(('PASS ' if good else 'FAIL ') + name)
            ok = ok and good
        await b.close()
    subprocess.run(['git', 'checkout', '--', 'projects/q3-review'], cwd=REPO)
    if not ok: raise SystemExit(1)

asyncio.run(main())
