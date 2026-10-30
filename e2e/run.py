"""Run the end-to-end suites with one command and print one table: `pnpm e2e` (or python3 e2e/run.py).

Each suite needs something different running: most want `pnpm dev` with the mock model, ai_settings wants it
with no model configured, a few build the editor and start their own server, embed starts the bundle. This
starts what each group needs, runs its suites one after another, stops it, and writes e2e/out/report.md
and report.json with every suite's checks, failures and time; each suite's output is in e2e/out/logs/.

  python3 e2e/run.py                 every suite but delegate (which calls the real `claude`)
  python3 e2e/run.py slides docs     only these suites (the groups they need still start)
  python3 e2e/run.py --smoke         the per-PR subset (SMOKE below)
  python3 e2e/run.py --list          the suites, their group and whether they are in the smoke subset
  --real      also run delegate.py   --force   run even when projects/ has uncommitted changes
  --timeout N seconds per suite (default 600; also --timeout=N)
  --shard I/N run only the I-th of N balanced slices of the picked suites (CI runs one per job; I counts from 1)
  --jobs N    run N slices side by side on this machine, each in its own copy of the repository with its own
              ports (a suite edits the samples in place, so two cannot share a checkout); one report for all

The suites edit the sample projects in place and put them back with `git checkout`, so the run refuses to
start when projects/ has uncommitted changes. DC_CHROME defaults to Playwright's chromium_headless_shell
when it is installed: full Chromium in headless mode misplaces clicks inside a zoomed artboard."""
import glob, json, os, re, shutil, signal, socket, subprocess, sys, tempfile, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'out')
# A parallel lane shifts every port by its offset (DC_E2E_OFFSET, 100 per lane), so lanes on one machine do not meet.
OFFSET = int(os.environ.get('DC_E2E_OFFSET', 0))
MOCK_PORT, API_PORT, EDITOR_PORT = 8790 + OFFSET, 8787 + OFFSET, 5173 + OFFSET
IMAGES_PORT = MOCK_PORT + 1  # the OpenAI-style images mock (image_gen)

# suite -> group. A group is what has to be running before the suite starts.
SUITES = {
    'e2e': 'dev', 'slides': 'dev', 'ds': 'dev', 'dash': 'dev', 'docs': 'dev', 'motion': 'dev', 'layers': 'dev', 'tweak_text': 'dev', 'template_values': 'dev', 'theme_switch': 'dev',
    'launcher': 'dev', 'dialogs': 'dev', 'folders': 'dev', 'git': 'dev', 'theme': 'dev', 'i18n': 'dev',
    'export_menu': 'dev', 'export_image': 'dev', 'export': 'dev', 'pptx': 'dev', 'archive': 'dev', 'claude_design': 'dev', 'copy_png': 'dev',
    'fast': 'dev', 'fast_slides': 'dev', 'fast_motion': 'dev', 'baseline': 'dev', 'external_edit': 'dev',
    'ai_settings': 'dev-bare', 'image_gen': 'dev-bare',
    'conversation': 'fake-claude', 'follow_up': 'fake-claude', 'folder_groups': 'fake-claude',
    'attach': 'build', 'run_feed': 'build', 'chat_panel': 'build', 'side_resize': 'build', 'import_here': 'build', 'import_board': 'build',
    'check_snapshots': 'build',
    'embed': 'bundle',
    'delegate': 'real',
}
# The per-PR subset: open, edit and save in every kind, plus the request bar's run feed.
SMOKE = ['e2e', 'slides', 'ds', 'dash', 'docs', 'motion', 'run_feed']
# Rough seconds per suite from a full run, to balance the slices (an unlisted suite counts WEIGHT_DEFAULT).
WEIGHTS = {'baseline': 162, 'run_feed': 40, 'chat_panel': 36, 'external_edit': 32, 'copy_png': 29, 'import_here': 23, 'import_board': 19,
           'side_resize': 17, 'attach': 13, 'ai_settings': 9, 'check_snapshots': 8, 'fast': 6, 'fast_slides': 6, 'fast_motion': 6,
           'embed': 6, 'conversation': 3}
