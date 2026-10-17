/**
 * The `tingly-design` command (the npm package's `bin`). Each command is the word the
 * editor already shows for the same action (Open, New, Check, Export); see .design/cli.md.
 *
 * Flags that change where things live (--projects) have to be in the environment before
 * the server's modules read it, so everything past argument parsing is imported lazily.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_LANGUAGE, matchLanguage, translator, type Language } from '@dc/i18n';
import type { ProjectProblem } from '@dc/core';
import type { PageJob } from './pageExport';

type Kind = 'design' | 'slides' | 'design-system' | 'dashboard' | 'docs' | 'motion';
/** The launcher's words for the kinds, as typed on the command line, and the internal names they map to. */
const KINDS: Record<string, Kind> = { canvas: 'design', slides: 'slides', 'design-system': 'design-system', dashboard: 'dashboard', doc: 'docs', docs: 'docs', motion: 'motion' };

const lang: Language = matchLanguage(process.env.DC_LANG) ?? matchLanguage(process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG) ?? DEFAULT_LANGUAGE;
const t = translator(lang);

class CliError extends Error {
  constructor(
    message: string,
    public code = 2,
  ) {
    super(message);
  }
}

const { values: opts, positionals } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        projects: { type: 'string' },
        json: { type: 'boolean' },
        port: { type: 'string' },
        host: { type: 'string' },
        title: { type: 'string' },
        size: { type: 'string' },
        as: { type: 'string' },
        'files-only': { type: 'boolean' },
        format: { type: 'string' },
        out: { type: 'string' },
        speed: { type: 'string' },
        fps: { type: 'string' },
        quality: { type: 'string' },
        width: { type: 'string' },
        height: { type: 'string' },
        board: { type: 'string' },
        slide: { type: 'string' },
        tab: { type: 'string' },
        view: { type: 'string' },
        scale: { type: 'string' },
        snapshots: { type: 'boolean' },
        since: { type: 'string' },
        limit: { type: 'string' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    // node's own wording names the option; the hint around it follows the language
    console.error(t('cli.badArgs', { message: (e as Error).message }));
    process.exit(2);
  }
})();

if (opts.projects) process.env.DC_PROJECTS = resolve(expandHome(opts.projects));
const [command = 'open', ...rest] = positionals;
// a command that answers and exits keeps the server's own log to warnings, unless asked
if (command !== 'serve' && command !== 'open' && !process.env.DC_LOG_LEVEL) process.env.DC_LOG_LEVEL = 'warn';
// run from the repository, the command serves the built editor too (there is no Vite beside it)
// (export and check --snapshots may start one to draw pages in)
if ((command === 'serve' || command === 'open' || command === 'export' || command === 'check') && !process.env.NODE_ENV) process.env.NODE_ENV = 'production';

// `tingly-design list | head` closes the pipe early; that is not an error
process.stdout.on('error', (e: NodeJS.ErrnoException) => (e.code === 'EPIPE' ? process.exit(0) : undefined));

const layout = await import('./layout');

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? resolve(homedir(), p.slice(2)) : p;
}

/** A path as a person reads it: relative to where they are when it is below it. */
function show(abs: string): string {
  const rel = relative(process.cwd(), abs);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : abs;
}

const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const looksLikePath = (arg: string) => /[/\\]/.test(arg) || arg.startsWith('.') || arg.startsWith('~');

/** A project named on the command line: a launcher name, or a path to its folder (read where it is, not linked). */
async function project(arg: string | undefined, cmd: string): Promise<{ name: string; dir: string; kind: Kind }> {
  if (!arg) throw new CliError(t('cli.needProject', { command: cmd }));
  const { kindOf, projectDir } = await import('./store');
  const dir = looksLikePath(arg) ? resolve(expandHome(arg)) : projectDir(arg);
  const kind = await kindOf(dir);
  if (!kind) throw new CliError(looksLikePath(arg) ? t('cli.noProjectAt', { path: show(dir) }) : t('errors.noProject', { name: arg }), 1);
  return { name: looksLikePath(arg) ? basename(dir) : arg, dir, kind };
}

// ---------------------------------------------------------------- open, serve

