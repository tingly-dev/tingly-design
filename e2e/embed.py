"""End-to-end checks for embedding: the bundle a host runs, under a base path, inside a host page.
Run after `pnpm bundle`: python3 e2e/embed.py  (DC_CHROME=/path/to/chrome to use another Chromium)
Starts dist/tingly-design/server.mjs itself, the way a host does (docs/en/embedding.md), with a
fresh projects folder, and serves a host page from another origin that frames the editor."""
import os, asyncio, json, subprocess, tempfile, threading, time, urllib.request, urllib.error
from http.server import HTTPServer, SimpleHTTPRequestHandler
from playwright.async_api import async_playwright, expect

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE = os.path.join(REPO, 'dist', 'tingly-design')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
CHROME = os.environ.get('DC_CHROME')
PREFIX = '/design'

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def launch(projects, **env):
    """Start the bundle as a host would: PORT=0, a base path, its own projects folder; wait for the ready line."""
    proc = subprocess.Popen(
        ['node', os.path.join(BUNDLE, 'server.mjs')],
        env={**os.environ, 'PORT': '0', 'DC_BASE_PATH': PREFIX, 'DC_PROJECTS': projects, 'DC_EXIT_WITH_STDIN': '1', **env},
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    t = time.time()
    while time.time() - t < 20:
        line = proc.stdout.readline()
        if line.startswith('TINGLY_DESIGN_READY '):
            ready = json.loads(line.split(' ', 1)[1])
            threading.Thread(target=lambda: [None for _ in proc.stdout], daemon=True).start()
            return proc, ready
        if not line and proc.poll() is not None: break
    raise SystemExit('the bundle did not print its ready line')

def get(url):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, method='GET'))
        return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None

HOST_PAGE = """<!doctype html><meta charset="utf-8"><title>host</title>
<style>body{margin:0}iframe{border:0;width:100vw;height:100vh;display:block}</style>
<iframe id="ed" src="%s"></iframe>
<script>
  window.got = [];
  addEventListener('message', (e) => { if (e.source === ed.contentWindow && String(e.data && e.data.type).startsWith('tingly-design:')) got.push(e.data); });
  window.send = (m) => ed.contentWindow.postMessage(m, '*');
</script>"""

