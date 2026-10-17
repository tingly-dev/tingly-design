/**
 * What the command line and the MCP tools do, as data: each command takes plain arguments and
 * returns what it found or made, and throws a `CommandError` worded in the caller's language.
 * `cli.ts` turns the results into tables and exit codes, `mcp.ts` into tool results, so the two
 * never drift (.design/cli.md §4). Imported after the environment is settled (`DC_PROJECTS`).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { checkProject, journalSince, type AgentStep, outlineProject, parseCanvas, parseDoc, parseMotion, parseSince, tabOrder, validSize, type ProjectProblem } from '@dc/core';
import { translator, type Language } from '@dc/i18n';
import { EDITOR_DIST, ROOT, SANDBOX_DIST } from './layout';
import type { PageJob } from './pageExport';
import { call, findEditor, ownEditor } from './running';
import { createProject, kindOf, linkFolder, listProjects, nameOfFolder, projectDir, readFolder, unlinkProject, visitFolder } from './store';

export type Kind = 'design' | 'slides' | 'design-system' | 'dashboard' | 'docs' | 'motion';
/** The launcher's words for the kinds, as typed, and the internal names they map to. */
export const KINDS: Record<string, Kind> = { canvas: 'design', slides: 'slides', 'design-system': 'design-system', dashboard: 'dashboard', doc: 'docs', docs: 'docs', motion: 'motion' };
/** Each kind's format reference under `.claude/skills/`. */
export const SKILLS: Record<Kind, string> = { design: 'dc-canvas', slides: 'slides', 'design-system': 'design-system', dashboard: 'dashboard', docs: 'docs', motion: 'motion' };

/** What `export --as` takes for each kind besides `zip`: the Import / Export menu's formats, by their names. */
export const FORMATS: Record<Kind, string[]> = {
  design: ['png'],
  slides: ['pdf', 'png', 'html', 'notes'],
  docs: ['pdf', 'html', 'md', 'png'],
  'design-system': ['png'],
  dashboard: ['png'],
  motion: ['mp4', 'gif', 'png'],
};

/** The views of a design system that have a picture (`issues` is a list, not a page). */
const DS_VIEWS = ['overview', 'colors', 'type', 'space', 'components', 'assets'];

export class CommandError extends Error {
  /** `code` is the command line's exit code: 2 when the command was not understood, 1 when it failed. */
  constructor(
    message: string,
    public code = 2,
  ) {
    super(message);
  }
}

export interface Ctx {
  lang: Language;
  /** Called inside this editor's own server (its `/mcp`): pages are drawn by this editor, never by one started beside it. */
  inServer?: boolean;
}

export interface Project {
  name: string;
  dir: string;
  kind: Kind;
}

export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? resolve(homedir(), p.slice(2)) : p;
}

export const looksLikePath = (arg: string) => /[/\\]/.test(arg) || arg.startsWith('.') || arg.startsWith('~');

/** A project named by its launcher name, or a path to its folder (read where it is, not linked). */
export async function resolveProject(ctx: Ctx, arg: string | undefined, command: string): Promise<Project> {
  const t = translator(ctx.lang);
  if (!arg) throw new CommandError(t('cli.needProject', { command }));
  const dir = looksLikePath(arg) ? resolve(expandHome(arg)) : projectDir(arg);
  const kind = await kindOf(dir);
  if (!kind) throw new CommandError(looksLikePath(arg) ? t('cli.noProjectAt', { path: dir }) : t('errors.noProject', { name: arg }), 1);
  return { name: looksLikePath(arg) ? (nameOfFolder(dir) ?? basename(dir)) : arg, dir, kind };
}

async function texts(dir: string): Promise<Record<string, string>> {
  return Object.fromEntries(Object.entries(await readFolder(dir)).map(([f, s]) => [f, s.content]));
}

// ---------------------------------------------------------------- list

export async function projects() {
  return (await listProjects()).map((c) => ({ name: c.name, kind: c.kind as Kind, title: c.title, ...(c.path ? { path: c.path } : {}), updatedAt: c.updatedAt }));
}

