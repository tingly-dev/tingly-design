"""End-to-end checks for exporting from the browser: a motion piece to a video file made in the tab
(no server, no ffmpeg), with progress and cancel, and embeds drawn there from the picture each frame
hands over when the machine has no Chrome. A new piece keeps it short.
Run with `pnpm dev` up: python3 e2e/export.py  (DC_CHROME=/path/to/chrome to use another Chromium)"""
import os, re, json, asyncio, subprocess
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('DC_URL', 'http://localhost:5173')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out') + '/'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('DC_CHROME')
PIECE = os.path.join(REPO, 'projects/zz-export')
EMBED = os.path.join(REPO, 'projects/zz-export-embed')
BOARD = os.path.join(REPO, 'projects/zz-export-board')
SOUND = os.path.join(REPO, 'projects/zz-export-sound')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames,r_frame_rate:format=duration', '-of', 'json', path], capture_output=True, text=True).stdout
    return json.loads(out)

async def main():
    os.makedirs(OUT, exist_ok=True)
    subprocess.run(['rm', '-rf', PIECE, EMBED, BOARD, SOUND])
    os.makedirs(PIECE + '/scenes')
    os.makedirs(EMBED + '/scenes')
    open(EMBED + '/motion.json', 'w').write(json.dumps({'v': 1, 'title': 'zz-export-embed', 'formats': {'wide': {'size': [1280, 720]}}, 'fps': 30, 'order': ['title'], 'audio': [], 'faces': {}}))
    open(EMBED + '/scenes/title.html', 'w').write('<section id="title" data-duration="2s" style="background:#14161c;padding:96px"><x-embed style="display:block;width:600px;height:300px"><div style="background:#ee3333;width:100%;height:100%"></div></x-embed></section>')
    # an artboard imported from a canvas (box-console's Glow, moving), behind a title
    os.makedirs(BOARD + '/scenes')
    os.makedirs(BOARD + '/uploads/box-console-Glow')
    subprocess.run(['cp', os.path.join(REPO, 'projects/box-console/Glow.dc.html'), BOARD + '/uploads/box-console-Glow/'])
    open(BOARD + '/motion.json', 'w').write(json.dumps({'v': 1, 'title': 'zz-export-board', 'formats': {'wide': {'size': [1280, 720]}}, 'fps': 30, 'order': ['glow'], 'audio': [], 'faces': {}}))
    open(BOARD + '/scenes/glow.html', 'w').write('<section id="glow" data-duration="2s" style="background:#0b1020;color:#fff;font-family:Arial,sans-serif;padding:96px"><x-embed src="uploads/box-console-Glow/Glow.dc.html" style="position:absolute;left:0px;top:0px;width:1280px;height:720px"></x-embed><h1 style="position:relative;font-size:80px">Glow</h1></section>')
    open(PIECE + '/motion.json', 'w').write(json.dumps({'v': 1, 'title': 'zz-export', 'formats': {'wide': {'size': [1920, 1080]}}, 'fps': 30, 'order': ['title'], 'audio': [], 'faces': {}}))
    open(PIECE + '/scenes/title.html', 'w').write('<section id="title" data-duration="2s" style="background:#14161c;color:#f4f1ea;font-family:Arial,sans-serif;padding:128px;display:flex;flex-direction:column;justify-content:center;gap:32px"><h1 data-in="rise 500ms" style="font-size:112px;font-weight:800">Export</h1><p data-in="fade 500ms" style="font-size:40px;color:#a9a59c">Made in the tab</p></section>')
    async with async_playwright() as p:
        b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
        ctx = await b.new_context(locale='en-US', viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'fonts.g' not in m.text and 'Failed to load resource' not in m.text and errs.append(m.text))

        # a piece with sound: two 2 s scenes and a 4 s tone that starts at 1 s
        os.makedirs(SOUND + '/scenes')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', SOUND + '/tone.wav'])
        open(SOUND + '/motion.json', 'w').write(json.dumps({'v': 1, 'title': 'zz-export-sound', 'formats': {'wide': {'size': [640, 360]}}, 'fps': 15, 'order': ['a', 'b'], 'audio': [{'src': 'tone.wav', 'start': 1, 'gain': 0}], 'faces': {}}))
        for sid in 'ab':
            open(SOUND + f'/scenes/{sid}.html', 'w').write(f'<section id="{sid}" data-duration="2s" style="background:#14161c;color:#f4f1ea;font:48px Arial;padding:48px">{sid}</section>')

        await pg.goto(BASE + '/?p=zz-export')
        await expect(pg.locator('.dashtitle')).to_have_text('zz-export')
        menu = pg.locator('button[aria-label="Import / Export"]')
        await expect(menu).to_be_enabled(timeout=15000)

        async def start(extra=None):
            """Import / Export → Video… → (options) → Export; the dialog opens on one summary line and the options folded."""
            await menu.click()
            await pg.get_by_role('menuitem', name='Video…').click()
            dlg = pg.get_by_role('dialog', name='Export video')
            await expect(dlg).to_be_visible()
            if extra: await extra(dlg)
            await dlg.get_by_role('button', name='Export', exact=True).click()

        # --- the dialog: a summary and nothing else until asked ------------------------------------
        await menu.click()
        await pg.get_by_role('menuitem', name='Video…').click()
        dlg0 = pg.get_by_role('dialog', name='Export video')
        check('the dialog opens on a summary of the file it will make', 'MP4' in await dlg0.locator('[data-summary]').inner_text() and '1920×1080' in await dlg0.locator('[data-summary]').inner_text())
        check('…with the options folded away', await dlg0.locator('select').count() == 0)
        await dlg0.get_by_role('button', name='Cancel').click()
        await expect(dlg0).to_have_count(0)

        # --- export, and the file it makes --------------------------------------------------------
        async with pg.expect_download(timeout=120000) as dl:
            await start()
            await expect(pg.locator('button', has_text='Exporting')).to_be_visible()
            check('the button shows progress and offers cancel', await pg.locator('button', has_text='Cancel').count() == 1)
            # the readout keeps one size while the numbers change, so the bar around it does not move
            boxes = set()
            for _ in range(12):
                box = await pg.evaluate("() => { const e = document.querySelector('[data-export-progress]'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.right)] }")
                if box: boxes.add(tuple(box))
                await pg.wait_for_timeout(80)
            check('the progress readout keeps its size and place while it counts', len(boxes) == 1, str(boxes))
        d = await dl.value
        path = OUT + d.suggested_filename
        await d.save_as(path)
        done_toast = pg.locator('.toast', has_text='Made in this tab')
        check('the saved message says which route made the file, how long it took and what took longest', await done_toast.count() >= 1 and 'most time went to' in (await done_toast.first.inner_text()), str(await pg.locator('.toast').all_inner_texts()))
        info = probe(path)
        v = next(s for s in info['streams'] if s.get('width'))
        check('a video file is saved, named for the piece and size', d.suggested_filename.startswith('zz-export-wide.') and d.suggested_filename.split('.')[-1] in ('mp4', 'webm'), d.suggested_filename)
        check('it is the piece\'s size', (v['width'], v['height']) == (1920, 1080), str(v))
        check('it runs as long as the piece', 1.8 < float(info['format']['duration']) < 2.3, str(info['format']))
        # a frame from the middle is not blank
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '0.5', '-i', path, '-frames:v', '1', OUT + 'export-frame.png'])
        sig = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', OUT + 'export-frame.png', '-vf', 'scale=16:9,format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
        check('the frame has something drawn on it', len(set(sig)) > 3, str(sorted(set(sig))[:6]))
        await expect(pg.locator('button', has_text='Exporting')).to_have_count(0)
        check('the progress button goes away after saving', True)

        # --- the options: size, frame rate, quality, a single scene, GIF ------------------------------
        async def pick(dlg, **o):
            await dlg.get_by_role('button', name='More options').click()
            for label, value in o.items():
                await dlg.get_by_label(label.replace('_', ' ')).select_option(value)
        async with pg.expect_download(timeout=120000) as dl3:
            await start(lambda dlg: pick(dlg, Format='webm', Size='720', Frame_rate='24', Quality='low'))
        d3 = await dl3.value
        p3 = OUT + d3.suggested_filename
        await d3.save_as(p3)
        i3 = probe(p3)
        v3 = next(s for s in i3['streams'] if s.get('width'))
        check('a smaller size and frame rate are honoured', (v3['width'], v3['height']) == (1280, 720) and v3['r_frame_rate'] == '24/1' and d3.suggested_filename.endswith('-720p.webm'), f'{v3} {d3.suggested_filename}')
        check('the file is smaller at low quality and 720p', os.path.getsize(p3) < os.path.getsize(path), (os.path.getsize(p3), os.path.getsize(path)))
        # the options of that video come back next time, and a GIF does not change them
        await menu.click()
        await pg.get_by_role('menuitem', name='Video…').click()
        dlgR = pg.get_by_role('dialog', name='Export video')
        summaryR = await dlgR.locator('[data-summary]').inner_text()
        check('the last video\'s format, size and frame rate are the next starting point', 'WebM' in summaryR and '1280×720' in summaryR and '24 fps' in summaryR, summaryR)
        await dlgR.get_by_role('button', name='Cancel').click()
        async with pg.expect_download(timeout=120000) as dl4:
            await start(lambda dlg: pick(dlg, Format='gif'))
        d4 = await dl4.value
        p4 = OUT + d4.suggested_filename
        await d4.save_as(p4)
        check('GIF makes a real GIF, small by default', open(p4, 'rb').read(6) in (b'GIF87a', b'GIF89a') and d4.suggested_filename.endswith('.gif'), d4.suggested_filename)
        v4 = next(s for s in probe(p4)['streams'] if s.get('width'))
        check('…at 480 lines, not the piece\'s 1080', v4['height'] == 480, str(v4))

        # --- the menu's own GIF… entry: the same dialog, GIF already chosen and the options open ---------
        await menu.click()
        await pg.get_by_role('menuitem', name='GIF…').click()
        dlg5 = pg.get_by_role('dialog', name='Export video')
        check('GIF… opens the dialog with GIF chosen, small and slow by default', await dlg5.get_by_label('Format').input_value() == 'gif' and 'GIF' in await dlg5.locator('[data-summary]').inner_text() and '15 fps' in await dlg5.locator('[data-summary]').inner_text(), await dlg5.locator('[data-summary]').inner_text())
        async with pg.expect_download(timeout=120000) as dl5:
            await dlg5.get_by_role('button', name='Export', exact=True).click()
        d5 = await dl5.value
        p5 = OUT + d5.suggested_filename
        await d5.save_as(p5)
        check('…and exports a GIF in one click', open(p5, 'rb').read(6) in (b'GIF87a', b'GIF89a') and d5.suggested_filename.endswith('-480p.gif'), d5.suggested_filename)

        # --- cancel -------------------------------------------------------------------------------
        # two seconds export in well under one now, before the click lands: a long piece leaves time to cancel
        open(PIECE + '/scenes/title.html', 'w').write(open(PIECE + '/scenes/title.html').read().replace('data-duration="2s"', 'data-duration="60s"'))
        await pg.reload()
        await expect(menu).to_be_enabled(timeout=15000)
        await pg.evaluate("localStorage.removeItem('dc.videoOptions')")
        await start()
        await pg.locator('button', has_text='Cancel').click()
        await expect(pg.locator('.toast', has_text='cancelled')).to_be_visible(timeout=30000)
        await expect(pg.locator('button', has_text='Exporting')).to_have_count(0)
        check('cancel stops the export and says so', True)

        await pg.evaluate("localStorage.removeItem('dc.videoOptions')")
        # --- a piece with an embed goes to the server's Chrome by itself -------------------------------
        await pg.goto(BASE + '/?p=zz-export-embed')
        await expect(pg.locator('.dashtitle')).to_have_text('zz-export-embed')
        await expect(menu).to_be_enabled(timeout=15000)
        await pg.wait_for_timeout(1500)
        await menu.click()
        await pg.get_by_role('menuitem', name='Video…').click()
        dlg2 = pg.get_by_role('dialog', name='Export video')
        check('a piece Chrome draws says so, and still offers the options', 'Chrome on this machine' in await dlg2.inner_text() and await dlg2.get_by_role('button', name='More options').count() == 1)
        await dlg2.get_by_role('button', name='More options').click()
        fmts = await dlg2.get_by_label('Format').locator('option').all_inner_texts()
        check('…MP4 and GIF, no WebM or automatic', fmts == ['MP4', 'GIF'], fmts)
        async with pg.expect_download(timeout=120000) as dl2:
            await dlg2.get_by_role('button', name='Export', exact=True).click()
            await expect(pg.locator('.toast', has_text='Chrome on this machine')).to_be_visible(timeout=15000)
        d2 = await dl2.value
        path2 = OUT + d2.suggested_filename
        await d2.save_as(path2)
        check('an embed piece is drawn by the server, as an MP4', d2.suggested_filename == 'zz-export-embed-wide.mp4', d2.suggested_filename)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '1', '-i', path2, '-frames:v', '1', OUT + 'export-embed-frame.png'])
        px = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', OUT + 'export-embed-frame.png', '-vf', 'crop=1:1:300:300,format=rgb24', '-f', 'rawvideo', '-'], capture_output=True).stdout
        check('the embed is on the frame, not blank', len(px) == 3 and px[0] > 180 and px[1] < 100, str(list(px)))
        # the server route honours size and frame rate, and makes a GIF
        await menu.click()
        await pg.get_by_role('menuitem', name='Video…').click()
        dlg6 = pg.get_by_role('dialog', name='Export video')
        await dlg6.get_by_role('button', name='More options').click()
        await dlg6.get_by_label('Format').select_option('mp4')
        await dlg6.get_by_label('Size').select_option('360')
        await dlg6.get_by_label('Frame rate').select_option('24')
        async with pg.expect_download(timeout=120000) as dl7:
            await dlg6.get_by_role('button', name='Export', exact=True).click()
        d7 = await dl7.value
        p7 = OUT + d7.suggested_filename
        await d7.save_as(p7)
        v7 = next(s for s in probe(p7)['streams'] if s.get('width'))
        check('the server route honours size and frame rate', (v7['width'], v7['height']) == (640, 360) and v7['r_frame_rate'] == '24/1' and d7.suggested_filename.endswith('-360p.mp4'), f'{v7} {d7.suggested_filename}')
        await menu.click()
        await pg.get_by_role('menuitem', name='GIF…').click()
        dlg8 = pg.get_by_role('dialog', name='Export video')
        async with pg.expect_download(timeout=120000) as dl8:
            await dlg8.get_by_role('button', name='Export', exact=True).click()
        d8 = await dl8.value
        p8 = OUT + d8.suggested_filename
        await d8.save_as(p8)
        v8 = next(s for s in probe(p8)['streams'] if s.get('width'))
        check('the server route makes a GIF, 480 lines by default', open(p8, 'rb').read(6) in (b'GIF87a', b'GIF89a') and v8['height'] == 480 and d8.suggested_filename == 'zz-export-embed-wide-480p.gif', f'{v8} {d8.suggested_filename}')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', p8, '-frames:v', '1', OUT + 'export-embed-gif.png'])
        px8 = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', OUT + 'export-embed-gif.png', '-vf', 'crop=1:1:100:100,format=rgb24', '-f', 'rawvideo', '-'], capture_output=True).stdout
        check('…with the embed on the GIF\'s frame', len(px8) == 3 and px8[0] > 180 and px8[1] < 100, str(list(px8)))

        await pg.evaluate("localStorage.removeItem('dc.videoOptions')")
        # --- without Chrome and ffmpeg, the tab draws embeds from the picture each one hands over -------
        await pg.route('**/api/render', lambda r: r.fulfill(json={'chrome': False, 'ffmpeg': False}))
        async def in_tab(project):
            await pg.goto(BASE + '/?p=' + project)
            await expect(pg.locator('.dashtitle')).to_have_text(project)
            await expect(menu).to_be_enabled(timeout=15000)
            await pg.wait_for_timeout(1500)
            await menu.click()
            await pg.get_by_role('menuitem', name='Video…').click()
            dlg = pg.get_by_role('dialog', name='Export video')
            async with pg.expect_download(timeout=120000) as dl:
                await dlg.get_by_role('button', name='Export', exact=True).click()
            d = await dl.value
            path = OUT + 'tab-' + d.suggested_filename
            await d.save_as(path)
            png = path + '.png'
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '1', '-i', path, '-frames:v', '1', png])
            return png
        p9 = await in_tab('zz-export-embed')
        px9 = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', p9, '-vf', 'crop=1:1:300:300,format=rgb24', '-f', 'rawvideo', '-'], capture_output=True).stdout
        check('with no Chrome, a video made in the tab has the embed on the frame', len(px9) == 3 and px9[0] > 180 and px9[1] < 100, str(list(px9)))
        check('…and does not warn that it is blank', await pg.locator('.toast', has_text='blank').count() == 0)
        p10 = await in_tab('zz-export-board')
        # Glow is coloured light on #0b1020: drawn, the frame's 8×8 average spans far more than the plain background
        g = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', p10, '-vf', 'scale=8:8,format=rgb24', '-f', 'rawvideo', '-'], capture_output=True).stdout
        spread = max(g) - min(g) if g else 0
        check('…and an artboard imported from a canvas too', len(g) == 192 and spread > 60, f'spread {spread}')
        await pg.unroute('**/api/render')

        # --- one scene keeps its share of the sound -------------------------------------------------------
        def level(path, a, b):
            out = subprocess.run(['ffmpeg', '-hide_banner', '-ss', str(a), '-t', str(b - a), '-i', path, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
            m = re.search(r'mean_volume: (-?[\d.]+|-inf) dB', out)
            return -99.0 if not m or m.group(1) == '-inf' else float(m.group(1))
        await pg.goto(BASE + '/?p=zz-export-sound')
        await expect(pg.locator('.dashtitle')).to_have_text('zz-export-sound')
        await expect(menu).to_be_enabled(timeout=15000)
        await pg.wait_for_timeout(1500)
        for scene, quiet, loud in (('whole', (0.0, 0.8), (1.2, 3.9)), ('a', (0.0, 0.8), (1.2, 1.9)), ('b', None, (0.1, 1.9))):
            await pg.locator('.mscene', has_text=scene if scene != 'whole' else 'a').first.click()
            await menu.click()
            await pg.get_by_role('menuitem', name='Video…').click()
            dlg = pg.get_by_role('dialog', name='Export video')
            await dlg.get_by_role('button', name='More options').click()
            if scene != 'whole': await dlg.get_by_label('Range').select_option('scene')
            await dlg.get_by_label('Format').select_option('mp4')
            check(f'scene {scene}: the dialog no longer says a scene comes out silent', 'without sound' not in await dlg.inner_text())
            async with pg.expect_download(timeout=120000) as dls:
                await dlg.get_by_role('button', name='Export', exact=True).click()
            ds = await dls.value
            ps = OUT + ds.suggested_filename
            await ds.save_as(ps)
            if not any(x.get('codec_type') == 'audio' for x in probe(ps)['streams']):
                print(f'SKIP scene {scene}: this browser cannot write an audio track (no AudioEncoder), so there is no mix to check')
                continue
            if quiet: check(f'scene {scene}: the tone starts when it does on the timeline', level(ps, *quiet) < -50, level(ps, *quiet))
            check(f'scene {scene}: …and is heard after that', level(ps, *loud) > -30, level(ps, *loud))
        # the same on the server's Chrome (b: the clip began before the scene and is joined part-way in)
        import urllib.request
        for scene, lo, hi in (('a', 0, 2000), ('b', 2000, 4000)):
            req = urllib.request.Request(f'{BASE}/api/projects/zz-export-sound/render', data=json.dumps({'format': 'wide', 'container': 'mp4', 'from': lo, 'to': hi}).encode(), headers={'content-type': 'application/json'})
            lines = urllib.request.urlopen(req, timeout=180).read().decode().strip().split('\n')
            done = [json.loads(l) for l in lines if '"done"' in l]
            if not done:
                check(f'server, scene {scene}: made a file', False, lines[-1:])
                continue
            fp = os.path.join(SOUND, 'renders', done[0]['done'])
            check(f'server, scene {scene}: sound is cut to the scene', level(fp, 1.2, 1.9) > -30 and (scene == 'b' or level(fp, 0.0, 0.8) < -50), (level(fp, 1.2, 1.9), level(fp, 0.0, 0.8)))

        check('no page errors', not errs, '\n'.join(errs[:5]))
        await b.close()
    subprocess.run(['rm', '-rf', PIECE, EMBED, BOARD, SOUND])
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    if failed: raise SystemExit(1)

try:
    asyncio.run(main())
finally:
    # a crash or a timeout must not leave zz-* projects behind: the next suite (embed) lists the samples
    subprocess.run(['rm', '-rf', PIECE, EMBED, BOARD, SOUND])