async def main():
    if not os.path.exists(os.path.join(BUNDLE, 'server.mjs')):
        raise SystemExit('no bundle: run pnpm bundle first')
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='dc-embed-')
    projects = os.path.join(tmp, 'data', 'projects')

    # --- the bundle on its own -------------------------------------------------------------
    manifest = json.load(open(os.path.join(BUNDLE, 'tingly-design.json')))
    check('the bundle carries a manifest', manifest.get('entry') == 'server.mjs' and manifest.get('protocol') == 1 and manifest.get('version'), str(manifest))
    proc, ready = launch(projects)
    port = ready['port']
    root = f'http://127.0.0.1:{port}'
    check('PORT=0 picks a port and the ready line names it', port > 0 and ready['basePath'] == PREFIX and ready['protocol'] == 1, str(ready))
    # the samples are the repository's projects/ folders; the running server's own .server.json sits beside them
    samples = sorted({f.split('/')[1] for f in subprocess.run(['git', 'ls-files', 'projects'], cwd=REPO, capture_output=True, text=True).stdout.split() if f.count('/') >= 2})
    seeded = sorted(d for d in os.listdir(projects) if os.path.isdir(os.path.join(projects, d)))
    check('a fresh projects folder starts with the samples', seeded == samples, f'{seeded} != {samples}')
    check('…without anyone\'s journal or run reports', not any(f.startswith('.') for d in seeded for f in os.listdir(os.path.join(projects, d))))
    status, body, _ = get(root + PREFIX + '/api/health')
    health = json.loads(body)
    check('health answers under the base path', status == 200 and health['basePath'] == PREFIX and health['protocol'] == 1 and health['version'] == manifest['version'], str(health))
    opener = urllib.request.build_opener(NoRedirect)
    try:
        opener.open(root + PREFIX + '?x=1')
        loc = None
    except urllib.error.HTTPError as e:
        loc = (e.code, e.headers.get('location'))
    check('the bare prefix redirects to prefix/ (assets are relative to it)', loc == (308, PREFIX + '/?x=1'), str(loc))
    check('nothing answers outside the prefix', get(root + '/api/health')[0] == 404)
    status, _, headers = get(root + PREFIX + '/api/projects/tingly-ds/raw/assets/Marks/tingly-mark.svg')
    check('project assets are served under the prefix', status == 200 and 'svg' in headers.get('content-type', ''), str(status))
    status, body, _ = get(root + PREFIX + '/')
    check('the editor\'s page loads its assets relatively', status == 200 and b'src="./assets/' in body)
    req = urllib.request.Request(root + PREFIX + '/api/projects/design-guide/commit', data=b'{}', method='POST', headers={'content-type': 'application/json'})
    out = json.loads(urllib.request.urlopen(req).read())
    check('committing in a projects folder outside git explains why it cannot', out['ok'] is False and 'git' in out['output'], str(out))

    # a host page on another origin
    host_dir = tempfile.mkdtemp(prefix='dc-host-')
    class Quiet(SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=host_dir, **k)
        def log_message(self, *a): pass
    hs = HTTPServer(('127.0.0.1', 0), Quiet)
    threading.Thread(target=hs.serve_forever, daemon=True).start()
    open(os.path.join(host_dir, 'host.html'), 'w').write(HOST_PAGE % (f'{root}{PREFIX}/?theme=dark'))
    host = f'http://localhost:{hs.server_address[1]}/host.html'

    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='zh-CN', viewport={'width': 1280, 'height': 800})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'fonts.g' not in m.text and errs.append(m.text))

        # --- standalone under the prefix --------------------------------------------------------
        await pg.goto(root + PREFIX + '/')
        await pg.locator('.lcard[data-project]').first.wait_for()
        n = await pg.locator('.lcard[data-project]').count()
        check('the launcher lists every project', n == len(samples), f'{n} cards, {len(samples)} samples')
        cover = pg.frame_locator('.lcard[data-project="tingly-intro"] .lframe iframe')
        await expect(cover.locator('section#cover h1')).to_contain_text('Meet Tingly')
        check('live previews run the sandbox from prefix/sandbox/', True)
        await pg.locator('.lcard[data-project="box-console"]').click()
        await pg.wait_for_url('**' + PREFIX + '/?p=box-console')
        main_board = pg.frame_locator('[data-board="Main.dc.html"] iframe')
        await expect(main_board.locator('h1').first).to_be_visible()
        check('opening a project stays under the prefix and renders its artboards', True)
        await pg.goto(root + PREFIX + '/?p=design-guide')
        body = pg.locator('.docbody')
        await expect(body.locator('h1')).to_have_text('Tingly Design handbook')
        overview = os.path.join(projects, 'design-guide', 'tabs', 'overview.md')
        await body.locator('ul[data-type=taskList] li').first.locator('input[type=checkbox]').click()
        t = time.time()
        while time.time() - t < 6 and '- [x] Run `pnpm install`' not in open(overview).read(): await asyncio.sleep(0.1)
        check('an edit is written to the host\'s projects folder', '- [x] Run `pnpm install`' in open(overview).read())
        await pg.locator('.pmenu a.tb').click()
        await pg.wait_for_url(root + PREFIX + '/')
        check('the home link goes back to the launcher under the prefix', True)

        # --- inside a host page -----------------------------------------------------------------
        await pg.goto(host)
        fr = pg.frame_locator('#ed')
        await fr.locator('.lcard[data-project]').first.wait_for()
        await pg.wait_for_function('got.some(m => m.type === "tingly-design:ready")')
        got = await pg.evaluate('got')
        r = next(m for m in got if m['type'] == 'tingly-design:ready')
        check('the editor tells its host it is ready, with version and protocol', r['version'] == manifest['version'] and r['protocol'] == 1 and r['project'] is None, str(r))
        check('…and the theme the host asked for by URL', any(m['type'] == 'tingly-design:theme-changed' and m['theme']['id'] == 'dark' for m in got), str(got))

        await pg.evaluate('got.length = 0; send({ type: "tingly-design:open", project: "tingly-intro" })')
        await pg.wait_for_function('got.some(m => m.type === "tingly-design:ready" && m.project === "tingly-intro")')
        check('the host can open a project', True)
        await fr.locator('.thumb[data-slide="box"]').click()
        await pg.wait_for_function('got.some(m => m.type === "tingly-design:location" && m.search.includes("s=box"))')
        loc = [m for m in await pg.evaluate('got') if m['type'] == 'tingly-design:location'][-1]
        check('moving inside a project tells the host the new address', loc['project'] == 'tingly-intro' and 'p=tingly-intro' in loc['search'], str(loc))
        await pg.screenshot(path=OUT + 'embed-host-slides.png')

        await pg.evaluate('got.length = 0; send({ type: "tingly-design:open", project: "../etc" })')
        await pg.wait_for_timeout(600)
        check('a project name that is not one is ignored', await pg.evaluate('got.length') == 0 and await fr.locator('.thumb').count() == 8)

        await pg.evaluate('got.length = 0; send({ type: "tingly-design:open", search: "?p=design-guide&t=workflow" })')
        await pg.wait_for_function('got.some(m => m.type === "tingly-design:ready" && m.project === "design-guide")')
        r = next(m for m in await pg.evaluate('got') if m['type'] == 'tingly-design:ready')
        check('the host can restore a full address it mirrored', 't=workflow' in r['search'], str(r))

        await pg.evaluate('got.length = 0; send({ type: "tingly-design:open", project: null })')
        await pg.wait_for_function('got.some(m => m.type === "tingly-design:ready" && m.project === null)')
        await fr.locator('.lcard[data-project]').first.wait_for()
        check('…or send it back to the launcher', True)

        await pg.evaluate('send({ type: "tingly-design:set-theme", theme: { palette: { mode: "light", primary: { main: "#D97757" } } } })')
        await pg.wait_for_function('got.some(m => m.type === "tingly-design:theme-changed" && m.theme.scheme === "light")')
        accent = await fr.locator('html').evaluate('h => getComputedStyle(h).getPropertyValue("--accent").trim()')
        check('the host\'s palette still themes the editor', accent.lower() == '#d97757', accent)
        await pg.screenshot(path=OUT + 'embed-host-launcher.png')

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    hs.shutdown()

    # --- lifecycle ---------------------------------------------------------------------------
    proc.stdin.close()
    try:
        proc.wait(5)
        gone = True
    except subprocess.TimeoutExpired:
        proc.kill()
        gone = False
    check('with DC_EXIT_WITH_STDIN=1 it exits when the host closes stdin', gone)

    proc2, _ = launch(projects)
    check('an existing projects folder is never reseeded', open(overview).read().count('- [x] Run `pnpm install`') == 1)
    proc2.terminate()
    try:
        proc2.wait(5)
        check('SIGTERM stops it', True)
    except subprocess.TimeoutExpired:
        proc2.kill()
        check('SIGTERM stops it', False)

    passed = sum(1 for _, ok in results if ok)
    print(f'\n{passed}/{len(results)} passed')
    if passed != len(results): raise SystemExit(1)

asyncio.run(main())