export async function outline(p: Project) {
  return { name: p.name, dir: p.dir, ...outlineProject(p.kind, await texts(p.dir)) };
}

// ---------------------------------------------------------------- new

export async function create(ctx: Ctx, o: { kind: string | undefined; target: string | undefined; title?: string; size?: string }): Promise<Project> {
  const t = translator(ctx.lang);
  if (!o.kind) throw new CommandError(t('cli.needKind'));
  const kind = KINDS[o.kind];
  if (!kind) throw new CommandError(t('cli.badKind', { kind: o.kind }));
  const target = o.target?.trim();
  if (!target) throw new CommandError(t('cli.needName', { kind: o.kind }));
  const size = o.size ? validSize(o.size.split(/[x×,]/i).map(Number)) : undefined;
  if (o.size && !size) throw new CommandError(t('errors.badSize'));
  const atPath = looksLikePath(target);
  const path = atPath ? resolve(expandHome(target)) : undefined;
  const title = o.title?.trim() || (path ? basename(path) : target);
  const sized = size && (kind === 'design' || kind === 'motion') ? { size } : {};
  // with an editor open on this folder, the editor creates it: a linked folder then lives in its list
  // of links too (it keeps them in memory and writes them back), and the launcher shows the card at once
  const running = ctx.inServer ? null : await findEditor();
  if (running) {
    const { name } = await call<{ name: string }>(running, 'api/projects', ctx.lang, { kind, title, ...sized, ...(path ? { path } : { name: target }) });
    // this process read the links before the editor added this one
    return { name, kind, dir: path ?? projectDir(name) };
  }
  const name = path ? await linkFolder(path, true) : target;
  await createProject(name, title, kind, ctx.lang, sized).catch(async (e) => {
    if (path) await unlinkProject(name).catch(() => {});
    throw e;
  });
  return { name, kind, dir: projectDir(name) };
}

// ---------------------------------------------------------------- history

export interface JournalLine {
  id: string;
  at: string;
  actor: string;
  file: string;
  summary: string;
  prompt?: string;
  version?: string;
}

async function readJournal(dir: string): Promise<JournalLine[]> {
  const all: JournalLine[] = [];
  const text = await readFile(resolve(dir, '.journal.jsonl'), 'utf8').catch(() => '');
  for (const line of text.split('\n')) {
    try {
      if (line.trim()) all.push(JSON.parse(line));
    } catch {
      // a torn line, as the server skips it
    }
  }
  return all;
}

/** The change log, as the editor's History shows it. `since` is an entry id, a time or how long ago; `limit` the last n (20 by default, all with `since`). */
export async function history(ctx: Ctx, p: Project, o: { since?: string; limit?: number } = {}) {
  const t = translator(ctx.lang);
  const all = await readJournal(p.dir);
  const since = o.since === undefined ? null : parseSince(o.since);
  if (o.since !== undefined && !since) throw new CommandError(t('cli.badSince', { since: o.since }));
  const entries = journalSince(all, since);
  if (!entries) throw new CommandError(t('cli.noEntry', { id: o.since ?? '', name: p.name }), 1);
  const limit = o.limit ? Math.max(1, o.limit) : since ? Infinity : 20;
  const shown = entries.slice(-limit);
  return { name: p.name, since: !!since, entries: shown, more: entries.length - shown.length };
}

// ---------------------------------------------------------------- check

/** The problems the editor would show; with `snapshots`, also a picture of everything, each one that fails added as a problem. */
export async function check(ctx: Ctx, p: Project, o: { snapshots?: boolean; out?: string } = {}) {
  const problems = checkProject(p.kind, await texts(p.dir));
  const pictures = o.snapshots ? await snapshots(ctx, p, problems, o.out) : undefined;
  return { name: p.name, kind: p.kind, problems, errors: problems.filter((x) => x.level === 'error').length, ...(pictures ? { snapshots: pictures } : {}) };
}

/**
 * The half of `check` that looks: every board, slide, tab, design-system view or motion cover drawn
 * as the Export menu draws it, and the pictures kept for whoever checks (an agent reads them back).
 * Motion covers come from the exact renderer.
 */
