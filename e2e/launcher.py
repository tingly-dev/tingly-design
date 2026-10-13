"""End-to-end checks for the launcher (the project picker). Run with `pnpm dev` up: python3 e2e/launcher.py"""
import os, asyncio, subprocess, json
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')
SAMPLES = {'box-console': 'design', 'tingly-intro': 'slides', 'tingly-ds': 'design-system', 'box-usage': 'dashboard', 'design-guide': 'docs', 'design-motion': 'motion'}
MADE = ['zz-launch', 'zz-launch-deck']

def cleanup():
    for n in MADE: subprocess.run(['rm', '-rf', os.path.join(REPO, 'projects', n)])

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

async def main():
    os.makedirs(OUT, exist_ok=True)
    cleanup()
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and errs.append(m.text))
        await pg.goto(BASE + '/')
        await pg.locator('.lcard[data-project]').first.wait_for()

        # --- every kind and every project ----------------------------------------------------
        tabs = await pg.locator('.ltabs [role=tab]').evaluate_all('ts => ts.map(t => t.dataset.tab)')
        check('a tab for all and for each of the six kinds', tabs == ['all', 'design', 'slides', 'design-system', 'dashboard', 'docs', 'motion'], str(tabs))
        listed = await pg.locator('.lcard[data-project]').evaluate_all('cs => Object.fromEntries(cs.map(c => [c.dataset.project, c.dataset.kind]))')
        check('every sample project is listed with its kind', all(listed.get(n) == k for n, k in SAMPLES.items()), json.dumps(listed))
        news = await pg.locator('.lstrip [data-new]').evaluate_all('cs => cs.map(c => c.dataset.new)')
        check('a new-project tile for each kind, and one to import', news == ['design', 'slides', 'design-system', 'dashboard', 'docs', 'motion', 'import'], str(news))
        await expect(pg.locator('.lcard[data-project="tingly-intro"] .lmeta')).to_contain_text('8 页')
        await expect(pg.locator('.lcard[data-project="box-console"] .lmeta')).to_contain_text('4 个画板')
        check('cards say how big each project is', True)

        # --- previews -----------------------------------------------------------------------
        cover = pg.frame_locator('.lcard[data-project="tingly-intro"] .lframe iframe')
        await expect(cover.locator('section#cover h1')).to_contain_text('Meet Tingly')
        check('the deck card renders its cover slide', True)
        board = pg.frame_locator('.lcard[data-project="box-console"] .lframe iframe')
        await expect(board.locator('h1').first).to_have_text('Team settings')
        check('the canvas card renders the board it opens on', True)
        check('the canvas card maps its boards', await pg.locator('.lcard[data-project="box-console"] .lp-mini rect').count() == 4)
        check('the design system card shows its swatches and components',
              await pg.locator('.lcard[data-project="tingly-ds"] .sw span').count() >= 6 and 'Button' in await pg.locator('.lcard[data-project="tingly-ds"] .chips').inner_text())
        await expect(pg.locator('.lcard[data-project="box-usage"] .lp-dash li').first).to_have_text('September provider budgets')
        await expect(pg.locator('.lcard[data-project="design-guide"] .lp-doc li').nth(2)).to_have_attribute('style', 'padding-left: 10px;')
        check('dashboard and doc cards show datasets and the tab outline', True)
        poster = pg.frame_locator('.lcard[data-project="design-motion"] .mframe iframe')
        await expect(poster.locator('section#poster')).to_be_visible()
        check('the motion card stands on its cover with its length and sizes',
              '1920×1080' in await pg.locator('.lcard[data-project="design-motion"] .lp-mmeta').inner_text())
        await pg.screenshot(path=OUT + 'launcher.png', full_page=True)

        # --- filter, search, keyboard -------------------------------------------------------
        await pg.locator('.ltabs [data-tab="slides"]').click()
        shown = await pg.locator('.lcard[data-project]').evaluate_all('cs => cs.map(c => c.dataset.project)')
        check('a kind tab shows only that kind, with a tile to make one', shown == ['tingly-intro'] and await pg.locator('.lgrid [data-new="slides"]').count() == 1, str(shown))
        await pg.locator('.ltabs [data-tab="all"]').click()
        await pg.keyboard.press('/')
        await expect(pg.locator('input[aria-label="搜索项目"]')).to_be_focused()
        await pg.keyboard.type('handbook')
        shown = await pg.locator('.lcard[data-project]').evaluate_all('cs => cs.map(c => c.dataset.project)')
        check('/ focuses search; search matches titles', shown == ['design-guide'], str(shown))
        await pg.keyboard.press('Escape')
        await pg.locator('input[aria-label="搜索项目"]').fill('nothing-like-this')
        await expect(pg.locator('.lhint')).to_contain_text('没有找到')
        check('a search with no match says so', True)
        await pg.locator('input[aria-label="搜索项目"]').fill('box-usage')
        await pg.keyboard.press('Enter')
        await pg.wait_for_url('**/?p=box-usage')
        await expect(pg.locator('.dashtitle')).to_have_text('Tingly Box usage · Q3 2026')
        check('Enter opens the first match', True)

        await pg.goto(BASE + '/')
        await pg.locator('.lcard[data-project]').first.wait_for()
        await expect(pg.locator('.lcontinue')).to_contain_text('Tingly Box usage')
        check('the last project opened is offered to continue', await pg.locator('.lcard[data-project="box-usage"] .recent').count() == 1)
        first = pg.locator('.lall .lcard[data-project]').first
        check('…and sorts first', await first.get_attribute('data-project') == 'box-usage')
        await first.focus()
        await pg.keyboard.press('ArrowRight')
        nxt = await pg.evaluate('document.activeElement.dataset.project')
        check('arrow keys move between cards', nxt and nxt != 'box-usage', str(nxt))
        await pg.locator('.lsort').select_option('name')
        names = await pg.locator('.lall .lcard[data-project] .ltitle .name').all_inner_texts()
        check('sorting by name', names == sorted(names, key=str.lower) or names == sorted(names), str(names))

        # --- new project dialog ---------------------------------------------------------------
        await pg.locator('.lnewbtn').click()
        dlg = pg.locator('[role=dialog]')
        check('the dialog offers all six kinds', await dlg.locator('[role=radio]').count() == 6)
        await expect(dlg.locator('input[aria-label="标题"]')).to_be_focused()
        await dlg.locator('input[aria-label="标题"]').fill('ZZ Launch')
        check('the folder follows the title', await dlg.locator('input[aria-label="新项目名称"]').input_value() == 'zz-launch')
        await dlg.locator('input[aria-label="新项目名称"]').fill('box-console')
        await expect(dlg.locator('.problem')).to_contain_text('已经存在')
        check('a taken folder is refused before creating', await dlg.locator('button[type=submit]').is_disabled())
        await dlg.locator('input[aria-label="新项目名称"]').fill('bad name!')
        await expect(dlg.locator('.problem')).to_contain_text('只能用字母')
        await pg.keyboard.press('Escape')
        await expect(dlg).to_have_count(0)
        check('Escape closes the dialog', True)

        await pg.locator('.lstrip [data-new="slides"]').click()
        check('a kind tile opens the dialog on that kind', await dlg.locator('[role=radio][aria-checked=true]').get_attribute('data-kind') == 'slides')
        await dlg.locator('input[aria-label="标题"]').fill('ZZ Launch deck')
        await dlg.locator('[role=radio][data-kind="design"]').click()
        await expect(dlg.locator('button[type=submit]')).to_have_text('创建画布')
        await dlg.locator('[role=radio][data-kind="slides"]').click()
        await dlg.locator('button[type=submit]').click()
        await pg.wait_for_url('**/?p=zz-launch-deck')
        deck = json.load(open(os.path.join(REPO, 'projects/zz-launch-deck/deck.json'), encoding='utf-8'))
        check('creating keeps the title and opens the new project', deck['title'] == 'ZZ Launch deck')
        await pg.goto(BASE + '/')
        await expect(pg.locator('.lcard[data-project="zz-launch-deck"] .ltitle .name')).to_have_text('ZZ Launch deck')
        check('the new project is listed', True)

        # --- narrow screens --------------------------------------------------------------------
        await pg.set_viewport_size({'width': 390, 'height': 800})
        await pg.wait_for_timeout(300)
        overflow = await pg.evaluate('document.querySelector(".launcher").scrollWidth - document.querySelector(".launcher").clientWidth')
        check('no sideways scroll at phone width', overflow <= 0, str(overflow))
        await pg.screenshot(path=OUT + 'launcher-narrow.png')

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    cleanup()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
