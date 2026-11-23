"""PPTX export that is editable in PowerPoint and Keynote (.design/slides-pptx-editable.md), read back from the file.

Copies e2e/fixtures/pptx-edit (a seven-slide deck: a cover with a three-line title, a paragraph with bold and
coloured runs, a `data-text` box of paragraphs and a list, two lists (one numbered from 3), a picture with alt
text, a table, a bar chart of boxes and a code block, a dark slide of cards and a pinned footer, four sections
and speaker notes) to projects/zz-pptx-edit, exports it from the editor's Import / Export menu and reads the
package's XML: one text box per text block with wrapping on, real bullets and numbers, the slide title in a title
placeholder, PowerPoint sections, a theme of the deck's own colours and typefaces, alt text and notes.

Also saves, in e2e/out/pptx_edit/: the .pptx, a picture of every slide as the editor draws it (`source-<id>.png`)
and metrics.json, the numbers `scripts/pptx-fidelity/readback.py` turns into box overlays. Run with `pnpm dev`
up: python3 e2e/pptx_edit.py (or `pnpm e2e pptx_edit`). No Office is needed."""
import asyncio, json, os, re, shutil, urllib.parse, urllib.request, zipfile
import xml.etree.ElementTree as ET
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, 'e2e', 'out', 'pptx_edit')
CHROME = os.environ.get('DC_CHROME')
NAME = 'zz-pptx-edit'
FIXTURE = os.path.join(REPO, 'e2e', 'fixtures', 'pptx-edit')
NS = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'p14': 'http://schemas.microsoft.com/office/powerpoint/2010/main'}
MARKER = re.compile(r'^\s*([•◦▪]|\d+\.|[a-z]+\.|[ivxlc]+\.)\s*$', re.I)

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''), flush=True)


def text_shapes(root):
    """Every shape with text: its name, text, paragraphs and how it wraps."""
    out = []
    for sp in root.iter(f'{{{NS["p"]}}}sp'):
        body = sp.find('p:txBody', NS)
        if body is None: continue
        paras = body.findall('a:p', NS)
        text = '\n'.join(''.join(t.text or '' for t in p.iter(f'{{{NS["a"]}}}t')) for p in paras)
        if not text.strip(): continue
        pr = body.find('a:bodyPr', NS)
        ph = sp.find('p:nvSpPr/p:nvPr/p:ph', NS)
        nv = sp.find('p:nvSpPr/p:cNvSpPr', NS)
        out.append({
            'name': sp.find('p:nvSpPr/p:cNvPr', NS).get('name'), 'text': text,
            'wrap': pr.get('wrap', 'square') if pr is not None else 'square',
            'placeholder': ph.get('type', 'body') if ph is not None else None,
            'txBox': nv is not None and nv.get('txBox') == '1',
            'paragraphs': [{'text': ''.join(t.text or '' for t in p.iter(f'{{{NS["a"]}}}t')),
                            'bullet': 'char' if p.find('a:pPr/a:buChar', NS) is not None else 'number' if p.find('a:pPr/a:buAutoNum', NS) is not None else None,
                            'startAt': (p.find('a:pPr/a:buAutoNum', NS).get('startAt') if p.find('a:pPr/a:buAutoNum', NS) is not None else None),
                            'bold': [r.find('a:rPr', NS).get('b') == '1' for r in p.findall('a:r', NS) if r.find('a:rPr', NS) is not None]}
                           for p in paras],
        })
    return out