async function snapshots(ctx: Ctx, p: Project, problems: ProjectProblem[], out?: string): Promise<{ dir: string; files: string[] }> {
  const t = translator(ctx.lang);
  const dir = out ? resolve(expandHome(out)) : resolve(p.dir, 'renders', 'check');
  // pictures of the last check would read as this one's; a folder named with --out is the person's, and stays
  if (!out) await rm(dir, { recursive: true, force: true });
  const fail = (file: string, message: string) => problems.push({ level: 'error', file, code: 'snapshot', message });
  if (p.kind === 'motion') {
    const { RenderError, renderMotion } = await import('./render');
    const motion = parseMotion(await readFile(resolve(p.dir, 'motion.json'), 'utf8'));
    const files: string[] = [];
    for (const format of Object.keys(motion.formats)) {
      try {
        files.push((await renderMotion({ dir: p.dir, runtime: resolve(SANDBOX_DIST, 'motion.js'), format, container: 'png', out: dir })).file);
      } catch (e) {
        if (e instanceof RenderError && e.code === 'no-renderer') throw new CommandError(t('errors.noRenderer'), 1);
        fail(`motion.json#${format}`, (e as Error).message);
      }
    }
    return { dir, files };
  }
  const { files, failed } = await runPage(ctx, p, await pageJobs(p, 'png', {}, true), dir);
  for (const f of failed) fail(f.what, f.error);
  return { dir, files };
}

// ---------------------------------------------------------------- export

export interface ExportOptions {
  as: string | undefined;
  out?: string;
  /** export --as zip: leave the change log and the installed design systems out */
  filesOnly?: boolean;
  board?: string;
  slide?: string;
  tab?: string;
  view?: string;
  /** a canvas at PNG @2x */
  scale?: number;
  /** motion: the formats to render, and the export dialog's settings */
  format?: string[];
  speed?: number;
  fps?: number;
  quality?: 'low' | 'medium' | 'high';
  width?: number;
  height?: number;
  onProgress?: (format: string, done: number, total: number) => void;
  /** said once the editor's page is about to open (it takes a few seconds) */
  onOpening?: () => void;
}

export interface ExportResult {
  files: string[];
  /** what could not be made, in words */
  failed: { what: string; error: string }[];
  /** a motion export: the file each format became, and its cover */
  formats?: { format: string; file: string; cover?: string }[];
  /** a zip: what went in */
  zip?: { files: number; systems: string[] };
}

/** What the Export menu saves, by its name: `zip` for any project, the kind's formats (`FORMATS`) otherwise. */
export async function exportProject(ctx: Ctx, p: Project, o: ExportOptions): Promise<ExportResult> {
  const t = translator(ctx.lang);
  if (!o.as) throw new CommandError(t('cli.needAs', { project: p.name }));
  const as = o.as.toLowerCase();
  if (as === 'zip') return exportZip(p, o);
  if (!FORMATS[p.kind].includes(as)) throw new CommandError(t('cli.exportAs', { as: o.as, kind: t(`cli.kind.${p.kind}`), formats: [...FORMATS[p.kind], 'zip'].join(', ') }));
  if (p.kind === 'motion') return exportMotion(ctx, p, as as 'mp4' | 'gif' | 'png', o);
  const dir = o.out ? resolve(expandHome(o.out)) : resolve(p.dir, 'renders');
  return runPage(ctx, p, await pageJobs(p, as, o), dir, o.onOpening);
}

