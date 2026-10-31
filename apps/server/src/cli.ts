/**
 * The `tingly-design` command (the npm package's `bin`). Each command is the word the
 * editor already shows for the same action (Open, New, Check, Export); see .design/cli.md.
 *
 * Flags that change where things live (--projects) have to be in the environment before
 * the server's modules read it, so everything past argument parsing is imported lazily.
 */
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_LANGUAGE, matchLanguage, translator, type Language } from '@dc/i18n';

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
        look: { type: 'string' },
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
        force: { type: 'boolean' },
        file: { type: 'string' },
        continue: { type: 'string' },
        new: { type: 'boolean' },
        archived: { type: 'boolean' },
        interactive: { type: 'boolean', short: 'i' },
        global: { type: 'boolean' },
        name: { type: 'boolean', short: 'n' },
        fast: { type: 'boolean' },
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
if (['serve', 'open', 'export', 'check', 'mcp', 'prompt'].includes(command) && !process.env.NODE_ENV) process.env.NODE_ENV = 'production';

// `tingly-design list | head` closes the pipe early; that is not an error
process.stdout.on('error', (e: NodeJS.ErrnoException) => (e.code === 'EPIPE' ? process.exit(0) : undefined));

const layout = await import('./layout');
const cmd = await import('./commands');
const ctx = { lang };

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? resolve(homedir(), p.slice(2)) : p;
}

/** A path as a person reads it: relative to where they are when it is below it. */
function show(abs: string): string {
  const rel = relative(process.cwd(), abs);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : abs;
}

