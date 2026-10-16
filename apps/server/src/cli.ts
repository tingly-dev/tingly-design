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
        format: { type: 'string' },
        out: { type: 'string' },
        speed: { type: 'string' },
        fps: { type: 'string' },
        quality: { type: 'string' },
        width: { type: 'string' },
        height: { type: 'string' },
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
if ((command === 'serve' || command === 'open') && !process.env.NODE_ENV) process.env.NODE_ENV = 'production';

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
  let name: string | undefined;
  if (arg) {
    if (looksLikePath(arg)) {
      const { linkFolder } = await import('./store');
      name = await linkFolder(resolve(expandHome(arg)));
    } else name = (await project(arg, 'open')).name;
  }
  const s = await start(opts.port ? Number(opts.port) : Number(process.env.PORT ?? 8787), opts.host ?? (process.env.DC_HOST?.trim() || '127.0.0.1'), !opts.port);
  const url = name ? `${s.url}?p=${encodeURIComponent(name)}` : s.url;
  if (opts.json) print({ url, port: s.port, projects: layout.PROJECTS_DIR });
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

// ---------------------------------------------------------------- check

async function check(arg: string | undefined): Promise<number> {
  if (!arg) return machine();
  const p = await project(arg, 'check');
  const { checkProject } = await import('@dc/core');
  const problems = checkProject(p.kind, await texts(p.dir));
  const errors = problems.filter((x) => x.level === 'error').length;
  if (opts.json) print({ name: p.name, kind: p.kind, problems });
  else if (!problems.length) console.log(t('cli.noProblems', { name: p.name }));
  else {
    table(problems.map((x) => [x.file, x.level, x.code === 'canvas' ? t(`cli.canvasRules.${x.rule}`, { ...x.params, defaultValue: x.rule ?? '' }) : t(`cli.problems.${x.code}`, { file: x.file, ref: x.ref ?? '', message: x.message ?? '' })]));
    console.log(t('cli.problemCount', { count: problems.length }));
  }
  return errors ? 1 : 0;
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
  if (opts.json) return print({ version: layout.VERSION, projects: layout.PROJECTS_DIR, chrome, ffmpeg, claude, fastModel: fast ? ai.fastModel.value : null }), 0;
  const line = (ok: boolean, text: string) => console.log(`${ok ? '✓' : '✗'} ${text}`);
  console.log(t('cli.machine.title', { version: layout.VERSION }));
  console.log(`  ${t('cli.machine.projects', { dir: layout.PROJECTS_DIR })}`);
  line(!!chrome, chrome ? t('cli.machine.chrome', { path: chrome }) : t('cli.machine.noChrome'));
  line(ffmpeg, t(ffmpeg ? 'cli.machine.ffmpeg' : 'cli.machine.noFfmpeg'));
  line(claude, t(claude ? 'cli.machine.claude' : 'cli.machine.noClaude'));
  line(fast, fast ? t('cli.machine.fast', { model: ai.fastModel.value }) : t('cli.machine.noFast'));
  return 0;
}

// ---------------------------------------------------------------- export

async function exportProject(arg: string | undefined): Promise<void> {
  const p = await project(arg, 'export');
  if (p.kind !== 'motion') throw new CliError(t('cli.exportKind', { kind: t(`cli.kind.${p.kind}`) }));
  if (!opts.as) throw new CliError(t('cli.needAs', { project: arg }));
  const as = opts.as.toLowerCase();
  if (as !== 'mp4' && as !== 'gif' && as !== 'png') throw new CliError(t('cli.exportAs', { as: opts.as }));
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
      await exportProject(rest[0]);
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