async function exportMotion(ctx: Ctx, p: Project, as: 'mp4' | 'gif' | 'png', o: ExportOptions): Promise<ExportResult> {
  const t = translator(ctx.lang);
  const { RenderError, renderMotion } = await import('./render');
  const motion = parseMotion(await readFile(resolve(p.dir, 'motion.json'), 'utf8'));
  const all = Object.keys(motion.formats);
  const formats = o.format?.length ? o.format : all;
  for (const f of formats) if (!all.includes(f)) throw new CommandError(t('cli.noFormat', { format: f, formats: all.join(', ') }));
  const done: { format: string; file: string; cover?: string }[] = [];
  for (const format of formats) {
    try {
      const r = await renderMotion({
        dir: p.dir,
        runtime: resolve(SANDBOX_DIST, 'motion.js'),
        format,
        container: as,
        cover: as === 'mp4',
        out: o.out ? resolve(expandHome(o.out)) : undefined,
        speed: o.speed,
        fps: o.fps,
        width: o.width,
        height: o.height,
        quality: o.quality ?? 'high',
        onProgress: o.onProgress && ((n, total) => o.onProgress!(format, n, total)),
      });
      done.push({ format, file: r.file, ...(r.coverFile ? { cover: r.coverFile } : {}) });
    } catch (e) {
      if (e instanceof RenderError && e.code === 'no-renderer') throw new CommandError(t('errors.noRenderer'), 1);
      throw new CommandError(t('errors.renderFailed', { detail: (e as Error).message }), 1);
    }
  }
  return { files: done.flatMap((d) => (d.cover ? [d.file, d.cover] : [d.file])), failed: [], formats: done };
}

/** The whole project as one .zip, the same as the editor's Whole project / Project files only (.design/project-archive.md). */
async function exportZip(p: Project, o: ExportOptions): Promise<ExportResult> {
  const { packProject } = await import('./archive');
  const full = !o.filesOnly;
  const { bytes, file, files, systems } = await packProject(p.name, { journal: full, systems: full }, p.dir);
  const dir = o.out ? resolve(expandHome(o.out)) : process.cwd();
  await mkdir(dir, { recursive: true });
  const out = resolve(dir, full ? file : file.replace(/\.zip$/, '-files.zip'));
  await writeFile(out, bytes);
  return { files: [out], failed: [], zip: { files, systems } };
}

// ---------------------------------------------------------------- export through the editor's page

/** The menu items that make `as`, with the board, slide, tab or view each one needs showing first. `every` is `check --snapshots`: a picture of everything. */
async function pageJobs(p: Project, as: string, o: Pick<ExportOptions, 'board' | 'slide' | 'tab' | 'view' | 'scale'>, every = false): Promise<PageJob[]> {
  const read = (f: string) => readFile(resolve(p.dir, f), 'utf8').catch(() => undefined);
  const one = (flag: string | undefined) => (every ? undefined : flag?.trim() || undefined);
  switch (p.kind) {
    case 'design': {
      const c = parseCanvas(await read('canvas.json'));
      const board = one(o.board);
      const boards = board ? [board] : c.order.filter((f) => c.boards[f] && !c.boards[f].hidden);
      return boards.map((pick) => ({ pick, item: o.scale === 2 && !every ? 'png2' : 'png' }));
    }
    case 'slides': {
      const slide = one(o.slide);
      if (as === 'png') return slide ? [{ pick: slide, item: 'png' }] : [{ item: 'pngs' }];
      return [{ item: as }];
    }
    case 'docs': {
      const tab = one(o.tab);
      if (as === 'md') return tab ? [{ pick: tab, item: 'md' }] : [{ item: 'mdAll' }];
      if (as === 'png') return (tab ? [tab] : tabOrder(parseDoc(await read('doc.json'))).map((x) => x.id)).map((pick) => ({ pick, item: 'png' }));
      return [{ item: as }];
    }
    case 'design-system': {
      const view = one(o.view);
      return (view ? [view] : every ? DS_VIEWS : ['overview']).map((pick) => ({ pick, item: 'png' }));
    }
    default:
      return [{ item: 'png' }];
  }
}

/**
 * Runs `fn` against an editor serving this project: the one already running on the projects
 * folder, or one started on a free port and stopped again. A folder given by its path that the
 * launcher does not list gets a name for this run only (`visitFolder`). Inside the editor's own
 * server that is this editor, and a folder it does not list is refused: naming it there would
 * put it in the launcher. `page`: the editor's page is needed, not only its API.
 */
