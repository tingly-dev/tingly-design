"""End-to-end checks for linked pages: a page of another project put into the open one as a picture, with a
record of where it came from (.design/cross-kind-embedding.md). A canvas artboard comes into a doc through the
slash menu, a dashboard onto a slide, a doc tab onto the canvas and a slide onto a scene through the Import / Export
menu; each copy is a PNG under uploads/linked/<id>/ drawn by the server's Chrome the way the original's Export menu
draws it, recorded in the index, shown in the right panel (or the doc's picture form) with where it came from and
whether the original changed; changing the original is noticed on reopening, Update copies it again and its toast
takes it back, Unlink keeps the copy; a deleted original leaves the copy alone and says so; a dashboard takes no page.
Run after `pnpm build`: python3 e2e/linked_page.py  (DC_CHROME=/path/to/chrome to use another Chromium)
Starts its own server (production mode, PORT=0) on a fresh copy of the sample projects. The server draws the pictures
with Chrome, whose socket path must stay under ~108 characters: keep TMPDIR short (a very deep TMPDIR crashes it)."""
import os, sys, asyncio, json, shutil, subprocess, tempfile, threading, time, urllib.request
from playwright.async_api import async_playwright, expect

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out') + '/'
CHROME = os.environ.get('DC_CHROME')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

async def wait_for(pred, timeout=10.0):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if pred(): return True
        except Exception: pass
        await asyncio.sleep(0.15)
    return False

async def toast(pg, text, timeout=45000):
    try:
        await expect(pg.locator('.toast', has_text=text).first).to_be_visible(timeout=timeout)
        return True
    except AssertionError:
        return False

def api(base, method, path, body=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}

async def open_picker(pg, how):
    if how == 'slash':
        # a new empty paragraph after the first one: the slash menu opens on a line that holds only the slash.
        # The click goes right of the paragraph's last line, so the cursor is at its end whatever the fonts wrap
        # (End only reaches the end of the line clicked; the middle of the paragraph may be its commented words)
        first = pg.locator('.ProseMirror > p').first
        box = await first.bounding_box()
        await first.click(position={'x': box['width'] - 2, 'y': box['height'] - 4})
        await pg.keyboard.press('End')
        await pg.keyboard.press('Enter')
        await pg.keyboard.type('/linked')
        await pg.locator('.slashmenu button', has_text='A page from another project').click()
    else:
        await pg.locator('button[aria-label="Import / Export"]').first.click()
        await pg.locator('.menu .mi', has_text='A page from another project').click()
    await expect(pg.locator('.bpick')).to_be_visible()

async def pick(pg, project, page):
    item = pg.locator(f'.bpick-item[data-project="{project}"][data-pick="{page}"]')
    await expect(item).to_be_visible()
    await item.click()

