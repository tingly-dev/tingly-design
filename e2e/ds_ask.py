"""End-to-end checks for a design system's request bar (it hands everything to Claude Code): a request from
every page reaches Claude Code with the page that is open and the theme the previews are drawn in, from the
bar at the bottom and from the conversation column on the left; the edit lands in the open page; and on a
machine where the claude command is not found the bar says why and offers the AI settings, where a path typed
by hand is tried as it is typed, saved, and from then on the requests are handed to it.
Run after `pnpm build`: python3 e2e/ds_ask.py  (DC_CHROME=/path/to/chrome to use another Chromium)
Starts its own servers (production mode, PORT=0) on a fresh projects folder with a stand-in `claude`, so it
needs neither `pnpm dev` nor an API key."""
import os, sys, asyncio, json, subprocess, tempfile, threading, time, shutil
from playwright.async_api import async_playwright, expect

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get('DC_CHROME')

results = []
def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  :: {extra}' if extra and not ok else ''))

# the stand-in `claude` of run_feed.py, read from there so the two never drift
src = open(os.path.join(HERE, 'run_feed.py')).read()
FAKE_CLAUDE = src.split("FAKE_CLAUDE = r'''", 1)[1].split("'''", 1)[0]
# a machine whose `claude` command does not run
BROKEN_CLAUDE = '#!/bin/sh\nexit 1\n'