async function withEditor<T>(ctx: Ctx, p: Project, page: boolean, fn: (at: { api: string; page: string; name: string }) => Promise<T>): Promise<T> {
  const t = translator(ctx.lang);
  const known = nameOfFolder(p.dir);
  if (ctx.inServer) {
    const self = ownEditor();
    if (!known) throw new CommandError(t('cli.notListed', { path: p.dir }), 1);
    if (!self) throw new CommandError(t('cli.noEditorPage', { detail: 'no address' }), 1);
    return fn({ api: self.url, page: self.editor, name: known });
  }
  const running = known ? await findEditor() : null;
  if (running) return fn({ api: running.url, page: running.editor, name: known! });
  if (page && !existsSync(resolve(EDITOR_DIST, 'index.html'))) throw new CommandError(t('cli.noEditorBuild'), 1);
  const name = known ?? (await visitFolder(p.dir));
  const { startServer } = await import('./serve');
  const s = await startServer({ port: 0, host: '127.0.0.1', announce: false });
  try {
    return await fn({ api: s.url, page: s.url, name });
  } finally {
    await s.close();
  }
}

/** The files the menu's items made, written to `dir`; what failed, in words. */
async function runPage(ctx: Ctx, p: Project, jobs: PageJob[], dir: string, onOpening?: () => void): Promise<ExportResult> {
  const t = translator(ctx.lang);
  const { exportFromPage, PageExportError } = await import('./pageExport');
  onOpening?.();
  let results;
  try {
    results = await withEditor(ctx, p, true, (at) => exportFromPage({ editor: at.page, project: at.name, lang: ctx.lang, jobs }));
  } catch (e) {
    if (e instanceof PageExportError && e.code === 'no-chrome') throw new CommandError(t('cli.noChrome'), 1);
    if (e instanceof PageExportError && e.code === 'no-editor') throw new CommandError(t('cli.noEditorPage', { detail: e.message }), 1);
    throw e;
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

// ---------------------------------------------------------------- prompt

export interface PromptOptions {
  text: string | undefined;
  /** the board, slide, tab or scene the request is about (a file in the project) */
  file?: string;
  /** fast AI instead of Claude Code: the request bar's quick edit, run in the editor's page (canvas, slides and motion) */
  fast?: boolean;
  /** a Claude Code session to continue: the `session` an earlier prompt returned */
  resume?: string;
  /** each step Claude Code takes (read, search, edit, run), as the editor's run feed shows it */
  onStep?: (step: AgentStep) => void;
  /** Claude Code's own words while it works */
  onText?: (text: string) => void;
  /** said once the editor's page is about to open (fast AI) */
  onOpening?: () => void;
  /** stops the run, as the editor's Stop button does */
  signal?: AbortSignal;
}

export interface PromptResult {
  name: string;
  /** `fast` when fast AI made the change itself; `claude` when Claude Code did, asked directly or handed over by fast AI */
  by: 'fast' | 'claude';
  outcome: 'done' | 'error' | 'stopped';
  /** Claude Code's last words, or why fast AI stopped */
  text: string;
  session?: string;
  /** fast AI: the statements it ran on the file, in order */
  statements?: { code: string; ok: boolean; error?: string }[];
  /** the change history entries the run made */
  entries: JournalLine[];
}

/** The kinds whose request bar has fast AI (`PromptBar`). */
const FAST_KINDS: Kind[] = ['design', 'slides', 'motion'];

interface RunEnd {
  outcome: PromptResult['outcome'];
  text: string;
  session?: string;
}

/**
 * Follows the editor's Claude Code runs on a project through its change stream, opened before
 * anything starts: a short run can end before the request that started it returns.
 */
async function delegateStream(ctx: Ctx, base: URL, o: Pick<PromptOptions, 'onStep' | 'onText'>) {
  const t = translator(ctx.lang);
  const listening = new AbortController();
  const events = await fetch(new URL('events', base), { signal: listening.signal });
  if (!events.ok || !events.body) throw new CommandError(t('cli.noEditorPage', { detail: `${events.status}` }), 1);
  type Ev = { id: string; state: string; text?: string; step?: AgentStep; session?: string };
  const seen: Ev[] = [];
  let wake: () => void = () => {};
  let failed: Error | null = null;
  void (async () => {
    const reader = events.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('the editor closed its change stream');
      buf += value;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const data = buf
          .slice(0, i)
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        buf = buf.slice(i + 2);
        try {
          const e = data ? JSON.parse(data) : null;
          if (e?.type === 'delegate') seen.push(e), wake();
        } catch {
          // not an event of ours
        }
      }
    }
  })().catch((e) => {
    if (listening.signal.aborted) return;
    failed = e;
    wake();
  });
  return {
    /** The id of the run that started with this request (fast AI handing over starts one the command did not). */
    adopt(prompt: string): string | undefined {
      return seen.find((e) => e.state === 'start' && e.text === prompt)?.id;
    },
    /** Waits for run `id` to end, passing on its steps and words. */
    follow(id: string): Promise<RunEnd> {
      let session: string | undefined;
      let at = 0;
      return new Promise<RunEnd>((done, fail) => {
        wake = () => {
          if (failed) return fail(failed);
          for (; at < seen.length; at++) {
            const e = seen[at];
            if (e.id !== id) continue;
            if (e.session) session = e.session;
            if (e.step) o.onStep?.(e.step);
            else if (e.text && e.state === 'progress') o.onText?.(e.text);
            if (e.state === 'done' || e.state === 'error' || e.state === 'stopped') return done({ outcome: e.state, text: e.text ?? '', session });
          }
        };
        wake();
      });
    },
    close: () => listening.abort(),
  };
}

