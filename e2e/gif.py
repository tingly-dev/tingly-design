"""End-to-end checks for animated GIFs as pictures (.design/gif-images.md): in a motion piece a GIF is a clip on the
timeline (the frame at a time is the frame of that time, scrubbing forward and back, the file's own loop count or
data-gif="once|loop", the file and the scene's src untouched, a frame saved as PNG), in a deck it is an ordinary
picture (inserted, replaced from the picker, a still in a PNG export), and in a doc it is placed by the slash menu's
picker, import, paste and drop, and travels in the Markdown .zip and the Word file. Uses e2e/fixtures/blink.gif:
160×90, red, green, blue, 500 ms each, looping. Run with `pnpm dev` up: python3 e2e/gif.py"""
import os, re, io, asyncio, json, shutil, zipfile, base64
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
CHROME = os.environ.get('DC_CHROME')
GIF = open(os.path.join(REPO, 'e2e', 'fixtures', 'blink.gif'), 'rb').read()
MOTION, DECK, DOC = 'zz-gif-motion', 'zz-gif-deck', 'zz-gif-doc'
RED, GREEN, BLUE = (255, 0, 0), (0, 255, 0), (0, 0, 255)

def path(*p): return os.path.join(REPO, 'projects', *p)

def write(rel, data):
    os.makedirs(os.path.dirname(path(rel)), exist_ok=True)
    with open(path(rel), 'wb' if isinstance(data, bytes) else 'w', **({} if isinstance(data, bytes) else {'encoding': 'utf-8'})) as f: f.write(data)

def read(rel): return open(path(rel), encoding='utf-8').read()

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

async def wait_for(pred, timeout=6.0):
    for _ in range(int(timeout / 0.1)):
        try:
            if pred(): return True
        except Exception: pass
        await asyncio.sleep(0.1)
    return False

# what the picture drawn in `img` looks like at its middle, as r,g,b
SHADE = """async (img) => {
  if (!img.complete) await new Promise(r => img.addEventListener('load', r, {once: true}));
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  return Array.from(g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data.slice(0, 3));
}"""

async def shade(img):
    return tuple(await img.evaluate(SHADE))

async def wait_shade(img, want, timeout=4.0):
    got = None
    for _ in range(int(timeout / 0.1)):
        try:
            got = await shade(img)
            if got == want: return True, got
        except Exception: pass
        await asyncio.sleep(0.1)
    return False, got

async def png_shade(helper, data, x, y):
    """The pixel of PNG bytes at x, y, read in a page of its own."""
    return tuple(await helper.evaluate("""async ([b64, x, y]) => {
      const b = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const c = document.createElement('canvas'); c.width = b.width; c.height = b.height;
      const g = c.getContext('2d'); g.drawImage(b, 0, 0);
      return Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
    }""", [base64.b64encode(data).decode(), x, y]))