async function start(port: number, host: string, fallback: boolean) {
  const { startServer } = await import('./serve');
  try {
    return await startServer({ port, host });
  } catch (e) {
    if (!fallback || (e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    const s = await startServer({ port: 0, host });
    console.error(t('cli.portBusy', { port, free: s.port }));
    return s;
  }
}

/** The editor in the person's browser; a machine without one just gets the address printed. */
function browse(url: string): void {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

async function open(arg: string | undefined): Promise<void> {
  // an editor already running on this projects folder takes the project; asking for a port means a server of its own
  const running = opts.port ? null : await editor();
  if (running) {
    const { call } = await import('./running');
    const name = !arg ? undefined : looksLikePath(arg) ? (await call<{ name: string }>(running, 'api/links', lang, { path: resolve(expandHome(arg)) })).name : (await project(arg, 'open')).name;
    const url = name ? `${running.editor}?p=${encodeURIComponent(name)}` : running.editor;
    if (opts.json) return print({ url, running: true, pid: running.pid, projects: layout.PROJECTS_DIR });
    console.log(t('cli.attached', { url, pid: running.pid }));
    return browse(url);
  }
  let name: string | undefined;
  if (arg) {
    if (looksLikePath(arg)) {
      const { linkFolder } = await import('./store');
      name = await linkFolder(resolve(expandHome(arg)));
    } else name = (await project(arg, 'open')).name;
  }
  const s = await start(opts.port ? Number(opts.port) : Number(process.env.PORT ?? 8787), opts.host ?? (process.env.DC_HOST?.trim() || '127.0.0.1'), !opts.port);
  const url = name ? `${s.url}?p=${encodeURIComponent(name)}` : s.url;
  if (opts.json) print({ url, running: false, port: s.port, projects: layout.PROJECTS_DIR });
  else {
    console.log(t('cli.serving', { version: layout.VERSION, url, dir: layout.PROJECTS_DIR }));
    browse(url);
  }
  const { stopOnSignal } = await import('./serve');
  stopOnSignal(s);
}

/** The server a host runs: `node server.mjs` is this command, so the two never differ. */
async function serve(): Promise<void> {
  const { runServer } = await import('./serve');
  await runServer({ port: opts.port ? Number(opts.port) : Number(process.env.PORT ?? 8787), host: opts.host ?? (process.env.DC_HOST?.trim() || '127.0.0.1') });
}

// ---------------------------------------------------------------- new

async function create(kindArg: string | undefined, target: string | undefined): Promise<void> {
  if (!kindArg) throw new CliError(t('cli.needKind'));
  const kind = KINDS[kindArg];
  if (!kind) throw new CliError(t('cli.badKind', { kind: kindArg }));
  if (!target) throw new CliError(t('cli.needName', { kind: kindArg }));
  const { createProject, linkFolder, projectDir, unlinkProject } = await import('./store');
  const { validSize } = await import('@dc/core');
  const size = opts.size ? validSize(opts.size.split(/[x×,]/i).map(Number)) : undefined;
  if (opts.size && !size) throw new CliError(t('errors.badSize'));
  const atPath = looksLikePath(target);
  // with an editor open on this folder, the editor creates it: a linked folder then lives in its list
  // of links too (it keeps them in memory and writes them back), and the launcher shows the card at once
  const running = await editor();
  if (running) {
    const { call } = await import('./running');
    const title = opts.title?.trim() || (atPath ? basename(resolve(expandHome(target))) : target);
    const sized = size && (kind === 'design' || kind === 'motion') ? { size } : {};
    const { name } = await call<{ name: string }>(running, 'api/projects', lang, { kind, title, ...sized, ...(atPath ? { path: resolve(expandHome(target)) } : { name: target }) });
    // this process read the links before the editor added this one
    const dir = atPath ? resolve(expandHome(target)) : projectDir(name);
    if (opts.json) return print({ name, kind: kindArg, dir });
    return void console.log(t('cli.created', { kind: t(`cli.kind.${kind}`), name, path: show(dir) }));
  }
  const name = atPath ? await linkFolder(resolve(expandHome(target)), true) : target;
  const title = opts.title?.trim() || (atPath ? basename(resolve(expandHome(target))) : target);
  await createProject(name, title, kind, lang, size && (kind === 'design' || kind === 'motion') ? { size } : {}).catch(async (e) => {
    if (atPath) await unlinkProject(name).catch(() => {});
    throw e;
  });
  const dir = projectDir(name);
  if (opts.json) print({ name, kind: kindArg, dir });
  else console.log(t('cli.created', { kind: t(`cli.kind.${kind}`), name, path: show(dir) }));
}

// ---------------------------------------------------------------- list

async function list(arg: string | undefined): Promise<void> {
  if (!arg) {
    const { listProjects } = await import('./store');
    const cards = await listProjects();
    if (opts.json) return print(cards.map((c) => ({ name: c.name, kind: c.kind, title: c.title, ...(c.path ? { path: c.path } : {}), updatedAt: c.updatedAt })));
    if (!cards.length) return void console.log(t('cli.listEmpty', { dir: layout.PROJECTS_DIR }));
    table(cards.map((c) => [c.name, t(`cli.kind.${c.kind}`), c.title, c.path ?? '']));
    return;
  }
  const p = await project(arg, 'list');
  const { outlineProject } = await import('@dc/core');
  const outline = outlineProject(p.kind, await texts(p.dir));
  if (opts.json) return print({ name: p.name, ...outline });
  console.log(`${p.name} · ${t(`cli.kind.${p.kind}`)} · ${outline.title}${outline.duration !== undefined ? ` · ${seconds(outline.duration)}` : ''}`);
  table(
    outline.items.map((i) => [
      i.type,
      i.id,
      i.size ? `${i.size[0]}×${i.size[1]}` : i.start !== undefined ? `${seconds(i.start)} +${seconds(i.duration ?? 0)}${i.transition ? ` ${i.transition}` : ''}` : i.words !== undefined ? t('cli.words', { n: i.words }) : (i.source ?? ''),
      i.title ?? '',
    ]),
    '  ',
  );
}

const seconds = (ms: number) => t('cli.seconds', { n: (ms / 1000).toFixed(1) });

function table(rows: string[][], indent = ''): void {
  const widths = rows[0]?.map((_, c) => Math.max(...rows.map((r) => r[c].length))) ?? [];
  for (const r of rows) console.log(indent + r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]))).join('  ').trimEnd());
}

