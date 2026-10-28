"""End-to-end checks for design systems: the system's own page, and installing it into a deck.
Run with `pnpm dev` up: python3 e2e/ds.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, asyncio, subprocess, time, json
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DS = os.path.join(REPO, 'projects/tingly-ds')
DECK = os.path.join(REPO, 'projects/tingly-intro')
CHROME = os.environ.get('DC_CHROME')

def read(path): return open(path, encoding='utf-8').read()
def tokens(): return json.loads(read(os.path.join(DS, 'tokens.json')))
def color(name): return next((t for t in tokens()['color']['tokens'] if t['name'] == name), None)
def restore():
    for p in ('projects/tingly-ds', 'projects/tingly-intro'):
        subprocess.run(['git', 'checkout', '--', p], cwd=REPO)
        subprocess.run(['git', 'clean', '-fdq', '--', p], cwd=REPO)
    subprocess.run(['rm', '-rf', os.path.join(REPO, 'projects/zz-ds')])

async def wait_for(pred, timeout=6.0):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if pred(): return True
        except Exception: pass
        await asyncio.sleep(0.1)
    return False

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

async def click_in_stage(pg, css):
    fr = pg.frame_locator('.sframe.f-stage iframe')
    r = await fr.locator(css).first.evaluate('e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }')
    box = await pg.locator('.sframe.f-stage').bounding_box()
    k = box['width'] / 1920
    await pg.mouse.click(box['x'] + (r[0] + r[2] / 2) * k, box['y'] + (r[1] + r[3] / 2) * k)

async def main():
    os.makedirs(OUT, exist_ok=True)
    restore()
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='zh-CN', viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and '409 (Conflict)' not in m.text and errs.append(m.text))

        # --- overview -------------------------------------------------------------
        await pg.goto(BASE + '/?p=tingly-ds&v=overview')
        await expect(pg.locator('.topbar h1.dashtitle')).to_have_text('Tingly Design System')
        await expect(pg.locator('.md h1').first).to_have_text('Tingly Design System')
        await expect(pg.locator('.glance .specimen')).to_be_visible()
        check('the overview shows the palette by token name', await pg.locator('.gpalette .gsw').count() == 12)
        cover = pg.frame_locator('.cover iframe')
        await expect(cover.locator('h1')).to_have_text('Tingly Design System')
        check('the cover runs with the system\'s tokens', await cover.locator('h1').evaluate("e => getComputedStyle(e).fontFamily.includes('Instrument Serif')"))
        await pg.locator('.dssection .secbar button', has_text='编辑').first.click()
        ed = pg.locator('.mdedit')
        await ed.fill(read(os.path.join(DS, 'README.md')).replace('## Voice', '## Voice and tone'))
        await pg.locator('.dssection .secbar button', has_text='保存').click()
        ok = await wait_for(lambda: '## Voice and tone' in read(os.path.join(DS, 'README.md')))
        check('the brand book edits README.md', ok)
        await expect(pg.locator('.md h2', has_text='Voice and tone')).to_be_visible()

        # --- colours ----------------------------------------------------------------
        await pg.locator('.navi', has_text='颜色').click()
        await expect(pg.locator('.dsrow[data-token]')).to_have_count(12)
        check('contrast against the surfaces a usage names', await pg.locator('.dsrow[data-token="ink"] .ratio').count() == 2)
        check('an alias shows what it points to', (await pg.locator('.dsrow[data-token="accent"] .val').text_content()) == '→ brand')
        await pg.locator('.dsrow[data-token="warning"] .dshead').click()
        val = pg.locator('.dsrow[data-token="warning"] input[aria-label="Light 的值"]')
        await val.fill('#c2410c')
        await val.press('Enter')
        ok = await wait_for(lambda: color('warning')['value']['light'] == '#c2410c' and '--warning: #c2410c;' in read(os.path.join(DS, 'tokens.css')))
        check('editing a colour writes tokens.json, and tokens.css is rebuilt', ok)
        diff = subprocess.run(['git', 'diff', '--unified=0', '--', 'projects/tingly-ds/tokens.json'], cwd=REPO, capture_output=True, text=True).stdout
        changed = [l for l in diff.splitlines() if l[:1] in '+-' and l[:3] not in ('+++', '---')]
        check('…as data: only the line that changed', len(changed) == 2 and all('c2410c' in l or 'b45309' in l for l in changed), '\n'.join(changed[:6]))
        await pg.locator('.dsrow[data-token="brand"] .dshead').click()
        name = pg.locator('.dsrow[data-token="brand"] input[aria-label="颜色名称"]')
        await name.fill('cobalt')
        await name.press('Enter')
        ok = await wait_for(lambda: color('cobalt') is not None and color('accent')['value'] == '{cobalt}')
        check('renaming a colour moves its aliases with it', ok, json.dumps(color('accent')))
        await pg.locator('.dsview header button', has_text='添加颜色').click()
        ok = await wait_for(lambda: color('color-1') is not None)
        await pg.locator('.dsrow[data-token="color-1"] button', has_text='删除这个颜色').click()
        ok = ok and await wait_for(lambda: color('color-1') is None)
        check('adding and removing a colour', ok)

        # --- type and spacing --------------------------------------------------------
        await pg.locator('.navi', has_text='文字').click()
        await pg.locator('.dsrow[data-style="body"] .dshead').click()
        size = pg.locator('.dsrow[data-style="body"] input[aria-label="字号"]')
        await size.fill('26px')
        await size.press('Enter')
        ok = await wait_for(lambda: tokens()['type']['groups'][1]['styles'][2]['fontSize'] == '26px')
        check('editing a text style', ok)
        await pg.locator('.navi', has_text='间距与圆角').click()
        rad = pg.locator('input[aria-label="radius-card 的值"]')
        await rad.fill('20px')
        await rad.press('Enter')
        ok = await wait_for(lambda: tokens()['radius']['tokens'][0]['value'] == '20px')
        check('editing a radius', ok)

        # --- components ----------------------------------------------------------------
        await pg.locator('.navi', has_text='组件').click()
        await expect(pg.locator('.comp')).to_have_count(4)
        card = pg.frame_locator('.comp[data-comp="Card"] iframe')
        await expect(card.locator('.tg-card .tg-stat').first).to_have_text('< 1 ms')
        check('previews load the bundle and the edited tokens', await card.locator('.tg-card').first.evaluate("e => getComputedStyle(e).borderTopLeftRadius") == '20px')
        await pg.screenshot(path=OUT + 'ds-components.png')

        # --- assets -------------------------------------------------------------------
        await pg.locator('.navi', has_text='资源').click()
        await expect(pg.locator('.tile[data-asset="assets/Marks/tingly-mark.svg"] img')).to_be_visible()
        png = OUT + 'dot.png'
        open(png, 'wb').write(bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
                                           '1f15c4890000000d49444154789c6360f8cfc00000030101009a5c1d5f0000000049454e44ae426082'))
        async with pg.expect_file_chooser() as fc:
            await pg.locator('.dsgroup[data-group="Marks"] button', has_text='上传').click()
        await (await fc.value).set_files(png)
        await expect(pg.locator('.tile[data-asset="assets/Marks/dot.png"]')).to_be_visible()
        check('uploads land in their group, keeping their name', os.path.exists(os.path.join(DS, 'assets/Marks/dot.png')))

        # an asset cannot be restored, so it is the one delete that asks first (in the editor's own dialog, not the window's)
        dot = os.path.join(DS, 'assets/Marks/dot.png')
        await pg.locator('.tile[data-asset="assets/Marks/dot.png"] button[aria-label^="删除"]').click()
        await expect(pg.get_by_role('dialog')).to_be_visible()
        await pg.get_by_role('dialog').get_by_role('button', name='取消').click()
        await pg.wait_for_timeout(300)
        check('cancelling the asset question keeps the file', os.path.exists(dot))
        await pg.locator('.tile[data-asset="assets/Marks/dot.png"] button[aria-label^="删除"]').click()
        await pg.get_by_role('dialog').get_by_role('button', name='删除').click()
        check('confirming it deletes the asset', await wait_for(lambda: not os.path.exists(dot)))

        # --- issues from an outside edit -------------------------------------------------
        t = tokens()
        t['color']['tokens'].append({'name': 'oops', 'value': 'red'})
        open(os.path.join(DS, 'tokens.json'), 'w', encoding='utf-8').write(json.dumps(t, ensure_ascii=False, indent=2))
        await expect(pg.locator('.navi.warn')).to_contain_text('1')
        await pg.locator('.navi.warn').click()
        await expect(pg.locator('.issue-list li')).to_contain_text('"red" is not a colour')
        check('an outside edit that breaks the grammar shows up', True)

        # --- a new system from the picker ---------------------------------------------------
        await pg.goto(BASE + '/')
        await pg.locator('.lnewbtn').click()
        await pg.locator('.menu [data-new="design-system"] .mi').click()
        await pg.locator('[role=dialog] input[aria-label="文件夹"]').fill('zz-ds')
        await pg.locator('[role=dialog] button[type="submit"]').click()
        await expect(pg.locator('.topbar h1.dashtitle')).to_have_text('zz-ds')
        check('a new system starts small and clean', await pg.locator('.navi.warn').count() == 0 and os.path.exists(os.path.join(REPO, 'projects/zz-ds/tokens.css')))

        # --- preview as ---------------------------------------------------------------------------
        await pg.goto(BASE + '/?p=tingly-ds')
        await pg.locator('button[data-preview]').wait_for()
        before = await pg.locator('.app.ds').get_attribute('data-theme')
        await pg.locator('button[data-preview]').click()
        await pg.locator('[role=menuitem]:not([aria-checked=true])').first.click()
        after = await pg.locator('.app.ds').get_attribute('data-theme')
        check('the top bar\'s Preview as menu switches the system\'s theme', before != after, f'{before} {after}')

        # --- installing into the deck -----------------------------------------------------
        restore()
        await pg.goto(BASE + '/?p=tingly-intro&s=box')
        await pg.frame_locator('.sframe.f-stage iframe').locator('section#box').wait_for()
        await pg.keyboard.press('Escape')
        await pg.locator('select[aria-label="选择设计系统"]').select_option('tingly-ds')
        await pg.locator('.dsinst, button:has-text("装入")').last.click()
        deck = lambda: json.loads(read(os.path.join(DECK, 'deck.json')))
        ok = await wait_for(lambda: any(r['namespace'] == 'tingly' for r in deck()['designSystems']) and os.path.exists(os.path.join(DECK, 'ds/tingly/tokens.json')))
        check('installing copies the tokens and records the system', ok, json.dumps(deck().get('designSystems')))
        check('…keeping the deck\'s typefaces (the system\'s are the same faces)', len(deck()['faces']) == 2)
        await expect(pg.locator('.dsinst[data-ds="tingly"]')).to_contain_text('12 色')

        await click_in_stage(pg, 'h2')
        await expect(pg.locator('.lr[aria-selected="true"]')).to_contain_text('Any agent')
        sel = pg.locator('select[aria-label="文字样式"]')
        check('the title is recognised as the system\'s slide-title style', await sel.input_value() == 'ds:tingly:slide-title')
        check('the text colour is recognised as a token', (await pg.locator('.colorfield .tokname').first.text_content()) == 'ink')
        await pg.locator('button[aria-label="文字颜色：从设计系统选"]').click()
        await pg.locator('.tokpick button[title^="brand #"]').click()
        arr = lambda: read(os.path.join(DECK, 'slides/box.html'))
        ok = await wait_for(lambda: 'color:#2563eb' in arr().split('</h2>')[0].split('<h2')[1])
        check('picking a token writes its value (the slide subset has no var())', ok)
        await sel.select_option('ds:tingly:lead')
        ok = await wait_for(lambda: 'font-size:30px' in arr().split('</h2>')[0].split('<h2')[1] and 'line-height:1.55' in arr().split('</h2>')[0].split('<h2')[1])
        check('a text style writes its declarations, in px', ok)
        await pg.screenshot(path=OUT + 'ds-consumer.png')
        await click_in_stage(pg, 'h2')
        await pg.wait_for_timeout(500)  # the stage reloads after the style edit; let the selection land before clearing it
        await pg.keyboard.press('Escape')
        await pg.keyboard.press('Escape')
        await pg.locator('.dsinst[data-ds="tingly"] button', has_text='移除').click()
        ok = await wait_for(lambda: not deck()['designSystems'] and not os.path.exists(os.path.join(DECK, 'ds/tingly/tokens.json')))
        check('removing a system takes its copy and record out', ok)

        # Built-ins also install through the shared panel picker without a project system.
        response = await pg.request.get(BASE + '/api/projects')
        projects = await response.json()
        await pg.route('**/api/projects', lambda route: route.fulfill(json=[x for x in projects if x['kind'] != 'design-system']))
        # a slow load shows no editor at all, not the canvas one in the deck's place (its panel would vanish under a click)
        asked = asyncio.Event()
        async def slow(route):
            asked.set()
            await asyncio.sleep(1.5)
            await route.continue_()
        await pg.route('**/api/projects/tingly-intro/files', slow)
        await pg.reload()
        await asyncio.wait_for(asked.wait(), 10)
        await pg.locator('.project-loading').wait_for()
        check('while a deck loads, no canvas editor stands in for it', await pg.locator('.panel').count() == 0)
        await pg.unroute('**/api/projects/tingly-intro/files', slow)
        await pg.locator('.panel').wait_for()
        await pg.keyboard.press('Escape')
        builtins = pg.locator('.panel .dsbuiltins')
        await builtins.locator('summary').click()
        await builtins.locator('[data-group="palette"]').click()
        await builtins.locator('[data-look="nord"]').click()
        await pg.locator('.faceadd button', has_text='装入').click()
        await expect(pg.locator('.dsinst[data-ds="look-nord"]')).to_contain_text('Nord')
        check('the panel installs a built-in even without project systems', any(r.get('artifact') == 'builtin:nord' for r in deck()['designSystems']))
        await pg.locator('.dsinst[data-ds="look-nord"] button', has_text='移除').click()
        ok = await wait_for(lambda: not deck()['designSystems'] and not os.path.exists(os.path.join(DECK, 'ds/look-nord/tokens.json')))
        check('the panel removes an installed built-in', ok)

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    restore()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