/**
 * The request bar, from a command. By default its Hand to Claude Code: the editor runs Claude Code
 * on the project (its writes credited to it in the change history, live in any open editor) and
 * this waits for the run to end. With `fast`, the editor's page opens in Chrome and its fast AI
 * makes the edit as it does when a person types; when the model hands the request to Claude Code,
 * that run is followed the same way. Returns what changed.
 */
export async function prompt(ctx: Ctx, p: Project, o: PromptOptions): Promise<PromptResult> {
  const t = translator(ctx.lang);
  const text = o.text?.trim();
  if (!text) throw new CommandError(t('cli.needPrompt', { project: p.name }));
  if (o.fast && !FAST_KINDS.includes(p.kind)) throw new CommandError(t('cli.noFast', { kind: t(`cli.kind.${p.kind}`) }));
  const before = (await readJournal(p.dir)).at(-1)?.id;
  const startedAt = Date.now() - 1000;
  const run = await withEditor(ctx, p, !!o.fast, async ({ api, page, name }) => {
    const base = new URL(`api/projects/${encodeURIComponent(name)}/`, api);
    const headers = { 'content-type': 'application/json', 'x-dc-lang': ctx.lang };
    const stream = await delegateStream(ctx, base, o);
    let id = '';
    const stop = () => id && void fetch(new URL(`delegate/${id}`, base), { method: 'DELETE', headers }).catch(() => {});
    o.signal?.addEventListener('abort', stop);
    try {
      if (o.fast) {
        const r = await fastInPage(ctx, { editor: page, project: name, kind: p.kind, signal: o.signal, onOpening: o.onOpening }, text, o.file);
        if (r.status !== 'delegated') return { by: 'fast' as const, outcome: r.status === 'done' ? ('done' as const) : o.signal?.aborted ? ('stopped' as const) : ('error' as const), text: r.note ?? '', statements: r.lines };
        // the model said this needs Claude Code; the editor started that run
        id = (await waitFor(() => stream.adopt(text), 10_000)) ?? '';
        if (!id) throw new CommandError(t('cli.noEditorPage', { detail: 'hand-off' }), 1);
        return { by: 'claude' as const, statements: r.lines, ...(await stream.follow(id)) };
      }
      const r = await fetch(new URL('delegate', base), { method: 'POST', headers, body: JSON.stringify({ prompt: text, ...(o.file ? { file: o.file } : {}), ...(o.resume ? { resume: o.resume } : {}) }) });
      const v = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!r.ok || !v.id) throw new CommandError(v.error ?? `${r.status} ${r.statusText}`, 1);
      id = v.id;
      if (o.signal?.aborted) stop();
      return { by: 'claude' as const, ...(await stream.follow(id)) };
    } finally {
      o.signal?.removeEventListener('abort', stop);
      stream.close();
    }
  });
  // the editor credits a run's last writes for a moment after it ends (delegate.ts), then the history has them
  await new Promise((r) => setTimeout(r, run.by === 'claude' ? 2000 : 300));
  const all = await readJournal(p.dir);
  const entries = (before ? journalSince(all, { id: before }) : all) ?? journalSince(all, { after: startedAt })!;
  return { name: p.name, ...run, entries: entries.filter((e) => e.actor === 'claude' || e.actor === 'fast-edit') };
}