async function texts(dir: string): Promise<Record<string, string>> {
  const { readFolder } = await import('./store');
  return Object.fromEntries(Object.entries(await readFolder(dir)).map(([f, s]) => [f, s.content]));
}

// ---------------------------------------------------------------- history

/** The change log, as the editor's History shows it: who changed which file, and how. */
async function history(arg: string | undefined): Promise<void> {
  const p = await project(arg, 'history');
  const { journalSince, parseSince } = await import('@dc/core');
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const all: { id: string; at: string; actor: string; file: string; summary: string; prompt?: string; version?: string }[] = [];
  const text = await readFile(join(p.dir, '.journal.jsonl'), 'utf8').catch(() => '');
  for (const line of text.split('\n')) {
    try {
      if (line.trim()) all.push(JSON.parse(line));
    } catch {
      // a torn line, as the server skips it
    }
  }
  const since = opts.since === undefined ? null : parseSince(opts.since);
  if (opts.since !== undefined && !since) throw new CliError(t('cli.badSince', { since: opts.since }));
  const entries = journalSince(all, since);
  if (!entries) throw new CliError(t('cli.noEntry', { id: opts.since ?? '', name: p.name }), 1);
  const limit = opts.limit ? Math.max(1, Number(opts.limit) || 0) : since ? Infinity : 20;
  const shown = entries.slice(-limit);
  if (opts.json) return print({ name: p.name, entries: shown, more: entries.length - shown.length });
  if (!shown.length) return void console.log(t(since ? 'cli.historyNone' : 'cli.historyEmpty', { name: p.name }));
  if (entries.length > shown.length) console.log(t('cli.historyMore', { count: entries.length - shown.length }));
  const when = (at: string) => new Date(at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  table(shown.map((e) => [e.id, when(e.at), t(`app.actor.${e.actor}`, { defaultValue: e.actor }), e.file, e.prompt ? `${e.summary} · “${e.prompt.replace(/\s+/g, ' ').slice(0, 60)}”` : e.summary]));
}

/** The editor running on this projects folder, if any (running.ts). */
async function editor() {
  const { findEditor } = await import('./running');
  return findEditor();
}

// ---------------------------------------------------------------- check

async function check(arg: string | undefined): Promise<number> {
  if (!arg) return machine();
  const p = await project(arg, 'check');
  const { checkProject } = await import('@dc/core');
  const problems = checkProject(p.kind, await texts(p.dir));
  const pictures = opts.snapshots ? await snapshots(p, problems) : null;
  const errors = problems.filter((x) => x.level === 'error').length;
  if (opts.json) print({ name: p.name, kind: p.kind, problems, ...(pictures ? { snapshots: pictures.files } : {}) });
  else if (!problems.length) console.log(t('cli.noProblems', { name: p.name }));
  else {
    table(problems.map((x) => [x.file, x.level, x.code === 'canvas' ? t(`cli.canvasRules.${x.rule}`, { ...x.params, defaultValue: x.rule ?? '' }) : t(`cli.problems.${x.code}`, { file: x.file, ref: x.ref ?? '', message: x.message ?? '' })]));
    console.log(t('cli.problemCount', { count: problems.length }));
  }
  if (pictures && !opts.json) console.log(t('cli.snapshotsWrote', { count: pictures.files.length, dir: show(pictures.dir) }));
  return errors ? 1 : 0;
}

/**
 * The half of `check` that looks: every board, slide, tab, design-system view or motion cover drawn
 * as the Export menu draws it, each one that fails added as a problem, and the pictures kept for
 * whoever checks (an agent reads them back). Motion covers come from the exact renderer.
 */
async function snapshots(p: { name: string; dir: string; kind: Kind }, problems: ProjectProblem[]): Promise<{ dir: string; files: string[] }> {
  const dir = opts.out ? resolve(expandHome(opts.out)) : resolve(p.dir, 'renders', 'check');
  // pictures of the last check would read as this one's; a folder named with --out is the person's, and stays
  if (!opts.out) await (await import('node:fs/promises')).rm(dir, { recursive: true, force: true });
  const fail = (file: string, message: string) => problems.push({ level: 'error', file, code: 'snapshot', message });
  if (p.kind === 'motion') {
    const { RenderError, renderMotion } = await import('./render');
    const { parseMotion } = await import('@dc/core');
    const { readFile } = await import('node:fs/promises');
    const motion = parseMotion(await readFile(resolve(p.dir, 'motion.json'), 'utf8'));
    const files: string[] = [];
    for (const format of Object.keys(motion.formats)) {
      try {
        const r = await renderMotion({ dir: p.dir, runtime: resolve(layout.SANDBOX_DIST, 'motion.js'), format, container: 'png', out: dir });
        files.push(r.file);
      } catch (e) {
        if (e instanceof RenderError && e.code === 'no-renderer') throw new CliError(t('errors.noRenderer'), 1);
        fail(`motion.json#${format}`, (e as Error).message);
      }
    }
    return { dir, files };
  }
  const { files, failed } = await runPage(p, await pageJobs(p, 'png', true), dir);
  for (const f of failed) fail(f.what, f.error);
  return { dir, files };
}

/** What this machine can do: the diagnostics the editor shows across its dialogs, in one place. */
async function machine(): Promise<number> {
  const { findChrome, renderCapabilities } = await import('./render');
  const { claudeAvailable } = await import('./delegate');
  const { aiResolved } = await import('./aiconfig');
  const { fastReady } = await import('@dc/core');
  const chrome = findChrome();
  const { ffmpeg } = await renderCapabilities();
  const claude = claudeAvailable();
  const ai = aiResolved();
  const fast = fastReady(ai);
  const running = await editor();
  if (opts.json) return print({ version: layout.VERSION, projects: layout.PROJECTS_DIR, chrome, ffmpeg, claude, fastModel: fast ? ai.fastModel.value : null, editor: running ? { url: running.editor, pid: running.pid, version: running.version } : null }), 0;
  const line = (ok: boolean, text: string) => console.log(`${ok ? '✓' : '✗'} ${text}`);
  console.log(t('cli.machine.title', { version: layout.VERSION }));
  console.log(`  ${t('cli.machine.projects', { dir: layout.PROJECTS_DIR })}`);
  line(!!chrome, chrome ? t('cli.machine.chrome', { path: chrome }) : t('cli.machine.noChrome'));
  line(ffmpeg, t(ffmpeg ? 'cli.machine.ffmpeg' : 'cli.machine.noFfmpeg'));
  line(claude, t(claude ? 'cli.machine.claude' : 'cli.machine.noClaude'));
  line(fast, fast ? t('cli.machine.fast', { model: ai.fastModel.value }) : t('cli.machine.noFast'));
  console.log(`  ${running ? t('cli.machine.running', { url: running.editor, pid: running.pid }) : t('cli.machine.notRunning')}`);
  return 0;
}

// ---------------------------------------------------------------- export

async function exportProject(arg: string | undefined): Promise<number | void> {
  const p = await project(arg, 'export');
  if (!opts.as) throw new CliError(t('cli.needAs', { project: arg }));
  const as = opts.as.toLowerCase();
  if (as === 'zip') return exportZip(p);
  if (p.kind !== 'motion') return exportPage(p, as);
  if (as !== 'mp4' && as !== 'gif' && as !== 'png') throw new CliError(t('cli.exportAs', { as: opts.as, kind: t(`cli.kind.${p.kind}`), formats: [...PAGE_FORMATS.motion, 'zip'].join(', ') }));
  const { RenderError, renderMotion } = await import('./render');
  const { parseMotion } = await import('@dc/core');
  const { readFile } = await import('node:fs/promises');
  const motion = parseMotion(await readFile(resolve(p.dir, 'motion.json'), 'utf8'));
  const all = Object.keys(motion.formats);
  const formats = opts.format ? opts.format.split(',').map((f) => f.trim()).filter(Boolean) : all;
  for (const f of formats) if (!all.includes(f)) throw new CliError(t('cli.noFormat', { format: f, formats: all.join(', ') }));
  const num = (v: string | undefined) => (v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
  const { SANDBOX_DIST } = layout;
  const runtime = resolve(SANDBOX_DIST, 'motion.js');
  const done: { format: string; file: string; cover?: string }[] = [];
  const tty = process.stderr.isTTY && !opts.json;
  for (const format of formats) {
    try {
      const r = await renderMotion({
        dir: p.dir,
        runtime,
        format,
        container: as,
        cover: as === 'mp4',
        out: opts.out ? resolve(expandHome(opts.out)) : undefined,
        speed: num(opts.speed),
        fps: num(opts.fps),
        width: num(opts.width),
        height: num(opts.height),
        quality: opts.quality === 'low' || opts.quality === 'medium' ? opts.quality : 'high',
        onProgress: tty ? (n, total) => process.stderr.write(`\r${t('cli.rendering', { format, done: n, total })}`) : undefined,
      });
      if (tty) process.stderr.write('\r\x1b[K');
      done.push({ format, file: r.file, ...(r.coverFile ? { cover: r.coverFile } : {}) });
      if (!opts.json) for (const f of [r.file, r.coverFile].filter(Boolean) as string[]) console.log(t('cli.wrote', { file: show(f) }));
    } catch (e) {
      if (tty) process.stderr.write('\r\x1b[K');
      if (e instanceof RenderError && e.code === 'no-renderer') throw new CliError(t('errors.noRenderer'), 1);
      throw new CliError(t('errors.renderFailed', { detail: (e as Error).message }), 1);
    }
  }
  if (opts.json) print(done);
}

// ---------------------------------------------------------------- export through the editor's page

/** What `export --as` takes for each kind besides `zip`: the Import / Export menu's formats, by their names. */
const PAGE_FORMATS: Record<Kind, string[]> = {
  design: ['png'],
  slides: ['pdf', 'png', 'html', 'notes'],
  docs: ['pdf', 'html', 'md', 'png'],
  'design-system': ['png'],
  dashboard: ['png'],
  motion: ['mp4', 'gif', 'png'],
};

/** The views of a design system that have a picture (`issues` is a list, not a page). */
const DS_VIEWS = ['overview', 'colors', 'type', 'space', 'components', 'assets'];

/** The menu items that make `as`, with the board, slide, tab or view each one needs showing first. `every` is `check --snapshots`: a picture of everything. */
async function pageJobs(p: { dir: string; kind: Kind }, as: string, every = false): Promise<PageJob[]> {
  const { readFile } = await import('node:fs/promises');
  const read = (f: string) => readFile(resolve(p.dir, f), 'utf8').catch(() => undefined);
  const one = (flag: string | undefined) => (every ? undefined : flag?.trim() || undefined);
  switch (p.kind) {
    case 'design': {
      const { parseCanvas } = await import('@dc/core');
      const c = parseCanvas(await read('canvas.json'));
      const board = one(opts.board);
      const boards = board ? [board] : c.order.filter((f) => c.boards[f] && !c.boards[f].hidden);
      return boards.map((pick) => ({ pick, item: opts.scale === '2' && !every ? 'png2' : 'png' }));
    }
    case 'slides': {
      const slide = one(opts.slide);
      if (as === 'png') return slide ? [{ pick: slide, item: 'png' }] : [{ item: 'pngs' }];
      return [{ item: as }];
    }
    case 'docs': {
      const { parseDoc, tabOrder } = await import('@dc/core');
      const tab = one(opts.tab);
      if (as === 'md') return tab ? [{ pick: tab, item: 'md' }] : [{ item: 'mdAll' }];
      if (as === 'png') return (tab ? [tab] : tabOrder(parseDoc(await read('doc.json'))).map((x) => x.id)).map((pick) => ({ pick, item: 'png' }));
      return [{ item: as }];
    }
    case 'design-system': {
      const view = one(opts.view);
      return (view ? [view] : every ? DS_VIEWS : ['overview']).map((pick) => ({ pick, item: 'png' }));
    }
    default:
      return [{ item: 'png' }];
  }
}

/**
 * Runs `fn` against an editor showing this project: the one already running on the projects
 * folder, or one this command starts on a free port and stops again. A folder given by its path
 * that the launcher does not list gets a name for this run only (`visitFolder`).
 */
async function withEditor<T>(p: { dir: string }, fn: (editor: string, name: string) => Promise<T>): Promise<T> {
  const { nameOfFolder, visitFolder } = await import('./store');
  const known = nameOfFolder(p.dir);
  const running = known ? await editor() : null;
  if (running) return fn(running.editor, known!);
  const { existsSync } = await import('node:fs');
  if (!existsSync(resolve(layout.EDITOR_DIST, 'index.html'))) throw new CliError(t('cli.noEditorBuild'), 1);
  const name = known ?? (await visitFolder(p.dir));
  const { startServer } = await import('./serve');
  const s = await startServer({ port: 0, host: '127.0.0.1', announce: false });
  try {
    return await fn(s.url, name);
  } finally {
    await s.close();
  }
}

/** The files the menu's items made, written to `dir`; what failed, in words. */
async function runPage(p: { dir: string }, jobs: PageJob[], dir: string): Promise<{ files: string[]; failed: { what: string; error: string }[] }> {
  const { exportFromPage, PageExportError } = await import('./pageExport');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const tty = process.stderr.isTTY && !opts.json;
  if (tty) process.stderr.write(t('cli.opening'));
  let results;
  try {
    results = await withEditor(p, (editorUrl, project) => exportFromPage({ editor: editorUrl, project, lang, jobs }));
  } catch (e) {
    if (e instanceof PageExportError && e.code === 'no-chrome') throw new CliError(t('cli.noChrome'), 1);
    if (e instanceof PageExportError && e.code === 'no-editor') throw new CliError(t('cli.noEditorPage', { detail: e.message }), 1);
    throw e;
  } finally {
    if (tty) process.stderr.write('\r\x1b[K');
  }
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  const failed: { what: string; error: string }[] = [];
  const taken = new Set<string>();
  for (const r of results) {
    for (const f of r.files) {
      // the menu names a doc's picture after the doc; with one per tab, the tab tells them apart
      let name = basename(f.name);
      if (taken.has(name) && r.pick) name = name.replace(/(\.[^.]+)?$/, (ext) => `-${r.pick!.replace(/[\\/:*?"<>|]+/g, '-')}${ext}`);
      taken.add(name);
      const out = resolve(dir, name);
      await writeFile(out, f.data);
      files.push(out);
    }
    for (const e of r.errors) {
      const [code, arg] = e.split(/:(.*)/s);
      const error = code === 'no-pick' ? t('cli.noPick', { what: arg }) : code === 'no-item' || code === 'disabled' ? t('cli.notOffered', { item: arg }) : e;
      failed.push({ what: r.pick ?? r.item, error });
    }
    if (!r.files.length && !r.errors.length) failed.push({ what: r.pick ?? r.item, error: t('cli.nothingSaved') });
  }
  return { files, failed };
}

/** `export` for every kind but motion: the menu's own items, run in the editor's page. */
async function exportPage(p: { name: string; dir: string; kind: Kind }, as: string): Promise<number> {
  if (!PAGE_FORMATS[p.kind].includes(as)) throw new CliError(t('cli.exportAs', { as: opts.as, kind: t(`cli.kind.${p.kind}`), formats: [...PAGE_FORMATS[p.kind], 'zip'].join(', ') }));
  const dir = opts.out ? resolve(expandHome(opts.out)) : resolve(p.dir, 'renders');
  const { files, failed } = await runPage(p, await pageJobs(p, as), dir);
  if (opts.json) print({ files, failed });
  else {
    for (const f of files) console.log(t('cli.wrote', { file: show(f) }));
    for (const f of failed) console.error(t('cli.exportFailed', f));
  }
  return failed.length ? 1 : 0;
}

/** The whole project as one .zip, the same as the editor's Whole project / Project files only (.design/project-archive.md). */
async function exportZip(p: { name: string; dir: string }): Promise<void> {
  const { packProject } = await import('./archive');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const full = !opts['files-only'];
  const { bytes, file, files, systems } = await packProject(p.name, { journal: full, systems: full }, p.dir);
  const dir = opts.out ? resolve(expandHome(opts.out)) : process.cwd();
  await mkdir(dir, { recursive: true });
  const out = resolve(dir, full ? file : file.replace(/\.zip$/, '-files.zip'));
  await writeFile(out, bytes);
  if (opts.json) print({ file: out, files, systems });
  else console.log(t('cli.wrote', { file: show(out) }));
}

// ---------------------------------------------------------------- import

/** A project from a .zip, the same as the launcher's Import a project. */
async function importProject(arg: string | undefined): Promise<void> {
  if (!arg) throw new CliError(t('cli.needZip'));
  const { readFile } = await import('node:fs/promises');
  const path = resolve(expandHome(arg));
  const bytes = await readFile(path).catch(() => {
    throw new CliError(t('cli.noFileAt', { path: show(path) }), 1);
  });
  const { unpackProject } = await import('./archive');
  const { projectDir } = await import('./store');
  const done = await unpackProject(new Uint8Array(bytes), basename(path));
  if (opts.json) print({ ...done, dir: projectDir(done.name) });
  else console.log(t('cli.imported', { name: done.name, path: show(projectDir(done.name)) }) + (done.systems.length ? ` ${t('cli.importedSystems', { systems: done.systems.join(', ') })}` : ''));
}

// ---------------------------------------------------------------- main

async function main(): Promise<number> {
  if (opts.version) return console.log(layout.VERSION), 0;
  if (opts.help || command === 'help') return console.log(t('cli.help', { version: layout.VERSION, projects: show(layout.PROJECTS_DIR) })), 0;
  // a projects folder that does not exist yet starts with the samples, whichever command comes first
  if (command !== 'serve') {
    const { seedSamples } = await import('./store');
    await seedSamples();
  }
  switch (command) {
    case 'open':
      await open(rest[0]);
      return -1;
    case 'serve':
      await serve();
      return -1;
    case 'new':
      await create(rest[0], rest[1]);
      return 0;
    case 'list':
      await list(rest[0]);
      return 0;
    case 'check':
      return check(rest[0]);
    case 'export':
      return (await exportProject(rest[0])) ?? 0;
    case 'import':
      await importProject(rest[0]);
      return 0;
    case 'history':
      await history(rest[0]);
      return 0;
    default:
      throw new CliError(t('cli.unknownCommand', { name: command }));
  }
}

try {
  const code = await main();
  // open and serve keep running until a signal
  if (code >= 0) process.exitCode = code;
} catch (e) {
  const { HttpError } = await import('./store');
  if (e instanceof CliError) console.error(e.message), (process.exitCode = e.code);
  else if (e instanceof HttpError) console.error(t(`errors.${e.key}`, e.params)), (process.exitCode = 1);
  else console.error((e as Error).message), (process.exitCode = 1);
}
