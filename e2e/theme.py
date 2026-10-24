"""End-to-end checks for themes: the appearance menu, ?theme=, the script API and a host's postMessage.
Run with `pnpm dev` up: python3 e2e/theme.py"""
import os, asyncio, json
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
CHROME = os.environ.get('DC_CHROME')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

TOKEN = 'getComputedStyle(document.documentElement).getPropertyValue("--{}").trim()'
BG = 'getComputedStyle(document.body).backgroundColor'
TB_CLAUDE = {
    'name': 'Tingly Box · Claude',
    'palette': {
        'mode': 'light',
        'primary': {'main': '#D97757', 'dark': '#C26146', 'contrastText': '#ffffff'},
        'background': {'default': '#FAF9F5', 'paper': '#FFFFFF'},
        'text': {'primary': '#141413', 'secondary': '#6B6863', 'disabled': '#B0AEA5'},
        'divider': '#E8E6DC',
    },
}

async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        errs = []

        # --- the default follows the system ---------------------------------------------------
        for scheme, want in (('light', 'light'), ('dark', 'dark')):
            ctx = await b.new_context(locale='zh-CN', viewport={'width': 1280, 'height': 800}, color_scheme=scheme)
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(BASE + '/')
            await pg.locator('.lcard[data-project]').first.wait_for()
            got = await pg.evaluate('[document.documentElement.dataset.theme, document.documentElement.dataset.scheme]')
            check(f'with nothing chosen, a {scheme} system gets the {want} theme', got == [want, want], str(got))
            await ctx.close()

        ctx = await b.new_context(locale='zh-CN', viewport={'width': 1280, 'height': 800})
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and errs.append(m.text))
        await pg.goto(BASE + '/')
        await pg.locator('.lcard[data-project]').first.wait_for()

        # --- the appearance menu --------------------------------------------------------------
        await pg.locator('button[aria-label="外观"]').click()
        modes = await pg.locator('.menu .amode').evaluate_all('bs => bs.map(b => b.dataset.mode)')
        check('the menu offers system and the five presets', modes == ['system', 'light', 'dark', 'claude', 'ds', 'sunlit'], str(modes))
        check('each row shows the theme\'s own colours', await pg.locator('.menu .amode .aswatch i').count() == 18)
        await pg.locator('.menu .amode[data-mode="dark"]').click()
        check('picking dark repaints at once, in Tingly Box\'s dark colours', await pg.evaluate(TOKEN.format('panel')) == '#11141c' and await pg.evaluate(BG) == 'rgb(7, 9, 15)')
        check('form controls switch to a dark colour scheme', await pg.evaluate('getComputedStyle(document.documentElement).colorScheme') == 'dark')
        await pg.screenshot(path=OUT + 'theme-dark-launcher.png')
        await pg.reload()
        await pg.locator('.lcard[data-project]').first.wait_for()
        check('the pick is remembered', await pg.evaluate('document.documentElement.dataset.theme') == 'dark')
        await pg.locator('button[aria-label="外观"]').click()
        await expect(pg.locator('.menu .amode[aria-checked="true"]')).to_have_attribute('data-mode', 'dark')
        check('the menu marks the current theme', True)
        await pg.keyboard.press('Escape')

        # --- a dark editor ------------------------------------------------------------------------
        await pg.goto(BASE + '/?p=tingly-box-console-canvas')
        await pg.locator('.board').first.wait_for()
        title = await pg.locator('.item.title1').first.evaluate('e => getComputedStyle(e).color')
        check('a canvas title in the default colour stays readable on a dark canvas', title == 'rgb(243, 245, 249)', title)
        await pg.goto(BASE + '/?p=tingly-box-usage-dashboard')
        await expect(pg.locator('.dashbar button[data-preview]')).to_have_attribute('aria-label', '预览为：暗色')
        check('a dashboard opens dark when the editor is dark', True)

        # --- ?theme= ------------------------------------------------------------------------------
        await pg.goto(BASE + '/?theme=claude')
        await pg.locator('.lcard[data-project]').first.wait_for()
        check('?theme=claude applies the Claude preset', await pg.evaluate(TOKEN.format('accent')) == '#d97757')
        await pg.locator('.lcard[data-project="tingly-design-guide-doc"]').click()
        await pg.wait_for_url('**/?p=tingly-design-guide-doc')
        check('the URL theme holds as you move around the tab', await pg.evaluate('document.documentElement.dataset.theme') == 'claude')
        await pg.screenshot(path=OUT + 'theme-claude-docs.png')
        custom = json.dumps({'base': 'dark', 'name': 'Rose', 'tokens': {'accent': '#e11d48'}})
        await pg.goto(BASE + '/?theme=' + custom.replace('#', '%23'))
        await pg.locator('.lcard[data-project]').first.wait_for()
        soft = await pg.evaluate(TOKEN.format('accent-soft'))
        check('a JSON theme overrides one token on a dark base', await pg.evaluate(TOKEN.format('accent')) == '#e11d48' and await pg.evaluate(TOKEN.format('panel')) == '#11141c')
        check('tokens derived from the accent follow it', '#e11d48' in soft, soft)
        await pg.locator('button[aria-label="外观"]').click()
        await expect(pg.locator('.menu .amode[data-mode="custom"]')).to_contain_text('Rose')
        await expect(pg.locator('.menu .amode[data-mode="custom"] .k')).to_have_text('链接传入')
        check('a passed-in theme shows as its own row, saying where it came from', True)
        await pg.locator('.menu .amode[data-mode="light"]').click()
        await pg.goto(BASE + '/')
        await pg.locator('.lcard[data-project]').first.wait_for()
        check('picking in the menu drops the URL theme', await pg.evaluate('document.documentElement.dataset.theme') == 'light')

        # --- the script API -------------------------------------------------------------------------
        got = await pg.evaluate('window.tinglyDesign.presets().map(p => p.id)')
        check('tinglyDesign.presets() lists the presets', got == ['light', 'dark', 'claude', 'ds', 'sunlit'], str(got))
        t = await pg.evaluate('window.tinglyDesign.setTheme(%s)' % json.dumps(TB_CLAUDE))
        check('a Tingly Box palette maps onto the tokens', t['tokens']['accent'] == '#D97757' and t['tokens']['canvas'] == '#FAF9F5' and t['tokens']['line'] == '#E8E6DC' and t['tokens']['accent-ink'] == '#C26146')
        bad = await pg.evaluate('window.tinglyDesign.setTheme({ tokens: { accent: "red; background: url(https://x.invalid/a.png)", panel: "#123456" } }).tokens')
        check('values that could load something are dropped, the rest kept', bad['accent'] == '#2563eb' and bad['panel'] == '#123456', json.dumps({k: bad[k] for k in ('accent', 'panel')}))
        check('getTheme() says where the theme came from', (await pg.evaluate('window.tinglyDesign.getTheme().source')) == 'host')
        await pg.reload()
        await pg.locator('.lcard[data-project]').first.wait_for()
        check('a script-set theme is not remembered', await pg.evaluate('document.documentElement.dataset.theme') == 'light')

        # --- a host page embedding the editor -----------------------------------------------------
        host = await ctx.new_page()
        host.on('pageerror', lambda e: errs.append(str(e)))
        await host.goto(BASE + '/api/health')
        await host.set_content(f'<iframe id="f" src="{BASE}/" style="width:1200px;height:700px;border:0"></iframe>'
                               '<script>window.got=[];addEventListener("message",e=>e.data&&e.data.type==="tingly-design:theme-changed"&&got.push(e.data.theme))</script>')
        frame = host.frame_locator('#f')
        await frame.locator('.lcard[data-project]').first.wait_for()
        await host.evaluate('document.getElementById("f").contentWindow.postMessage({ type: "tingly-design:set-theme", theme: "ds" }, "*")')
        await expect(frame.locator('html')).to_have_attribute('data-theme', 'ds')
        check('a host sets the theme with postMessage', True)
        await host.evaluate('document.getElementById("f").contentWindow.postMessage({ type: "tingly-design:set-theme", theme: %s }, "*")' % json.dumps(TB_CLAUDE))
        await expect(frame.locator('html')).to_have_attribute('data-theme', 'custom')
        check('a host can pass its whole palette', True)
        told = await host.evaluate('window.got.map(t => t.id)')
        check('the editor tells the host which theme is on', 'ds' in told and told[-1] == 'custom', str(told))
        await host.screenshot(path=OUT + 'theme-host.png')

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