def big_gif(w, h):
    """A valid GIF of w×h pixels whose pixel data is stored, not compressed (a clear code every 250 codes), so it is larger than a model attachment may be."""
    out = bytearray(b'GIF89a' + w.to_bytes(2, 'little') + h.to_bytes(2, 'little') + bytes([0xF7, 0, 0]))
    out += bytes(v for i in range(256) for v in (i, 255 - i, 128))
    out += b',' + bytes(4) + w.to_bytes(2, 'little') + h.to_bytes(2, 'little') + b'\x00\x08'
    data = bytearray()
    total, chunk = w * h, 250
    for start in range(0, total, chunk):
        codes = [256] + [(start + i) * 7 % 256 for i in range(min(chunk, total - start))]
        bits = 0
        for i, c in enumerate(codes): bits |= c << (9 * i)
        data += bits.to_bytes((9 * len(codes) + 7) // 8, 'little')
    data += (257).to_bytes(2, 'little')
    for i in range(0, len(data), 255):
        part = data[i:i + 255]
        out += bytes([len(part)]) + part
    return bytes(out) + b'\x00;'

SCENE = ('<section id="s1" data-duration="4s" style="background:#ffffff;color:#16181d">'
         '<img id="g" src="uploads/blink.gif" alt="Blink" {extra}data-in="fade 300ms @1s" style="position:absolute;left:100px;top:100px;width:320px;height:180px">'
         '<h1 style="position:absolute;left:100px;top:360px;margin:0;font-size:48px">Blink</h1></section>\n')
MOTION_JSON = {'v': 1, 'title': 'GIF motion', 'formats': {'wide': {'size': [1280, 720]}}, 'fps': 30, 'order': ['s1'], 'audio': [], 'faces': {}}

def scaffold():
    for n in (MOTION, DECK, DOC): shutil.rmtree(path(n), ignore_errors=True)
    write(f'{MOTION}/motion.json', json.dumps(MOTION_JSON))
    write(f'{MOTION}/scenes/s1.html', SCENE.format(extra=''))
    write(f'{MOTION}/uploads/blink.gif', GIF)
    write(f'{DECK}/deck.json', json.dumps({'v': 4, 'title': 'GIF deck', 'cover': 's1', 'order': ['s1'], 'sections': {}}))
    write(f'{DECK}/slides/s1.html', '<section id="s1" style="background:#ffffff;color:#16181d;padding:96px"><h1 style="font-size:64px;margin:0">Hello</h1>'
          '<img id="pic" src="uploads/blink.gif" alt="Blink" style="position:absolute;left:600px;top:200px;width:320px;height:180px"></section>\n')
    write(f'{DECK}/uploads/blink.gif', GIF)
    write(f'{DOC}/doc.json', json.dumps({'title': 'GIF doc', 'tabs': [{'id': 't1', 'title': 'One'}]}))
    write(f'{DOC}/tabs/t1.md', '# Hello\n\nA picture:\n\n![blink](../uploads/blink.gif)\n')
    write(f'{DOC}/uploads/blink.gif', GIF)

async def main():
    os.makedirs(OUT, exist_ok=True)
    scaffold()
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
            helper = await ctx.new_page()
            await helper.goto(f'{BASE}/api/projects')  # a page of a secure origin: ImageDecoder is only there
            pg = await ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'fonts.g' not in m.text and errs.append(m.text))

            # ===== motion: a GIF is a clip on the timeline =============================================
            await pg.goto(f'{BASE}/?p={MOTION}')
            await expect(pg.locator('.mtime')).to_be_visible()
            stage = pg.frame_locator('.medit iframe')
            img = stage.locator('#g')
            scrub = pg.locator('.mscrub')
            await expect(img).to_have_count(1)

            async def at(ms):
                await scrub.fill(str(ms))

            # the picture comes on at 1 s; before it, and at its start, the first frame
            await at(500)
            ok, got = await wait_shade(img, RED)
            check('motion: before the picture comes on it shows its first frame', ok, got)
            frames = [(1250, RED), (1750, GREEN), (2250, BLUE), (2750, RED), (3250, GREEN)]
            for ms, want in frames:
                await at(ms)
                ok, got = await wait_shade(img, want)
                check(f'motion: at {ms} ms the GIF shows the frame of {ms - 1000} ms into it', ok, got)
            # the same time gives the same frame whichever way the playhead came
            await at(2250)
            await at(1750)
            ok, got = await wait_shade(img, GREEN)
            await at(2250)
            ok2, got2 = await wait_shade(img, BLUE)
            check('motion: scrubbing back and forth draws the frame of the time, not of the path', ok and ok2, (got, got2))
            check('motion: the scene file keeps pointing at the file', 'src="uploads/blink.gif"' in read(f'{MOTION}/scenes/s1.html') and 'data:' not in read(f'{MOTION}/scenes/s1.html'))
            check('motion: …and the file on disk is untouched', open(path(MOTION, 'uploads', 'blink.gif'), 'rb').read() == GIF)

            # data-gif="once" holds the last frame after one play
            write(f'{MOTION}/scenes/s1.html', SCENE.format(extra='data-gif="once" '))
            await expect(stage.locator('#g[data-gif=once]')).to_have_count(1)
            await at(3250)
            ok, got = await wait_shade(stage.locator('#g'), BLUE)
            check('motion: data-gif="once" plays the clip once and holds its last frame', ok, got)
            write(f'{MOTION}/scenes/s1.html', SCENE.format(extra=''))
            await expect(stage.locator('#g[data-gif=once]')).to_have_count(0)
            await at(3250)
            ok, got = await wait_shade(stage.locator('#g'), GREEN)
            check('motion: without it the file\'s own loop count applies (this one loops)', ok, got)
            await pg.screenshot(path=OUT + 'gif-motion.png')

            # a file named .gif that is not a picture is said so in the issues (a broken image is all the browser can show of it)
            write(f'{MOTION}/uploads/bad.gif', 'not a gif at all')
            write(f'{MOTION}/scenes/s1.html', SCENE.format(extra='').replace('<h1', '<img id="bad" src="uploads/bad.gif" style="position:absolute;left:600px;top:100px;width:100px;height:100px"><h1'))
            await expect(stage.locator('#bad')).to_have_count(1)
            await pg.get_by_role('button', name=re.compile('^Check')).click()
            await expect(pg.locator('.missues')).to_contain_text('GIF is damaged or not a picture the browser can draw')
            check('motion: a .gif that is damaged or not a picture is reported among the piece\'s issues', True)
            # one cut short but still drawable by the browser is said to play on its own, out of step
            write(f'{MOTION}/uploads/cut.gif', GIF[:-40])
            write(f'{MOTION}/scenes/s1.html', SCENE.format(extra='').replace('<h1', '<img id="cut" src="uploads/cut.gif" style="position:absolute;left:600px;top:300px;width:100px;height:100px"><h1'))
            await expect(stage.locator('#cut')).to_have_count(1)
            await expect(pg.locator('.missues')).to_contain_text('cannot be read to follow the timeline')
            check('motion: a GIF cut short but still drawable is said to play on its own, out of step', True)
            await pg.get_by_role('button', name=re.compile('^Check')).click()
            write(f'{MOTION}/scenes/s1.html', SCENE.format(extra=''))
            os.remove(path(MOTION, 'uploads', 'bad.gif'))
            os.remove(path(MOTION, 'uploads', 'cut.gif'))

            # a frame saved as PNG is the frame of the time on the playhead (on a page loaded afresh: the stage has just been rewritten twice)
            await pg.goto(f'{BASE}/?p={MOTION}')
            await expect(pg.locator('.mtime')).to_be_visible()
            await at(2250)
            await wait_shade(stage.locator('#g'), BLUE)
            await pg.locator('button[aria-label="Import / Export"]').first.click()
            async with pg.expect_download(timeout=60000) as dl:
                await pg.get_by_role('menuitem', name=re.compile('^PNG image')).click()
            d = await dl.value
            png = open(await d.path(), 'rb').read()
            sh = await png_shade(helper, png, 260, 190)  # the middle of the picture, at 100,100 and 320×180 in the 1280×720 frame
            check('motion: the PNG of a frame draws the GIF\'s frame of that time', sh == BLUE, (sh, len(png), png[16:24].hex()))

            # the GIF made from the piece (the browser's own encoder) moves with the clip: 15 frames a second
            await pg.locator('button[aria-label="Import / Export"]').first.click()
            await pg.get_by_role('menuitem', name='GIF…').click()
            dlg = pg.get_by_role('dialog', name='Export video')
            async with pg.expect_download(timeout=120000) as dl:
                await dlg.get_by_role('button', name='Export', exact=True).click()
            d = await dl.value
            made = open(await d.path(), 'rb').read()
            seen = await helper.evaluate("""async ([b64, at]) => {
              const dec = new ImageDecoder({data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)), type: 'image/gif'});
              await dec.tracks.ready;
              const out = [];
              for (const [i, fx, fy] of at) {
                const {image} = await dec.decode({frameIndex: i});
                const c = document.createElement('canvas'); c.width = image.displayWidth; c.height = image.displayHeight;
                const g = c.getContext('2d'); g.drawImage(image, 0, 0);
                out.push(Array.from(g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3)));
                image.close();
              }
              return out;
            }""", [base64.b64encode(made).decode(), [[int(t * 15) + 1, 0.203, 0.264] for t in (0.5, 1.25, 1.75, 2.25, 2.75, 3.25)]])
            near = lambda a, b: all(abs(x - y) < 40 for x, y in zip(a, b))
            want = [(255, 255, 255), RED, GREEN, BLUE, RED, GREEN]  # white: the picture fades in at 1 s
            check('motion: the GIF made from the piece plays the clip at the piece\'s own pace', all(near(a, w) for a, w in zip(seen, want)), seen)

            # ===== slides: an ordinary picture ===========================================================
            await pg.goto(f'{BASE}/?p={DECK}')
            sframe = pg.frame_locator('.stage iframe').first
            await expect(sframe.locator('#pic')).to_have_count(1)
            ok = await sframe.locator('#pic').evaluate('i => i.complete && i.naturalWidth === 160 && i.naturalHeight === 90')
            check('slides: a GIF on a slide loads as a picture', ok)
            # the toolbar's Insert picture: a GIF is kept as it is in uploads/
            await pg.get_by_role('toolbar', name='Insert').locator('input[type=file]').set_input_files({'name': 'wave.gif', 'mimeType': 'image/gif', 'buffer': GIF})
            ok = await wait_for(lambda: len(re.findall(r'<img ', read(f'{DECK}/slides/s1.html'))) == 2)
            added = re.findall(r'src="(uploads/wave-[0-9a-f]{8}\.gif)"', read(f'{DECK}/slides/s1.html'))
            check('slides: Insert picture puts a GIF on the slide by its path', ok and len(added) == 1, read(f'{DECK}/slides/s1.html')[-300:])
            check('slides: …kept in uploads/ byte for byte, so it stays animated', bool(added) and open(path(DECK, added[0]), 'rb').read() == GIF)
            # the expand-to-edit picker lists it and replaces the source with it
            await sframe.locator('#pic').dblclick()
            pop = pg.locator('.cpop')
            await expect(pop).to_be_visible()
            await pop.get_by_role('button', name='Replace…').click()
            await expect(pop.locator('.cpicker .tile[title$=".gif"]')).to_have_count(2)
            check('slides: the picker lists the project\'s GIFs', True)
            await pop.locator(f'.cpicker .tile[title="{added[0]}"]').click()
            check('slides: choosing a GIF in the picker writes its path', await wait_for(lambda: f'id="pic" src="{added[0]}"' in read(f'{DECK}/slides/s1.html')), read(f'{DECK}/slides/s1.html')[-400:])
            await pg.keyboard.press('Escape')
            # exports are a still: the first frame
            await pg.locator('button[aria-label="Import / Export"]').first.click()
            async with pg.expect_download(timeout=60000) as dl:
                await pg.get_by_role('menuitem', name=re.compile('^PNG image$')).click()
            d = await dl.value
            png = open(await d.path(), 'rb').read()
            sh = await png_shade(helper, png, 760, 290)  # the middle of the picture on the 1920×1080 slide
            check('slides: the PNG of a slide draws a GIF as its first frame', sh == RED, sh)
            await pg.screenshot(path=OUT + 'gif-slides.png')

            # ===== docs: placed by picker, import, paste and drop; carried by exports ====================
            await pg.goto(f'{BASE}/?p={DOC}')
            body = pg.locator('.docbody')
            await expect(body.locator('img')).to_have_count(1)
            ok = await body.locator('img').evaluate('i => i.complete && i.naturalWidth === 160')
            check('docs: a GIF written in a tab is drawn from the project\'s files', ok)
            # Import → a picture goes to the end of the open tab, kept in uploads/
            await pg.locator('button[aria-label="Import / Export"]').first.click()
            async with pg.expect_file_chooser() as fc:
                await pg.get_by_role('menuitem', name=re.compile('^Import')).first.click()
            await (await fc.value).set_files({'name': 'wave.gif', 'mimeType': 'image/gif', 'buffer': GIF})
            ok = await wait_for(lambda: re.search(r'!\[wave\]\(\.\./uploads/wave-[0-9a-f]{8}\.gif\)\n$', read(f'{DOC}/tabs/t1.md')) is not None)
            check('docs: Import takes a GIF to the end of the open tab', ok, read(f'{DOC}/tabs/t1.md'))
            await expect(body.locator('img')).to_have_count(2)
            # paste and drop into the text
            await body.locator('h1').click()
            await body.evaluate("""(el, b64) => {
              const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
              const dt = new DataTransfer(); dt.items.add(new File([bytes], 'pasted.gif', {type: 'image/gif'}));
              el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
            }""", base64.b64encode(GIF).decode())
            ok = await wait_for(lambda: len(re.findall(r'!\[pasted\]', read(f'{DOC}/tabs/t1.md'))) == 1)
            check('docs: pasting a GIF puts it in the text', ok, read(f'{DOC}/tabs/t1.md'))
            box = await body.locator('h1').bounding_box()
            await body.evaluate("""(el, [b64, x, y]) => {
              const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
              const dt = new DataTransfer(); dt.items.add(new File([bytes], 'dropped.gif', {type: 'image/gif'}));
              el.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true}));
            }""", [base64.b64encode(GIF).decode(), box['x'] + 5, box['y'] + box['height'] / 2])
            ok = await wait_for(lambda: '![dropped]' in read(f'{DOC}/tabs/t1.md'))
            md = read(f'{DOC}/tabs/t1.md')
            check('docs: dropping a GIF puts it where it landed', ok and md.index('![dropped]') < md.index('A picture:'), md)
            kept = [f for f in os.listdir(path(DOC, 'uploads')) if f.endswith('.gif')]
            check('docs: …each kept in uploads/ byte for byte', len(kept) == 4 and all(open(path(DOC, 'uploads', f), 'rb').read() == GIF for f in kept), kept)
            await pg.screenshot(path=OUT + 'gif-docs.png')

            # the Markdown .zip and the Word file carry the GIF as it is
            await pg.locator('button[aria-label="Import / Export"]').first.click()
            async with pg.expect_download(timeout=30000) as dl:
                await pg.get_by_role('menuitem', name=re.compile('^Markdown$')).click()
            d = await dl.value
            with zipfile.ZipFile(await d.path()) as z:
                gifs = [n for n in z.namelist() if n.endswith('.gif')]
                same = bool(gifs) and all(z.read(n) == GIF for n in gifs)
            check('docs: the Markdown export carries the GIF files unchanged', same, d.suggested_filename)
            await pg.locator('button[aria-label="Import / Export"]').first.click()
            async with pg.expect_download(timeout=30000) as dl:
                await pg.get_by_role('menuitem', name=re.compile('^Word document')).click()
            d = await dl.value
            with zipfile.ZipFile(await d.path()) as z:
                media = [n for n in z.namelist() if n.startswith('word/media/')]
            check('docs: the Word file holds the GIF', any(n.endswith('.gif') for n in media), media)

            # ===== a request's attachment: a GIF over the model's limit goes as its first frame, the file is kept =====
            big = big_gif(2600, 2600)
            await pg.goto(f'{BASE}/?p={MOTION}')
            await expect(pg.locator('.mtime')).to_be_visible()
            await pg.locator('.prompt input[type=file]').set_input_files({'name': 'big.gif', 'mimeType': 'image/gif', 'buffer': big})
            chip = pg.locator('.prompt .attach-chip')
            await expect(chip).to_have_count(1, timeout=20000)
            check('attachments: a GIF of over 5 MB is taken (its first frame goes to the model), not refused', len(big) > 5 * 1024 * 1024 and await chip.locator('img').count() == 1, len(big))

            # ===== the project package =====================================================================
            r = await pg.request.get(f'{BASE}/api/projects/{MOTION}/archive')
            with zipfile.ZipFile(io.BytesIO(await r.body())) as z:
                kept = [n for n in z.namelist() if n.endswith('blink.gif')]
                same = bool(kept) and z.read(kept[0]) == GIF
            check('package: the project .zip carries the GIF unchanged', same, kept)

            check('no page errors', not errs, errs[:3])
            await b.close()
    finally:
        for n in (MOTION, DECK, DOC): shutil.rmtree(path(n), ignore_errors=True)
    bad = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(bad)}/{len(results)} passed')
    raise SystemExit(1 if bad else 0)

asyncio.run(main())
