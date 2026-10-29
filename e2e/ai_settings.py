"""AI model settings: the dialog from the launcher and from a project, a custom address + key saved, the fast model tested
through the mock (python3 e2e/mock_anthropic.py), health turning ready, the key never read back, the prompt bar hint.
Run with `pnpm dev` up and NO ANTHROPIC_* in its environment, DC_CONFIG=<a temp file>, and the mock on 8790:
python3 e2e/ai_settings.py  (DC_CHROME=/path/to/chrome to use another Chromium; SHOTS=<dir> to keep screenshots)"""
import os, asyncio, json, urllib.request
from playwright.async_api import async_playwright, expect
BASE = os.environ.get('DC_URL', 'http://localhost:5173')
MOCK = f"http://127.0.0.1:{8790 + int(os.environ.get('DC_E2E_OFFSET', 0))}"  # the mock run.py started for this lane
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
    urllib.request.urlopen(urllib.request.Request(BASE + '/api/ai-config', data=b'{"reset": true}', method='PUT', headers={'content-type': 'application/json'}))
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        pg = await b.new_page(locale='en-US', viewport={'width': 1280, 'height': 860})
        # This case exercises the unavailable message, not a person's live Box on port 12580.
        async def box_unavailable(route):
            if route.request.method != 'GET':
                await route.continue_()
                return
            response = await route.fetch()
            cfg = await response.json()
            cfg['box']['reachable'] = False
            await route.fulfill(response=response, json=cfg)
        await pg.route('**/api/ai-config', box_unavailable)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        # nothing saved, no key: the prompt bar says so and opens the dialog
        await pg.goto(BASE + '/?p=tingly-box-console-canvas')
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
        # three cards, top to bottom: Claude Code, ImageGen, fast AI, each with its own connection
        await expect(dlg.locator('[data-card]')).to_have_count(3)
        order = await dlg.locator('[data-card]').evaluate_all('els => els.map(e => e.dataset.card)')
        check(order == ['claude', 'image', 'fast'], f'the cards are Claude Code, ImageGen, fast AI: {order}')
        claude, image, fast = dlg.locator('[data-card=claude]'), dlg.locator('[data-card=image]'), dlg.locator('[data-card=fast]')
        # Claude Code opens on its own sign-in and needs nothing; its tabs hold only their own fields
        await expect(claude.locator('[data-mode=local]')).to_have_attribute('aria-pressed', 'true')
        await expect(claude.locator('input')).to_have_count(0)
        await expect(claude.locator('[data-mode=box]')).to_contain_text('suggested')
        # fast AI: Tingly Box fills its address; Box is not running here, and the card says so
        await fast.locator('[data-preset=tingly-box]').click()
        await expect(fast.locator('[data-address]')).to_have_text('http://localhost:12580/tingly/anthropic')
        await expect(fast.locator('[data-box]')).to_have_attribute('data-box', 'down')
        await shot(pg, '1-tingly-box.png')
        # Claude Code through Box: its own token, an optional profile; the address shows what claude is given
        await claude.locator('[data-mode=box]').click()
        await claude.get_by_label('Claude Code Token').fill('box-token')
        await expect(claude.locator('[data-claude-address]')).to_have_text('http://localhost:12580/tingly/claude_code')
        await claude.get_by_label('Profile').fill('p1')
        await expect(claude.locator('[data-claude-address]')).to_have_text('http://localhost:12580/tingly/claude_code:p1')
        await claude.get_by_label('Profile').fill('a b')
        await expect(dlg.get_by_role('button', name='Save')).to_be_disabled()
        await claude.get_by_label('Profile').fill('p1')
        # the other Box cards can take that token instead of asking for it again (a copy made when saved)
        await fast.locator('[data-reuse]').click()
        await expect(fast.locator('[data-reused]')).to_contain_text('Claude Code')
        await image.locator('[data-reuse]').click()
        await shot(pg, '1b-tingly-box-profile.png')
        await dlg.get_by_role('button', name='Save').click()
        await expect(dlg).to_have_count(0)
        cfg = json.load(urllib.request.urlopen(BASE + '/api/ai-config'))
        check(cfg['claude']['mode'] == {'value': 'box', 'source': 'saved'} and cfg['claude']['launchUrl'].endswith('/tingly/claude_code:p1'), 'Claude Code is pointed at the Box profile')
        check(cfg['fast']['key'] == {'set': True, 'source': 'saved'} and cfg['image']['key'] == {'set': True, 'source': 'saved'}, 'the token was handed to the other two cards')
        check('box-token' not in json.dumps(cfg), 'no key in the response')
        await pg.locator('button[aria-label="AI model settings"]').click()
        await expect(dlg).to_be_visible()
        # a custom address (the mock) and a key for fast AI, then a test through it; nothing in the other cards moves
        await expect(claude.locator('[data-mode=box]')).to_have_attribute('aria-pressed', 'true')
        await fast.locator('[data-preset=custom]').click()
        await fast.locator('input[placeholder="https://"]').fill('ftp://nope')
        await expect(fast.locator('.status.bad').first).to_contain_text('http://')
        await fast.locator('input[placeholder="https://"]').fill(MOCK)
        await fast.locator('input[type=password]').fill('test-key')
        await fast.get_by_role('button', name='Test').click()
        await expect(fast.locator('.testrow .status.ok')).to_contain_text('Works', timeout=10000)
        await shot(pg, '2-custom-tested.png')
        await dlg.get_by_role('button', name='Save').click()
        await expect(dlg).to_have_count(0)
        cfg = json.load(urllib.request.urlopen(BASE + '/api/ai-config'))
        check(cfg['fast']['baseUrl']['value'] == MOCK and cfg['fast']['key'] == {'set': True, 'source': 'saved'}, 'fast AI saved, and the key is not sent back')
        check('test-key' not in json.dumps(cfg), 'no key in the response')
        check(cfg['claude']['launchUrl'].endswith('/tingly/claude_code:p1') and cfg['image']['preset'] == 'tingly-box', 'changing fast AI left Claude Code and ImageGen alone')
        check(json.load(urllib.request.urlopen(BASE + '/api/health'))['fastEdit'] is True, 'health: fast AI is ready')
        # from inside a project
        await pg.goto(BASE + '/?p=tingly-box-console-canvas')
        await pg.wait_for_timeout(2000)
        await pg.locator('.pmenu button[aria-haspopup=menu]').click()
        await pg.get_by_role('menuitem', name='AI model settings').click()
        await expect(pg.locator('[role=dialog]')).to_be_visible()
        await expect(pg.locator('[role=dialog] [data-card=fast] input[type=password]')).to_have_attribute('placeholder', 'Saved on this machine · type to replace')
        await pg.locator('[role=dialog] [data-mode=local]').click()
        await expect(pg.locator('[role=dialog] [data-card=claude] input')).to_have_count(0)
        await shot(pg, '3-project-claude-local.png')
        await pg.keyboard.press('Escape')
        check(not errs, f'no page errors {errs}')
        await b.close()
asyncio.run(main())
print('ALL PASS' if ok else 'SOME FAILED')
raise SystemExit(0 if ok else 1)