async function waitFor<T>(get: () => T | undefined, ms: number): Promise<T | undefined> {
  const until = Date.now() + ms;
  for (let v = get(); ; v = get()) {
    if (v !== undefined || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** The request typed into the request bar of the editor's page, with fast AI chosen. */
async function fastInPage(ctx: Ctx, o: { editor: string; project: string; kind: Kind; signal?: AbortSignal; onOpening?: () => void }, text: string, file?: string) {
  const t = translator(ctx.lang);
  const { withPage, PageExportError } = await import('./pageExport');
  o.onOpening?.();
  let r: { status: string; file?: string; note?: string; changed: boolean; lines: { code: string; ok: boolean; error?: string }[] };
  try {
    r = await withPage({ editor: o.editor, project: o.project, lang: ctx.lang, signal: o.signal }, async ({ call, quiet }) => {
      await quiet();
      return call(`window.tinglyDesign.fast(${JSON.stringify(text)}${file ? `, ${JSON.stringify(file)}` : ''})`, 300_000);
    });
  } catch (e) {
    if (e instanceof PageExportError && e.code === 'no-chrome') throw new CommandError(t('cli.noChrome'), 1);
    if (e instanceof PageExportError && e.code === 'no-editor') throw new CommandError(t('cli.noEditorPage', { detail: e.message }), 1);
    if (o.signal?.aborted) return { status: 'error', note: t('cli.promptStopped'), changed: false, lines: [] };
    throw e;
  }
  if (r.note === 'no-fast') throw new CommandError(t('cli.noFast', { kind: t(`cli.kind.${o.kind}`) }), 1);
  if (r.note?.startsWith('no-file:')) throw new CommandError(r.note.length > 8 ? t('cli.noFile', { file: r.note.slice(8) }) : t('cli.needFile'), 2);
  return r;
}

// ---------------------------------------------------------------- skills

/** Each kind's format reference: the file, the name and the one line that says when to read it. */
export async function skills() {
  const out: { kind: Kind; word: string; name: string; description: string; dir: string; file: string; text: string }[] = [];
  const words = Object.fromEntries(Object.entries(KINDS).filter(([w]) => w !== 'docs').map(([w, k]) => [k, w])) as Record<Kind, string>;
  for (const [kind, dir] of Object.entries(SKILLS) as [Kind, string][]) {
    const file = resolve(ROOT, '.claude', 'skills', dir, 'SKILL.md');
    const text = await readFile(file, 'utf8').catch(() => '');
    if (!text) continue;
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    const field = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(front)?.[1]?.trim() ?? '';
    out.push({ kind, word: words[kind], name: field('name') || dir, description: field('description'), dir, file, text });
  }
  return out;
}

/**
 * Copies the format references into a project's `.claude/skills/`, so Claude Code (or another agent
 * that reads skills) knows the files before it edits them. A skill already there with other text is
 * left alone unless `force`.
 */
export async function addSkills(o: { to?: string; force?: boolean } = {}) {
  const root = resolve(expandHome(o.to ?? '.'));
  const done: { name: string; file: string; state: 'added' | 'updated' | 'same' | 'kept' }[] = [];
  for (const s of await skills()) {
    const file = resolve(root, '.claude', 'skills', s.dir, 'SKILL.md');
    const had = await readFile(file, 'utf8').catch(() => null);
    const state = had === null ? 'added' : had === s.text ? 'same' : o.force ? 'updated' : 'kept';
    if (state === 'added' || state === 'updated') {
      await mkdir(resolve(file, '..'), { recursive: true });
      await writeFile(file, s.text, 'utf8');
    }
    done.push({ name: s.name, file, state });
  }
  return { root, skills: done };
}