const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const project = (arg: string | undefined, command: string) => cmd.resolveProject(ctx, arg, command, opts.name || process.env.DC_PROJECT_ARG === 'name' ? 'name' : 'path');
/** While the editor's page opens in Chrome (a few seconds), a terminal says so. */
const tty = () => process.stderr.isTTY && !opts.json;
const opening = () => tty() && process.stderr.write(t('cli.opening'));
const clearLine = () => tty() && process.stderr.write('\r\x1b[K');

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
  const [bin, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const child = spawn(bin, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

async function open(arg: string | undefined): Promise<void> {
  // an editor already running on this projects folder takes the project; asking for a port means a server of its own
  const running = opts.port ? null : await editor();
  if (running) {
    const { call } = await import('./running');
    const dir = arg ? (await project(arg, 'open')).dir : undefined;
    const name = !dir ? undefined : (await import('./store')).nameOfFolder(dir) ?? (await call<{ name: string }>(running, 'api/links', lang, { path: dir })).name;
    const url = name ? `${running.editor}?p=${encodeURIComponent(name)}` : running.editor;
    if (opts.json) return print({ url, running: true, pid: running.pid, projects: layout.PROJECTS_DIR });
    console.log(t('cli.attached', { url, pid: running.pid }));
    return browse(url);
  }
  let name: string | undefined;
  if (arg) {
    const { linkFolder, nameOfFolder } = await import('./store');
    const dir = (await project(arg, 'open')).dir;
    name = nameOfFolder(dir) ?? (await linkFolder(dir));
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

async function create(kind: string | undefined, target: string | undefined): Promise<void> {
  // `new` with nothing to go on, in a terminal, asks; -i asks for what is missing even when some is given
  const ask = opts.interactive || (!kind && !target && process.stdin.isTTY && process.stderr.isTTY);
  if (!ask) {
    const p = await cmd.create(ctx, { kind, target, title: opts.title, size: opts.size, look: opts.look, global: opts.global });
    if (opts.json) print({ name: p.name, kind, dir: p.dir });
    else console.log(t('cli.created', { kind: t(`cli.kind.${p.kind}`), name: p.name, path: show(p.dir) }));
    return;
  }
  if (!process.stdin.isTTY) throw new CliError(t('cli.needTerminal'));
  const { terminalWizard } = await import('./wizard');
  // a bare name lands in the current directory unless --global, so that is where a name has to be free
  const global = await cmd.bareNamesGlobal(ctx, opts.global);
  const w = terminalWizard(t as (key: string, params?: Record<string, string>) => string, process.stdin, process.stderr, global ? 'projects' : '.');
  try {
    const given = await cmd.wizardGiven(ctx, { kind, target, title: opts.title, size: opts.size });
    const taken = global ? (await cmd.projects()).map((c) => c.name) : await readdir(process.cwd()).catch(() => []);
    const answer = await w.run(given, new Set(taken));
    const p = await cmd.create(ctx, { kind: answer.kind, target: answer.target, title: answer.title, size: answer.size ? answer.size.join('x') : undefined, look: opts.look, global: opts.global });
    if (opts.json) print({ name: p.name, kind: answer.kind, dir: p.dir });
    else console.log(t('cli.created', { kind: t(`cli.kind.${p.kind}`), name: p.name, path: show(p.dir) }));
    // the next step of the journey: open it, or say how
    if (!opts.json && (await w.confirm('openNow'))) {
      w.close();
      await open(p.dir);
    } else if (!opts.json) console.log(t('cli.createdNext', { path: /\s/.test(show(p.dir)) ? JSON.stringify(show(p.dir)) : show(p.dir) }));
  } finally {
    w.close();
  }
}

// ---------------------------------------------------------------- list

async function list(arg: string | undefined): Promise<void> {
  if (!arg) {
    const cards = await cmd.projects({ archived: opts.archived });
    if (opts.json) return print(cards);
    if (!cards.length) return void console.log(t('cli.listEmpty', { dir: layout.PROJECTS_DIR }));
    table(cards.map((c) => [c.name, t(`cli.kind.${c.kind}`), c.title, c.path ?? '']));
    return;
  }
  const o = await cmd.outline(await project(arg, 'list'));
  if (opts.json) return print(o);
  console.log(`${o.name} · ${t(`cli.kind.${o.kind}`)} · ${o.title}${o.duration !== undefined ? ` · ${seconds(o.duration)}` : ''}`);
  table(
    o.items.map((i) => [
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

// ---------------------------------------------------------------- history

/** The change log, as the editor's History shows it: who changed which file, and how. */
async function history(arg: string | undefined): Promise<void> {
  const p = await project(arg, 'history');
  const h = await cmd.history(ctx, p, { since: opts.since, limit: opts.limit ? Number(opts.limit) || 1 : undefined });
  if (opts.json) return print({ name: h.name, entries: h.entries, more: h.more });
  if (!h.entries.length) return void console.log(t(h.since ? 'cli.historyNone' : 'cli.historyEmpty', { name: p.name }));
  if (h.more) console.log(t('cli.historyMore', { count: h.more }));
  const when = (at: string) => new Date(at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  table(h.entries.map((e) => [e.id, when(e.at), t(`app.actor.${e.actor}`, { defaultValue: e.actor }), e.file, e.prompt ? `${e.summary} · “${e.prompt.replace(/\s+/g, ' ').slice(0, 60)}”` : e.summary]));
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
  if (opts.snapshots) opening();
  const r = await cmd.check(ctx, p, { snapshots: opts.snapshots, out: opts.out, pick: { board: opts.board, slide: opts.slide, tab: opts.tab, view: opts.view }, format: opts.format?.split(',').map((f) => f.trim()).filter(Boolean) }).finally(() => opts.snapshots && clearLine());
  if (opts.json) print({ name: r.name, kind: r.kind, problems: r.problems, ...(r.snapshots ? { snapshots: r.snapshots.files } : {}) });
  else if (!r.problems.length) console.log(t('cli.noProblems', { name: p.name }));
  else {
    table(r.problems.map((x) => [x.file, x.level, x.code === 'canvas' || x.code === 'layout' ? t(`cli.${x.code}Rules.${x.rule}`, { ...x.params, defaultValue: x.rule ?? '' }) : t(`cli.problems.${x.code}`, { ...x.params, file: x.file, ref: x.ref ?? '', message: x.message ?? '' })]));
    console.log(t('cli.problemCount', { count: r.problems.length }));
  }
  if (r.snapshots && !opts.json) {
    console.log(t('cli.snapshotsWrote', { count: r.snapshots.files.length, dir: show(r.snapshots.dir) }));
    for (const f of r.snapshots.files.slice(0, 20)) console.log(`  ${show(f)}`);
  }
  return r.errors ? 1 : 0;
}

/** What this machine can do: the diagnostics the editor shows across its dialogs, in one place. */
async function machine(): Promise<number> {
  const { renderCapabilities } = await import('./render');
  const { findChrome } = await import('./chrome');
  const { claudeAvailable } = await import('./delegate');
  const { aiResolved } = await import('./aiconfig');
  const { fastReady } = await import('@dc/core');
  const chrome = findChrome();
  const { ffmpeg } = await renderCapabilities();
  const claude = claudeAvailable();
  const ai = aiResolved();
  const fast = fastReady(ai);
  const running = await editor();
  if (opts.json) return print({ version: layout.VERSION, projects: layout.PROJECTS_DIR, chrome, ffmpeg, claude, fastModel: fast ? ai.fast.model.value : null, editor: running ? { url: running.editor, pid: running.pid, version: running.version } : null }), 0;
  const line = (ok: boolean, text: string) => console.log(`${ok ? '✓' : '✗'} ${text}`);
  console.log(t('cli.machine.title', { version: layout.VERSION }));
  console.log(`  ${t('cli.machine.projects', { dir: layout.PROJECTS_DIR })}`);
  line(!!chrome, chrome ? t('cli.machine.chrome', { path: chrome }) : t('cli.machine.noChrome'));
  line(ffmpeg, t(ffmpeg ? 'cli.machine.ffmpeg' : 'cli.machine.noFfmpeg'));
  line(claude, t(claude ? 'cli.machine.claude' : 'cli.machine.noClaude'));
  line(fast, fast ? t('cli.machine.fast', { model: ai.fast.model.value }) : t('cli.machine.noFast'));
  console.log(`  ${running ? t('cli.machine.running', { url: running.editor, pid: running.pid }) : t('cli.machine.notRunning')}`);
  return 0;
}

// ---------------------------------------------------------------- export

async function exportProject(arg: string | undefined): Promise<number> {
  const p = await project(arg, 'export');
  const num = (v: string | undefined) => (v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
  const r = await cmd
    .exportProject(ctx, p, {
      as: opts.as,
      out: opts.out,
      filesOnly: opts['files-only'],
      board: opts.board,
      slide: opts.slide,
      tab: opts.tab,
      view: opts.view,
      scale: num(opts.scale),
      format: opts.format?.split(',').map((f) => f.trim()).filter(Boolean),
      speed: num(opts.speed),
      fps: num(opts.fps),
      width: num(opts.width),
      height: num(opts.height),
      quality: opts.quality === 'low' || opts.quality === 'medium' ? opts.quality : undefined,
      onProgress: tty() ? (format, done, total) => process.stderr.write(`\r${t('cli.rendering', { format, done, total })}`) : undefined,
      onOpening: opening,
    })
    .finally(clearLine);
  if (opts.json) print(r.zip ? { file: r.files[0], ...r.zip, ...(r.notes ? { notes: r.notes } : {}) } : r.formats ? r.formats : { files: r.files, failed: r.failed });
  else {
    for (const f of r.files) console.log(t('cli.wrote', { file: show(f) }));
    for (const f of r.failed) console.error(t('cli.exportFailed', f));
    for (const n of r.notes ?? []) console.log(`  ${t(`claudeDesign.note.${n.key}`, n.params)}`);
  }
  return r.failed.length ? 1 : 0;
}

// ---------------------------------------------------------------- prompt

/** The request bar's Hand to Claude Code: the steps as it works (in a terminal), then what it said and what it changed. */
async function promptCommand(arg: string | undefined, text: string | undefined): Promise<number> {
  const p = await project(arg, 'prompt');
  // Ctrl+C stops the run, as the editor's Stop button does, and the command still reports what it changed
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort());
  const r = await cmd.prompt(ctx, p, {
    text,
    file: opts.file,
    resume: opts.continue,
    fresh: opts.new,
    fast: opts.fast,
    source: 'cli',
    signal: stop.signal,
    onOpening: opening,
    onStep: tty() ? (step) => process.stderr.write(`  · ${t(`prompt.step.${step.op}`, { target: step.target ?? '', within: step.within ?? '' })}\n`) : undefined,
  }).finally(clearLine);
  if (opts.json) print(r);
  else {
    if (r.by === 'claude' && r.statements) console.log(t('cli.promptHandedOver'));
    if (r.text) console.log(r.text);
    if (r.outcome === 'stopped') console.error(t('cli.promptStopped'));
    if (r.entries.length) {
      console.log(t('cli.promptChanged', { count: r.entries.length }));
      table(r.entries.map((e) => [e.id, e.file, e.summary]), '  ');
    } else console.log(t('cli.promptNoChanges'));
    if (r.session) console.log(t('cli.promptContinue', { project: arg, session: r.session }));
  }
  return r.outcome === 'done' ? 0 : 1;
}

// ---------------------------------------------------------------- skills

/** The format references Claude Code reads, listed or copied into a folder's .claude/skills/. */
async function skillsCommand(sub: string | undefined, to: string | undefined): Promise<void> {
  if (sub === undefined || sub === 'list') {
    const all = await cmd.skills();
    if (opts.json) return print(all.map(({ text: _, ...s }) => s));
    table(all.map((s) => [s.word, s.name, s.description.length > 90 ? `${s.description.slice(0, 89)}…` : s.description]));
    return;
  }
  if (sub !== 'add') throw new CliError(t('cli.skillsUsage'));
  const r = await cmd.addSkills({ to, force: opts.force });
  if (opts.json) return print(r);
  for (const s of r.skills) console.log(t(`cli.skill.${s.state}`, { file: show(s.file) }));
  if (r.skills.some((s) => s.state === 'kept')) console.log(t('cli.skillsKept'));
}

// ---------------------------------------------------------------- mcp

/** The MCP server over stdio, for an agent that starts it as a command: one JSON-RPC message per line, stdout carries nothing else. */
async function mcp(): Promise<void> {
  const { handleMcp } = await import('./mcp');
  const { createInterface } = await import('node:readline');
  // anything a module prints would break the protocol: the server's own log already goes to stderr
  console.log = console.error;
  const write = (v: unknown) => process.stdout.write(JSON.stringify(v) + '\n');
  const pending = new Set<Promise<void>>();
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let m: unknown;
    try {
      m = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    // a long export must not hold up a ping
    const job = Promise.all((Array.isArray(m) ? m : [m]).map((x) => handleMcp(x, lang, false))).then((rs) => {
      const replies = rs.filter((r) => r !== null);
      if (replies.length) write(Array.isArray(m) ? replies : replies[0]);
    });
    pending.add(job);
    void job.finally(() => pending.delete(job));
  }
  await Promise.all(pending);
}

// ---------------------------------------------------------------- import

/** A project from a .zip, a Claude Design package (a .zip or the folder Claude Code saved), or a Claude Docs Markdown export, the same as the launcher's Import a project. */
async function importProject(arg: string | undefined): Promise<void> {
  if (!arg) throw new CliError(t('cli.needZip'));
  const { readFile, stat } = await import('node:fs/promises');
  const path = resolve(expandHome(arg));
  const info = await stat(path).catch(() => {
    throw new CliError(t('cli.noFileAt', { path: show(path) }), 1);
  });
  const { unpackProject, importFiles, readTree, MAX_ARCHIVE_INPUT, describePptx } = await import('./archive');
  if (!info.isDirectory() && info.size > MAX_ARCHIVE_INPUT) throw new CliError(t('errors.archiveInputTooBig'), 1);
  const { projectDir } = await import('./store');
  const done = info.isDirectory() ? await importFiles(await readTree(path), basename(path)) : await unpackProject(new Uint8Array(await readFile(path)), basename(path));
  if (opts.json) print({ ...done, dir: projectDir(done.name) });
  else {
    console.log(t(done.claudeDesign ? 'cli.importedClaudeDesign' : 'cli.imported', { name: done.name, path: show(projectDir(done.name)), kind: done.claudeDesign ? t(`cli.kind.${done.claudeDesign}`) : '' }) + (done.systems.length ? ` ${t('cli.importedSystems', { systems: done.systems.join(', ') })}` : ''));
    for (const n of done.notes) console.log(`  ${t(`claudeDesign.note.${n.key}`, n.params)}`);
    if (done.pptx) {
      console.log(t('cli.pptxKept', { source: resolve(projectDir(done.name), done.pptx.source), report: resolve(projectDir(done.name), done.pptx.report) }));
      for (const d of done.pptx.diagnostics) console.log(`  ${d.part ?? ''}${d.object ? ` [${d.object}]` : ''}: ${describePptx(d, t)}`);
    }
  }
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
      return exportProject(rest[0]);
    case 'import':
      await importProject(rest[0]);
      return 0;
    case 'history':
      await history(rest[0]);
      return 0;
    case 'prompt':
      return promptCommand(rest[0], rest.slice(1).join(' ') || undefined);
    case 'skills':
      await skillsCommand(rest[0], rest[1]);
      return 0;
    case 'mcp':
      await mcp();
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
  const { PptxImportError, describePptx } = await import('./archive');
  if (e instanceof PptxImportError) {
    const error = t(`errors.${e.key}`, e.params);
    const diagnostics = e.diagnostics.map(d => ({ ...d, message: describePptx(d, t) }));
    if (opts.json) print({ error, code: e.key, diagnostics });
    else {
      console.error(error);
      for (const d of diagnostics) console.error(`  ${d.part ?? ''}${d.object ? ` [${d.object}]` : ''}: ${d.message}`);
    }
    process.exitCode = 1;
  }
  else if (e instanceof CliError || e instanceof cmd.CommandError) console.error(e.message), (process.exitCode = e.code);
  else if (e instanceof HttpError) console.error(t(`errors.${e.key}`, e.params)), (process.exitCode = 1);
  else console.error((e as Error).message), (process.exitCode = 1);
}
