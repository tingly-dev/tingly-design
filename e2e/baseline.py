"""Screenshot baselines for the editor itself: the launcher and every kind's sample, in light and dark, English and
Chinese, compared with the pictures on the `e2e-baselines` branch. Run with `pnpm dev` up: python3 e2e/baseline.py

A picture counts as the same when fewer than 0.2% of its pixels differ by more than a little (antialiasing and font
hinting move single pixels); a different one is kept with a diff beside it in e2e/out/baseline/ for a person to look
at. A picture with no baseline yet passes and says so. Baselines depend on the machine's fonts and Chromium, so they
are recorded where they are compared: DC_RECORD=1 writes every picture to e2e/out/baselines-new/ without comparing,
and the E2E patrol workflow run by hand with "record baselines" pushes that folder to the branch. DC_BASELINES=<folder> compares against
a folder instead of the branch."""
import os, re, sys, asyncio, base64, shutil, subprocess
from playwright.async_api import async_playwright

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
CHROME = os.environ.get('DC_CHROME')
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'out', 'baseline')
NEW = os.path.join(HERE, 'out', 'baselines-new')
RECORD = os.environ.get('DC_RECORD') == '1'
BRANCH = 'e2e-baselines'
SCREENS = {'launcher': '', 'canvas': 'tingly-box-console-canvas', 'slides': 'tingly-design-intro-slides', 'design-system': 'tingly-design-system',
           'dashboard': 'tingly-box-usage-dashboard', 'docs': 'tingly-design-guide-doc', 'motion': 'tingly-design-motion'}
# the same kinds with the request bar moved into the conversation column on the left
LEFT = {f'{k}-left': v for k, v in SCREENS.items() if v}
LOOKS = [('light', 'en'), ('dark', 'en'), ('light', 'zh'), ('dark', 'zh')]
# open states of the editor's chrome, not only the first screen: project, then how to reach the state
STATES = {'canvas-theme-tab': ('tingly-box-console-canvas', 'theme'), 'canvas-shortcuts': ('tingly-box-console-canvas', 'shortcuts')}
# a pixel differs when a channel moves by more than this; a picture differs when more than this share of pixels do
PIXEL, SHARE = 24, 0.002

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def baselines():
    """The folder to compare with: DC_BASELINES, or the branch's pictures fetched into e2e/out/baselines/."""
    if os.environ.get('DC_BASELINES'): return os.environ['DC_BASELINES']
    dest = os.path.join(HERE, 'out', 'baselines')
    shutil.rmtree(dest, ignore_errors=True); os.makedirs(dest)
    if subprocess.run(['git', 'fetch', '-q', 'origin', BRANCH], cwd=REPO, capture_output=True).returncode == 0:
        tar = subprocess.run(['git', 'archive', 'FETCH_HEAD'], cwd=REPO, capture_output=True).stdout
        subprocess.run(['tar', '-x', '-C', dest], input=tar)
    return dest

# in the page: how many pixels of two same-sized PNGs differ, and a picture of where (red on a faded copy)
COMPARE = """async ([a, b, pixel]) => {
  const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
  const [x, y] = await Promise.all([load(a), load(b)]);
  if (x.width !== y.width || x.height !== y.height) return { size: [x.width, x.height, y.width, y.height] };
  const c = document.createElement('canvas'); c.width = x.width; c.height = x.height;
  const g = c.getContext('2d');
  g.drawImage(x, 0, 0); const p = g.getImageData(0, 0, c.width, c.height);
  g.drawImage(y, 0, 0); const q = g.getImageData(0, 0, c.width, c.height);
  let n = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    const d = Math.max(Math.abs(p.data[i] - q.data[i]), Math.abs(p.data[i + 1] - q.data[i + 1]), Math.abs(p.data[i + 2] - q.data[i + 2]));
    if (d > pixel) { n++; q.data[i] = 255; q.data[i + 1] = 0; q.data[i + 2] = 0; q.data[i + 3] = 255; }
    else q.data[i + 3] = 60;
  }
  g.clearRect(0, 0, c.width, c.height); g.putImageData(q, 0, 0);
  return { differ: n, total: p.data.length / 4, diff: c.toDataURL('image/png') };
}"""

STILL = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'

async def main():
    ref = None if RECORD else baselines()
    os.makedirs(OUT, exist_ok=True)
    if RECORD: shutil.rmtree(NEW, ignore_errors=True); os.makedirs(NEW)
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        scratch = await b.new_page()
        for scheme, lang in LOOKS:
            ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, color_scheme=scheme, reduced_motion='reduce',
                                      locale='zh-CN' if lang == 'zh' else 'en-US')
            pg = await ctx.new_page()
            for screen, project in {**SCREENS, **LEFT, **{k: v[0] for k, v in STATES.items()}}.items():
                name = f'{screen}-{scheme}-{lang}.png'
                left = screen in LEFT
                # a page's own frames are sandboxed and have no storage, so the write is guarded
                await pg.add_init_script(f"try {{ localStorage.setItem('dc.barMode', '{'left' if left else 'float'}') }} catch (e) {{}}")
                await pg.goto(f'{BASE}/?lang={lang}' + (f'&p={project}' if project else ''))
                # the editor keeps a live connection open, so the network may never fall quiet; wait for it a while
                try: await pg.wait_for_load_state('networkidle', timeout=3000)
                except Exception: pass
                await pg.add_style_tag(content=STILL)
                await pg.wait_for_timeout(2500)
                if left: check(f'{name}: the column is open with the work beside it', await pg.locator('.chat-panel').count() == 1)
                if screen in STATES:
                    if STATES[screen][1] == 'theme':
                        await pg.get_by_role('tab', name=re.compile('^(Theme|主题)$')).click()
                    else:
                        await pg.evaluate('document.activeElement && document.activeElement.blur()')
                        await pg.keyboard.press('?')
                        check(f'{name}: the shortcuts dialog is open', await pg.locator('.shortcutsdlg').count() == 1)
                    await pg.wait_for_timeout(500)
                shot = await pg.screenshot()
                open(os.path.join(OUT, name), 'wb').write(shot)
                if RECORD: open(os.path.join(NEW, name), 'wb').write(shot)
                if RECORD:  # recording replaces the baselines, so a changed picture is what is wanted here
                    check(f'{name} recorded', True)
                    continue
                known = os.path.join(ref, name)
                if not os.path.exists(known):
                    check(f'{name}: no baseline yet', True)
                    continue
                url = lambda data: 'data:image/png;base64,' + base64.b64encode(data).decode()
                r = await scratch.evaluate(COMPARE, [url(open(known, 'rb').read()), url(shot), PIXEL])
                if 'size' in r:
                    check(f'{name} matches its baseline', False, f'size changed: {r["size"]}')
                    continue
                same = r['differ'] <= SHARE * r['total']
                if not same: open(os.path.join(OUT, name.replace('.png', '-diff.png')), 'wb').write(base64.b64decode(r['diff'].split(',')[1]))
                check(f'{name} matches its baseline', same, f'{r["differ"]} pixels ({100 * r["differ"] / r["total"]:.2f}%) differ; see e2e/out/baseline/')
            await ctx.close()
        await b.close()
    if RECORD: print(f'\nrecorded {len(os.listdir(NEW))} pictures in {os.path.relpath(NEW, REPO)}')
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)

asyncio.run(main())
