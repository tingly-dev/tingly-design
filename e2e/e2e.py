"""End-to-end checks for the editor. Run with `pnpm dev` up: python3 e2e/e2e.py"""
import os, asyncio, subprocess, re, time, json
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(REPO, 'projects/tingly-box-console-canvas')
MAIN = os.path.join(DEMO, 'Main.dc.html')
CANVAS = os.path.join(DEMO, 'canvas.json')
CHROME = os.environ.get('DC_CHROME')  # a Chromium to use instead of Playwright's own

def src(path=MAIN): return open(path, encoding='utf-8').read()
def canvas(): return json.loads(src(CANVAS))
def diff(path='projects/tingly-box-console-canvas/Main.dc.html'):
    return subprocess.run(['git', 'diff', '--unified=0', '--', path], cwd=REPO, capture_output=True, text=True).stdout
def restore(): subprocess.run(['git', 'checkout', '--', 'projects/tingly-box-console-canvas'], cwd=REPO); subprocess.run(['git', 'clean', '-fdq', '--', 'projects/tingly-box-console-canvas'], cwd=REPO)

async def wait_async(pred, timeout=5.0):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if await pred(): return True
        except Exception: pass
        await asyncio.sleep(0.1)
    return False


async def wait_for(pred, timeout=5.0):
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

async def empty_point(pg):
    """A point on the stage that is not over an artboard, item or floating bar."""
    boxes = await pg.evaluate("""() => [...document.querySelectorAll('[data-board], [data-item], .bar, .prompt, .panel, .strip')]
        .map(e => { const r = e.getBoundingClientRect(); return [r.left - 30, r.top - 30, r.right + 30, r.bottom + 30]; })""")
    stage = await pg.locator('.stage').bounding_box()
    for y in range(int(stage['y']) + 80, int(stage['y'] + stage['height']) - 120, 30):
        for x in range(int(stage['x']) + 40, int(stage['x'] + stage['width']) - 60, 30):
            if not any(a <= x <= c and b <= y <= d for a, b, c, d in boxes):
                return x, y
    raise RuntimeError('no empty point')

