"""Image generation: the dialog's Image generation section (follows Tingly Box, off with Anthropic, an OpenAI-style address with its
own key), then the server's /images route through the mock (python3 e2e/mock_images.py): a picture made and kept in uploads/, one
edited, the gateway's refusal passed on, a path outside uploads/ refused, the key never read back.
`pnpm e2e image_gen` starts what it needs; by hand: `pnpm dev` with NO ANTHROPIC_* / DC_IMAGE_* in its environment, DC_CONFIG=<a temp file>, python3 e2e/mock_anthropic.py and python3 e2e/mock_images.py <log> (8790 and 8791):
python3 e2e/image_gen.py  (DC_CHROME=/path/to/chrome; SHOTS=<dir> to keep screenshots; DC_MOCK_LOG=<log> to check what the mock received)"""
import os, asyncio, json, urllib.request, urllib.error, shutil
from playwright.async_api import async_playwright, expect
BASE = os.environ.get('DC_URL', 'http://localhost:5173')
API = os.environ.get('DC_API', 'http://localhost:8787')
SHOTS = os.environ.get('SHOTS')
CHROME = os.environ.get('DC_CHROME')
MOCK_LOG = os.environ.get('DC_MOCK_LOG')
OFFSET = int(os.environ.get('DC_E2E_OFFSET', 0))
MOCK_URL = os.environ.get('DC_MOCK_URL', f'http://127.0.0.1:{8790 + OFFSET}')
IMAGES_URL = os.environ.get('DC_MOCK_IMAGES_URL', f'http://127.0.0.1:{8791 + OFFSET}')
PROJECT = os.environ.get('DC_PROJECT', 'box-console')
ok = True
def check(cond, what):
    global ok
    ok = ok and bool(cond)
    print('PASS' if cond else 'FAIL', what)
