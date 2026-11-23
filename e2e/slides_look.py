"""The open deck looks at what Claude Code drew (.design/slides-self-check.md), with the stand-in `claude` (e2e/fake-claude):
a request makes it write a slide with a placeholder left in, a broken word and content that stops early, then wait for
`.runs.json` the way SLIDES_SYSTEM tells a model to. While the run is under way the open deck draws the changed slide,
runs the layout probe in it, keeps a picture in renders/look/ and writes the findings; the stand-in reads them before
its run ends. With no run under way, a hand edit writes no report.
Run with `pnpm dev` started with e2e/fake-claude first on PATH: python3 e2e/slides_look.py (or pnpm e2e slides_look)"""
import os, json, time, shutil, asyncio
from playwright.async_api import async_playwright

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
CHROME = os.environ.get('DC_CHROME')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.environ.get('FAKE_CLAUDE_LOG', '/tmp/fake-claude.log')
NAME = 'zz-slides-look'
DIR = os.path.join(REPO, 'projects', NAME)
RUNS = os.path.join(DIR, '.runs.json')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def calls(): return [json.loads(l) for l in open(LOG)] if os.path.exists(LOG) else []

PLAIN = 'background:#FFFFFF;color:#111111;font-family:Arial, sans-serif;padding:128px;display:flex;flex-direction:column;gap:48px'
COVER = f'<section id="cover" style="{PLAIN};justify-content:center"><h1 style="font-size:120px">Look back</h1></section>'
DRAFT = (f'<section id="draft" style="{PLAIN}"><h2 style="font-size:72px">Revenue grew</h2>'
         '<p style="font-size:32px">Revenue was [€__] this quarter.</p>'
         '<p style="font-size:32px;width:200px">Internationalisation</p></section>')

async def main():
    os.path.exists(LOG) and os.remove(LOG)
    shutil.rmtree(DIR, ignore_errors=True)
    os.makedirs(os.path.join(DIR, 'slides'))
    json.dump({'v': 4, 'title': 'Look back', 'cover': 'cover', 'order': ['cover'], 'faces': {}, 'designSystems': []}, open(os.path.join(DIR, 'deck.json'), 'w'))
    open(os.path.join(DIR, 'slides', 'cover.html'), 'w').write(COVER + '\n')
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            pg = await b.new_page(locale='en-US', viewport={'width': 1440, 'height': 900})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(f'{BASE}/?p={NAME}&lang=en')
            await pg.wait_for_selector('.topbar')
            await pg.wait_for_timeout(2000)

            # a hand edit with no run under way: nothing is looked at
            open(os.path.join(DIR, 'slides', 'cover.html'), 'w').write(COVER.replace('Look back', 'Look back now') + '\n')
            await pg.wait_for_timeout(4000)
            check('with no Claude Code run, an edit writes no report', not os.path.exists(RUNS))

            rel = f'projects/{NAME}'
            deck = json.dumps({'v': 4, 'title': 'Look back', 'cover': 'cover', 'order': ['cover', 'draft'], 'faces': {}, 'designSystems': []})
            request = (f'Add a slide.\nFAKE_WRITE: {rel}/slides/draft.html\n{DRAFT}\nFAKE_END\n'
                       f'FAKE_WRITE: {rel}/deck.json\n{deck}\nFAKE_END\nFAKE_WAIT: {rel}/.runs.json')
            await pg.get_by_role('button', name='Claude Code', exact=True).click()
            await pg.locator('.prompt textarea').fill(request)
            await pg.locator('.prompt .send').click()
            t = time.time()
            while time.time() - t < 45 and not any(c['ev'] == 'end' for c in calls()): await asyncio.sleep(0.3)
            log = calls()
            read = next((c for c in log if c['ev'] == 'read'), None)
            check('the run wrote the slide', any(c['ev'] == 'wrote' and c['path'].endswith('draft.html') for c in log), json.dumps(log)[:300])
            check('the open deck wrote .runs.json while the run waited for it', read is not None and read['text'], json.dumps(read)[:300])
            runs = json.loads(read['text']) if read and read['text'] else {}
            slides = {s['id']: s for s in runs.get('slides', [])}
            check('the report is a deck\'s, with every shown slide', runs.get('kind') == 'slides' and set(slides) == {'cover', 'draft'}, json.dumps(runs)[:300])
            rules = {f['rule'] for f in slides.get('draft', {}).get('problems', [])}
            check('the changed slide\'s layout warnings are the ones check gives', {'broken', 'short'} <= rules, str(rules))
            check('a slide with nothing wrong has no warnings', slides.get('cover', {}).get('problems') == [], json.dumps(slides.get('cover')))
            check('a placeholder left on a slide is listed under the deck', any(d['rule'] == 'placeholder' and d['file'] == 'slides/draft.html' for d in runs.get('deck', [])), json.dumps(runs.get('deck')))
            pic = os.path.join(DIR, slides.get('draft', {}).get('picture', '-'))
            check('a picture of the slide is kept where the report says', slides.get('draft', {}).get('picture') == 'renders/look/draft.png' and os.path.exists(pic) and open(pic, 'rb').read(8) == b'\x89PNG\r\n\x1a\n', pic)
            check('the editor threw nothing', not errs, '; '.join(errs)[:300])
            await b.close()
    finally:
        shutil.rmtree(DIR, ignore_errors=True)

asyncio.run(main())
failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
raise SystemExit(1 if failed else 0)