async def main():
    os.makedirs(OUT, exist_ok=True)
    restore()
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='zh-CN', viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and '409 (Conflict)' not in m.text and errs.append(m.text))
        await pg.goto(BASE + '/?p=tingly-box-console-canvas')
        await pg.wait_for_timeout(2500)
        main = pg.frame_locator('[data-board="Main.dc.html"] iframe')
        target = pg.locator('.prompt .target')

        # --- selection, layer tree, properties --------------------------------
        await main.locator('h1').click()
        await expect(pg.locator('.lr[aria-selected="true"]')).to_contain_text('Team settings')
        check('click selects element and the layer tree follows', True)
        await pg.locator('input[aria-label="文字颜色"]').fill('#15803d')
        await pg.locator('input[aria-label="文字颜色"]').press('Enter')
        ok = await wait_for(lambda: 'font-weight:700;color:#15803d">Team settings</h1>' in src())
        changed = [l for l in diff().splitlines() if l.startswith('+') and not l.startswith('+++')]
        check('panel colour edit writes a one-line patch', ok and len(changed) == 1, diff())
        await expect(pg.locator('.contrast')).to_be_visible()
        check('contrast check shown for text colour', True)

        # width mode: hug -> fixed
        await pg.locator('select[aria-label="宽度模式"]').select_option('fixed')
        ok = await wait_for(lambda: re.search(r'<h1 style="[^"]*width:\d+px', src()) is not None)
        check('size mode Fixed writes a px width', ok)
        await pg.locator('select[aria-label="宽度模式"]').select_option('hug')
        ok = await wait_for(lambda: re.search(r'<h1 style="[^"]*width:', src()) is None)
        check('size mode Hug removes it again', ok)

        # Shift+Enter walks up to the parent, Enter back down, Escape clears (keys pressed inside the artboard frame);
        # a panel field used just before must not keep the keys
        await pg.wait_for_timeout(400)
        await pg.locator('select[aria-label="宽度模式"]').focus()
        await main.locator('h1').click()
        await expect(pg.locator('select[aria-label="宽度模式"]')).not_to_be_focused()
        await expect(pg.locator('.lr[aria-selected="true"] .rn')).to_have_text('文字')
        await main.locator('body').press('Shift+Enter')
        await expect(pg.locator('.lr[aria-selected="true"] .rn')).to_have_text('横向')
        check('Shift+Enter selects the parent', True)
        await main.locator('body').press('Enter')
        await expect(pg.locator('.lr[aria-selected="true"] .rn')).to_have_text('文字')
        check('Enter selects the first child', True)
        await main.locator('body').press('Escape')
        await expect(pg.locator('text=未选中任何内容')).to_be_visible()
        check('Escape clears the selection', True)

        # stack direction on the button row
        await main.locator('button', has_text='Save changes').click()
        await expect(pg.locator('.lr[aria-selected="true"]')).to_contain_text('Save changes')
        await main.locator('body').press('Shift+Enter')
        await expect(pg.locator('.lr[aria-selected="true"]')).to_contain_text('Save changes Discard')
        await pg.locator('.seg button[aria-label="纵向"]').click()
        ok = await wait_for(lambda: re.search(r'<div style="display:flex;gap:12px;flex-direction:column">', src()) is not None)
        check('layout direction toggle', ok, re.search(r'<div style="display:flex;gap:12px[^"]*">', src()).group(0) if re.search(r'<div style="display:flex;gap:12px[^"]*">', src()) else '')
        await pg.locator('.seg button[aria-label="横向"]').click()
        await wait_for(lambda: 'gap:12px;flex-direction:row' in src())

        # double-click text edit
        await main.locator('p').first.dblclick()
        await pg.keyboard.type('在画布上直接改的字')
        await pg.keyboard.press('Enter')
        check('double-click edits text in place', await wait_for(lambda: '>在画布上直接改的字</p>' in src()))

        # --- context menu: wrap and ungroup -------------------------------------
        await main.locator('button', has_text='Save changes').click(button='right')
        await expect(pg.locator('.menu[aria-label="编辑"]')).to_be_visible()
        await pg.locator('.menu .mi', has_text='包进 flex 容器').click()
        ok = await wait_for(lambda: re.search(r'<div style="display:flex;gap:8px;align-items:center"><button[^>]*>Save changes</button></div>', src()) is not None)
        check('context menu: wrap in flex', ok)
        await pg.keyboard.press('Control+Shift+G')
        ok = await wait_for(lambda: 'align-items:center"><button' not in src() and '>Save changes</button>' in src())
        check('ungroup restores the element', ok)

        # --- clipboard ---------------------------------------------------------
        before = src().count('>Team settings</h1>')
        await main.locator('h1').click()
        await expect(pg.locator('.lr[aria-selected="true"] .rn')).to_have_text('文字')
        await main.locator('body').press('Control+c')
        await main.locator('body').press('Control+v')
        check('copy + paste an element', await wait_for(lambda: src().count('>Team settings</h1>') == before + 1))
        await main.locator('body').press('Control+z')
        check('undo the paste', await wait_for(lambda: src().count('>Team settings</h1>') == before))

        # --- drag to reorder inside a flex row ---------------------------------
        save = main.locator('button', has_text='Save changes')
        await save.click()
        bb = await save.bounding_box()
        reset = await main.locator('button', has_text='Discard').bounding_box()
        await pg.mouse.move(bb['x'] + 10, bb['y'] + bb['height'] / 2)
        await pg.mouse.down()
        await pg.mouse.move(reset['x'] + reset['width'] - 2, reset['y'] + reset['height'] / 2, steps=12)
        await pg.screenshot(path=OUT + 'drag-reorder.png')
        await pg.mouse.up()
        ok = await wait_for(lambda: src().index('>Discard</button>') < src().index('>Save changes</button>'))
        check('drag reorders siblings', ok)
        await expect(pg.locator('.lr[aria-selected="true"]')).to_contain_text('Save changes')
        check('selection follows the moved element', True)

        # --- drag out of the flow ---------------------------------------------
        card = main.locator('text=5 connected')
        await card.click(); await pg.wait_for_timeout(300)  # let the selection land before walking up from it
        await main.locator('body').press('Shift+Enter')
        await expect(pg.locator('.lr[aria-selected="true"]')).to_contain_text('Providers')
        await pg.wait_for_timeout(300)
        cb = await card.bounding_box()
        await pg.mouse.move(cb['x'] + 20, cb['y'] + 4)
        await pg.mouse.down()
        await pg.mouse.move(cb['x'] + 20, cb['y'] + 260, steps=15)
        await pg.mouse.up()
        def card_abs():
            m = re.search(r'<div style="([^"]*)">\s*<div[^>]*>Providers', src())
            return m and all(k in m.group(1) for k in ('position:absolute', 'left:', 'top:', 'width:', 'margin:0'))
        ok = await wait_for(card_abs)
        check('drag out of a grid makes the element absolute', ok)
        check('the parent is made relative and keeps its height', re.search(r'grid-template-columns:repeat\(3, minmax\(0, 1fr\)\);gap:16px;position:relative;height:\d+px', src()) is not None)
        await pg.keyboard.press('Control+z')

        # --- canvas tools -------------------------------------------------------
        x, y = await empty_point(pg)
        await pg.keyboard.press('Escape')
        await pg.keyboard.press('n')
        await pg.mouse.click(x, y)
        await pg.keyboard.type('一条便签')
        await pg.keyboard.press('Escape')
        check('note tool creates a sticky', await wait_for(lambda: any(n.get('text') == '一条便签' for n in canvas()['notes'].values())))
        await expect(pg.locator('.fmt')).to_be_visible()
        check('format bar shows for the note', True)

        async def drag_tool(key, dx, dy):
            x, y = await empty_point(pg)
            await pg.keyboard.press('Escape')
            await pg.keyboard.press(key)
            await pg.mouse.move(x, y); await pg.mouse.down()
            await pg.mouse.move(x + dx, y + dy, steps=8); await pg.mouse.up()
            await pg.wait_for_timeout(400)
        await drag_tool('r', 80, 50)
        check('rectangle tool', await wait_for(lambda: any(n.get('kind') == 'rect' and n['w'] > 50 for n in canvas()['notes'].values())))
        await drag_tool('Shift+L', 90, 0)
        check('arrow tool', await wait_for(lambda: any(n.get('kind') == 'arrow' and 'x2' in n for n in canvas()['notes'].values())))
        await drag_tool('p', 60, 30)
        check('pen tool stores a path', await wait_for(lambda: any(n.get('kind') == 'pen' and n.get('d', '').startswith('M') for n in canvas()['notes'].values())))
        await pg.keyboard.press('Escape')
        await drag_tool('a', 160, 100)
        ok = await wait_for(lambda: any(f.startswith('Board') for f in canvas()['boards']))
        newb = next((f for f in canvas()['boards'] if f.startswith('Board')), '')
        check('artboard tool creates a board file', ok and os.path.exists(os.path.join(DEMO, newb)))

        # text tool inside an artboard
        await pg.keyboard.press('Escape')
        await pg.locator('button[aria-label="适应全部"]').count()
        await pg.keyboard.press('Shift+1'); await pg.wait_for_timeout(500)
        await pg.keyboard.press('t')
        await main.locator('section').click()
        await pg.wait_for_timeout(600)
        await pg.keyboard.type('用文字工具加的')
        await pg.keyboard.press('Enter')
        check('text tool inserts and edits a paragraph', await wait_for(lambda: '>用文字工具加的</p>' in src()))

        # --- artboard: rename, tweaks, code tab --------------------------------
        await pg.keyboard.press('Escape')
        strip = pg.locator('[data-board="Main.dc.html"] .strip .t')
        await strip.dblclick()
        await pg.locator('[data-board="Main.dc.html"] .strip input').fill('Team settings v2')
        await pg.keyboard.press('Enter')
        check('rename artboard from its name strip', await wait_for(lambda: canvas()['boards']['Main.dc.html'].get('title') == 'Team settings v2'))
        await pg.locator('.panel [role="tab"]', has_text='微调').click()
        await pg.locator('.swatches button[aria-label="#15803d"]').click()
        check('tweak swatch rewrites data-props', await wait_for(lambda: '"accent":{"editor":"color","default":"#15803d"' in src()))
        await main.locator('h1').click()
        await pg.locator('.panel [role="tab"]', has_text='代码').click()
        await expect(pg.locator('.decl .p', has_text='font-size').first).to_be_visible()
        await expect(pg.locator('.from', has_text='body')).to_be_visible()
        check('code tab lists declarations and inherited values', True)
        await pg.locator('input[aria-label="添加样式声明"]').fill('letter-spacing: 1px;')
        await pg.locator('input[aria-label="添加样式声明"]').press('Enter')
        check('code tab adds a declaration', await wait_for(lambda: re.search(r'<h1 style="[^"]*letter-spacing:1px', src()) is not None))
        await pg.locator('.panel [role="tab"]', has_text='属性').click()

        # --- pages ------------------------------------------------------------
        await pg.locator('.bar.left .tb.text').click()
        await pg.locator('.menu .mi', has_text='新建页面').click()
        check('new page', await wait_for(lambda: len(canvas()['pages']) == 2))
        await expect(pg.locator('[data-board]')).to_have_count(0)
        check('the new page starts empty', True)
        await pg.locator('.bar.left .tb.text').click()
        await pg.locator('.menu .mi', has_text='第 1 页').click()
        await expect(pg.locator('[data-board="Main.dc.html"]')).to_be_visible()
        check('switch back to the first page', True)

        # --- full window and export ------------------------------------------
        await pg.locator('[data-board="Agents.dc.html"] .strip button[aria-label^="全屏打开"]').click()
        focus = pg.frame_locator('.focus iframe')
        await focus.locator('button', has_text='Codex').click()
        await expect(focus.locator('text=OpenAI Responses')).to_be_visible()
        check('full window runs the artboard', True)
        await pg.keyboard.press('Escape')
        await expect(pg.locator('.focus')).to_have_count(0)
        await pg.locator('[data-board="Agents.dc.html"] .strip button[aria-label^="导出"]').click()
        async with pg.expect_download() as dl:
            await pg.locator('.menu .mi', has_text='PNG @2x').click()
        d = await dl.value
        path = OUT + d.suggested_filename
        await d.save_as(path)
        check('export PNG', open(path, 'rb').read(4) == b'\x89PNG', d.suggested_filename)

        # --- two editors at once, then undo ----------------------------------
        restore()
        await pg.reload(); await pg.wait_for_timeout(2500)
        pg2 = await ctx.new_page()
        await pg2.goto(BASE + '/?p=tingly-box-console-canvas'); await pg2.wait_for_timeout(2500)
        main2 = pg2.frame_locator('[data-board="Main.dc.html"] iframe')
        await main.locator('h1').click()
        await main2.locator('button', has_text='Discard').click()
        await pg.locator('input[aria-label="字号"]').fill('30')
        await pg2.locator('input[aria-label="字号"]').fill('17')
        await asyncio.gather(pg.locator('input[aria-label="字号"]').press('Enter'), pg2.locator('input[aria-label="字号"]').press('Enter'))
        ok = await wait_for(lambda: 'font-size:30px' in src() and re.search(r'font-size:17px[^>]*>Discard', src()) is not None, 6)
        check('two editors saving at once both keep their edits', ok)
        await pg.evaluate("document.activeElement && document.activeElement.blur()")
        await pg.keyboard.press('Control+z')
        check('undo own edit while keeping the other editor\'s', await wait_for(lambda: 'font-size:30px' not in src() and 'font-size:17px' in src()))
        await pg2.close()

        # outside edit shows up
        text = src().replace('>Discard<', '>Reset to defaults<')
        open(MAIN, 'w', encoding='utf-8').write(text)
        try:
            await expect(main.locator('button', has_text='Reset to defaults')).to_be_visible(timeout=4000); ok = True
        except Exception: ok = False
        check('outside edit appears on the canvas', ok)

        # play mode
        await pg.locator('button[aria-label="播放"]').click()
        pricing = pg.frame_locator('[data-board="Agents.dc.html"] iframe')
        await pricing.locator('button', has_text='Codex').click()
        try:
            await expect(pricing.locator('text=OpenAI Responses')).to_be_visible(timeout=2000); ok = True
        except Exception: ok = False
        check('play mode runs artboard logic', ok)
        await pg.evaluate('document.activeElement && document.activeElement.blur()')
        await pg.keyboard.press('f')
        ok = await wait_async(lambda: pg.evaluate('!!document.fullscreenElement'))
        check('F fills the screen while playing a canvas, as in a presentation', ok)
        await pg.keyboard.press('Escape')
        ok = await wait_async(lambda: pg.evaluate('!document.fullscreenElement && !document.querySelector(\'[data-mode=play]\')'))
        check('Esc leaves the full screen and play mode together', ok)

        # deleting an artboard asks nothing; the toast's Undo brings it back with its file
        glow = os.path.join(REPO, 'projects/tingly-box-console-canvas/Glow.dc.html')
        await pg.locator('.layers .lr[data-key="Glow.dc.html"]').click()
        await pg.keyboard.press('Delete')
        ok = await wait_for(lambda: 'Glow.dc.html' not in canvas()['boards'] and not os.path.exists(glow))
        check('deleting an artboard removes it and its file without asking', ok)
        await pg.locator('.toast-act').click()
        ok = await wait_for(lambda: 'Glow.dc.html' in canvas()['boards'] and os.path.exists(glow) and canvas()['order'][-1] == 'Glow.dc.html')
        check('Undo in the toast brings the artboard back to its place', ok, str(canvas()['order']))

        await pg.locator('.syncchip').click()
        n = await pg.locator('.jline').count()
        check('journal popover lists edits', n >= 3, str(n))
        await pg.screenshot(path=OUT + 'final.png')
        check('no page errors', not errs, '; '.join(errs[:3]))
        await b.close()
    restore()
    print(f"{sum(ok for _, ok in results)}/{len(results)} passed")

asyncio.run(main())
