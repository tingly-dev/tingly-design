"""AI model settings: the dialog from the launcher and from a project, a custom address + key saved, the fast model tested
through the mock (python3 e2e/mock_anthropic.py), health turning ready, the key never read back, the prompt bar hint.
Run with `pnpm dev` up and NO ANTHROPIC_* in its environment, DC_CONFIG=<a temp file>, and the mock on 8790:
python3 e2e/ai_settings.py  (DC_CHROME=/path/to/chrome to use another Chromium; SHOTS=<dir> to keep screenshots)"""
import os, asyncio, json, urllib.request
from playwright.async_api import async_playwright, expect
BASE = os.environ.get('DC_URL', 'http://localhost:5173')
SHOTS = os.environ.get('SHOTS')
CHROME = os.environ.get('DC_CHROME')
ok = True
def check(cond, what):
    global ok
    ok = ok and bool(cond)
    print('PASS' if cond else 'FAIL', what)
async def shot(pg, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        await pg.screenshot(path=os.path.join(SHOTS, name))
async def main():
    # start from nothing saved
    urllib.request.urlopen(urllib.request.Request(BASE + '/api/ai-config', data=b'{"clearKey": true}', method='PUT', headers={'content-type': 'application/json'}))
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        pg = await b.new_page(locale='en-US', viewport={'width': 1280, 'height': 860})
        await pg.add_init_script("try{localStorage.setItem('dc.barMode','float')}catch(e){}")  # the floating bar; e2e/dock.py covers the side dock
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        # nothing saved, no key: the prompt bar says so and opens the dialog
        await pg.goto(BASE + '/?p=box-console')
        await pg.wait_for_timeout(2000)
        await pg.locator('.prompt .seg button', has_text='Fast AI').click()
        await expect(pg.locator('.prompt .setup')).to_be_visible()
        await shot(pg, '0-prompt-bar-hint.png')
        await pg.locator('.prompt .setup').click()
        await expect(pg.locator('[role=dialog]')).to_be_visible()
        await pg.keyboard.press('Escape')
        await expect(pg.locator('[role=dialog]')).to_have_count(0)
        await pg.goto(BASE + '/')
        await pg.locator('button[aria-label="AI model settings"]').click()
        dlg = pg.locator('[role=dialog]')
        await expect(dlg).to_be_visible()
        await expect(dlg.locator('[data-preset=tingly-box]')).to_contain_text('suggested')
        await dlg.locator('[data-preset=tingly-box]').click()
        await expect(dlg.locator('[data-address]')).to_have_text('http://localhost:12580/tingly/anthropic')
        await expect(dlg.locator('[data-box]')).to_have_attribute('data-box', 'down')
        await shot(pg, '1-tingly-box.png')
        # a custom address (the mock), a key, then a test through it
        await dlg.locator('[data-preset=custom]').click()
        await dlg.locator('input[placeholder="https://"]').fill('ftp://nope')
        await expect(dlg.locator('.status.bad').first).to_contain_text('http://')
        await dlg.locator('input[placeholder="https://"]').fill('http://127.0.0.1:8790')
        await dlg.locator('input[type=password]').fill('test-key')
        await dlg.get_by_role('button', name='Test').click()
        await expect(dlg.locator('.testrow .status.ok')).to_contain_text('Works', timeout=10000)
        await shot(pg, '2-custom-tested.png')
        await dlg.get_by_role('button', name='Save').click()
        await expect(dlg).to_have_count(0)
        cfg = json.load(urllib.request.urlopen(BASE + '/api/ai-config'))
        check(cfg['baseUrl']['value'] == 'http://127.0.0.1:8790' and cfg['key'] == {'set': True, 'source': 'saved'}, 'saved, and the key is not sent back')
        check('test-key' not in json.dumps(cfg), 'no key in the response')
        check(json.load(urllib.request.urlopen(BASE + '/api/health'))['fastEdit'] is True, 'health: fast AI is ready')
        check(cfg['claudeRoute']['value'] == 'shared', 'Claude Code defaults to the shared connection once there is a key')
        # from inside a project
        await pg.goto(BASE + '/?p=box-console')
        await pg.wait_for_timeout(2000)
        await pg.locator('.pmenu button[aria-haspopup=menu]').click()
        await pg.get_by_role('menuitem', name='AI model settings').click()
        await expect(pg.locator('[role=dialog]')).to_be_visible()
        await expect(pg.locator('[role=dialog] input[type=password]')).to_have_attribute('placeholder', 'Saved on this machine · type to replace')
        await pg.locator('[role=dialog] [data-route=login]').click()
        await expect(pg.locator('[role=dialog] input[aria-label="Claude Code Model"]')).to_have_count(0)
        await shot(pg, '3-project-claude-login.png')
        await pg.keyboard.press('Escape')
        check(not errs, f'no page errors {errs}')
        await b.close()
asyncio.run(main())
print('ALL PASS' if ok else 'SOME FAILED')
raise SystemExit(0 if ok else 1)