async def main():
    if not os.path.exists(os.path.join(REPO, 'apps/editor/dist/index.html')):
        raise SystemExit('no editor build: run pnpm build first')
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='dc-linked-')
    projects = os.path.join(tmp, 'projects')
    shutil.copytree(os.path.join(REPO, 'projects'), projects)
    P = lambda *a: os.path.join(projects, *a)
    read = lambda *a: open(P(*a)).read()
    index = lambda p, f: json.loads(read(p, f))
    imports = lambda p, f: index(p, f).get('imports', [])

    server = subprocess.Popen(
        [os.path.join(REPO, 'apps/server/node_modules/.bin/tsx'), 'src/index.ts'], cwd=os.path.join(REPO, 'apps/server'),
        env={**os.environ, 'NODE_ENV': 'production', 'PORT': '0', 'DC_PROJECTS': projects, 'DC_EXIT_WITH_STDIN': '1'},
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    port = None; t = time.time()
    while time.time() - t < 30:
        line = server.stdout.readline()
        if line.startswith('TINGLY_DESIGN_READY '):
            port = json.loads(line.split(' ', 1)[1])['port']; break
        if not line and server.poll() is not None: break
    if not port: raise SystemExit('the server did not start')
    threading.Thread(target=lambda: [None for _ in server.stdout], daemon=True).start()
    base = f'http://127.0.0.1:{port}'
    DOC, CANVAS, SLIDES, DASH, WDOC, MOTION = 'tingly-design-guide-doc', 'tingly-box-console-canvas', 'tingly-design-intro-slides', 'tingly-box-usage-dashboard', 'tingly-design-wechat-doc', 'tingly-design-motion'
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            pg = await b.new_page(locale='en-US', viewport={'width': 1440, 'height': 900})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))

            # --- doc: a canvas artboard through the slash menu ------------------------------------------
            await pg.goto(base + f'/?p={DOC}')
            await pg.wait_for_timeout(2000)
            await open_picker(pg, 'slash')
            await expect(pg.locator(f'.bpick-item[data-project="{CANVAS}"]').first).to_be_visible(timeout=15000)
            await expect(pg.locator(f'.bpick-item[data-project="{MOTION}"]').first).to_be_visible(timeout=15000)
            groups = await pg.locator('.bpick-group h3').all_inner_texts()
            check('picker: lists the other projects, none of them the open one', await pg.locator(f'.bpick-item[data-project="{DOC}"]').count() == 0 and await pg.locator(f'.bpick-item[data-project="{CANVAS}"]').count() > 0, groups)
            check('picker: a doc can take pages of a canvas, a deck, a dashboard, a doc and a motion piece', all([await pg.locator(f'.bpick-item[data-project="{x}"]').count() > 0 for x in (CANVAS, SLIDES, DASH, WDOC, MOTION)]))
            check('picker: a design system has no page to link', await pg.locator('.bpick-item[data-project="tingly-design-system"]').count() == 0)
            await pg.locator('.bpick-search').fill('usage')
            await expect(pg.locator('.bpick-item[data-project="%s"]' % DASH)).to_be_visible()
            check('picker: the search narrows the list to what matches', await pg.locator(f'.bpick-item[data-project="{SLIDES}"]').count() == 0)
            await pg.locator('.bpick-search').fill('')
            await pg.screenshot(path=OUT + 'linked-picker.png')
            await pick(pg, CANVAS, 'Usage.dc.html')
            check('doc: linking says so', await toast(pg, 'Linked Usage dashboard from Tingly Box Console Canvas'))
            recs = lambda: imports(DOC, 'doc.json')
            check('doc: doc.json records where the picture came from', await wait_for(lambda: len(recs()) == 1), recs())
            r = recs()[0]
            check('…the page, its kind and how it is shown', r['kind'] == 'design' and r['page'] == 'Usage.dc.html' and r['mode'] == 'image' and r['from'] == f'projects/{CANVAS}', r)
            check('…and a hash of the original', str(r.get('at', '')).startswith('sha1:'), r)
            png = P(DOC, r['path'])
            check('doc: the copy is a PNG under uploads/linked/', r['path'].startswith('uploads/linked/') and os.path.exists(png) and open(png, 'rb').read(8) == b'\x89PNG\r\n\x1a\n', r['path'])
            tab = lambda: ''.join(open(os.path.join(projects, DOC, 'tabs', f)).read() for f in os.listdir(os.path.join(projects, DOC, 'tabs')))
            check('doc: the tab holds a plain Markdown image of it', await wait_for(lambda: f'](../{r["path"]}' in tab()), tab()[-300:])
            img = pg.locator(f'.docfig img[data-src="../{r["path"]}"]')
            await expect(img).to_be_visible()
            check('doc: the picture is drawn in the page', await img.evaluate('(i) => i.complete && i.naturalWidth > 100'))
            await img.click()
            form = pg.locator('.docimgform .linkedp')
            await expect(form).to_be_visible()
            await expect(form.locator('.linkedp-words')).to_contain_text('Up to date')
            check('doc: the picture form says where it came from and that it is current', await form.locator('.linkedp-v', has_text='Usage dashboard').count() == 1 and await form.get_attribute('data-state') == 'current')
            await pg.screenshot(path=OUT + 'linked-doc.png')

            # --- the original changes: noticed on reopening, updated from the form, taken back ---------
            usage = P(CANVAS, 'Usage.dc.html')
            text = open(usage).read()
            open(usage, 'w').write(text.replace('Usage dashboard', 'Usage dashboard v2'))
            before = open(png, 'rb').read()
            await pg.goto(base + f'/?p={DOC}')
            await pg.wait_for_timeout(2500)
            await pg.locator(f'.docfig img[data-src="../{r["path"]}"]').click()
            await expect(pg.locator('.docimgform .linkedp .linkedp-words')).to_contain_text('The original changed', timeout=15000)
            check('doc: a changed original is noticed when the project opens', True)
            await pg.locator('button[aria-label="Switch project"], .pmenu button[aria-haspopup="menu"]').first.click()
            check('project menu: offers to update the linked pages that changed', await pg.locator('.menu .mi', has_text='Update 1 linked page').count() == 1)
            await pg.keyboard.press('Escape')
            await pg.screenshot(path=OUT + 'linked-changed.png')
            await pg.locator('.docimgform .linkedp button', has_text='Update').first.click()
            check('doc: updating says so', await toast(pg, 'Updated Usage dashboard'))
            await toast(pg, 'Undo')
            after = open(png, 'rb').read()
            check('doc: the copy is a new picture', after != before and after[:8] == b'\x89PNG\r\n\x1a\n')
            check('doc: the record keeps the new hash', recs()[0]['at'] != r['at'])
            await pg.locator('.toast button', has_text='Undo').first.click()
            check('doc: Undo puts the old picture back', await wait_for(lambda: open(png, 'rb').read() == before))
            check('…and the old record', await wait_for(lambda: recs()[0]['at'] == r['at']))

            # --- unlink: the record goes, the picture stays; Undo brings the link back ------------------
            await pg.goto(base + f'/?p={DOC}')
            await pg.wait_for_timeout(2000)
            await pg.locator(f'.docfig img[data-src="../{r["path"]}"]').click()
            await pg.locator('.docimgform .linkedp button', has_text='Unlink').click()
            check('doc: unlinking says the copy stays', await toast(pg, 'Unlinked'))
            check('…the record is gone, the picture is not', await wait_for(lambda: recs() == []) and os.path.exists(png) and f'](../{r["path"]}' in tab())
            await pg.locator('.toast button', has_text='Undo').first.click()
            check('doc: Undo links it again', await wait_for(lambda: len(recs()) == 1))
            open(usage, 'w').write(text)

            # --- slides: a dashboard live on the open slide, frozen, with its picture kept beside it -----
            await pg.goto(base + f'/?p={SLIDES}')
            await pg.wait_for_timeout(2000)
            slide_id = index(SLIDES, 'deck.json')['order'][0]
            slide = lambda: read(SLIDES, 'slides', f'{slide_id}.html')
            await open_picker(pg, 'menu')
            await pick(pg, DASH, 'index')
            check('slides: linking says so', await toast(pg, 'Linked Tingly Box Usage Dashboard from'))
            srecs = lambda: imports(SLIDES, 'deck.json')
            sr = [x for x in srecs() if x['kind'] == 'dashboard']
            check('slides: deck.json records the dashboard as a live copy with a picture beside it', len(sr) == 1 and sr[0]['mode'] == 'live' and sr[0]['page'] == 'index' and sr[0]['path'].endswith('.dash.json') and str(sr[0].get('poster', '')).startswith('uploads/linked/'), srecs())
            bundle = json.loads(read(SLIDES, sr[0]['path'])) if sr else {}
            check('slides: the copy is the dashboard frozen into one file: its page and its data', bundle.get('v') == 1 and 'index.html' in bundle.get('files', {}) and len(bundle.get('datasets', {})) > 0 and bundle.get('frozenAt'), list(bundle))
            check('slides: the slide holds a live element for it, named for its picture', await wait_for(lambda: sr and f'<x-embed src="{sr[0]["path"]}"' in slide() and f'data-poster="{sr[0]["poster"]}"' in slide() and 'position:absolute' in slide()), slide()[-500:])
            check('slides: the picture beside it is drawn in the background', await wait_for(lambda: os.path.exists(P(SLIDES, sr[0]['poster'])) and open(P(SLIDES, sr[0]['poster']), 'rb').read(8) == b'\x89PNG\r\n\x1a\n', 60), sr[0].get('poster'))
            await pg.wait_for_timeout(1500)
            ran = None
            for f in pg.frames:
                try:
                    if await f.locator('#dash-root').count(): ran = f
                except Exception: pass
            check('slides: the dashboard runs in its frame on the slide', ran is not None and len((await ran.locator('#dash-root').inner_text()).strip()) > 20 if ran else False)
            panel = pg.locator('.linkedp')
            await expect(panel).to_be_visible()
            check('slides: selecting it shows where it came from', await panel.locator('.linkedp-v', has_text='Tingly Box Usage Dashboard').count() >= 1)
            check('slides: and when its data was frozen', await panel.locator('.linkedp-data').count() == 1)
            await pg.screenshot(path=OUT + 'linked-slides.png')
            await panel.locator('.seg button', has_text='Picture').click()
            await pg.wait_for_timeout(1200)
            await pg.screenshot(path=OUT + 'linked-slides-picture.png')
            check('slides: Show as Picture swaps in the kept picture in the same place', await wait_for(lambda: f'<img src="{sr[0]["poster"]}"' in slide() and f'<x-embed src="{sr[0]["path"]}"' not in slide() and 'position:absolute' in slide()), slide()[-500:])
            check('…without touching the record or the copy', srecs() == sr or [ {k: v for k, v in x.items() if k != 'copiedAt'} for x in srecs()] == [{k: v for k, v in x.items() if k != 'copiedAt'} for x in sr])
            await expect(pg.locator('.linkedp .seg button[aria-pressed="true"]', has_text='Picture')).to_be_visible()
            await panel.locator('.seg button', has_text='Live').click()
            check('slides: Show as Live puts the running dashboard back', await wait_for(lambda: f'<x-embed src="{sr[0]["path"]}"' in slide() and f'<img src="{sr[0]["poster"]}"' not in slide()), slide()[-500:])

            # --- the dashboard changes: noticed, frozen again with its picture, taken back ---------------
            page_file = P(DASH, 'files', 'index.html')
            page_text = open(page_file).read()
            open(page_file, 'w').write(page_text + '\n<div style="height:80px;background:#c33;color:#fff">v2</div>\n')
            before_bundle, before_poster = read(SLIDES, sr[0]['path']), open(P(SLIDES, sr[0]['poster']), 'rb').read()
            await pg.goto(base + f'/?p={SLIDES}')
            await pg.wait_for_timeout(2500)
            emb = pg.frame_locator('.sframe.f-stage iframe').locator('x-embed').first
            await expect(emb).to_be_visible(timeout=15000)
            await pg.wait_for_timeout(800)
            await emb.click(position={'x': 30, 'y': 30})
            await expect(pg.locator('.linkedp .linkedp-words')).to_contain_text('The original changed', timeout=20000)
            check('slides: a changed dashboard is noticed when the project opens', True)
            await pg.locator('.linkedp button', has_text='Update').first.click()
            check('slides: updating says so', await toast(pg, 'Updated'))
            check('slides: the dashboard is frozen again', '>v2</div>' in read(SLIDES, sr[0]['path']), 'v2 not in the bundle')
            check('…and its picture is drawn again', open(P(SLIDES, sr[0]['poster']), 'rb').read() != before_poster)
            await pg.locator('.toast button', has_text='Undo').first.click()
            check('slides: Undo puts the earlier freeze and its picture back', await wait_for(lambda: read(SLIDES, sr[0]['path']) == before_bundle and open(P(SLIDES, sr[0]['poster']), 'rb').read() == before_poster))
            open(page_file, 'w').write(page_text)

            # --- canvas: a doc tab as an image on the canvas ---------------------------------------------
            await pg.goto(base + f'/?p={CANVAS}')
            await pg.wait_for_timeout(2500)
            await open_picker(pg, 'menu')
            await pick(pg, WDOC, 'how-to')
            check('canvas: linking says so', await toast(pg, 'onto the canvas'))
            crecs = lambda: [x for x in imports(CANVAS, 'canvas.json') if x['kind'] == 'docs']
            check('canvas: canvas.json records the tab', await wait_for(lambda: len(crecs()) == 1), imports(CANVAS, 'canvas.json'))
            notes = lambda: [n for n in index(CANVAS, 'canvas.json')['notes'].values() if n.get('kind') == 'image']
            check('canvas: an image item holds its copy', await wait_for(lambda: crecs() and any(n.get('src') == crecs()[0]['path'] for n in notes())), notes())
            panel = pg.locator('.linkedp')
            await expect(panel).to_be_visible()
            try:
                await expect(panel.locator('.linkedp-v')).to_contain_text('How to use', timeout=15000)
                said = True
            except AssertionError:
                said = False
            check('canvas: the item says where it came from', said)
            await pg.screenshot(path=OUT + 'linked-canvas.png')

            # --- motion: a slide as a picture on the scene under the playhead ---------------------------
            await pg.goto(base + f'/?p={MOTION}')
            await pg.wait_for_timeout(2000)
            await pg.locator('.mscene', has_text='kind-slides').click()
            await pg.wait_for_timeout(500)
            await open_picker(pg, 'menu')
            await pick(pg, SLIDES, 'cover')
            check('motion: linking says so', await toast(pg, 'onto scene kind-slides'))
            scene = lambda: read(MOTION, 'scenes', 'kind-slides.html')
            mr = lambda: [x for x in imports(MOTION, 'motion.json') if x['kind'] == 'slides']
            check('motion: the scene holds a picture of it, entering at the playhead', await wait_for(lambda: mr() and f'<img src="{mr()[0]["path"]}"' in scene() and 'data-in=' in scene()), scene()[-300:])

            # --- the original is deleted: the copy stays and the panel says so ----------------------------
            check('a project can be deleted', api(base, 'DELETE', f'/api/projects/{SLIDES}')[0] == 200)
            code, body = api(base, 'POST', f'/api/projects/{MOTION}/link-check', {})
            states = {l['path']: l['state'] for l in body.get('links', [])}
            check('motion: a deleted original is reported as such, the copy stays', states.get(mr()[0]['path']) == 'deleted' and os.path.exists(P(MOTION, mr()[0]['path'])), states)
            check('a canvas is deleted too', api(base, 'DELETE', f'/api/projects/{CANVAS}')[0] == 200)
            await pg.goto(base + f'/?p={DOC}')
            await pg.wait_for_timeout(2500)
            await pg.locator(f'.docfig img[data-src="../{r["path"]}"]').click()
            await expect(pg.locator('.docimgform .linkedp .linkedp-words')).to_contain_text('in the trash', timeout=15000)
            check('doc: a deleted original is said to be in the trash, the copy stays', os.path.exists(png))
            await pg.screenshot(path=OUT + 'linked-deleted.png')

            # --- what takes no page, and what is refused -------------------------------------------------
            await pg.goto(base + f'/?p={DASH}')
            await pg.wait_for_timeout(2000)
            await pg.locator('button[aria-label="Import / Export"]').first.click()
            check('dashboard: its Import / Export menu offers no page from another project', await pg.locator('.menu .mi', has_text='A page from another project').count() == 0)
            await pg.keyboard.press('Escape')
            code, body = api(base, 'POST', f'/api/projects/{DASH}/link-page', {'from': WDOC, 'page': 'how-to'})
            check('server: a dashboard refuses a page', code == 400 and body.get('code') == 'linkNotTaken', (code, body))
            code, body = api(base, 'POST', f'/api/projects/{DOC}/link-page', {'from': DOC, 'page': 'x'})
            check('server: a project cannot link itself', code == 400 and body.get('code') == 'linkSelf', (code, body))
            code, body = api(base, 'POST', f'/api/projects/{DOC}/link-page', {'from': WDOC, 'page': 'Nope'})
            check('server: a page that is not there is refused', code == 404 and body.get('code') == 'linkNoPage', (code, body))

            check('no page errors', not errs, errs)
            await b.close()
    finally:
        server.stdin.close()
        server.wait(timeout=10)
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)

asyncio.run(main())