WEIGHT_DEFAULT = 20
GROUP_ORDER = ['dev', 'dev-bare', 'fake-claude', 'build', 'bundle', 'real']


def say(msg): print(msg, flush=True)


def port_busy(port):
    with socket.socket() as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def wait_http(url, timeout=180):
    t = time.time()
    while time.time() - t < timeout:
        try:
            urllib.request.urlopen(url, timeout=3)
            return True
        except urllib.error.HTTPError:
            return True  # it answered
        except Exception:
            time.sleep(0.5)
    return False


def start(cmd, env, log):
    return subprocess.Popen(cmd, cwd=REPO, env=env, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                            start_new_session=True)


def stop(proc):
    if proc and proc.poll() is None:
        try: os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError: return
        try: proc.wait(10)
        except subprocess.TimeoutExpired: os.killpg(proc.pid, signal.SIGKILL)


def base_env(tmp):
    env = {k: v for k, v in os.environ.items() if not k.startswith('ANTHROPIC_')}
    if not env.get('DC_CHROME'):
        # where Playwright puts its headless shell: this container's /opt/pw-browsers, or its cache on a runner (two layouts)
        shell = sorted(p for root in ('/opt/pw-browsers', os.path.expanduser('~/.cache/ms-playwright'))
                       for p in glob.glob(f'{root}/chromium_headless_shell-*/chrome-linux/headless_shell')
                       + glob.glob(f'{root}/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell'))
        if shell: env['DC_CHROME'] = shell[-1]
    env['DC_CONFIG'] = os.path.join(tmp, 'ai.json')  # never the person's own saved model settings
    env.update(DC_URL=f'http://localhost:{EDITOR_PORT}', DC_API=f'http://localhost:{API_PORT}', DC_E2E_OFFSET=str(OFFSET))
    return env