def start(tmp, projects, claude_src, log):
    bin_dir = os.path.join(tmp, 'bin' + str(len(os.listdir(tmp)))); os.makedirs(bin_dir)
    open(os.path.join(bin_dir, 'claude'), 'w').write(claude_src); os.chmod(os.path.join(bin_dir, 'claude'), 0o755)
    server = subprocess.Popen(
        [os.path.join(REPO, 'apps/server/node_modules/.bin/tsx'), 'src/index.ts'], cwd=os.path.join(REPO, 'apps/server'),
        env={**os.environ, 'NODE_ENV': 'production', 'PORT': '0', 'DC_PROJECTS': projects, 'DC_EXIT_WITH_STDIN': '1',
             'PATH': bin_dir + os.pathsep + os.environ['PATH'], 'FAKE_CLAUDE_LOG': log, 'DC_CONFIG': os.path.join(tmp, f'ai-{os.path.basename(bin_dir)}.json'),},
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    port = None; t = time.time()
    while time.time() - t < 30:
        line = server.stdout.readline()
        if line.startswith('TINGLY_DESIGN_READY '):
            port = json.loads(line.split(' ', 1)[1])['port']; break
        if not line and server.poll() is not None: break
    if not port: raise SystemExit('the server did not start')
    threading.Thread(target=lambda: [None for _ in server.stdout], daemon=True).start()
    return server, f'http://127.0.0.1:{port}'

def stop(server):
    try: server.stdin.close()
    except Exception: pass
    try: server.wait(timeout=10)
    except Exception: server.kill()

def requests(log):
    try: return [json.loads(l)['prompt'] for l in open(log) if l.strip()]
    except FileNotFoundError: return []

async def main():
    if not os.path.exists(os.path.join(REPO, 'apps/editor/dist/index.html')):
        raise SystemExit('no editor build: run pnpm build first')
    tmp = tempfile.mkdtemp(prefix='dc-dsask-')
    projects = os.path.join(tmp, 'projects')
    shutil.copytree(os.path.join(REPO, 'projects'), projects, ignore=shutil.ignore_patterns('.transcript.jsonl', '.claude-session.json'))
    log = os.path.join(tmp, 'claude.log')
    server, base = start(tmp, projects, FAKE_CLAUDE, log)
    server2 = None
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            pg = await b.new_page(locale='zh-CN', viewport={'width': 1440, 'height': 860})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(f'{base}/')
            await pg.evaluate("localStorage.setItem('dc.barMode', 'float')")

            # the bar at the bottom of the colors page, previewing the dark theme
            await pg.goto(f'{base}/?p=tingly-design-system&v=colors')
            await pg.wait_for_selector('.dsask textarea')
            await pg.locator('button[data-preview]').click()
            await pg.get_by_role('menuitemcheckbox', name='Dark').click()
            before = len(requests(log))
            await pg.locator('.dsask textarea').fill('让主色更暖一点')
            await pg.locator('.dsask textarea').press('Enter')
            await expect(pg.locator('.runfeed')).to_contain_text('Claude Code 完成', timeout=20000)
            sent = requests(log)
            check('a request from the colors page reaches Claude Code', len(sent) == before + 1 and '让主色更暖一点' in sent[-1])
            check('with the page that is open and what it shows', 'the colors page of the design system' in sent[-1] and 'tokens.json' in sent[-1], sent[-1][-400:])
            check('and the theme the previews are drawn in', 'theme "Dark" (dark)' in sent[-1], sent[-1][-400:])
            check('the design system is not called an artboard', 'artboard' not in sent[-1])
            check('the edit lands in the open design system', '<!-- run-feed -->' in open(os.path.join(projects, 'tingly-design-system', 'README.md')).read())

            # the conversation column: a request from the components page
            await pg.goto(f'{base}/')
            await pg.evaluate("localStorage.setItem('dc.barMode', 'left')")
            await pg.goto(f'{base}/?p=tingly-design-system&v=components')
            await pg.wait_for_selector('.chat-composer textarea')
            await pg.locator('.chat-composer textarea').fill('加一个 Tag 组件')
            await pg.locator('.chat-composer textarea').press('Enter')
            for _ in range(200):
                if len(requests(log)) > before + 1: break
                await asyncio.sleep(0.1)
            await expect(pg.locator('.turn').last).to_contain_text('加一个 Tag 组件', timeout=20000)
            sent = requests(log)
            check('a request from the conversation column reaches Claude Code', '加一个 Tag 组件' in sent[-1])
            check('with the components page that is open', 'the components page of the design system' in sent[-1] and 'components/<Comp>/README.md' in sent[-1], sent[-1][-400:])
            check('no page errors', not errs, errs)
            await b.close()
        stop(server); server = None

        # a machine where the claude command is not found: the bar says why and offers the settings
        log2 = os.path.join(tmp, 'claude2.log')
        server2, base2 = start(tmp, projects, BROKEN_CLAUDE, log2)
        good = os.path.join(tmp, 'good'); os.makedirs(good)
        open(os.path.join(good, 'claude'), 'w').write(FAKE_CLAUDE); os.chmod(os.path.join(good, 'claude'), 0o755)
        async with async_playwright() as p:
            b = await p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
            pg = await b.new_page(locale='zh-CN', viewport={'width': 1440, 'height': 860})
            await pg.goto(f'{base2}/')
            await pg.evaluate("localStorage.setItem('dc.barMode', 'float')")
            await pg.goto(f'{base2}/?p=tingly-design-system')
            await pg.wait_for_selector('.dsask textarea')
            check('without the claude command the box says so', '找不到 claude 命令' in (await pg.locator('.dsask textarea').get_attribute('placeholder') or ''))
            setup = pg.locator('.dsask .setup')
            check('and offers the AI settings', await setup.count() == 1)
            await pg.locator('.dsask textarea').fill('hi')
            check('sending stays off', await pg.locator('.dsask .send').is_disabled())
            await setup.click()
            dlg = pg.get_by_role('dialog')
            await expect(dlg).to_be_visible()
            check('the settings open from the bar', True)

            # the card says the command is missing in every tab, and a path can be typed
            claude = dlg.locator('[data-card=claude]')
            await expect(claude.locator('[data-command-status=missing]')).to_be_visible()
            check('the Claude Code card says the command is missing', await claude.locator('[data-state=missing]').count() == 1)
            await claude.locator('[data-mode=box]').click()
            check('whichever tab is open', await claude.locator('[data-state=missing]').count() == 1 and await claude.locator('[data-claude-command] input').count() == 1)
            await claude.locator('[data-mode=local]').click()
            cmd = claude.locator('[data-claude-command] input')
            await cmd.fill(os.path.join(tmp, 'nowhere', 'claude'))
            await expect(claude.locator('[data-command-status=missing]')).to_contain_text('没有可用的 claude 命令')
            check('a path that does not answer is named as such', True)
            await cmd.fill(os.path.join(good, 'claude'))
            await expect(claude.locator('[data-command-status=found]')).to_contain_text('0.0.0 (fake)')
            check('a path that answers is found, with its version, before anything is saved', await claude.locator('[data-state=ready]').count() == 1)
            await dlg.get_by_role('button', name='保存').click()
            await expect(dlg).to_have_count(0)
            check('saving closes the dialog', True)

            # the bar is open now, and a request goes to that command
            await expect(pg.locator('.dsask textarea')).not_to_have_attribute('placeholder', '本机找不到 claude 命令，无法委托。')
            check('the bar no longer says there is no claude command', await pg.locator('.dsask .setup').count() == 0)
            await pg.locator('.dsask textarea').fill('让主色更暖一点')
            await pg.locator('.dsask textarea').press('Enter')
            await expect(pg.locator('.runfeed')).to_contain_text('Claude Code 完成', timeout=20000)
            sent = requests(log2)
            check('the request is handed to the command the person named', len(sent) == 1 and '让主色更暖一点' in sent[0])
            await pg.reload()
            await pg.wait_for_selector('.dsask textarea')
            check('and it is remembered after a reload', await pg.locator('.dsask .setup').count() == 0)
            await b.close()
    finally:
        if server: stop(server)
        if server2: stop(server2)
    failed = [n for n, ok in results if not ok]
    print(f'{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)

asyncio.run(main())
