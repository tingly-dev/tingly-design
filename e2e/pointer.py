"""Live edit pointers: whoever changes a page, a pointer in their colour marks the element or block they changed, then fades.
Writes straight into the files the way Claude Code or a terminal does (an `external` pointer), saves as another editor window would
(`x-dc-client`, a "Someone else" pointer), lets the fast AI answer through the mock model (a "Fast AI" pointer, and none for the
window's own save), and announces two participants through `POST /api/projects/:p/pointer` (two pointers at once, each its own
colour and name, one taken away). Covers canvas, slides, motion and docs; checks the pointer never takes a click and is gone a few
seconds after its participant stops. Run with `pnpm dev` up: python3 e2e/pointer.py (or pnpm e2e pointer). Leaves the samples as committed."""
import asyncio, json, os, subprocess, time, urllib.request
from playwright.async_api import async_playwright

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
API = os.environ.get('DC_API', 'http://localhost:8787')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')

# kind -> (sample project, file, text on screen at first, what the outside edit turns it into)
CASES = {
    'design': ('tingly-box-console-canvas', 'Flow.dc.html', 'Translated', 'Translated by hand'),
    'slides': ('tingly-design-intro-slides', 'slides/cover.html', 'Meet Tingly', 'Met Tingly outside'),
    'motion': ('tingly-design-motion', 'scenes/poster.html', 'AI drafts. You decide.', 'AI drafts. You decide outside.'),
}
DOC = ('tingly-design-guide-doc', 'tabs/overview.md', 'Tingly Design handbook', 'Tingly Design handbook outside')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''), flush=True)

def restore(project): subprocess.run(['git', 'checkout', '--', f'projects/{project}'], cwd=REPO)

def api(method, path, body=None, headers=None):
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'content-type': 'application/json', **(headers or {})})
    with urllib.request.urlopen(req, timeout=10) as r: return json.loads(r.read() or b'{}')

# in a frame: the pointer's node, its frame colour and name, and whether it holds the element drawing `text` (frame coordinates)
MEASURE = """([pid, text]) => {
  const node = document.querySelector(`[data-dc-pointer="${pid}"]`);
  if (!node) return null;
  const p = node.getBoundingClientRect();
  let at = null;
  if (text) {
    const w = document.createTreeWalker(document.getElementById('dc-app') || document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.includes(text)) { at = n.parentElement.getBoundingClientRect(); break; }
  }
  const layer = node.closest('[data-dc-pointers]');
  const cx = at ? at.left + at.width / 2 : 0, cy = at ? at.top + at.height / 2 : 0;
  const hit = at ? document.elementFromPoint(cx, cy) : null;
  return {
    label: node.textContent, color: getComputedStyle(node.firstElementChild).borderTopColor, fading: node.hasAttribute('data-fading'),
    holds: !!at && p.left <= cx && cx <= p.right && p.top <= cy && cy <= p.bottom,
    passes: !!layer && getComputedStyle(layer).pointerEvents === 'none' && !!hit && !hit.closest('[data-dc-pointers]'),
  };
}"""

async def find_pointer(pg, pid, text=None, timeout=8.0):
    """The first frame that draws pointer `pid`, with what MEASURE says of it; (None, None) when none does in time."""
    t = time.time()
    while time.time() - t < timeout:
        for fr in pg.frames:
            try:
                m = await fr.evaluate(MEASURE, [pid, text])
                if m: return fr, m
            except Exception: pass
        await asyncio.sleep(0.2)
    return None, None

async def gone(fr, selector, timeout=9.0):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if not await fr.locator(selector).count(): return True
        except Exception: return True
        await asyncio.sleep(0.25)
    return False

