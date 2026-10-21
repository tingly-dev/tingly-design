"""Product PPTX exchange, through the real launcher, editor menu, API and CLI.
Run with pnpm dev up: python3 -I e2e/pptx.py. No model or Office is needed.
Only uniquely named projects created by this run are removed; samples are never edited.
Downloads, source fixtures and English/Chinese × light/dark screenshots stay in e2e/out/.
"""
import asyncio
import io
import json
import os
from pathlib import Path
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
import xml.etree.ElementTree as ET

from playwright.async_api import async_playwright, expect

REPO = Path(__file__).resolve().parents[1]
BASE = os.environ.get('DC_URL', 'http://localhost:5173').rstrip('/')
CLI_ROOT = Path(os.environ.get('DC_PPTX_CLI_ROOT', str(REPO))).resolve()
API_BASE = os.environ.get('DC_API', BASE).rstrip('/')
CHROME = os.environ.get('DC_CHROME')
PROJECTS = Path(os.environ.get('DC_PROJECTS', str(REPO / 'projects'))).resolve()
OUT = REPO / 'e2e' / 'out' / 'pptx'
FIXTURES = REPO / 'packages/core/test/fixtures/pptx-smoke'


def _macro():
    """A macro-enabled package: one of the few things that still refuse the whole file."""
    out = io.BytesIO()
    with zipfile.ZipFile(FIXTURES / 'cases/table.pptx') as src, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            dst.writestr(item, src.read(item))
        dst.writestr('ppt/vbaProject.bin', b'\x01')
    return out.getvalue()


MACRO = _macro()
PREFIX = 'e2e-pptx-' + uuid.uuid4().hex[:10]
OWNED = set()
ZIP_STEMS = {}
RESULTS = []
NS = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}


def check(name, ok, extra=''):
    RESULTS.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f' :: {extra}' if not ok else ''), flush=True)


def request(path, body=None, method=None, mime='application/json'):
    data = body if isinstance(body, bytes) else None if body is None else json.dumps(body).encode()
    req = urllib.request.Request((API_BASE if path == '/mcp' else BASE) + path, data=data, method=method, headers={'content-type': mime})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read()


def api(path, body=None, method=None, mime='application/json'):
    return json.loads(request(path, body, method, mime))


def files(name):
    return api(f'/api/projects/{name}/files')['files']


def raw(name, path):
    return request(f'/api/projects/{name}/raw/' + urllib.parse.quote(path, safe='/'))


def own(name):
    # A response cannot authorize deleting an unrelated folder.
    if not re.fullmatch(re.escape(PREFIX) + r'[A-Za-z0-9_-]*', name):
        raise AssertionError(f'Unexpected imported project name: {name}')
    OWNED.add(name)
    return name


def owned_names():
    return {p['name'] for p in api('/api/projects') if p['name'].startswith(PREFIX)}


def cleanup():
    for name in OWNED:
        path = PROJECTS / name
        if path.parent == PROJECTS and path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)


def put(name, path, content):
    current = files(name).get(path)
    return api(f'/api/projects/{name}/file?path=' + urllib.parse.quote(path, safe=''),
               {'content': content, 'baseVersion': current['version'] if current else None}, 'PUT')


