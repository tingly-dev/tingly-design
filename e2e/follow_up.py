"""End-to-end checks for the offer after a setting changed by hand (.design/config-awareness.md), with a stand-in `claude`
(e2e/fake-claude) that records the request it is given. A deck resized to a very different shape offers a re-layout above the
request bar, in the bar and not as a run: nothing starts until it is accepted. Accepting sends the prepared request, with the
change told to Claude Code; editing puts it in the box; dismissing removes it; a small change offers nothing.
Run with `pnpm dev` started with e2e/fake-claude first on PATH: python3 e2e/follow_up.py (or pnpm e2e follow_up)"""
import os, json, time, subprocess, asyncio
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
CHROME = os.environ.get('DC_CHROME')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, 'e2e', 'out') + '/'
LOG = os.environ.get('FAKE_CLAUDE_LOG', '/tmp/fake-claude.log')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def calls(): return [json.loads(l) for l in open(LOG)] if os.path.exists(LOG) else []
def started(): return [c for c in calls() if c['ev'] == 'start']
def restore():
    subprocess.run(['git', 'checkout', '--', 'projects/tingly-intro'], cwd=REPO)
    subprocess.run(['git', 'clean', '-fdq', '--', 'projects/tingly-intro'], cwd=REPO)

async def main():
    os.makedirs(OUT, exist_ok=True)
    os.path.exists(LOG) and os.remove(LOG)
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        pg = await b.new_page(locale='zh-CN', viewport={'width': 1440, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE + '/?p=tingly-intro&s=box')
        await pg.wait_for_selector('.thumb')
        await pg.wait_for_timeout(800)
        w, h = pg.locator('input[aria-label="宽"]').first, pg.locator('input[aria-label="高"]').first
        offer = pg.locator('.follow-up')

        # a small change offers nothing
        await w.fill('1800'); await w.press('Enter')
        await pg.wait_for_timeout(500)
        check('a small change offers nothing', await offer.count() == 0)

        # a big one offers the re-layout, and runs nothing by itself
        await w.fill('1080'); await w.press('Enter')
        await h.fill('1920'); await h.press('Enter')
        await expect(offer).to_have_count(1)
        check('a very different shape offers a re-layout above the request bar', 'Claude' in await offer.inner_text() or '排版' in await offer.inner_text())
        await pg.wait_for_timeout(800)
        check('the offer starts no run', len(started()) == 0)
        await pg.screenshot(path=OUT + 'follow-up-offer.png')

        # edit: the request goes into the box, nothing is sent
        await offer.get_by_role('button', name='改写请求').click()
        await expect(offer).to_have_count(0)
        text = await pg.locator('.prompt textarea').input_value()
        check('editing puts the prepared request in the box', 'Re-lay out every slide' in text and '1080×1920' in text, text)
        check('and still starts no run', len(started()) == 0)
        await pg.locator('.prompt textarea').fill('')

        # dismiss
        await w.fill('1920'); await w.press('Enter')
        await w.fill('1000'); await w.press('Enter')
        await h.fill('1900'); await h.press('Enter')
        await pg.wait_for_timeout(400)
        if await offer.count():
            await offer.get_by_role('button', name='忽略').click()
        check('dismissing removes the offer', await offer.count() == 0)

        # accept: the prepared request is sent, and Claude Code is told what changed
        await w.fill('1920'); await w.press('Enter')
        await h.fill('1080'); await h.press('Enter')
        await w.fill('1080'); await w.press('Enter')
        await h.fill('1920'); await h.press('Enter')
        await expect(offer).to_have_count(1)
        await offer.get_by_role('button', name='让 Claude 重新排版').click()
        t = time.time()
        while time.time() - t < 15 and not started(): await asyncio.sleep(0.2)
        s = started()
        check('accepting sends the prepared request to Claude Code', len(s) == 1 and 'Re-lay out every slide' in s[0].get('prompt', ''), s)
        check('and tells it what the person changed', len(s) == 1 and 'Settings the person changed since your last run' in s[0].get('prompt', '') and 'was resized from' in s[0].get('prompt', ''), s)
        check('the settings are in the request too', len(s) == 1 and 'Project settings now' in s[0].get('prompt', ''), s)
        check('the offer is gone after it', await offer.count() == 0)
        check('no page errors', not errs, errs)
        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    raise SystemExit(1 if failed else 0)

restore()
try:
    asyncio.run(main())
finally:
    restore()