async def shown(pg, text, timeout=8.0):
    t = time.time()
    while time.time() - t < timeout:
        for fr in pg.frames:
            try:
                if await fr.get_by_text(text, exact=False).count(): return True
            except Exception: pass
        await asyncio.sleep(0.3)
    return False

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        errs = []

        # an outside write (Claude Code, a terminal): the pointer frames the element it changed, says who, lets clicks through, fades
        for kind, (project, file, old, new) in CASES.items():
            path = os.path.join(REPO, 'projects', project, file)
            pg = await b.new_page(viewport={'width': 1440, 'height': 900})
            pg.on('pageerror', lambda e: errs.append(str(e)))
            try:
                await pg.goto(f'{BASE}/?p={project}&lang=en')
                await pg.wait_for_timeout(2500)
                check(f'{kind}: the sample shows "{old}"', await shown(pg, old))
                src = open(path, encoding='utf-8').read()
                open(path, 'w', encoding='utf-8').write(src.replace(old, new, 1))
                fr, m = await find_pointer(pg, 'external', new)
                check(f'{kind}: an outside edit puts a pointer on the page', m is not None)
                if not m: continue
                check(f'{kind}: the pointer frames the element that changed', m['holds'], m)
                check(f'{kind}: the pointer says who changed it', m['label'] == 'Outside the editor', m['label'])
                check(f'{kind}: the pointer lets a click through to the page', m['passes'], m)
                if kind == 'design':
                    await pg.screenshot(path=os.path.join(REPO, 'e2e', 'out', 'pointer-canvas.png'))
                check(f'{kind}: the pointer fades once its participant is still', await gone(fr, '[data-dc-pointer="external"]'))
            finally:
                restore(project)
                await pg.close()

        # a doc tab: the pointer frames the top-level block an outside write changed
        project, file, old, new = DOC
        path = os.path.join(REPO, 'projects', project, file)
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: errs.append(str(e)))
        try:
            await pg.goto(f'{BASE}/?p={project}&lang=en')
            await pg.wait_for_selector('.docbody')
            await pg.wait_for_timeout(1500)
            src = open(path, encoding='utf-8').read()
            open(path, 'w', encoding='utf-8').write(src.replace(old, new, 1))
            ptr = pg.locator('.docpointer[data-dc-pointer="external"]')
            try: await ptr.wait_for(timeout=8000); ok = True
            except Exception: ok = False
            check('docs: an outside edit puts a pointer on the tab', ok)
            if ok:
                box = await ptr.bounding_box()
                block = await pg.locator('.docbody > *', has_text=new).first.bounding_box()
                cx, cy = block['x'] + block['width'] / 2, block['y'] + block['height'] / 2
                check('docs: the pointer frames the block that changed', box['x'] <= cx <= box['x'] + box['width'] and box['y'] <= cy <= box['y'] + box['height'], (box, block))
                check('docs: the pointer says who changed it', (await ptr.inner_text()).strip() == 'Outside the editor')
                check('docs: the pointer lets a click through to the text', await pg.evaluate("([x, y]) => !document.elementFromPoint(x, y).closest('.docpointers')", [cx, cy]))
                await pg.screenshot(path=os.path.join(REPO, 'e2e', 'out', 'pointer-docs.png'))
                check('docs: the pointer fades once its participant is still', await gone(pg, '.docpointer[data-dc-pointer="external"]'))
        finally:
            restore(project)
            await pg.close()

        # several participants at once: two announced agents (each its own colour and name), then another window's save
        project, file = 'tingly-box-console-canvas', 'Flow.dc.html'
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: errs.append(str(e)))
        try:
            await pg.goto(f'{BASE}/?p={project}&lang=en')
            await pg.wait_for_timeout(2500)
            flow = pg.frame_locator(f'[data-board="{file}"] iframe')
            tids = await flow.locator('#dc-app').evaluate("(app) => [...app.querySelectorAll('[data-dc-tid]')].filter((e) => e.getBoundingClientRect().width > 20 && e.getBoundingClientRect().height > 10).map((e) => +e.dataset.dcTid)")
            a, z = tids[1], tids[-1]
            api('POST', f'/api/projects/{project}/pointer', {'participant': {'id': 'agent:writer', 'actor': 'claude', 'name': 'Writer'}, 'file': file, 'tid': a})
            api('POST', f'/api/projects/{project}/pointer', {'participant': {'id': 'agent:reviewer', 'name': 'Reviewer', 'color': '#16a34a'}, 'file': file, 'tid': z})
            _, w = await find_pointer(pg, 'agent:writer')
            _, r = await find_pointer(pg, 'agent:reviewer')
            check('two announced participants show two pointers at once', w is not None and r is not None)
            if w and r:
                check('each pointer carries its own name', w['label'] == 'Writer' and r['label'] == 'Reviewer', (w['label'], r['label']))
                check('each pointer carries its own colour (an agent its actor\'s, an announced one its own)', w['color'] == 'rgb(124, 58, 237)' and r['color'] == 'rgb(22, 163, 74)', (w['color'], r['color']))
            await pg.screenshot(path=os.path.join(REPO, 'e2e', 'out', 'pointer-two.png'))
            api('POST', f'/api/projects/{project}/pointer', {'participant': {'id': 'agent:writer'}, 'file': None})
            fr, _ = await find_pointer(pg, 'agent:reviewer')
            check('a participant that stops takes its pointer away, the other stays', await gone(fr, '[data-dc-pointer="agent:writer"]', 3) and await fr.locator('[data-dc-pointer="agent:reviewer"]').count() == 1)
            try:
                api('POST', f'/api/projects/{project}/pointer', {'participant': {'id': 'not ok'}, 'file': file})
                refused = False
            except urllib.error.HTTPError as e: refused = e.code == 400
            check('an announcement without a proper participant is refused', refused)
            # another window saves: this one shows where, as someone else
            st = api('GET', f'/api/projects/{project}/files')['files'][file]
            api('PUT', f'/api/projects/{project}/file?path={file}', {'content': st['content'].replace('Translated', 'Translated twice', 1), 'baseVersion': st['version'], 'actor': 'human'}, {'x-dc-client': 'otherwin'})
            _, o = await find_pointer(pg, 'client:otherwin', 'Translated twice')
            check('another window\'s save shows a pointer in this one', o is not None)
            if o: check('another window\'s pointer frames what it changed and is called someone else', o['holds'] and o['label'] == 'Someone else', o)
        finally:
            restore(project)
            await pg.close()

        # the fast AI: its reply is marked where it landed; the window's own save puts no "someone else" pointer on it
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: errs.append(str(e)))
        try:
            await pg.goto(f'{BASE}/?p={project}&lang=en')
            await pg.wait_for_timeout(2500)
            main_board = pg.frame_locator('[data-board="Main.dc.html"] iframe')
            await main_board.locator('h1').click()
            await pg.locator('.seg button', has_text='Fast AI').click()
            await pg.locator('.prompt textarea').fill('make the title purple and add three points under it')
            await pg.locator('.prompt .send').click()
            fr, f = await find_pointer(pg, 'fast-edit', None, 15)
            check('the fast AI\'s reply shows a pointer where it landed', f is not None and f['label'] == 'Fast AI', f)
            if fr:
                held = await fr.evaluate("() => { const p = document.querySelector('[data-dc-pointer=\"fast-edit\"]').getBoundingClientRect(); const h = document.querySelector('h1').getBoundingClientRect(); return p.left <= h.left + 1 && p.top <= h.top + 1 && p.right >= h.right - 1 && p.bottom >= h.bottom - 1; }")
                check('the fast AI\'s pointer holds the title it changed', held)
            await pg.wait_for_timeout(1500)
            own = 0
            for x in pg.frames:
                try: own += await x.locator('[data-dc-pointer^="client:"]').count()
                except Exception: pass
            check('the window\'s own save puts no pointer on its own page', own == 0)
        finally:
            restore(project)
            await pg.close()

        check('no page errors', not errs, errs[:3])
        await b.close()

asyncio.run(main())
failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
raise SystemExit(1 if failed else 0)