def import_api(source, stem):
    response = api('/api/archive?file=' + urllib.parse.quote(stem + '.pptx'),
                   source, 'POST', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    own(response['name'])
    return response


async def until(predicate, timeout=12):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        await asyncio.sleep(.15)
    return False


def preserved(name, source):
    state = files(name)
    report_path = json.loads(state['deck.json']['content']).get('pptxImport')
    check('import: one durable conversion report linked from deck',
          isinstance(report_path, str) and report_path.startswith('uploads/') and report_path.endswith('/report.json'), report_path)
    report = json.loads(raw(name, report_path))
    check('import: original bytes preserved exactly under uploads',
          report['source'].startswith('uploads/') and raw(name, report['source']) == source)
    check('import: report retains source size, mapping and diagnostics',
          report['width'] > 0 and report['height'] > 0 and len(report['slides']) == 2
          and bool(report['diagnostics']))
    slides = [state[f"slides/{s['id']}.html"]['content'] for s in report['slides']]
    check('import: native text and both speaker notes preserved',
          '中文 &amp; &lt;copy&gt;' in slides[0] and 'Second native slide' in slides[1]
          and 'Original speaker notes 中文 page one.' in slides[0]
          and 'Original speaker notes page two.' in slides[1])
    sources = re.findall(r'<img[^>]+src="([^"]+)"', ''.join(slides))
    check('import: slide images reference uploads, not duplicate assets',
          bool(sources) and all(p.startswith('uploads/') for p in sources), sources)
    with zipfile.ZipFile(io.BytesIO(source)) as original:
        media = {original.read(p) for p in original.namelist() if p.startswith('ppt/media/')}
    check('import: actual image bytes preserved', bool(sources) and all(raw(name, p) in media for p in sources))
    return report


async def ready(pg, name):
    await pg.goto(f'{BASE}/?p={name}')
    await expect(pg.locator('.sframe.f-stage iframe')).to_have_count(1)
    await pg.frame_locator('.sframe.f-stage iframe').locator('section').wait_for()


async def report_open(pg):
    dialog = pg.get_by_role('dialog')
    await expect(dialog).to_be_visible(timeout=30000)
    body = dialog.locator('.pptx-import-body')
    await expect(body).to_be_visible()
    await pg.wait_for_timeout(100)
    check('import report: initial summary stays in view', await body.evaluate('e => e.scrollTop') == 0)
    return dialog


async def finish_import(pg):
    dialog = await report_open(pg)
    await dialog.get_by_role('button', name=re.compile(r'^(Open project|打开项目)$')).click()
    await pg.wait_for_url(re.compile(r'\?p=' + re.escape(PREFIX)), timeout=30000)
    return own(urllib.parse.parse_qs(urllib.parse.urlparse(pg.url).query)['p'][0])


async def picker(pg, path):
    await pg.goto(BASE + '/')
    await pg.locator('button[data-new-menu]').click()
    format = 'pptx' if path.suffix.lower() == '.pptx' else 'markdown' if path.suffix.lower() in ('.md', '.markdown') else 'archive'
    accepts = {
        'pptx': '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'markdown': '.md,.markdown,text/markdown',
        'archive': '.zip,application/zip',
    }
    async with pg.expect_file_chooser() as chooser:
        await pg.locator(f'[data-new="{format}"] [role="menuitem"]').click()
    selection = await chooser.value
    check(f'picker: {format} scopes accepted file types', await selection.element.get_attribute('accept') == accepts[format])
    async with pg.expect_response(lambda response: '/api/archive?' in response.url and response.request.method == 'POST') as imported:
        await selection.set_files(str(path))
    response = await imported.value
    if response.ok:
        # Match only this suite's unique input stem; a project ZIP keeps its inner name.
        stem = ZIP_STEMS.get(path.name, path.stem)
        for name in owned_names():
            if re.fullmatch(re.escape(stem) + r'(?:-\d+)?', name):
                own(name)


async def drop(pg, path):
    await pg.goto(BASE + '/')
    await pg.locator('button[data-new-menu]').wait_for()
    payload = {'name': path.name, 'bytes': list(path.read_bytes())}
    transfer = await pg.evaluate_handle('''p => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(p.bytes)], p.name,
        {type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'}));
      return transfer;
    }''', payload)
    surface = pg.locator('.launcher')
    await surface.dispatch_event('dragover', {'dataTransfer': transfer})
    await expect(surface).to_have_class(re.compile(r'\bdropping\b'))
    async with pg.expect_response(lambda response: '/api/archive?' in response.url and response.request.method == 'POST') as imported:
        await surface.dispatch_event('drop', {'dataTransfer': transfer})
    response = await imported.value
    if response.ok:
        # Match only this suite's unique input stem; a project ZIP keeps its inner name.
        stem = ZIP_STEMS.get(path.name, path.stem)
        for name in owned_names():
            if re.fullmatch(re.escape(stem) + r'(?:-\d+)?', name):
                own(name)
    await transfer.dispose()


async def edit_and_reopen(pg, name, report):
    await ready(pg, name)
    frame = pg.frame_locator('.sframe.f-stage iframe')
    text = frame.locator('p').filter(has_text='Uniform font and size').first
    await expect(text).to_be_visible()
    await pg.wait_for_timeout(500)  # stage runtime's selection listener follows its first render
    rect = await text.evaluate('''e => {
      const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode(); const range = document.createRange();
      range.setStart(node, 0); range.setEnd(node, Math.min(5, node.textContent.length));
      const r = range.getBoundingClientRect(); return [r.x,r.y,r.width,r.height];
    }''')
    stage = await pg.locator('.sframe.f-stage').bounding_box()
    scale = stage['width'] / 1920
    await pg.mouse.click(stage['x'] + (rect[0] + rect[2]/2)*scale,
                         stage['y'] + (rect[1] + rect[3]/2)*scale, click_count=2)
    await expect(frame.locator('[contenteditable="true"], [contenteditable="plaintext-only"]')).to_be_visible()
    await pg.keyboard.press('ControlOrMeta+a')
    await pg.keyboard.type('Edited PPTX product text')
    await pg.keyboard.press('Enter')
    slide = f"slides/{report['slides'][0]['id']}.html"
    check('import: double-click edit saves to ordinary slide source',
          await until(lambda: 'Edited PPTX product text' in files(name)[slide]['content']))
    await pg.reload()
    await expect(pg.frame_locator('.sframe.f-stage iframe').get_by_text('Edited PPTX product text', exact=True)).to_be_visible()
    check('import: saved text survives reopening', True)


async def native_deck():
    name = PREFIX + '-native'
    own(name)
    api('/api/projects', {'name': name, 'kind': 'slides', 'title': 'PPTX native product check'}, 'POST')
    # A real project image, installed through the same upload endpoint as attachments.
    with zipfile.ZipFile(FIXTURES / 'supported.pptx') as z:
        image = z.read(next(p for p in z.namelist() if p.startswith('ppt/media/') and p.endswith('.png')))
    upload = api(f'/api/projects/{name}/uploads?path=uploads/native-fixture/image.png', image, 'PUT', 'image/png')
    image_path = upload.get('path') or upload.get('attachment', {}).get('path')
    if not image_path:
        raise AssertionError(f'Upload endpoint did not return a path: {upload}')
    section = ('<section id="cover" style="background:#f8fafc;color:#17202a;font-family:Arial;display:flex;'
               'flex-direction:column;padding:100px;gap:50px">'
               '<h1 style="font-size:72px">Native product title</h1>'
               '<x-shape kind="rect" style="position:absolute;left:100px;top:300px;width:350px;height:180px;background:#336699"></x-shape>'
               f'<img src="{image_path}" alt="Product image" style="position:absolute;left:600px;top:300px;width:480px;height:320px;object-fit:contain">'
               '<p data-hide style="font-size:32px">HIDDEN ELEMENT SENTINEL</p>'
               '<div data-hide><img src="uploads/hidden-missing.png" alt="Hidden missing sentinel" style="width:100px;height:100px"></div>'
               '<aside>Native product speaker notes 中文</aside></section>')
    put(name, 'slides/cover.html', section)
    put(name, 'slides/second.html', '<section id="second" style="background:#f8fafc;color:#17202a;font-family:Arial;display:flex;padding:100px"><h2 style="font-size:64px">Second visible page</h2><aside>Second page notes</aside></section>')
    put(name, 'slides/hidden.html', '<section id="hidden" hidden style="background:#f8fafc;color:#17202a;font-family:Arial"><p style="font-size:32px">HIDDEN SLIDE SENTINEL</p><aside>Hidden notes sentinel</aside></section>')
    deck = json.loads(files(name)['deck.json']['content'])
    deck.update({'order': ['cover', 'hidden', 'second'], 'cover': 'cover', 'faces': {}})
    put(name, 'deck.json', json.dumps(deck))
    return name, section, image


def inspect_native(path, image):
    with zipfile.ZipFile(path) as z:
        slide_paths = sorted(p for p in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', p))
        roots = [ET.fromstring(z.read(p)) for p in slide_paths]
        texts = [''.join(root.itertext()) for root in roots]
        check('export: whole deck skips hidden slide and keeps order',
              len(roots) == 2 and 'Native product title' in texts[0] and 'Second visible page' in texts[1], texts)
        check('export: real native text and shape, not a slide screenshot',
              bool(roots[0].findall('.//p:sp/p:txBody//a:t', NS))
              and roots[0].find('.//a:prstGeom[@prst="rect"]', NS) is not None)
        check('export: real native picture with original media',
              roots[0].find('.//p:pic', NS) is not None
              and image in [z.read(p) for p in z.namelist() if p.startswith('ppt/media/')])
        notes = ''.join(z.read(p).decode() for p in z.namelist() if re.fullmatch(r'ppt/notesSlides/notesSlide\d+\.xml', p))
        check('export: speaker notes are native, never drawn on the slide',
              'Native product speaker notes 中文' in notes and 'Second page notes' in notes
              and not any('speaker notes' in text for text in texts))
        check('export: hidden content never leaks into PPTX',
              not any('SENTINEL' in text for text in texts) and 'Hidden notes sentinel' not in notes)
        check('export: presentation lists two native slides',
              len(ET.fromstring(z.read('ppt/presentation.xml')).findall('.//p:sldId', NS)) == 2)


async def menu(pg, label='Import / Export'):
    await pg.get_by_role('button', name=label, exact=True).first.click()
    result = pg.get_by_role('menu', name=label, exact=True)
    await expect(result).to_be_visible()
    return result


async def cli(*args):
    # Invoke this checkout's source command, not a globally installed or downloaded CLI.
    env = {**os.environ, 'DC_PROJECTS': str(PROJECTS), 'DC_LANG': 'en'}
    process = await asyncio.create_subprocess_exec('pnpm', 'exec', 'tsx', 'apps/server/src/cli.ts', *args,
                                                  cwd=CLI_ROOT, env=env, stdout=asyncio.subprocess.PIPE,
                                                  stderr=asyncio.subprocess.STDOUT)
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout=150)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise
    return process.returncode, output.decode(errors='replace')


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    source = (FIXTURES / 'supported.pptx').read_bytes()
    picker_file = OUT / (PREFIX + '-picker.pptx')
    picker_file.write_bytes(source)
    # API first: records the project immediately, so cleanup never guesses by directory diff.
    imported = import_api(source, PREFIX + '-api')
    report = preserved(imported['name'], source)
    check('API: explicitly identifies PPTX and report/source diagnostics',
          bool(imported.get('pptx')) and bool(imported['pptx'].get('report'))
          and bool(imported['pptx'].get('source')) and bool(imported['pptx'].get('diagnostics')), imported)
    twins = await asyncio.gather(*(asyncio.to_thread(import_api, source, PREFIX + '-collision') for _ in range(2)))
    check('API: concurrent same-name imports publish separate complete projects',
          twins[0]['name'] != twins[1]['name'] and all(len(json.loads(files(t['name'])['deck.json']['content'])['order']) == 2 for t in twins))
    prior = owned_names()
    try:
        import_api(MACRO, PREFIX + '-unsafe')
        check('API: macro package import fails', False)
    except urllib.error.HTTPError as error:
        body = json.loads(error.read())
        check('API: refused import returns actionable diagnostics',
              error.code == 400 and bool(body.get('error')) and bool(body.get('diagnostics'))
              and any(d.get('level') == 'error' and d.get('code') == 'forbidden_package' and d.get('part') for d in body['diagnostics']), body)
    check('API: refused import leaves no visible project', owned_names() == prior)
    check('API: refused import leaves no target folder', not (PROJECTS / (PREFIX + '-unsafe')).exists())
    best = import_api((FIXTURES / 'comprehensive.pptx').read_bytes(), PREFIX + '-best-effort')
    check('API: tables, lists, charts and effects import instead of refusing the file',
          len(json.loads(files(best['name'])['deck.json']['content'])['order']) == 9
          and any(d.get('code') == 'chart_redrawn' for d in best['pptx']['diagnostics']), best['pptx']['diagnostics'])
    name, original, image = await native_deck()
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await browser.new_context(locale='en-US', color_scheme='light', viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        pg = await ctx.new_page()
        errors = []
        pg.on('pageerror', lambda error: errors.append(str(error)))
        await picker(pg, picker_file)
        picker_name = await finish_import(pg)
        preserved(picker_name, source)
        await edit_and_reopen(pg, imported['name'], report)
        drop_file = OUT / (PREFIX + '-drop.pptx')
        drop_file.write_bytes(source)
        await drop(pg, drop_file)
        dropped = await finish_import(pg)
        preserved(dropped, source)
        check('launcher: picker and drop both create ordinary editable decks', True)
        notes_file = OUT / (PREFIX + '-notes.pptx')
        notes_file.write_bytes((FIXTURES / 'comprehensive.pptx').read_bytes())
        await picker(pg, notes_file)
        notes = await report_open(pg)
        chart_note = notes.locator('.pptx-import-notes li').filter(has_text='A chart was redrawn')
        await expect(chart_note).to_have_count(1)
        await expect(chart_note.locator('strong')).to_have_text('Slide 4: object 3')
        check('import report: one line per kind of note, naming its slides', await notes.locator('.pptx-import-notes li').filter(has_text='Text wrapping').count() == 1)
        await notes.locator('footer').get_by_role('button', name='Open project', exact=True).click()
        await pg.wait_for_url(re.compile(r'\?p=' + re.escape(PREFIX)), timeout=30000)
        own(urllib.parse.parse_qs(urllib.parse.urlparse(pg.url).query)['p'][0])
        bad_file = OUT / (PREFIX + '-bad-picker.pptx')
        bad_file.write_bytes(MACRO)
        before_bad = owned_names()
        await picker(pg, bad_file)
        refusal = await report_open(pg)
        await expect(refusal.get_by_text('PowerPoint could not be imported', exact=True)).to_be_visible()
        check('launcher: refused PPTX stays on launcher with visible failure and no new project',
              'p=' not in pg.url and owned_names() == before_bad)
        await refusal.locator('footer').get_by_role('button', name='Close', exact=True).click()
        # Each direct import action still uses shared detection, without a mode choice.
        archive_file = OUT / (PREFIX + '-ordinary.zip')
        archive_file.write_bytes(request(f'/api/projects/{name}/archive?journal=0&systems=0'))
        ZIP_STEMS[archive_file.name] = name
        await picker(pg, archive_file)
        await pg.wait_for_url(re.compile(r'\?p=' + re.escape(name) + r'-\d+'), timeout=30000)
        archive_name = own(urllib.parse.parse_qs(urllib.parse.urlparse(pg.url).query)['p'][0])
        check('picker regression: ordinary project ZIP still opens', 'deck.json' in files(archive_name))
        markdown_file = OUT / (PREFIX + '-markdown.md')
        markdown_file.write_text('# Markdown exchange check\n\nGeneralized picker keeps documents editable.\n')
        await picker(pg, markdown_file)
        await pg.wait_for_url(re.compile(r'\?p=' + re.escape(PREFIX + '-markdown')), timeout=30000)
        markdown_name = own(urllib.parse.parse_qs(urllib.parse.urlparse(pg.url).query)['p'][0])
        check('picker regression: Markdown still opens as docs', 'doc.json' in files(markdown_name))
        claude_file = OUT / (PREFIX + '-claude.zip')
        claude_name = PREFIX + '-claude'
        with zipfile.ZipFile(claude_file, 'w') as archive:
            archive.writestr('project/deck.json', json.dumps({'v': 4, 'title': claude_name, 'cover': 'cover', 'order': ['cover'], 'sections': {}, 'faces': {}, 'designSystems': []}))
            archive.writestr('project/slides/cover.html', '<section id="cover" style="background:#f8fafc;color:#17202a;font-family:Arial;padding:100px"><h1 style="font-size:72px">Claude package picker check</h1></section>')
        await picker(pg, claude_file)
        await pg.wait_for_url(re.compile(r'\?p=' + re.escape(claude_name)), timeout=30000)
        own(urllib.parse.parse_qs(urllib.parse.urlparse(pg.url).query)['p'][0])
        check('picker regression: original Claude package still opens', 'deck.json' in files(claude_name))
        await ready(pg, name)
        await menu(pg)
        hidden_fetches = []
        async def hidden_image(route):
            hidden_fetches.append(route.request.url)
            await route.abort()
        await pg.route('**/raw/uploads/hidden-missing.png*', hidden_image)
        async with pg.expect_download(timeout=60000) as download_event:
            await pg.get_by_role('menuitem', name='PowerPoint (.pptx)', exact=True).click()
        check('menu: hidden missing images are never fetched by export', not hidden_fetches)
        await pg.unroute('**/raw/uploads/hidden-missing.png*', hidden_image)
        download = await download_event.value
        saved = OUT / (PREFIX + '-menu.pptx')
        await download.save_as(saved)
        check('menu: hands over a .pptx artifact', download.suggested_filename.endswith('.pptx'))
        inspect_native(saved, image)
        await expect(pg.locator('iframe[data-pptx-capture]')).to_have_count(0)
        check('menu: successful export releases its capture iframe', True)
        # Gate a real local asset request rather than relying on a lucky cancel race.
        await ready(pg, name)
        asset_started = asyncio.Event()
        release_asset = asyncio.Event()
        asset_finished = asyncio.Event()
        async def delayed_image(route):
            asset_started.set()
            await release_asset.wait()
            try:
                await route.continue_()
            finally:
                asset_finished.set()
        asset_pattern = f'**/api/projects/{name}/raw/uploads/native-fixture/image.png*'
        await pg.route(asset_pattern, delayed_image)
        cancelled_downloads = []
        pg.on('download', lambda artifact: cancelled_downloads.append(artifact))
        await menu(pg)
        await pg.get_by_role('menuitem', name='PowerPoint (.pptx)', exact=True).click()
        await asyncio.wait_for(asset_started.wait(), timeout=15)
        await pg.get_by_role('dialog').get_by_role('button', name='Cancel export', exact=True).click()
        release_asset.set()
        await asyncio.wait_for(asset_finished.wait(), timeout=10)
        await pg.unroute(asset_pattern, delayed_image)
        await expect(pg.locator('iframe[data-pptx-capture]')).to_have_count(0)
        await pg.wait_for_timeout(500)
        check('menu: cancel stops artifact delivery and releases capture resources', not cancelled_downloads)
        # What PowerPoint has no object for becomes a picture of that element only; the rest stays native.
        put(name, 'slides/cover.html', original.replace('background:#f8fafc', 'background:linear-gradient(90deg,#336699,#669933)', 1))
        await ready(pg, name)
        await menu(pg)
        async with pg.expect_download(timeout=90000) as download_event:
            await pg.get_by_role('menuitem', name='PowerPoint (.pptx)', exact=True).click()
        download = await download_event.value
        drawn = OUT / (PREFIX + '-picture-fallback.pptx')
        await download.save_as(drawn)
        result = pg.get_by_test_id('pptx-export')
        await expect(result.get_by_text(re.compile('placed as pictures'))).to_be_visible(timeout=30000)
        await pg.screenshot(path=str(OUT / 'export-pictures-en-light.png'))
        with zipfile.ZipFile(drawn) as z:
            first = ET.fromstring(z.read('ppt/slides/slide1.xml'))
            text = ''.join(first.itertext())
            pics = first.findall('.//p:pic', NS)
        check('menu: a gradient background becomes one picture while the title stays native text',
              len(pics) == 2 and 'Native product title' in text and first.find('.//a:prstGeom[@prst="rect"]', NS) is not None, (len(pics), text))
        await pg.get_by_role('dialog').locator('footer').get_by_role('button', name='Close', exact=True).click()
        # A visible picture that cannot be read is a real failure: visible, located, and no partial file.
        put(name, 'slides/cover.html', original.replace('</section>', '<img src="uploads/visible-missing.png" style="width:100px;height:100px"></section>', 1))
        await ready(pg, name)
        downloads = []
        pg.on('download', lambda download: downloads.append(download))
        await menu(pg)
        await pg.get_by_role('menuitem', name='PowerPoint (.pptx)', exact=True).click()
        failure = pg.get_by_test_id('pptx-export').get_by_role('alert')
        await expect(failure).to_be_visible(timeout=60000)
        check('menu: an unreadable picture explains the failure',
              'resource' in (await failure.inner_text()).lower() or 'picture' in (await failure.inner_text()).lower(), await failure.inner_text())
        await pg.screenshot(path=str(OUT / 'export-refused-en-light.png'))
        await pg.wait_for_timeout(500)
        check('menu: failed deck produces no partial download', not downloads)
        await expect(pg.locator('iframe[data-pptx-capture]')).to_have_count(0)
        check('menu: failed export releases its capture iframe', True)
        put(name, 'slides/cover.html', original)
        # Owned non-slide projects prove the item is scoped, without touching samples.
        for kind in ('design', 'design-system', 'dashboard', 'docs', 'motion'):
            other = own(PREFIX + '-' + kind)
            api('/api/projects', {'name': other, 'kind': kind}, 'POST')
            await pg.goto(f'{BASE}/?p={other}')
            file_menu = await menu(pg)
            check(f'{kind}: no PPTX export item', await file_menu.get_by_role('menuitem', name=re.compile('PowerPoint')).count() == 0)
            await pg.keyboard.press('Escape')
        # Four independent browser preferences ensure both translations and themes are real.
        for lang, locale in (('en', 'en-US'), ('zh', 'zh-CN')):
            for theme in ('light', 'dark'):
                shot_ctx = await browser.new_context(locale=locale, color_scheme=theme, viewport={'width': 1440, 'height': 900})
                shot = await shot_ctx.new_page()
                await ready(shot, name)
                file_menu = await menu(shot, 'Import / Export' if lang == 'en' else '导入 / 导出')
                await expect(file_menu.get_by_role('menuitem', name='PowerPoint (.pptx)' if lang == 'en' else 'PowerPoint（.pptx）', exact=True)).to_be_visible()
                await shot.wait_for_timeout(500)
                await shot.screenshot(path=str(OUT / f'menu-{lang}-{theme}.png'), animations='disabled')
                await shot.goto(BASE + '/')
                await shot.locator('button[data-new-menu]').click()
                labels = (['Import PowerPoint (.pptx)…', 'Import Markdown (.md)…', 'Import a project package (.zip)…']
                          if lang == 'en' else ['导入 PowerPoint（.pptx）…', '导入 Markdown（.md）…', '导入项目包（.zip）…'])
                for label in labels:
                    await expect(shot.get_by_role('menuitem', name=label, exact=True)).to_be_visible()
                check(f'launcher: {lang}/{theme} shows three direct import actions', True)
                await shot.screenshot(path=str(OUT / f'launcher-imports-{lang}-{theme}.png'), animations='disabled')
                localized_file = OUT / (PREFIX + f'-{lang}-{theme}.pptx')
                localized_file.write_bytes(source)
                await picker(shot, localized_file)
                await report_open(shot)
                await shot.wait_for_timeout(500)
                await shot.screenshot(path=str(OUT / f'import-report-{lang}-{theme}.png'), animations='disabled')
                own(await finish_import(shot))
                await shot_ctx.close()
        check('browser: no uncaught page errors', not errors, errors)
        await browser.close()
    # The source CLI uses the shared headless menu job; never substitute a direct writer call.
    cli_source = OUT / (PREFIX + '-cli.pptx')
    cli_source.write_bytes(source)
    code, output = await cli('import', str(cli_source), '--json')
    (OUT / 'cli-import.log').write_text(output)
    imported_cli = own(PREFIX + '-cli')
    check('CLI: source command imports PPTX as a new project', code == 0 and imported_cli in owned_names(), output)
    cli_dir = OUT / (PREFIX + '-cli-export')
    code, output = await cli('export', name, '--as', 'pptx', '--out', str(cli_dir))
    (OUT / 'cli-export.log').write_text(output)
    cli_artifacts = list(cli_dir.glob('*.pptx')) if cli_dir.is_dir() else []
    check('CLI: shared browser export writes PPTX', code == 0 and len(cli_artifacts) == 1, output)
    if cli_artifacts:
        inspect_native(cli_artifacts[0], image)
    cli_error = OUT / (PREFIX + '-single-slide-must-not-exist.pptx')
    code, output = await cli('export', name, '--as', 'pptx', '--slide', 'cover', '--out', str(cli_error))
    check('CLI: whole-deck PPTX rejects a single-slide selector', code != 0 and not cli_error.exists(), output)
    rpc = await asyncio.to_thread(api, '/mcp', {
        'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
        'params': {'name': 'export', 'arguments': {'project': name, 'as': 'pptx'}}}, 'POST')
    (OUT / 'mcp-export.json').write_text(json.dumps(rpc, ensure_ascii=False, indent=2))
    result = rpc.get('result', {})
    payload = json.loads(result['content'][0]['text']) if result.get('content') else {}
    mcp_files = payload.get('files', [])
    check('MCP: export tool traverses shared browser job and returns PPTX',
          not result.get('isError') and len(mcp_files) == 1 and mcp_files[0].endswith('.pptx'), rpc)
    if mcp_files:
        mcp_path = Path(mcp_files[0]).resolve()
        if mcp_path.is_relative_to(PROJECTS / name):
            artifact = OUT / (PREFIX + '-mcp-export.pptx')
            shutil.copyfile(mcp_path, artifact)
            inspect_native(artifact, image)
        else:
            check('MCP: artifact belongs to the exact owned project', False, mcp_path)
    failed = [label for label, ok in RESULTS if not ok]
    print(f'\n{len(RESULTS) - len(failed)}/{len(RESULTS)} passed')
    if failed:
        raise SystemExit(1)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    finally:
        cleanup()