def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method or ('POST' if body is not None else 'GET'), headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
async def shot(pg, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        await pg.screenshot(path=os.path.join(SHOTS, name))
async def open_dialog(pg):
    await pg.goto(BASE + '/')
    await pg.locator('button[aria-label="AI model settings"]').click()
    dlg = pg.locator('[role=dialog]')
    await expect(dlg).to_be_visible()
    return dlg
async def main():
    call('/api/ai-config', {'clearKey': True, 'clearImageKey': True}, 'PUT')
    check(call('/api/health')[1]['imageGen'] is False, 'health: image generation is off before it is set up')
    check(call(f'/api/projects/{PROJECT}/images', {'prompt': 'a fox'})[0] == 501, 'asking for a picture before setup is refused')
    uploads = os.path.join(os.environ.get('DC_PROJECTS', 'projects'), PROJECT, 'uploads')
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        pg = await b.new_page(locale='en-US', viewport={'width': 1280, 'height': 1000})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        dlg = await open_dialog(pg)
        # Anthropic has no image address: the section says so and asks for nothing else
        await dlg.locator('[data-preset=anthropic]').click()
        await expect(dlg.locator('[data-image-none]')).to_be_visible()
        await dlg.locator('input[type=password]').first.fill('test-key')
        await dlg.locator('[data-image-section]').scroll_into_view_if_needed()
        await shot(pg, '1-anthropic-no-endpoint.png')
        # Tingly Box: the address follows the connection
        await dlg.locator('[data-preset=tingly-box]').click()
        await expect(dlg.locator('[data-image-address]')).to_have_text('http://localhost:12580/tingly/imagegen/v1')
        await expect(dlg.locator('[data-image-state]')).to_have_attribute('data-image-state', 'ready')
        await expect(dlg.get_by_label('Image generation Model')).to_have_attribute('placeholder', 'tingly')
        await shot(pg, '2-tingly-box-follows.png')
        # another address: an OpenAI-style one, with its own key and model
        await dlg.locator('[data-preset=custom]').click()
        await dlg.locator('input[placeholder="https://"]').fill(MOCK_URL)
        await dlg.get_by_label('Image generation Address').fill('ftp://nope')
        await expect(dlg.locator('.status.bad')).to_contain_text('http://')
        await dlg.get_by_label('Image generation Address').fill(IMAGES_URL + '/v1')
        await dlg.get_by_label('Image generation Key').fill('sk-image')
        await expect(dlg.get_by_label('Image generation Model')).to_have_attribute('placeholder', 'gpt-image-1')
        await dlg.get_by_label('Image generation Model').fill('gpt-image-test')
        await shot(pg, '3-openai-address.png')
        await dlg.get_by_role('button', name='Save').click()
        await expect(dlg).to_have_count(0)
        cfg = call('/api/ai-config')[1]
        check(cfg['image']['baseUrl'] == {'value': IMAGES_URL + '/v1', 'source': 'saved'} and cfg['image']['ready'], 'saved and ready')
        check('sk-image' not in json.dumps(cfg), 'no image key in the response')
        check(call('/api/health')[1]['imageGen'] is True, 'health: image generation is on')

        # the route: a picture made, one edited, a refusal passed on, a path outside uploads/ refused
        st, made = call(f'/api/projects/{PROJECT}/images', {'prompt': 'A fox, watercolour', 'size': '1536x1024'})
        check(st == 200 and made['path'].startswith('uploads/a-fox-watercolour-') and made['path'].endswith('.png'), 'a picture is kept under uploads/ by content')
        check(os.path.exists(os.path.join(uploads, os.path.basename(made['path']))), 'the file is in the project')
        st, edited = call(f'/api/projects/{PROJECT}/images', {'prompt': 'make it dusk', 'edit': made['path']})
        check(st == 200 and edited['path'] != made['path'], 'an edit makes another picture')
        st, err = call(f'/api/projects/{PROJECT}/images', {'prompt': 'FAIL'})
        check(st == 502 and 'safety system' in err['error'], 'the gateway’s refusal reaches the person')
        check(call(f'/api/projects/{PROJECT}/images', {'prompt': 'x', 'edit': 'uploads/../../etc/passwd'})[0] == 400, 'an edit outside uploads/ is refused')
        check(call(f'/api/projects/{PROJECT}/images', {'prompt': 'x', 'size': 'huge'})[0] == 400, 'a bad size is refused')
        check(call(f'/api/projects/{PROJECT}/images', {'prompt': ' '})[0] == 400, 'an empty prompt is refused')
        if MOCK_LOG and os.path.exists(MOCK_LOG):
            seen = [json.loads(l) for l in open(MOCK_LOG)]
            gen = next(s for s in seen if s['path'] == '/v1/images/generations' and s.get('prompt') == 'A fox, watercolour')
            check(gen['auth'] == 'Bearer sk-image' and gen['model'] == 'gpt-image-test' and gen['size'] == '1536x1024', 'generations got the image key, the model and the size')
            ed = next(s for s in seen if s['path'] == '/v1/images/edits')
            check(ed['type'] == 'multipart/form-data' and 'image' in ed['fields'], 'edits went as multipart with the picture')
        # the picture can be used like any other in uploads/
        r = urllib.request.urlopen(f"{API}/api/projects/{PROJECT}/raw/{made['path']}")
        check(r.headers['content-type'] == 'image/png', 'it is served as an image')

        # the switches: the project's own (the request bar), then the global one (the dialog)
        st, state = call(f'/api/projects/{PROJECT}/image-gen')
        check(st == 200 and state == {'configured': True, 'global': True, 'project': True, 'on': True}, 'on by default in a project')
        await pg.goto(f'{BASE}/?p={PROJECT}')
        item = pg.get_by_role('button', name='Pictures', exact=True)
        await expect(item).to_have_attribute('aria-pressed', 'true')
        await pg.wait_for_timeout(2000)
        await shot(pg, '5-request-bar-on.png')
        await item.click()
        await pg.wait_for_timeout(300)
        state = call(f'/api/projects/{PROJECT}/image-gen')[1]
        check(state['project'] is False and state['on'] is False and state['global'] is True, 'the project switch turns it off for this project only')
        st, err = call(f'/api/projects/{PROJECT}/images', {'prompt': 'a fox'})
        check(st == 403 and 'switched off' in err['error'], 'a project with it off refuses a picture')
        check(os.path.exists(os.path.join(os.environ.get('DC_PROJECTS', 'projects'), PROJECT, '.image.json')), 'the choice is kept in local state')
        await pg.goto(f'{BASE}/?p={PROJECT}')
        await expect(pg.get_by_role('button', name='Pictures', exact=True)).to_have_attribute('aria-pressed', 'false')
        await pg.wait_for_timeout(2000)
        await shot(pg, '6-request-bar-off.png')
        call(f'/api/projects/{PROJECT}/image-gen', {'enabled': True}, 'PUT')
        check(call(f'/api/projects/{PROJECT}/image-gen')[1]['on'] is True, 'turned back on')
        # the global switch keeps the address and key
        dlg = await open_dialog(pg)
        sw = dlg.locator('[data-image-switch] input')
        await expect(sw).to_be_checked()
        await sw.uncheck()
        await expect(dlg.locator('[data-image-state]')).to_have_attribute('data-image-state', 'paused')
        await dlg.locator('[data-image-section]').scroll_into_view_if_needed()
        await shot(pg, '7-global-off.png')
        await dlg.get_by_role('button', name='Save').click()
        await expect(dlg).to_have_count(0)
        cfg = call('/api/ai-config')[1]
        check(cfg['image']['ready'] and not cfg['image']['active'] and cfg['image']['enabled']['value'] is False, 'off globally, still configured')
        check(call('/api/health')[1]['imageGen'] is False, 'health: off')
        st, err = call(f'/api/projects/{PROJECT}/images', {'prompt': 'a fox'})
        check(st == 403, 'the route refuses while the global switch is off')
        state = call(f'/api/projects/{PROJECT}/image-gen')[1]
        check(state['configured'] and not state['global'] and not state['on'], 'the project sees the global switch')
        dlg = await open_dialog(pg)
        await dlg.locator('[data-image-switch] input').check()
        await dlg.get_by_role('button', name='Save').click()
        await expect(dlg).to_have_count(0)
        check(call('/api/health')[1]['imageGen'] is True, 'on again, nothing re-entered')

        # Chinese, dark
        pg2 = await b.new_page(locale='zh-CN', viewport={'width': 1280, 'height': 1000}, color_scheme='dark')
        await pg2.goto(BASE + '/')
        await pg2.locator('button[aria-label="AI 模型设置"]').click()
        d2 = pg2.locator('[role=dialog]')
        await expect(d2.locator('[data-image-section]')).to_contain_text('图片生成')
        await d2.locator('[data-image-section]').scroll_into_view_if_needed()
        await shot(pg2, '4-zh-dark.png')
        await pg2.goto(f'{BASE}/?p={PROJECT}')
        await expect(pg2.get_by_role('button', name='图片', exact=True)).to_have_attribute('aria-pressed', 'true')
        await pg2.wait_for_timeout(2000)
        await shot(pg2, '8-zh-dark-request-bar.png')
        check(not errs, 'no page errors')
        await b.close()
    # leave the project as it was
    shutil.rmtree(uploads, ignore_errors=True)
asyncio.run(main())
raise SystemExit(0 if ok else 1)
