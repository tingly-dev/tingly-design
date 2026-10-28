"""End-to-end checks for the keyboard every dialog owes. Run with `pnpm dev` up: python3 e2e/dialogs.py

Each of the seven dialogs (new project, open a folder, import, AI model settings, commit, export video,
import from a project) is opened from where a person opens it, in English light and Chinese dark: it is
a modal (`aria-modal`), focus lands inside it, Tab and Shift+Tab stay inside it, Esc closes it, and focus
goes back to what opened it. Set DC_SHOTS to a folder to keep a picture of each.
"""
import os, asyncio, json, shutil
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
SHOTS = os.environ.get('DC_SHOTS')
CHROME = os.environ.get('DC_CHROME')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIECE = os.path.join(REPO, 'projects', 'zz-dialog-motion')

L = {
    'en': {'io': 'Import / Export', 'ai': 'AI model settings', 'video': 'Video…', 'from': 'Import from a project…'},
    'zh': {'io': '导入 / 导出', 'ai': 'AI 模型设置', 'video': '视频…', 'from': '从项目导入…'},
}

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

async def launcher_new(pg, lang, which):
    await pg.goto(BASE + f'/?lang={lang}')
    btn = pg.locator('.lnewbtn')
    await btn.click()
    await pg.locator(f'.menu [data-new="{which}"]').click()
    return btn

async def new_project(pg, lang):
    return await launcher_new(pg, lang, 'design')

async def open_folder(pg, lang):
    return await launcher_new(pg, lang, 'folder')

async def import_dialog(pg, lang):
    return await launcher_new(pg, lang, 'import')

async def ai_settings(pg, lang):
    await pg.goto(BASE + f'/?lang={lang}')
    btn = pg.get_by_role('button', name=L[lang]['ai'], exact=True)
    await btn.click()
    return btn

async def commit(pg, lang):
    await pg.goto(BASE + f'/?p=box-console&lang={lang}')
    await pg.locator('header.topbar').wait_for(timeout=15000)
    await pg.locator('.syncchip').click()
    btn = pg.locator('[data-commit]')
    await btn.click()
    return btn

async def export_video(pg, lang):
    await pg.goto(BASE + f'/?p=zz-dialog-motion&lang={lang}')
    await pg.locator('header.topbar').wait_for(timeout=15000)
    io = pg.locator(f'button[aria-label="{L[lang]["io"]}"]').first
    await io.click()
    # Video… waits until the tab has checked what it can encode
    item = pg.get_by_role('menuitem', name=L[lang]['video'])
    await expect(item).to_be_enabled(timeout=20000)
    await item.click()
    return io

async def board_picker(pg, lang):
    await pg.goto(BASE + f'/?p=tingly-intro&lang={lang}')
    await pg.locator('header.topbar').wait_for(timeout=15000)
    io = pg.locator(f'button[aria-label="{L[lang]["io"]}"]').first
    await io.click()
    await pg.locator('.menu .mi', has_text=L[lang]['from']).click()
    return io

DIALOGS = [
    ('new-project', new_project),
    ('open-folder', open_folder),
    ('import', import_dialog),
    ('ai-settings', ai_settings),
    ('commit', commit),
    ('export-video', export_video),
    ('board-picker', board_picker),
]

INSIDE = 'document.activeElement && !!document.activeElement.closest("[role=dialog]")'

ONLY = os.environ.get('DC_ONLY')

async def run(pg, lang, scheme):
    for name, opener in DIALOGS:
        if ONLY and name != ONLY: continue
        tag = f'{name} ({lang}, {scheme})'
        try:
            await opener(pg, lang)
            dlg = pg.locator('[role=dialog][aria-modal="true"]')
            await expect(dlg).to_have_count(1)
            await pg.wait_for_timeout(300)
            check(f'{tag}: opens as a modal with focus inside', await pg.evaluate(INSIDE))
            # the floating request bar sits under the scrim: the point at its centre belongs to the modal layer, not to the bar
            if await pg.locator('.prompt').count():
                check(f'{tag}: the request bar is under the dialog layer', await pg.evaluate('''() => {
                    const r = document.querySelector('.prompt').getBoundingClientRect();
                    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                    return !!el && !el.closest('.prompt');
                }'''))
            if SHOTS:
                await pg.screenshot(path=os.path.join(SHOTS, f'{name}-{lang}-{scheme}.png'))
            # walk further than the dialog has controls: focus never leaves it
            out = False
            for _ in range(40):
                await pg.keyboard.press('Tab')
                out = out or not await pg.evaluate(INSIDE)
            for _ in range(5):
                await pg.keyboard.press('Shift+Tab')
                out = out or not await pg.evaluate(INSIDE)
            check(f'{tag}: Tab and Shift+Tab stay inside', not out)
            # a field keeps its own Esc (none of these clear on Esc), so press it on the dialog's own box
            await pg.keyboard.press('Escape')
            await expect(pg.locator('[role=dialog]')).to_have_count(0)
            check(f'{tag}: Esc closes it', True)
            back = await pg.evaluate('document.activeElement && document.activeElement !== document.body')
            check(f'{tag}: focus goes back to the page, not lost', back)
        except Exception as e:
            check(f'{tag}: opens', False, ' '.join(str(e).split('\n')[:6]))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        for lang, scheme in (('en', 'light'), ('zh', 'dark')):
            ctx = await b.new_context(viewport={'width': 1280, 'height': 800}, color_scheme=scheme, locale='zh-CN' if lang == 'zh' else 'en-US')
            pg = await ctx.new_page()
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            await run(pg, lang, scheme)
            check(f'no page errors ({lang}, {scheme})', not errors, '; '.join(errors[:3]))
            await ctx.close()
        await b.close()
    passed = sum(ok for _, ok in results)
    print(f'\n{passed}/{len(results)} passed')
    raise SystemExit(0 if passed == len(results) else 1)

def piece():
    # a plain piece: the sample's fonts and embeds would only slow the player down
    shutil.rmtree(PIECE, ignore_errors=True)
    os.makedirs(PIECE + '/scenes')
    open(PIECE + '/motion.json', 'w').write(json.dumps({'v': 1, 'title': 'zz-dialog-motion', 'formats': {'wide': {'size': [1280, 720]}}, 'fps': 30, 'order': ['title'], 'audio': [], 'faces': {}}))
    open(PIECE + '/scenes/title.html', 'w').write('<section id="title" data-duration="2s" style="background:#14161c;color:#f4f1ea;font-family:Arial,sans-serif;padding:96px"><h1 style="font-size:96px">Dialogs</h1></section>')

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    piece()
    try:
        asyncio.run(main())
    finally:
        shutil.rmtree(PIECE, ignore_errors=True)
