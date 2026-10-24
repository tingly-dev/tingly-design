"""End-to-end checks for attachments: images and files added to a request by pasting, dropping or the
file picker, kept in the project's uploads/, and passed to the fast model as content blocks and to
Claude Code by their paths.
Run after `pnpm build`: python3 e2e/attach.py  (DC_CHROME=/path/to/chrome to use another Chromium)
Starts its own server (production mode, PORT=0) on a fresh projects folder, with the mock model and a
stand-in `claude` command first on PATH, so it needs neither `pnpm dev` nor an API key."""
import os, sys, asyncio, json, struct, subprocess, tempfile, threading, time, urllib.request, urllib.error
from playwright.async_api import async_playwright, expect

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out') + '/'
CHROME = os.environ.get('DC_CHROME')
MOCK_PORT = 8791 + int(os.environ.get('DC_E2E_OFFSET', 0))  # a parallel lane shifts every port (e2e/run.py)

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

# A stand-in for Claude Code: answers --version, and for a request records its arguments and what the
# attached files held (they are removed when it finishes), then reports success in stream-json.
FAKE_CLAUDE = r'''#!/usr/bin/env python3
import sys, json, os, re
if '--version' in sys.argv: print('0.0.0 (fake)'); sys.exit(0)
args = sys.argv[1:]
prompt = args[args.index('-p') + 1]
dirs = [args[i + 1] for i, a in enumerate(args) if a == '--add-dir']
files = {}
for p in re.findall(r'^- (/\S+) \(attached as', prompt, re.M):
    b = open(p, 'rb').read()
    files[p] = {'size': len(b), 'head': b[:40].decode('latin-1')}
open(os.environ['FAKE_CLAUDE_LOG'], 'a').write(json.dumps({'prompt': prompt, 'dirs': dirs, 'files': files}) + '\n')
print(json.dumps({'type': 'result', 'result': 'Looked at the attachments.', 'is_error': False}), flush=True)
'''

def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'content-type': 'application/json'}, method='POST')
    try:
        r = urllib.request.urlopen(req)
        return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def lines(path):
    try: return [json.loads(l) for l in open(path) if l.strip()]
    except FileNotFoundError: return []

async def wait_for(pred, timeout=8.0):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if pred(): return True
        except Exception: pass
        await asyncio.sleep(0.1)
    return False

# files made in the page: a 2000×1000 PNG (it must shrink to 1568 on its long side), and others by content
MAKE_PNG = """async ([w, h]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#7c3aed'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(w / 4, h / 4, w / 2, h / 2);
  const b = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new File([b], '', { type: 'image/png' });
}"""

async def paste_image(pg, selector, w, h):
    await pg.evaluate("""async ([sel, make, w, h]) => {
      const f = await (eval(make))([w, h]);
      const dt = new DataTransfer(); dt.items.add(f);
      document.querySelector(sel).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }""", [selector, MAKE_PNG, w, h])

async def drop_file(pg, selector, name, text, mime):
    """Drag a file over the bar (the hint shows), then drop it."""
    await pg.evaluate("""([sel, name, text, mime]) => {
      const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: mime }));
      window.__drop = dt;
      document.querySelector(sel).dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }""", [selector, name, text, mime])
    hint = await pg.locator('.drop-hint').count()
    await pg.evaluate("""(sel) => document.querySelector(sel).dispatchEvent(new DragEvent('drop', { dataTransfer: window.__drop, bubbles: true, cancelable: true }))""", selector)
    return hint

PDF = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'

