"""End-to-end checks for the one Import / Export menu: every kind has it in its bar (and no scattered import
or export buttons beside it), it lists what the kind takes and what it can save, a PDF is made in one click
from a deck and a doc (a real PDF with a page per slide), a machine with no Chrome falls back to the print
window, and the status chip is on the bars that have one. Needs the dev server's machine to have Chrome.
Run with `pnpm dev` up: python3 e2e/export_menu.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, re, asyncio, zipfile
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
CHROME = os.environ.get('DC_CHROME')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def markdown_of(path):
    # a doc with local pictures saves as a .zip holding the .md and the pictures (.design/docs-markdown.md)
    if path.endswith('.zip'):
        with zipfile.ZipFile(path) as z:
            return z.read(next(n for n in z.namelist() if n.endswith('.md'))).decode('utf-8')
    return open(path, encoding='utf-8').read()

def pages(path):
    return len(re.findall(rb'/Type\s*/Page[^s]', open(path, 'rb').read()))

# kind → (project, the exports it offers, by the name a person reads)
KINDS = {
    'canvas': ('tingly-box-console-canvas', ['PDF', 'PNG image', 'PNG image @2x', 'Copy as PNG', 'PNG images', 'Source file']),
    'slides': ('tingly-design-intro-slides', ['PDF', 'PNG image', 'Copy as PNG', 'PNG images', 'HTML page', 'Markdown', 'Speaker notes']),
    'design system': ('tingly-design-system', ['PNG image', 'Copy as PNG']),
    'dashboard': ('tingly-box-usage-dashboard', ['PNG image', 'Copy as PNG']),
    'docs': ('tingly-design-guide-doc', ['PDF', 'Markdown', 'Markdown (this tab)', 'HTML page', 'PNG image', 'Copy as PNG']),
    'motion': ('tingly-design-motion', ['Video…', 'GIF…', 'PNG image', 'Copy as PNG']),
}

async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='en-US', viewport={'width': 1600, 'height': 900}, accept_downloads=True)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))

        for kind, (project, wants) in KINDS.items():
            await pg.goto(f'{BASE}/?p={project}')
            await pg.wait_for_timeout(3500)
            if kind == 'canvas':
                await pg.mouse.click(400, 300)  # an artboard element, so the selected-artboard items show
            btns = pg.locator('button[aria-label="Import / Export"]')
            check(f'{kind}: one Import / Export button', await btns.count() == 1, await btns.count())
            await btns.first.click()
            menu = pg.get_by_role('menu', name='Import / Export')
            await expect(menu).to_be_visible()
            names = [re.sub(r'\s+', ' ', (await i.inner_text()).split('\n')[0]) for i in await menu.get_by_role('menuitem').all()]
            check(f'{kind}: the menu lists import and export', any(n.startswith('Import ') for n in names) and all(w in names for w in wants), names)
            check(f'{kind}: …under Import and Export headings', await menu.locator('.head', has_text='Import').count() == 1 and await menu.locator('.head', has_text='Export').count() == 1)
            await pg.screenshot(path=OUT + f'menu-{kind.replace(" ", "-")}.png')
            await pg.keyboard.press('Escape')
            if kind in ('canvas', 'slides', 'design system'):
                chip = pg.locator('.syncchip')
                check(f'{kind}: a status chip with the change history behind it', await chip.count() == 1 and await chip.get_attribute('data-state') == 'ok')

        # --- one-click PDF ---------------------------------------------------------------------------
        for project, label, want in (('tingly-design-intro-slides', 'slides', 8), ('tingly-design-guide-doc', 'docs', 2), ('tingly-box-console-canvas', 'canvas', 5)):
            await pg.goto(f'{BASE}/?p={project}')
            await pg.wait_for_timeout(3500)
            await pg.locator('button[aria-label="Import / Export"]').first.click()
            async with pg.expect_download(timeout=60000) as dl:
                await pg.get_by_role('menuitem', name=re.compile('^PDF')).click()
            d = await dl.value
            path = OUT + d.suggested_filename
            await d.save_as(path)
            head = open(path, 'rb').read(5)
            check(f'{label}: PDF saves straight away', head == b'%PDF-' and d.suggested_filename.endswith('.pdf'), d.suggested_filename)
            check(f'{label}: …with {"a page per slide" if label == "slides" else "a page per artboard" if label == "canvas" else "its content"}', pages(path) >= want, pages(path))
            if label == 'canvas':
                # a page per artboard, each as large as its artboard rather than one paper size
                boxes = {tuple(float(x) for x in m.split()[2:]) for m in (b.decode() for b in re.findall(rb'/MediaBox\s*\[([^\]]+)\]', open(path, 'rb').read()))}
                check('canvas: …each page the size of its artboard', len(boxes) >= 1 and (595.0, 842.0) not in boxes, sorted(boxes))

        # --- Markdown: the deck as a document ---------------------------------------------------------
        await pg.goto(f'{BASE}/?p=tingly-design-intro-slides')
        await pg.wait_for_timeout(3500)
        await pg.locator('button[aria-label="Import / Export"]').first.click()
        async with pg.expect_download(timeout=30000) as dl:
            await pg.get_by_role('menuitem', name=re.compile('^Markdown')).click()
        d = await dl.value
        path = OUT + d.suggested_filename
        await d.save_as(path)
        md = open(path, encoding='utf-8').read()
        check('slides: Markdown saves as a .md file', d.suggested_filename.endswith('.md'), d.suggested_filename)
        check('slides: …headed by the deck title, with the slide titles below it', md.startswith('# ') and md.count('\n### ') >= 3, md[:200])
        check('slides: …with a table written as a table and the notes as quotes', '| --- |' in md and '\n> **' in md)
        check('slides: …and no slide markup', '<section' not in md and 'style=' not in md)

        # --- Markdown: the doc as one document ------------------------------------------------------
        await pg.goto(f'{BASE}/?p=tingly-design-guide-doc')
        await pg.wait_for_timeout(3500)
        await pg.locator('button[aria-label="Import / Export"]').first.click()
        async with pg.expect_download(timeout=30000) as dl:
            await pg.get_by_role('menuitem', name=re.compile('^Markdown$')).click()
        d = await dl.value
        path = OUT + d.suggested_filename
        await d.save_as(path)
        md = markdown_of(path)
        check('docs: the whole doc saves as Markdown (a .zip when it has pictures)', d.suggested_filename.endswith(('.md', '.zip')), d.suggested_filename)
        check('docs: …headed by the doc title, with each tab a section under it', md.startswith('# Tingly Design Handbook Doc\n') and md.count('\n## ') >= 3 and '\n---\n' not in md, md[:200])
        outside = re.sub(r'```.*?```', '', md, flags=re.S)
        check('docs: …and no tab keeps a second top-level heading', len(re.findall(r'^# ', outside, flags=re.M)) == 1)

        # --- web fonts travel inside the page, so a server with no network still prints them --------------
        face = "@font-face{font-family:'Source Serif 4';src:url(data:font/woff2;base64,AAEAAA==) format('woff2')}"
        await pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(body=face, content_type='text/css', headers={'access-control-allow-origin': '*'}))
        await pg.goto(f'{BASE}/?p=tingly-design-guide-doc')
        await pg.wait_for_timeout(3500)
        await pg.get_by_role('button', name='Layout').first.click()
        await pg.locator('.popmenu.settings').get_by_role('button', name='Serif', exact=True).first.click()
        await pg.wait_for_timeout(1500)
        await pg.keyboard.press('Escape')
        await pg.mouse.move(800, 600)
        await pg.wait_for_timeout(500)
        await pg.locator('button[aria-label="Import / Export"]').first.click()
        async with pg.expect_request('**/api/pdf') as req:
            await pg.get_by_role('menuitem', name=re.compile('^PDF')).click()
        body = (await req.value).post_data or ''
        check('docs: the serif face is inlined into the page sent to the server', '@font-face' in body and 'Source Serif 4' in body, ('googleapis' in body, 'serif' in body.lower(), len(body)))
        check('docs: …and the hosted stylesheet link is gone', 'fonts.googleapis.com/css2' not in body)
        await pg.unroute('https://fonts.googleapis.com/**')

        # --- no Chrome on the server: the print window ------------------------------------------------
        await pg.route('**/api/render', lambda r: r.fulfill(json={'chrome': False, 'ffmpeg': False}))
        await pg.goto(f'{BASE}/?p=tingly-design-intro-slides')
        await pg.wait_for_timeout(3500)
        await pg.locator('button[aria-label="Import / Export"]').first.click()
        check('without Chrome the PDF item says it opens the print dialog', await pg.get_by_role('menuitem', name=re.compile('^PDF')).locator('.mh', has_text='print dialog').count() == 1)
        async with ctx.expect_page() as popup:
            await pg.get_by_role('menuitem', name=re.compile('^PDF')).click()
        w = await popup.value
        await w.wait_for_load_state()
        check('…and opens the deck laid out for printing', await w.locator('.dc-slide-host').count() == 8)

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