def read_package(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        slides = sorted((p for p in names if re.fullmatch(r'ppt/slides/slide\d+\.xml', p)), key=lambda p: int(re.findall(r'\d+', p)[0]))
        out = {'slides': []}
        for p in slides:
            root = ET.fromstring(z.read(p))
            pics = [{'descr': pic.find('p:nvPicPr/p:cNvPr', NS).get('descr', '')} for pic in root.iter(f'{{{NS["p"]}}}pic')]
            tables = len(list(root.iter(f'{{{NS["a"]}}}tbl')))
            n = re.findall(r'\d+', p)[0]
            notes_path = next((f'ppt/notesSlides/{t}' for t in [f'notesSlide{n}.xml'] if f'ppt/notesSlides/{t}' in names), None)
            notes = ''
            if notes_path:
                nroot = ET.fromstring(z.read(notes_path))
                notes = ' '.join(''.join(t.text or '' for t in sp.iter(f'{{{NS["a"]}}}t')) for sp in nroot.iter(f'{{{NS["p"]}}}sp') if sp.find('p:nvSpPr/p:nvPr/p:ph[@type="body"]', NS) is not None)
            out['slides'].append({'text': text_shapes(root), 'pictures': pics, 'tables': tables, 'notes': notes.strip()})
        pres = ET.fromstring(z.read('ppt/presentation.xml'))
        out['sections'] = [{'name': s.get('name'), 'slides': len(s.findall('p14:sldIdLst/p14:sldId', NS))} for s in pres.iter(f'{{{NS["p14"]}}}section')]
        theme = ET.fromstring(z.read('ppt/theme/theme1.xml'))
        scheme = theme.find('.//a:clrScheme', NS)
        out['theme'] = {
            'colors': {c.tag.split('}')[1]: (c.find('a:srgbClr', NS).get('val') if c.find('a:srgbClr', NS) is not None else c.find('a:sysClr', NS).get('lastClr')) for c in scheme},
            'major': theme.find('.//a:majorFont/a:latin', NS).get('typeface'), 'minor': theme.find('.//a:minorFont/a:latin', NS).get('typeface'),
        }
    return out


def shapes_with(slide, needle):
    return [s for s in slide['text'] if needle in s['text']]


def inspect(pkg):
    s = pkg['slides']
    check('package: seven slides in deck order', len(s) == 7, len(s))
    if len(s) != 7: return
    every = [t for sl in s for t in sl['text']]
    lonely = [t['text'] for t in every if MARKER.match(t['text'])]
    check('lists: no bullet or number drawn as a text box of its own', not lonely, lonely)
    unwrapped = [t['text'][:30] for t in every if t['wrap'] == 'none' and 'deploy:' not in t['text']]
    check('text: every text box wraps (only the pre-formatted code keeps its lines)', not unwrapped, unwrapped)
    cover, rich, lists, picture, table, chart, cards = s
    title = 'Quarterly review of the platform team and what comes next'
    found = shapes_with(cover, 'Quarterly')
    check('cover: the three-line h1 is one text box', len(found) == 1 and found[0]['text'].replace('\n', ' ').strip() == title, [t['text'] for t in found])
    check('cover: the title sits in the title placeholder', any(t['placeholder'] in ('title', 'ctrTitle') and 'Quarterly' in t['text'] for t in cover['text']), [(t['placeholder'], t['text'][:20]) for t in cover['text']])
    check('cover: speaker notes are native notes', 'hand over to Ana' in cover['notes'], cover['notes'])
    para = shapes_with(rich, 'one deploy path')
    check('rich: a paragraph with bold and coloured runs is one text box', len(para) == 1 and 'retired the last two' in para[0]['text'], [t['text'][:40] for t in para])
    check('rich: the bold words stay a bold run inside it', bool(para) and any(any(p['bold']) and not all(p['bold']) for p in para[0]['paragraphs']))
    box = shapes_with(rich, 'one scheduler')
    check('rich: a data-text box of paragraphs and a list is one text box', len(box) == 1 and 'data jobs' in box[0]['text'] and 'end of January' in box[0]['text'], [t['text'][:30] for t in box])
    check('rich: its list items carry real bullets, its paragraphs none',
          bool(box) and [p['bullet'] for p in box[0]['paragraphs'] if p['text']] == [None, 'char', 'char', None], box and box[0]['paragraphs'])
    check('rich: title placeholder holds the h2', any(t['placeholder'] == 'title' and 'What changed' in t['text'] for t in rich['text']))
    ul = shapes_with(lists, 'Feature flags')
    check('lists: an unordered list is one text box of bulleted paragraphs',
          len(ul) == 1 and [p['bullet'] for p in ul[0]['paragraphs']] == ['char'] * 3, ul and ul[0]['paragraphs'])
    ol = shapes_with(lists, 'Cost report')
    check('lists: an ordered list numbers itself from its start',
          len(ol) == 1 and [p['bullet'] for p in ol[0]['paragraphs']] == ['number'] * 3 and ol[0]['paragraphs'][0]['startAt'] == '3', ol and ol[0]['paragraphs'])
    check('lists: only the first heading is the title', sum(1 for t in lists['text'] if t['placeholder']) == 1)
    check('picture: alt text reaches the picture', any(p['descr'] == 'The new build dashboard on the office screen' for p in picture['pictures']), picture['pictures'])
    check('table: a native table', table['tables'] == 1)
    code = shapes_with(chart, 'deploy:')
    check('chart: the code block is one text box keeping its lines', len(code) == 1 and code[0]['text'].count('\n') >= 3, [t['text'] for t in code])
    check('cards: each card text is one box', len(shapes_with(cards, 'faster builds')) == 1 and len(shapes_with(cards, '4×')) == 1)
    others = [t for t in every if not t['placeholder']]
    check('text: plain text boxes are marked as text boxes (txBox)', others and all(t['txBox'] for t in others))
    check('text: objects are named for what they are, not "Text 0"', not any(re.fullmatch(r'Text \d+', t['name'] or '') for t in every))
    check('sections: deck.json sections become PowerPoint sections',
          [(x['name'], x['slides']) for x in pkg['sections']] == [('Opening', 1), ('Text and lists', 2), ('Pictures, tables and charts', 3), ('Closing', 1)], pkg['sections'])
    th = pkg['theme']
    check('theme: typefaces are the deck\'s, not Office\'s', th['major'] == 'Arial' and th['minor'] == 'Arial', th)
    check('theme: colours are the deck\'s', {'10233F', 'C2410C'} <= set(v.upper() for v in th['colors'].values()), th['colors'])


async def main():
    os.makedirs(OUT, exist_ok=True)
    dest = os.path.join(REPO, 'projects', NAME)
    shutil.rmtree(dest, ignore_errors=True)
    shutil.copytree(FIXTURE, dest)
    imported = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            ctx = await browser.new_context(locale='en-US', color_scheme='light', viewport={'width': 1600, 'height': 1000}, accept_downloads=True)
            pg = await ctx.new_page()
            order = json.load(open(os.path.join(FIXTURE, 'deck.json')))['order']
            for sid in order:
                await pg.goto(f'{BASE}/?p={NAME}&s={sid}')
                frame = pg.frame_locator('.sframe.f-stage iframe')
                await frame.locator(f'section#{sid}').wait_for()
                await pg.wait_for_timeout(400)
                await frame.locator(f'section#{sid}').screenshot(path=os.path.join(OUT, f'source-{sid}.png'))
            await pg.get_by_role('button', name='Import / Export', exact=True).first.click()
            logs = []
            pg.on('console', lambda m: logs.append(m.text))
            pg.on('pageerror', lambda e: logs.append(str(e)))
            try:
                async with pg.expect_download(timeout=120000) as event:
                    await pg.get_by_role('menuitem', name='PowerPoint (.pptx)', exact=True).click()
            except Exception:
                dialog = pg.locator('[data-testid=pptx-export]')
                check('menu: export finishes', False, (await dialog.inner_text() if await dialog.count() else 'no dialog') + ' | ' + ' | '.join(logs[-10:]))
                raise
            download = await event.value
            saved = os.path.join(OUT, 'export.pptx')
            await download.save_as(saved)
            check('menu: hands over a .pptx', download.suggested_filename.endswith('.pptx'))
            pkg = read_package(saved)
            json.dump({'order': order, **pkg}, open(os.path.join(OUT, 'metrics.json'), 'w'), ensure_ascii=False, indent=1)
            inspect(pkg)
            # back the other way: the importer reads what the export wrote (sections, titles, lists), and the
            # editor's picture of the imported deck is how a reader that wraps the text sees it
            req = urllib.request.Request(f'{BASE}/api/archive?file=' + urllib.parse.quote(NAME + '-back.pptx'), data=open(saved, 'rb').read(), method='POST',
                                         headers={'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'})
            back = json.loads(urllib.request.urlopen(req, timeout=120).read())['name']
            imported.append(back)
            check('import: the export comes back as a deck', back.startswith(NAME))
            files = json.loads(urllib.request.urlopen(f'{BASE}/api/projects/{back}/files', timeout=30).read())['files']
            deck = json.loads(files['deck.json']['content'])
            sources = [files[f'slides/{sid}.html']['content'] for sid in deck['order']]
            check('import: sections come back', [x['description'] for x in deck['sections'].values()] == ['Opening', 'Text and lists', 'Pictures, tables and charts', 'Closing'], deck['sections'])
            check('import: every slide title comes back as its heading', all(re.search(r'<h[12] ', src) for src in sources), [bool(re.search(r'<h[12] ', src)) for src in sources])
            check('import: lists come back as lists', '<ol start="3"' in sources[2] and sources[2].count('<li') == 6 and '<ul' in sources[1], sources[2][:300])
            check('import: the table comes back as a table', '<table' in sources[4])
            for n, sid in enumerate(deck['order'], 1):
                await pg.goto(f'{BASE}/?p={back}&s={sid}')
                frame = pg.frame_locator('.sframe.f-stage iframe')
                await frame.locator(f'section#{sid}').wait_for()
                await pg.wait_for_timeout(400)
                await frame.locator(f'section#{sid}').screenshot(path=os.path.join(OUT, f'reimport-{n}.png'))
            await browser.close()
    finally:
        shutil.rmtree(dest, ignore_errors=True)
        for name in imported:
            if re.fullmatch(re.escape(NAME) + r'[A-Za-z0-9_-]*', name): shutil.rmtree(os.path.join(REPO, 'projects', name), ignore_errors=True)
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    raise SystemExit(1 if failed else 0)

if __name__ == '__main__':
    asyncio.run(main())
