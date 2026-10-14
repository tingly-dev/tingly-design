"""End-to-end checks for exporting from the browser: a motion piece to a video file made in the tab
(no server, no ffmpeg), with progress and cancel. A new piece keeps it short.
Run with `pnpm dev` up: python3 e2e/export.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, json, asyncio, subprocess
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')
PIECE = os.path.join(REPO, 'projects/zz-export')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames:format=duration', '-of', 'json', path], capture_output=True, text=True).stdout
    return json.loads(out)

async def main():
    os.makedirs(OUT, exist_ok=True)
    subprocess.run(['rm', '-rf', PIECE])
    os.makedirs(PIECE + '/scenes')
    open(PIECE + '/motion.json', 'w').write(json.dumps({'v': 1, 'title': 'zz-export', 'formats': {'wide': {'size': [1920, 1080]}}, 'fps': 30, 'order': ['title'], 'audio': [], 'faces': {}}))
    open(PIECE + '/scenes/title.html', 'w').write('<section id="title" data-duration="2s" style="background:#14161c;color:#f4f1ea;font-family:Arial,sans-serif;padding:128px;display:flex;flex-direction:column;justify-content:center;gap:32px"><h1 data-in="rise 500ms" style="font-size:112px;font-weight:800">Export</h1><p data-in="fade 500ms" style="font-size:40px;color:#a9a59c">Made in the tab</p></section>')
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and errs.append(m.text))

        await pg.goto(BASE + '/?p=zz-export')
        await expect(pg.locator('.dashtitle')).to_have_text('zz-export')
        btn = pg.locator('button', has_text='Export video')
        await expect(btn).to_be_enabled(timeout=15000)

        # --- export, and the file it makes --------------------------------------------------------
        async with pg.expect_download(timeout=120000) as dl:
            await btn.click()
            await expect(pg.locator('button', has_text='Exporting')).to_be_visible()
            check('the button shows progress and offers cancel', await pg.locator('button', has_text='Cancel').count() == 1)
        d = await dl.value
        path = OUT + d.suggested_filename
        await d.save_as(path)
        info = probe(path)
        v = next(s for s in info['streams'] if s.get('width'))
        check('a video file is saved, named for the piece and size', d.suggested_filename.startswith('zz-export-wide.') and d.suggested_filename.split('.')[-1] in ('mp4', 'webm'), d.suggested_filename)
        check('it is the piece\'s size', (v['width'], v['height']) == (1920, 1080), str(v))
        check('it runs as long as the piece', 1.8 < float(info['format']['duration']) < 2.3, str(info['format']))
        # a frame from the middle is not blank
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '0.5', '-i', path, '-frames:v', '1', OUT + 'export-frame.png'])
        sig = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', OUT + 'export-frame.png', '-vf', 'scale=16:9,format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
        check('the frame has something drawn on it', len(set(sig)) > 3, str(sorted(set(sig))[:6]))
        await expect(pg.locator('button', has_text='Export video')).to_be_enabled()
        check('the button comes back after saving', True)

        # --- cancel -------------------------------------------------------------------------------
        await pg.locator('button', has_text='Export video').click()
        await pg.locator('button', has_text='Cancel').click()
        await expect(pg.locator('.toast', has_text='cancelled')).to_be_visible(timeout=30000)
        await expect(pg.locator('button', has_text='Export video')).to_be_enabled()
        check('cancel stops the export and says so', True)

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    subprocess.run(['rm', '-rf', PIECE])
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

asyncio.run(main())
