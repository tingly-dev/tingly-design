"""An edit made outside the page (an agent, a terminal, git) shows up in an open editor of every kind, with no reload.
The suite writes straight into the file, the way Claude Code does, and waits for the new text on screen.
It also replaces a picture an artboard or a slide shows (uploads/pic.svg) and waits for the new picture.
Run with `pnpm dev` up: python3 e2e/external_edit.py (or pnpm e2e external_edit). Leaves the sample projects as committed."""
import asyncio, os, subprocess, time
from playwright.async_api import async_playwright

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')

# kind -> (sample project, file, text on screen at first, what the edit turns it into)
CASES = {
    'design': ('box-console', 'Flow.dc.html', 'Translated', 'Translated by hand'),
    'slides': ('tingly-intro', 'slides/cover.html', 'Meet Tingly', 'Met Tingly outside'),
    'design-system': ('tingly-ds', 'README.md', 'Tingly Design System', 'Tingly Design System outside'),
    'dashboard': ('box-usage', 'files/index.html', 'Gateway usage', 'Gateway usage outside'),
    'docs': ('design-guide', 'tabs/overview.md', 'Tingly Design handbook', 'Tingly Design handbook outside'),
    'motion': ('design-motion', 'scenes/cover.html', 'Tingly Design', 'Tingly Design outside'),
}

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def restore(project): subprocess.run(['git', 'checkout', '--', f'projects/{project}'], cwd=REPO)

async def shown(pg, text, timeout=8.0):
    """Is the text on the page or in any of its frames (artboards, slides and scenes live in iframes)?"""
    t = time.time()
    while time.time() - t < timeout:
        for fr in pg.frames:
            try:
                if await fr.get_by_text(text, exact=False).count(): return True
            except Exception: pass
        await asyncio.sleep(0.3)
    return False

# kind -> (sample project, file, text after which the picture goes in)
PICTURES = {
    'design': ('box-console', 'Flow.dc.html', '<x-dc>\n'),
    'slides': ('tingly-intro', 'slides/cover.html', '>\n'),
}
SVG = lambda color: f'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="{color}"/></svg>'

async def picture_bytes(pg):
    """A screenshot of the first picture in any frame of the page."""
    for fr in pg.frames:
        try:
            el = await fr.query_selector('img[src*="uploads/pic.svg"]')
            if el: return await el.screenshot()
        except Exception: pass
    return None

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        for kind, (project, file, old, new) in CASES.items():
            path = os.path.join(REPO, 'projects', project, file)
            pg = await b.new_page(viewport={'width': 1440, 'height': 900})
            try:
                await pg.goto(f'{BASE}/?p={project}')
                await pg.wait_for_timeout(2500)
                check(f'{kind}: the sample shows "{old}"', await shown(pg, old))
                src = open(path, encoding='utf-8').read()
                open(path, 'w', encoding='utf-8').write(src.replace(old, new, 1))
                check(f'{kind}: an outside edit appears with no reload', await shown(pg, new))
            finally:
                restore(project)
                await pg.close()
        for kind, (project, file, after) in PICTURES.items():
            root = os.path.join(REPO, 'projects', project)
            path = os.path.join(root, file)
            pic = os.path.join(root, 'uploads', 'pic.svg')
            pg = await b.new_page(viewport={'width': 1440, 'height': 900})
            try:
                os.makedirs(os.path.dirname(pic), exist_ok=True)
                open(pic, 'w').write(SVG('red'))
                src = open(path, encoding='utf-8').read()
                i = src.index(after, src.index('<section') if kind == 'slides' else 0) + len(after)
                open(path, 'w', encoding='utf-8').write(src[:i] + '<img src="uploads/pic.svg" style="position:absolute;left:0;top:0;width:40px;height:40px;z-index:9">' + src[i:])
                await pg.goto(f'{BASE}/?p={project}')
                await pg.wait_for_timeout(3000)
                first = await picture_bytes(pg)
                check(f'{kind}: the picture is on screen', first is not None)
                open(pic, 'w').write(SVG('blue'))
                changed = False
                for _ in range(20):
                    await pg.wait_for_timeout(300)
                    now = await picture_bytes(pg)
                    if now is not None and now != first: changed = True; break
                check(f'{kind}: a picture replaced outside shows with no reload', changed)
            finally:
                restore(project)
                if os.path.exists(pic): os.remove(pic)
                try: os.rmdir(os.path.dirname(pic))
                except OSError: pass
                await pg.close()
        await b.close()

asyncio.run(main())
failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
raise SystemExit(1 if failed else 0)