class Group:
    """Starts what a group of suites needs and stops it afterwards."""
    def __init__(self, name, tmp, logs):
        self.name, self.tmp, self.logs, self.procs = name, tmp, logs, []
        self.env = base_env(tmp)

    def log(self, what): return open(os.path.join(self.logs, f'_{self.name}-{what}.log'), 'w')

    def __enter__(self):
        try:
            return self.start()
        except BaseException:
            self.__exit__()  # Python skips __exit__ when __enter__ raises; don't leave the mock or `pnpm dev` behind
            raise

    def start(self):
        if self.name in ('dev', 'dev-bare', 'fake-claude'):
            busy = [p for p in (EDITOR_PORT, API_PORT, MOCK_PORT, *([IMAGES_PORT] if self.name == 'dev-bare' else [])) if port_busy(p)]
            if busy: raise RuntimeError(f'ports {busy} are in use; stop the running dev server (or mock) first')
            # the fast suites read what the model was sent from the mock's default log, e2e/out/mock.log
            self.procs.append(start([sys.executable, os.path.join(HERE, 'mock_anthropic.py'), os.path.join(OUT, 'mock.log'), str(MOCK_PORT)], self.env, self.log('mock')))
            if self.name == 'dev-bare':
                self.procs.append(start([sys.executable, os.path.join(HERE, 'mock_images.py'), os.path.join(OUT, 'mock-images.log'), str(IMAGES_PORT)], self.env, self.log('mock-images')))
                self.env.update(DC_MOCK_IMAGES_URL=f'http://127.0.0.1:{IMAGES_PORT}', DC_MOCK_URL=f'http://127.0.0.1:{MOCK_PORT}', DC_MOCK_LOG=os.path.join(OUT, 'mock-images.log'))
            if self.name == 'dev':
                self.env.update(ANTHROPIC_API_KEY='x', ANTHROPIC_BASE_URL=f'http://127.0.0.1:{MOCK_PORT}')
            self.env['DC_CONFIG'] = os.path.join(self.tmp, f'ai-{self.name}.json')
            if self.name == 'fake-claude':
                # a stand-in `claude` first on PATH, so no real model is called and every call is recorded
                self.env['PATH'] = os.path.join(HERE, 'fake-claude') + os.pathsep + self.env['PATH']
                self.env['FAKE_CLAUDE_LOG'] = os.path.join(self.tmp, 'fake-claude.log')
            # what `pnpm dev` runs, with ports of this lane: the server and the editor take different PORTs
            if subprocess.run(['pnpm', '--filter', '@dc/sandbox', 'build'], cwd=REPO, env=self.env, stdout=self.log('sandbox'), stderr=subprocess.STDOUT).returncode:
                raise RuntimeError(f'the sandbox did not build; see e2e/out/logs/_{self.name}-sandbox.log')
            self.procs.append(start(['pnpm', '--filter', '@dc/server', 'dev'], {**self.env, 'PORT': str(API_PORT)}, self.log('server')))
            self.procs.append(start(['pnpm', '--filter', '@dc/editor', 'dev'], {**self.env, 'PORT': str(EDITOR_PORT), 'DC_SERVER_PORT': str(API_PORT)}, self.log('editor')))
            if not (wait_http(f'http://localhost:{API_PORT}/api/projects') and wait_http(f'http://localhost:{EDITOR_PORT}/')):
                raise RuntimeError(f'the dev server did not come up; see e2e/out/logs/_{self.name}-server.log and -editor.log')
        elif self.name in ('build', 'bundle'):
            cmd = ['pnpm', self.name]
            say(f'  {" ".join(cmd)} …')
            with self.log(self.name) as f:
                if subprocess.run(cmd, cwd=REPO, env=self.env, stdout=f, stderr=subprocess.STDOUT).returncode:
                    raise RuntimeError(f'`{" ".join(cmd)}` failed; see e2e/out/logs/_{self.name}-{self.name}.log')
        return self

    def __exit__(self, *exc):
        for p in reversed(self.procs): stop(p)


def run_suite(name, env, timeout, logs):
    path = os.path.join(logs, f'{name}.log')
    t = time.time()
    with open(path, 'w') as f:
        # its own session, so a timeout also stops what the suite started (a mock, a server)
        proc = start([sys.executable, os.path.join(HERE, f'{name}.py')], env, f)
        try:
            code, timed_out = proc.wait(timeout), False
        except subprocess.TimeoutExpired:
            code, timed_out = None, True
        stop(proc)
    text = open(path, encoding='utf-8', errors='replace').read()
    passed = len(re.findall(r'^PASS\b', text, re.M))
    failed = re.findall(r'^FAIL\b ?(.*)$', text, re.M)
    if timed_out: status = 'timeout'
    elif failed: status = 'fail'
    elif code != 0 or passed == 0: status = 'error'  # crashed, or printed no checks at all
    else: status = 'pass'
    tail = '' if status == 'pass' else '\n'.join(text.strip().splitlines()[-8:])
    return {'suite': name, 'group': SUITES[name], 'status': status, 'passed': passed, 'failed': len(failed),
            'failures': [s.strip() for s in failed], 'exit': code, 'seconds': round(time.time() - t, 1),
            'log': os.path.relpath(path, REPO), 'tail': tail}


