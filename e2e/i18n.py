"""End-to-end checks for the UI language: browser detection, the appearance menu, ?lang=, a host's
postMessage, server errors in the request's language, and every kind's editor showing one language.
Run with `pnpm dev` up: python3 e2e/i18n.py"""
import os, asyncio, json, re
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
CHROME = os.environ.get('DC_CHROME')

# one sample per kind; the samples are written in English, so an English editor shows no Chinese at all
SAMPLES = ['box-console', 'tingly-intro', 'tingly-ds', 'box-usage', 'design-guide', 'design-motion']
HAN = r"""() => {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const out = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest('[lang="zh"]') || !/\p{Script=Han}/u.test(n.textContent)) continue;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    out.push(n.textContent.trim().slice(0, 40));
  }
  for (const el of document.querySelectorAll('[aria-label], [title], [placeholder]')) {
    for (const a of ['aria-label', 'title', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v && /\p{Script=Han}/u.test(v) && !el.closest('[lang="zh"]')) out.push(`${a}=${v.slice(0, 40)}`);
    }
  }
  return out;
}"""

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        errs = []

        # --- the browser's language picks one we ship -----------------------------------------
        for locale, want, label in (('en-US', 'en', 'Appearance'), ('zh-CN', 'zh-CN', '外观'), ('zh-TW', 'zh-CN', '外观'), ('ru-RU', 'en', 'Appearance')):
            ctx = await b.new_context(locale=locale, viewport={'width': 1280, 'height': 800})
            pg = await ctx.new_page()
            await pg.goto(BASE + '/')
            await pg.locator('.lcard[data-project]').first.wait_for()
            got = await pg.evaluate('document.documentElement.lang')
            has = await pg.locator(f'button[aria-label="{label}"]').count()
            check(f'a {locale} browser opens in {want}', got == want and has == 1, got)
            await ctx.close()

        ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and '409 (Conflict)' not in m.text and '400 (Bad Request)' not in m.text and errs.append(m.text))
        await pg.goto(BASE + '/')
        await pg.locator('.lcard[data-project]').first.wait_for()
        han = await pg.evaluate(HAN)
        check('the English launcher has no Chinese left in it', not han, json.dumps(han[:8], ensure_ascii=False))

        # --- every kind's editor speaks one language ---------------------------------------------
        for name in SAMPLES:
            await pg.goto(f'{BASE}/?p={name}')
            await pg.wait_for_timeout(2500)
            han = await pg.evaluate(HAN)
            check(f'{name}: the English editor has no Chinese left in it', not han, json.dumps(han[:8], ensure_ascii=False))
            await pg.screenshot(path=OUT + f'i18n-en-{name}.png')

        # --- the appearance menu -------------------------------------------------------------------
        await pg.goto(BASE + '/')
        await pg.locator('.lcard[data-project]').first.wait_for()
        check('the language button shows the language in use', (await pg.locator('button[data-language]').inner_text()).strip() == 'English')
        await pg.locator('button[aria-label="Language"]').click()
        langs = await pg.locator('.menu .alang').evaluate_all('bs => bs.map(b => [b.dataset.lang, b.textContent.trim()])')
        check('the menu lists each language by its own name', langs == [['en', 'English'], ['zh', '中文']], str(langs))
        await pg.locator('.menu .alang[data-lang="zh"]').click()
        await expect(pg.locator('button[aria-label="外观"]')).to_have_count(1)
        check('picking 中文 switches at once, without a reload', await pg.evaluate('document.documentElement.lang') == 'zh-CN')
        await pg.reload()
        await pg.locator('.lcard[data-project]').first.wait_for()
        check('the pick is remembered', await pg.locator('button[aria-label="外观"]').count() == 1)
        check('and the launcher reads in Chinese', len(await pg.evaluate(HAN)) > 5)
        await pg.screenshot(path=OUT + 'i18n-zh-launcher.png')

        # --- ?lang= wins for the tab, the script API ------------------------------------------------
        await pg.goto(BASE + '/?lang=en')
        await pg.locator('.lcard[data-project]').first.wait_for()
        check('?lang=en wins over the pick', await pg.locator('button[aria-label="Appearance"]').count() == 1)
        got = await pg.evaluate('window.tinglyDesign.setLanguage("zh-TW")')
        check('tinglyDesign.setLanguage() takes a regional tag', got == 'zh' and await pg.evaluate('document.documentElement.lang') == 'zh-CN', str(got))
        check('getLanguage() says where it came from', await pg.evaluate('window.tinglyDesign.getLanguage().source') == 'host')
        check('an unknown language is ignored', await pg.evaluate('window.tinglyDesign.setLanguage("ru")') is None)

        # --- the server answers in the request's language -----------------------------------------
        async def refused(lang):
            return await pg.evaluate("""async (lang) => {
                const r = await fetch('api/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dc-lang': lang }, body: JSON.stringify({ name: 'bad name!' }) });
                return [r.status, await r.json()];
            }""", lang)
        en_status, en_body = await refused('en')
        zh_status, zh_body = await refused('zh')
        check('a refused request is worded in English for an English editor', en_status == 400 and en_body.get('error', '').startswith('A project name'), json.dumps(en_body))
        check('and in Chinese for a Chinese one, with the same code', zh_body.get('error', '').startswith('项目名') and zh_body.get('code') == en_body.get('code') == 'badProjectName', json.dumps(zh_body, ensure_ascii=False))

        # --- a host page embedding the editor -----------------------------------------------------
        await ctx.close()
        ctx = await b.new_context(locale='en-US', viewport={'width': 1280, 'height': 800})
        host = await ctx.new_page()
        host.on('pageerror', lambda e: errs.append(str(e)))
        await host.goto(BASE + '/api/health')
        await host.set_content(f'<iframe id="f" src="{BASE}/?lang=zh" style="width:1200px;height:700px;border:0"></iframe>'
                               '<script>window.got=[];addEventListener("message",e=>e.data&&String(e.data.type).startsWith("tingly-design:")&&got.push(e.data))</script>')
        frame = host.frame_locator('#f')
        await frame.locator('.lcard[data-project]').first.wait_for()
        ready = await host.evaluate('window.got.find(m => m.type === "tingly-design:ready")')
        check('a host frames the editor in its language with ?lang=, and ready says so', ready and ready.get('language') == 'zh', json.dumps(ready))
        await host.evaluate('document.getElementById("f").contentWindow.postMessage({ type: "tingly-design:set-language", language: "en-US" }, "*")')
        await expect(frame.locator('html')).to_have_attribute('lang', 'en')
        check('a host switches the language with postMessage', await frame.locator('button[aria-label="Appearance"]').count() == 1)
        told = await host.evaluate('window.got.filter(m => m.type === "tingly-design:language-changed").map(m => m.language)')
        check('the editor tells the host the language changed', told[-1:] == ['en'], str(told))

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
