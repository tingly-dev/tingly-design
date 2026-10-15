"""Fast AI on a motion scene, against e2e/mock_anthropic.py: the model gets the piece's outline (sizes,
scenes, where the playhead stopped), a thrown line is undone and retried, a reply that leaves the
subset is undone and explained, and the clean reply lands in the scene file.
Run: python3 e2e/mock_anthropic.py &  then  ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:8790 pnpm dev"""
import os, asyncio, subprocess, json
from playwright.async_api import async_playwright, expect
BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENE = os.path.join(REPO, 'projects/design-motion/scenes/kind-slides.html')
CHROME = os.environ.get('DC_CHROME')
src = lambda: open(SCENE, encoding='utf-8').read()

async def main():
    os.makedirs(OUT, exist_ok=True)
    subprocess.run(['git', 'checkout', '--', 'projects/design-motion'], cwd=REPO)
    open(OUT + 'mock.log', 'w').close()
    ok = True
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        pg = await b.new_page(locale='zh-CN', viewport={'width': 1440, 'height': 1000})
        await pg.add_init_script("try{localStorage.setItem('dc.barMode','float')}catch(e){}")  # the floating bar; e2e/dock.py covers the side dock
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/?p=design-motion')
        await pg.locator('.mscene', has_text='kind-slides').click()
        h2 = pg.frame_locator('.medit iframe').locator('section#kind-slides h2')
        await h2.click()
        await expect(pg.locator('.prompt .target')).to_contain_text('<h2>')
        await pg.locator('.seg button', has_text='快速 AI').click()
        await pg.locator('.prompt textarea').fill('标题换成紫色，下面加三条要点')
        await pg.locator('.prompt .send').click()
        await expect(pg.locator('.runfeed')).to_contain_text('已保存', timeout=15000)
        await pg.wait_for_timeout(500)
        s = src()
        log = [json.loads(l) for l in open(OUT + 'mock.log')]
        print('model calls:', [(x['n'], x['last'][:90].replace('\n', ' ')) for x in log])
        checks = [
            ('the model sees the piece: its sizes and the scene the playhead is on', len(log) == 3 and 'a motion piece. Formats: wide 1920×1080' in log[0]['last']),
            ('a thrown line is undone and retried', 'failed with' in log[1]['last']),
            ('a reply outside the subset is undone and explained', 'slide subset' in log[2]['last'] and 'margin' in log[2]['last']),
            ('the clean reply is saved into the scene', 'color:#7c3aed' in s and '<li>保留每个 Agent 的覆盖</li>' in s and 'margin: 0 0 8px' not in s and 'b42318' not in s),
            ('the timing attributes are kept', 'data-in="rise 600ms @0.3s"' in s),
            ('no handle ids leaked', 'id="dc' not in s),
            ('no page errors', not errs),
        ]
        for name, good in checks:
            print(('PASS ' if good else 'FAIL ') + name)
            ok = ok and good
        await b.close()
    subprocess.run(['git', 'checkout', '--', 'projects/design-motion'], cwd=REPO)
    if not ok: raise SystemExit(1)

asyncio.run(main())