def report(results, total_s):
    icon = {'pass': 'ok', 'fail': 'FAIL', 'error': 'ERROR', 'timeout': 'TIMEOUT', 'skipped': 'skipped'}
    lines = ['| Suite | Group | Result | Checks | Time |', '|---|---|---|---|---|']
    for r in results:
        checks = f"{r['passed']}/{r['passed'] + r['failed']}" if r['status'] != 'skipped' else ''
        lines.append(f"| {r['suite']} | {r['group']} | {icon[r['status']]} | {checks} | {r.get('seconds', 0):.0f}s |")
    bad = [r for r in results if r['status'] not in ('pass', 'skipped')]
    body = '\n'.join(lines) + f"\n\n{len(results) - len(bad)}/{len(results)} suites passed in {total_s / 60:.1f} min\n"
    for r in bad:
        body += f"\n## {r['suite']}: {r['status']}\n\n"
        body += ''.join(f'- {f}\n' for f in r.get('failures', [])) or ''
        if r.get('tail'): body += f"\n```\n{r['tail']}\n```\n"
        if r.get('log'): body += f"\nLog: `{r['log']}`\n"
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, 'report.md'), 'w').write('# E2E report\n\n' + body)
    json.dump({'seconds': round(total_s, 1), 'suites': results}, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
    return body, bad


def shard_of(names, i, n):
    """The i-th (from 1) of n slices: the heaviest suite goes to the lightest slice so far."""
    slices = [[] for _ in range(n)]
    load = [0] * n
    for name in sorted(names, key=lambda x: -WEIGHTS.get(x, WEIGHT_DEFAULT)):
        k = load.index(min(load))
        slices[k].append(name); load[k] += WEIGHTS.get(name, WEIGHT_DEFAULT)
    keep = set(slices[i - 1])
    return [x for x in names if x in keep]


def run_jobs(picked, n, argv):
    """n lanes at once, each a copy of this checkout (the suites edit projects/ in place and `git checkout` it back)."""
    n = max(1, min(n, len(picked)))
    base = tempfile.mkdtemp(prefix='dc-e2e-lanes-')
    flags = [a for a in argv if a.startswith('--timeout') or a in ('--real',)]
    lanes, t0 = [], time.time()
    for k in range(1, n + 1):
        names = shard_of(picked, k, n)
        if not names: continue
        root = os.path.join(base, f'lane{k}')
        shutil.copytree(REPO, root, symlinks=True, ignore=lambda d, names: ['out'] if d == HERE else [])
        say(f'lane {k}: {", ".join(names)}')
        log = open(os.path.join(base, f'lane{k}.log'), 'w')
        proc = subprocess.Popen([sys.executable, os.path.join(root, 'e2e', 'run.py'), '--force', *flags, *names],
                                cwd=root, env={**os.environ, 'DC_E2E_OFFSET': str((k - 1) * 100)}, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
        lanes.append((k, root, proc))
    results = []
    for k, root, proc in lanes:
        proc.wait()
        try: results += json.load(open(os.path.join(root, 'e2e', 'out', 'report.json')))['suites']
        except (OSError, ValueError): say(f'lane {k} left no report; see {base}/lane{k}.log')
        say(f'lane {k} finished')
    logs = os.path.join(OUT, 'logs')
    shutil.rmtree(logs, ignore_errors=True); os.makedirs(logs)
    for k, root, _ in lanes:
        src = os.path.join(root, 'e2e', 'out', 'logs')
        if os.path.isdir(src): shutil.copytree(src, logs, dirs_exist_ok=True)
    for r in results:
        if r.get('log'): r['log'] = os.path.join('e2e', 'out', 'logs', os.path.basename(r['log']))
    got = {r['suite'] for r in results}
    results += [{'suite': s_, 'group': SUITES[s_], 'status': 'error', 'passed': 0, 'failed': 0, 'failures': [], 'seconds': 0, 'tail': 'its lane left no result'} for s_ in picked if s_ not in got]
    results.sort(key=lambda r: picked.index(r['suite']))
    body, bad = report(results, time.time() - t0)
    say('\n' + body)
    say('Report: e2e/out/report.md')
    shutil.rmtree(base, ignore_errors=True)
    return 1 if bad else 0


def main(argv):
    timeout = 600
    if '--timeout' in argv:  # also `--timeout 300`
        i = argv.index('--timeout')
        argv = argv[:i] + [f'--timeout={argv[i + 1] if i + 1 < len(argv) else ""}'] + argv[i + 2:]
    for a in argv:
        if a.startswith('--timeout='):
            try: timeout = int(a.split('=', 1)[1])
            except ValueError: say('--timeout takes a number of seconds'); return 2
    opts = {}
    for o in ('--shard', '--jobs'):  # also `--jobs 4`
        if o in argv:
            i = argv.index(o)
            argv = argv[:i] + [f'{o}={argv[i + 1] if i + 1 < len(argv) else ""}'] + argv[i + 2:]
    for a in argv:
        for o in ('--shard', '--jobs'):
            if a.startswith(o + '='): opts[o] = a.split('=', 1)[1]
    args = [a for a in argv if not a.startswith('--')]
    flags = {a for a in argv if a.startswith('--') and not a.startswith(('--timeout', '--shard', '--jobs'))}
    if '--list' in flags:
        for s, g in SUITES.items(): say(f"{s:14} {g:9} {'smoke' if s in SMOKE else ''}")
        return 0
    unknown = [a for a in args if a not in SUITES]
    if unknown:
        say(f'unknown suite(s): {", ".join(unknown)}; see --list'); return 2
    picked = args or (SMOKE if '--smoke' in flags else [s for s, g in SUITES.items() if g != 'real' or '--real' in flags])
    try:
        if '--shard' in opts:
            i, n = (int(x) for x in opts['--shard'].split('/'))
            if not 1 <= i <= n: raise ValueError
            picked = shard_of(picked, i, n)
            say(f'slice {i}/{n}: {", ".join(picked) or "(nothing)"}')
        jobs = int(opts['--jobs']) if '--jobs' in opts else 0
    except ValueError:
        say('--shard takes I/N (I from 1 to N) and --jobs a number'); return 2
    dirty = subprocess.run(['git', 'status', '--porcelain', '--', 'projects'], cwd=REPO, capture_output=True, text=True).stdout
    # a folder holding only ignored files (a change log left by an earlier run) is not in git status, but takes a name
    tracked = {f.split('/')[1] for f in subprocess.run(['git', 'ls-files', 'projects'], cwd=REPO, capture_output=True, text=True).stdout.split() if f.count('/') >= 2}
    dirty += ''.join(f'?? projects/{d}/ (no tracked files)\n' for d in sorted(os.listdir(os.path.join(REPO, 'projects')))
                     if os.path.isdir(os.path.join(REPO, 'projects', d)) and d not in tracked and f'projects/{d}/' not in dirty)
    if dirty and '--force' not in flags:
        say('projects/ has uncommitted changes, and the suites put the samples back with `git checkout`.\n'
            'Commit or stash them first, or pass --force to run anyway (they will be lost).\n' + dirty)
        return 2

    if jobs > 1: return run_jobs(picked, jobs, argv)
    if not picked: return 0
    logs = os.path.join(OUT, 'logs')
    shutil.rmtree(logs, ignore_errors=True); os.makedirs(logs)
    tmp = tempfile.mkdtemp(prefix='dc-e2e-')
    results, t0 = [], time.time()
    for g in GROUP_ORDER:
        names = [s for s in picked if SUITES[s] == g]
        if not names: continue
        say(f'[{g}] {", ".join(names)}')
        try:
            with Group(g, tmp, logs) as grp:
                for n in names:
                    r = run_suite(n, grp.env, timeout, logs)
                    results.append(r)
                    say(f"  {r['status']:7} {n:14} {r['passed']}/{r['passed'] + r['failed']}  {r['seconds']:.0f}s")
        except RuntimeError as e:
            say(f'  could not start: {e}')
            for n in names:
                if not any(r['suite'] == n for r in results):
                    results.append({'suite': n, 'group': g, 'status': 'error', 'passed': 0, 'failed': 0, 'failures': [],
                                    'seconds': 0, 'tail': str(e)})
    shutil.rmtree(tmp, ignore_errors=True)
    body, bad = report(results, time.time() - t0)
    say('\n' + body)
    say('Report: e2e/out/report.md')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
