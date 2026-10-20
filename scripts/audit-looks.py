"""How closely each look matches html-ppt: the first two slides of its demo deck, drawn by html-ppt with the
theme and by a new design system from the look (the same markup on `lk-` classes, only tokens.css and
components/bundle.css loaded), compared pixel by pixel. See .design/design-system-looks.md §5.

  python3 scripts/audit-looks.py <html-ppt folder> [out folder] [look,look,…]

Needs `pnpm dev` running (DC_URL, default http://localhost:5173) and Python Playwright (DC_CHROME for
another Chromium). Prints the mean difference per look and slide (0–255) and keeps the screenshots, plus
each look drawn with a plain page colour over the body (`-f`), the way html-ppt's deck draws it."""
import asyncio, json, os, re, shutil, sys, urllib.request
from playwright.async_api import async_playwright
from PIL import Image, ImageChops, ImageStat

HP = os.path.abspath(sys.argv[1])
OUT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else 'looks-audit') + '/'
BASE = os.environ.get('DC_URL', 'http://localhost:5173')
CHROME = os.environ.get('DC_CHROME')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ids = sys.argv[3].split(',') if len(sys.argv) > 3 else sorted(f[:-4] for f in os.listdir(HP + '/assets/themes') if f.endswith('.css'))

deck = open(HP + '/examples/demo-deck/index.html', encoding='utf-8').read()
slides = re.findall(r'<section class="slide"[^>]*>(.*?)</section>', deck, re.S)[:2]
CLASSES = ['card-soft', 'card-outline', 'card-accent', 'card', 'pill-accent', 'pill', 'eyebrow', 'kicker', 'lede', 'divider-accent', 'divider', 'gradient-text', 'dim2', 'dim', 'mono', 'serif']
LAYOUT = '.row{display:flex;gap:24px;align-items:center}.row.wrap{flex-wrap:wrap}.grid{display:grid;gap:24px}.g3{grid-template-columns:repeat(3,1fr)}.mt-l{margin-top:32px}.mt-m{margin-top:18px}'

def ours(h):
    h = re.sub(r'<div class="(deck-header|deck-footer|notes)".*?</div>', '', h, flags=re.S)
    h = h.replace('class="h1', 'class="lk-h1').replace('class="h2', 'class="lk-h2')
    return re.sub(r'class="([^"]*)"', lambda m: 'class="' + ' '.join(('lk-' + c if c in CLASSES else c) for c in m.group(1).split() if not c.startswith('anim-')) + '"', h)

def page(folder, body, flat):
    extra = '.lk-page{background:var(--surface)}' if flat else ''
    return (f'<!doctype html><html><head><meta charset=utf-8><link rel=stylesheet href="file://{folder}/tokens.css">'
            f'<link rel=stylesheet href="file://{folder}/components/bundle.css"><style>{LAYOUT}{extra}'
            '.s{width:1920px;height:1080px}</style></head>'
            f'<body><div class="s lk-page">{body}</div></body></html>')

def post(body):
    req = urllib.request.Request(BASE + '/api/projects', json.dumps(body).encode(), {'content-type': 'application/json'})
    urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req).read()  # the local server, never a proxy

def diff(a, b):
    return sum(ImageStat.Stat(ImageChops.difference(Image.open(a).convert('RGB'), Image.open(b).convert('RGB'))).mean) / 3

async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        pg = await (await b.new_context(viewport={'width': 1920, 'height': 1080})).new_page()
        rows = []
        for look in ids:
            name = f'zz-audit-{look}'
            folder = os.path.join(REPO, 'projects', name)
            shutil.rmtree(folder, ignore_errors=True)
            post({'name': name, 'title': look, 'kind': 'design-system', 'look': look})
            try:
                for i in (0, 1):
                    await pg.goto('file://' + HP + '/examples/demo-deck/index.html')
                    await pg.evaluate("""([look, i]) => {
                      document.getElementById('theme-link').href = '../../assets/themes/' + look + '.css';
                      document.querySelectorAll('.slide').forEach((s, j) => s.classList.toggle('is-active', j === i));
                      document.querySelectorAll('[class*=anim-]').forEach((e) => { e.className = e.className.replace(/anim-[a-z-]+/g, ''); });
                    }""", [look, i])
                    await pg.wait_for_timeout(900)
                    await pg.screenshot(path=f'{OUT}{look}-{i}-html-ppt.png')
                    for flat in (False, True):
                        html = f'{OUT}{look}-{i}{"-f" if flat else ""}.html'
                        open(html, 'w', encoding='utf-8').write(page(folder, ours(slides[i]), flat))
                        await pg.goto('file://' + html)
                        await pg.wait_for_timeout(700)
                        await pg.screenshot(path=html[:-5] + '.png')
                    rows.append((look, i, diff(f'{OUT}{look}-{i}-html-ppt.png', f'{OUT}{look}-{i}.png'), diff(f'{OUT}{look}-{i}-html-ppt.png', f'{OUT}{look}-{i}-f.png')))
            finally:
                shutil.rmtree(folder, ignore_errors=True)
        await b.close()
    print('look                     slide  as shipped  page covered')
    for look, i, d, f in sorted(rows, key=lambda r: -r[2]):
        print(f'{look:24} {i:5}  {d:10.1f}  {f:12.1f}')

asyncio.run(main())