async def main():
    if not os.path.exists(os.path.join(REPO, 'apps/editor/dist/index.html')):
        raise SystemExit('no editor build: run pnpm build first')
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='dc-attach-')
    projects = os.path.join(tmp, 'projects')
    bin_dir = os.path.join(tmp, 'bin'); os.makedirs(bin_dir)
    open(os.path.join(bin_dir, 'claude'), 'w').write(FAKE_CLAUDE); os.chmod(os.path.join(bin_dir, 'claude'), 0o755)
    mock_log = os.path.join(tmp, 'mock.log'); claude_log = os.path.join(tmp, 'claude.log')
    files = os.path.join(tmp, 'files'); os.makedirs(files)
    for name, data in [('brief.pdf', PDF), ('q3.csv', b'month,calls\nJul,1200\nAug,1350\n'), ('archive.zip', b'PK\x03\x04'), ('ref.png', None)]:
        if data: open(os.path.join(files, name), 'wb').write(data)

    mock = subprocess.Popen([sys.executable, os.path.join(HERE, 'mock_anthropic.py'), mock_log, str(MOCK_PORT)])
    server = subprocess.Popen(
        [os.path.join(REPO, 'apps/server/node_modules/.bin/tsx'), 'src/index.ts'], cwd=os.path.join(REPO, 'apps/server'),
        env={**os.environ, 'NODE_ENV': 'production', 'PORT': '0', 'DC_PROJECTS': projects, 'DC_EXIT_WITH_STDIN': '1',
             'ANTHROPIC_API_KEY': 'x', 'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{MOCK_PORT}',
             'PATH': bin_dir + os.pathsep + os.environ['PATH'], 'FAKE_CLAUDE_LOG': claude_log},
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
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            pg = await b.new_page(locale='zh-CN', viewport={'width': 1440, 'height': 900})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(base + '/?p=tingly-box-console-canvas')
            await pg.wait_for_timeout(2500)
            chips = pg.locator('.prompt .attach-chip')

            # the paperclip is on every request to a model; jQuery typed by hand lives in the Code tab, not here
            await pg.locator('.prompt .seg button', has_text='快速 AI').click()
            check('paperclip on the fast AI bar', await pg.locator('.prompt .attach').is_visible())
            check('no jQuery choice in the prompt bar', await pg.locator('.prompt .seg button', has_text='jQuery').count() == 0)

            # paste a screenshot: a chip with a thumbnail, scaled down for the model
            await pg.locator('.prompt textarea').focus()
            await paste_image(pg, '.prompt textarea', 2000, 1000)
            await expect(chips).to_have_count(1)
            name = await chips.first.locator('.name').inner_text()
            check('pasted image becomes a chip with a thumbnail', await chips.first.locator('img').count() == 1 and name == '粘贴的图片.png', name)
            check('the paste did not type anything', await pg.locator('.prompt textarea').input_value() == '')

            # plain text still pastes as text
            await pg.evaluate("""() => { const dt = new DataTransfer(); dt.setData('text/plain', 'x'); document.querySelector('.prompt textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }""")
            check('pasting text adds no chip', await chips.count() == 1)

            # the picker: a PDF and a CSV; a zip is refused with a reason
            await pg.locator('.prompt input[type=file]').set_input_files([os.path.join(files, 'brief.pdf'), os.path.join(files, 'q3.csv')])
            await expect(chips).to_have_count(3)
            check('picked PDF and CSV show as file chips', await pg.locator('.prompt .attach-chip.pdf').count() == 1 and await pg.locator('.prompt .attach-chip.text').count() == 1)
            await pg.locator('.prompt input[type=file]').set_input_files(os.path.join(files, 'archive.zip'))
            await expect(pg.locator('.toast.error')).to_contain_text('不支持这种文件')
            check('an unsupported file is refused with a reason', await chips.count() == 3)

            # drop a file on the bar: the hint shows while it is over, then it is attached
            hint = await drop_file(pg, '.prompt', 'notes.md', '# Notes\nUse the purple from the screenshot.', 'text/markdown')
            await expect(chips).to_have_count(4)
            check('dropping a file shows the hint and attaches it', hint == 1 and 'notes.md' in await chips.nth(3).inner_text())
            await pg.screenshot(path=OUT + 'attach-chips.png')
            await pg.locator('.prompt').screenshot(path=OUT + 'attach-bar.png')

            # × takes one off
            await chips.nth(3).locator('.x').click()
            check('× removes a chip', await chips.count() == 3)

            # never more than six
            for _ in range(4): await paste_image(pg, '.prompt textarea', 40, 40)
            await expect(pg.locator('.toast.error').last).to_contain_text('最多附 6 个')
            check('at most six attachments', await chips.count() == 6)
            for _ in range(3): await chips.last.locator('.x').click()
            await expect(chips).to_have_count(3)

            # send to the fast model: the files go as content blocks before the request
            main = pg.frame_locator('[data-board="Main.dc.html"] iframe')
            await main.locator('h1').click()
            await pg.locator('.prompt textarea').fill('标题换成截图里的紫色，下面加一个三条的要点列表')
            await pg.locator('.prompt .send').click()
            await expect(pg.locator('.runfeed')).to_contain_text('已保存', timeout=15000)
            calls = lines(mock_log)
            first = calls[0]['blocks'] if calls else []
            kinds = [x['type'] for x in first]
            check('the model gets image, PDF and text blocks, then the request', kinds == ['text', 'image', 'document', 'text', 'text'], kinds)
            img = next((x for x in first if x['type'] == 'image'), {})
            check('the image is sent scaled down as WebP', img.get('media_type') == 'image/webp' and 0 < img.get('bytes', 0) < 400_000, img)
            check('the PDF is sent as a document with its name', any(x['type'] == 'document' and x['title'] == 'brief.pdf' and x['media_type'] == 'application/pdf' for x in first))
            csv = next((x for x in first if x['type'] == 'text' and 'q3.csv' in x['text']), {})
            check('the CSV is sent as fenced text', '⟦untrusted:' in csv.get('text', '') and 'Jul,1200' in csv.get('text', ''), csv)
            check('the request names the attachments', 'attached (shown above this message)' in first[-1]['tail'] if first else False)
            check('each attachment is labelled with where the project keeps it', 'kept in the project as uploads/' in first[0]['text'] if first else False, first[:1])
            check('the retry keeps the same attachments', len(calls) >= 2 and calls[1]['blocks'] == calls[0]['blocks'])
            check('chips clear after sending', await chips.count() == 0)
            proj = os.path.join(projects, 'tingly-box-console-canvas')
            ups = os.path.join(proj, 'uploads')
            kept = sorted(os.listdir(ups)) if os.path.isdir(ups) else []
            check('the three attachments are kept in uploads/, named by content', len(kept) == 3 and any(f.startswith('pasted-') and f.endswith('.png') for f in kept) and any(f.startswith('brief-') for f in kept) and any(f.startswith('q3-') for f in kept), kept)
            png = next((f for f in kept if f.endswith('.png')), None)
            head = open(os.path.join(ups, png), 'rb').read(24) if png else b''
            check('the pasted image is kept as given (2000×1000 PNG), not the scaled copy', head[:4] == b'\x89PNG' and struct.unpack('>II', head[16:24]) == (2000, 1000))
            st, _ = 200, None
            try:
                r = urllib.request.urlopen(f'{base}/api/projects/tingly-box-console-canvas/raw/uploads/{png}')
                st, ctype = r.status, r.headers['content-type']
            except Exception as e: st, ctype = 0, str(e)
            check('a kept image is served from the project', st == 200 and ctype == 'image/png', (st, ctype))
            csvf = next((f for f in kept if f.endswith('.csv')), '')
            r = urllib.request.urlopen(f'{base}/api/projects/tingly-box-console-canvas/raw/uploads/{csvf}')
            check('a kept text file is served as plain text', r.headers['content-type'].startswith('text/plain') and b'Jul,1200' in r.read())
            journal = os.path.join(proj, '.journal.jsonl')
            check('keeping attachments adds nothing to the change log', not os.path.exists(journal) or 'uploads/' not in open(journal).read())

            # hand to Claude Code: it is told where the project keeps each file
            await pg.locator('.prompt .seg button', has_text='Claude Code').click()
            await pg.locator('.prompt input[type=file]').set_input_files([os.path.join(files, 'q3.csv'), os.path.join(files, 'brief.pdf')])
            await expect(chips).to_have_count(2)
            await pg.locator('.prompt textarea').fill('Put the Q3 numbers from the CSV into the usage card')
            await pg.locator('.prompt .send').click()
            ok = await wait_for(lambda: len(lines(claude_log)) >= 1, 10)
            run = lines(claude_log)[0] if ok else {}
            fs = run.get('files', {})
            check('Claude Code is told about each attachment by path', len(fs) == 2 and 'attached as "q3.csv"' in run.get('prompt', '') and 'attached as "brief.pdf"' in run.get('prompt', ''), run.get('prompt', '')[-400:])
            check('the paths are the files kept in uploads/', sorted(os.path.basename(p) for p in fs) == sorted(f for f in kept if not f.endswith('.png')) and all(p.startswith(ups) for p in fs), list(fs))
            check('the kept files hold what was picked', sorted(v['size'] for v in fs.values()) == sorted([os.path.getsize(os.path.join(files, 'q3.csv')), len(PDF)]) and any(v['head'].startswith('%PDF') for v in fs.values()), fs)
            await asyncio.sleep(1)
            check('a file attached twice is kept once, and stays after Claude Code finishes', sorted(os.listdir(ups)) == kept, os.listdir(ups))
            check('chips clear after handing off', await chips.count() == 0)

            # a design system's, dashboard's and doc's "hand to Claude Code" bar takes them too
            await pg.goto(base + '/?p=tingly-design-guide-doc')
            await pg.wait_for_timeout(2000)
            ask = pg.locator('.dsask')
            await ask.locator('textarea').focus()
            await paste_image(pg, '.dsask textarea', 300, 200)
            await ask.locator('input[type=file]').set_input_files(os.path.join(files, 'q3.csv'))
            await expect(ask.locator('.attach-chip')).to_have_count(2)
            await ask.screenshot(path=OUT + 'attach-docs.png')
            await ask.locator('textarea').fill('Add a short section on the Q3 numbers')
            await ask.locator('button.send').click()
            ok = await wait_for(lambda: len(lines(claude_log)) >= 2, 10)
            run = lines(claude_log)[1] if ok else {}
            check('the doc bar hands its attachments to Claude Code', ok and len(run.get('files', {})) == 2 and 'Doc folder' in run.get('prompt', ''), run.get('prompt', '')[-300:])
            check('the doc bar clears after sending', await ask.locator('.attach-chip').count() == 0)

            # a slide shows a kept image by its uploads/ path (what the fast model is told it may write)
            req = urllib.request.Request(f'{base}/api/projects/tingly-design-intro-slides/assets?name=logo.png&dir=uploads', data=open(os.path.join(ups, png), 'rb').read(), method='POST')
            up = json.loads(urllib.request.urlopen(req).read())['path']
            await pg.goto(base + '/?p=tingly-design-intro-slides')
            await pg.wait_for_timeout(2000)
            await pg.locator('.panel [role="tab"]', has_text='代码').click()
            await pg.locator('.jqbox textarea').fill(f"$('section').append(`<img src=\"{up}\" alt=\"logo\" style=\"position:absolute;left:128px;top:128px;width:400px;height:200px;object-fit:cover\">`)")
            await pg.locator('.jqbox button', has_text='执行').click()
            img = pg.frame_locator('.sframe.f-stage iframe').locator('img[alt="logo"]')
            await img.wait_for(timeout=8000)
            await pg.wait_for_timeout(500)
            check('a slide shows a kept image by its uploads/ path', await img.evaluate('(i) => i.complete && i.naturalWidth === 2000'))

            # the server checks what it is sent
            st, body = post(f'{base}/api/projects/tingly-box-console-canvas/delegate', {'prompt': 'x', 'attachments': [{'name': 'x', 'path': 'canvas.json'}]})
            check('the server hands on only files in uploads/', st == 400 and 'not an upload' in body, (st, body))
            st, body = post(f'{base}/api/projects/tingly-box-console-canvas/delegate', {'prompt': 'x', 'attachments': [{'name': 'x', 'path': 'uploads/../canvas.json'}]})
            check('the server refuses a path that climbs out of uploads/', st == 400, (st, body))
            req = urllib.request.Request(f'{base}/api/projects/tingly-box-console-canvas/assets?name=a.exe&dir=uploads', data=b'MZ', method='POST')
            try: st = urllib.request.urlopen(req).status
            except urllib.error.HTTPError as e: st = e.code
            check('the server keeps only kinds that can be attached', st == 400, st)
            st, body = post(f'{base}/api/projects/tingly-box-console-canvas/fast-edit', {'messages': [{'role': 'user', 'content': [{'type': 'tool_use', 'id': 'x', 'name': 'y', 'input': {}}]}]})
            check('the server refuses blocks that are not text, image or PDF', st == 400, (st, body))
            check('no page errors', not errs, errs)
            await b.close()
    finally:
        try: server.stdin.close()
        except Exception: pass
        server.wait(timeout=10)
        mock.terminate()
        subprocess.run(['rm', '-rf', tmp])
    passed = sum(ok for _, ok in results)
    print(f'\n{passed}/{len(results)} passed')
    sys.exit(0 if passed == len(results) else 1)

asyncio.run(main())
