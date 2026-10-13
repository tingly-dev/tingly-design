import { create } from 'zustand';
import {
  applyHumanOps,
  editsForFormat,
  sceneIdOf,
  rebaseSwap,
  parseCanvas,
  parseDc,
  type DcDoc,
  stringifyCanvas,
  CANVAS_FILE,
  type Actor,
  type AgentStep,
  type CanvasJson,
  type HumanOp,
  type JournalEntry,
  type Mode,
  type Inspect,
  type NoteEntry,
  noteBox,
  DECK_FILE,
  deckOrder,
  parseDeck,
  projectKind,
  slideFile,
  stringifyDeck,
  type DeckJson,
  type ProjectKind,
} from '@dc/core';
import { api, type FileState, type Health, type ServerEvent } from './api';
import { t } from './i18n';

/** What a failed edit says to the person: a rebase conflict in the editor's own words, anything else as thrown. */
function errorText(e: unknown): string {
  if ((e as { code?: unknown } | null)?.code === 'rebase-conflict') return t('errors.rebaseConflict');
  return (e as Error).message;
}

/**
 * Editor state. Each file has the last version the server confirmed and a
 * queue of pending edits. What the canvas shows is the newest pending
 * result (optimistic), so edits appear instantly; the queue then saves them
 * one by one against the server's version. On a 409 the edit is replayed on
 * the newer file — which is why every edit is kept as a function of the
 * source, not as a finished string.
 */

export type Selection =
  | { kind: 'el'; file: string; tid: number }
  | { kind: 'board'; file: string }
  | { kind: 'note'; id: string }
  | null;

export interface Pending {
  id: number;
  basis: string;
  optimistic: string;
  apply: (src: string) => string | Promise<string>;
  actor: Actor;
  summary: string;
  prompt?: string;
}

export interface FileEntry {
  server: FileState | null;
  pending: Pending[];
}

export interface FastLine {
  code: string;
  ok: boolean;
  error?: string;
  /** a marker between attempts, not a statement */
  divider?: boolean;
}

export interface FastState {
  status: 'idle' | 'running' | 'done' | 'error' | 'delegated';
  mode: 'ai' | 'jquery';
  file?: string;
  prompt?: string;
  lines: FastLine[];
  note?: string;
  startedAt?: number;
  endedAt?: number;
  /** the run saved a change, so it can be undone */
  changed?: boolean;
}

/** One line of a Claude Code run: a step it took, or something it said. */
export type DelegateEntry = { step: AgentStep; at: number } | { say: string; at: number };

export interface DelegateState {
  id: string;
  prompt: string;
  state: 'start' | 'progress' | 'done' | 'error' | 'stopped';
  log: DelegateEntry[];
  startedAt: number;
  endedAt?: number;
  result?: string;
  /** set when the fast model handed the request over */
  via?: 'fast';
  /** project files the run changed, in the order it first touched them */
  files: string[];
  /** each changed file before the run touched it (null: the run created it) and as the run left it, to undo the run */
  before: Record<string, string | null>;
  after: Record<string, string>;
  undone?: boolean;
}

/** Which run the prompt bar's feed shows: the fast model's, or a Claude Code run by id. */
export type LastRun = { kind: 'fast' } | { kind: 'delegate'; id: string } | null;

interface UndoItem {
  file: string;
  before: string;
  after: string;
}

export type Tool = 'select' | 'hand' | 'text' | 'frame' | 'note' | 'draw' | 'rect' | 'oval' | 'line' | 'arrow';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

/** Presenting a deck: which slide, how far its builds have played, how many steps it has. */
export interface Present {
  index: number;
  step: number;
  total: number;
  /** the slide being left, while a transition plays */
  leaving: { index: number; dir: 1 | -1 } | null;
  notes: boolean;
}

interface State {
  project: string | null;
  /** design canvas or slide deck, from the project's files */
  kind: ProjectKind | null;
  /** slides: the slide on the stage */
  slide: string | null;
  /**
   * motion: the format the stage shows. Style edits in any format but the
   * primary one go to that format's `data-<format>` override.
   */
  motionView: { format: string; primary: string; scene: string | null; at: number; landed: boolean } | null;
  present: Present | null;
  health: Health | null;
  connected: boolean;
  loaded: boolean;
  files: Record<string, FileEntry>;
  drafts: Record<string, string>;
  journal: JournalEntry[];
  selection: Selection;
  tool: Tool;
  mode: Mode;
  /** right panel */
  panelOpen: boolean;
  panelTab: 'props' | 'code' | 'tweaks';
  /** what the runtime measured about the selected element */
  inspect: Inspect | null;
  /** rendered instances per tid, per artboard (for "Repeating group · N items") */
  counts: Record<string, Record<number, number>>;
  /** layer-tree hover, mirrored as an outline inside the artboard */
  layerHover: { file: string; tid: number } | null;
  /** current page id ('' = the first page) */
  page: string;
  /** an artboard opened full window */
  focused: string | null;
  /** a note being retyped on the canvas */
  editingNote: string | null;
  menu: { x: number; y: number } | null;
  journalOpen: boolean;
  view: { x: number; y: number; zoom: number };
  viewport: { w: number; h: number };
  runtimeErrors: Record<string, string | null>;
  fast: FastState;
  delegates: DelegateState[];
  /** jQuery typed by hand in the Code tab (also filled from the run feed) */
  jqDraft: string;
  /** the run the feed above the prompt shows, and whether the person closed it */
  lastRun: LastRun;
  runHidden: boolean;
  /** how many run feeds are on screen: when none is, a finished run is announced by a toast instead */
  feeds: number;
  toasts: Toast[];
  undo: UndoItem[];
  redo: UndoItem[];
}

export const useStore = create<State>(() => ({
  project: null,
  kind: null,
  slide: null,
  motionView: null,
  present: null,
  health: null,
  connected: false,
  loaded: false,
  files: {},
  drafts: {},
  journal: [],
  selection: null,
  tool: 'select',
  mode: 'edit',
  panelOpen: (() => {
    try {
      return localStorage.getItem('dc.panelOpen') !== '0';
    } catch {
      return true;
    }
  })(),
  panelTab: 'props',
  inspect: null,
  counts: {},
  layerHover: null,
  page: '',
  focused: null,
  editingNote: null,
  menu: null,
  journalOpen: false,
  view: { x: 80, y: 120, zoom: 0.5 },
  viewport: { w: 1000, h: 700 },
  runtimeErrors: {},
  fast: { status: 'idle', mode: 'ai', lines: [] },
  delegates: [],
  jqDraft: '',
  lastRun: null,
  runHidden: false,
  feeds: 0,
  toasts: [],
  undo: [],
  redo: [],
}));

const get = useStore.getState;
const set = useStore.setState;

// ----------------------------------------------------------------- reading

export function display(s: State, file: string): string | undefined {
  const d = s.drafts[file];
  if (d !== undefined) return d;
  const e = s.files[file];
  if (!e) return undefined;
  return e.pending.length ? e.pending[e.pending.length - 1].optimistic : e.server?.content;
}

let canvasCache: { text: string | undefined; canvas: CanvasJson } = { text: undefined, canvas: parseCanvas(undefined) };
export function canvasOf(s: State): CanvasJson {
  const text = display(s, CANVAS_FILE);
  if (text !== canvasCache.text) canvasCache = { text, canvas: parseCanvas(text) };
  return canvasCache.canvas;
}

const docCache = new Map<string, DcDoc>();
/** Parsed artboard source, cached by content (selectors run on every pan and zoom). */
export function parsed(src: string): DcDoc {
  let d = docCache.get(src);
  if (!d) {
    d = parseDc(src);
    if (docCache.size > 32) docCache.delete(docCache.keys().next().value!);
    docCache.set(src, d);
  }
  return d;
}

let deckCache: { text: string | undefined; deck: DeckJson } = { text: undefined, deck: parseDeck(undefined) };
export function deckOf(s: State): DeckJson {
  const text = display(s, DECK_FILE);
  if (text !== deckCache.text) deckCache = { text, deck: parseDeck(text) };
  return deckCache.deck;
}

export function useDeck(): DeckJson {
  return useStore((s) => deckOf(s));
}

let idsCache: { deck: DeckJson | null; keys: string; ids: string[] } = { deck: null, keys: '', ids: [] };
/** Slide ids in deck order (files `order` leaves out come last), stable between renders. */
export function slideIds(s: State): string[] {
  const deck = deckOf(s);
  const keys = Object.keys(s.files).filter((f) => f.startsWith('slides/') && (s.files[f].server || s.files[f].pending.length)).join('|');
  if (idsCache.deck !== deck || idsCache.keys !== keys) idsCache = { deck, keys, ids: deckOrder(deck, keys ? keys.split('|') : []) };
  return idsCache.ids;
}

export function useSlideIds(): string[] {
  return useStore((s) => slideIds(s));
}

/** The file the stage shows (slides) — what the prompt bar and the panel act on by default. */
export function currentSlideFile(s: State): string | null {
  return s.slide ? slideFile(s.slide) : null;
}

export function editDeck(mutate: (d: DeckJson) => void, summary: string, undoable = true): boolean {
  return edit(
    DECK_FILE,
    (src) => {
      const d = structuredClone(parseDeck(src));
      mutate(d);
      return stringifyDeck(d);
    },
    { actor: 'human', summary, undoable },
  );
}

export function useCanvas(): CanvasJson {
  return useStore((s) => canvasOf(s));
}

export function useSource(file: string): string | undefined {
  return useStore((s) => display(s, file));
}

// ----------------------------------------------------------------- toasts

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts, { id, text, kind }].slice(-4) }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3500);
}

// ----------------------------------------------------------------- loading

let stopEvents: (() => void) | null = null;

export async function openProject(name: string): Promise<void> {
  stopEvents?.();
  set({ project: name, loaded: false, files: {}, drafts: {}, journal: [], selection: null, undo: [], redo: [], delegates: [], lastRun: null, runHidden: false, slide: null, present: null, motionView: null });
  const [{ files }, journal] = await Promise.all([api.files(name), api.journal(name)]);
  const entries: Record<string, FileEntry> = {};
  for (const [path, st] of Object.entries(files)) entries[path] = { server: st, pending: [] };
  const kind = projectKind(Object.keys(files));
  set({ files: entries, journal, loaded: true, kind });
  if (kind === 'slides') {
    const ids = slideIds(get());
    const want = new URLSearchParams(location.search).get('s');
    set({ slide: want && ids.includes(want) ? want : ids[0] ?? null });
  }
  stopEvents = api.events(name, onEvent, (st) => set({ connected: st === 'open' }));
}

function onEvent(e: ServerEvent): void {
  if (e.type === 'file') {
    set((s) => {
      const cur = s.files[e.path];
      if (cur?.server?.version === e.version) return {};
      const files = { ...s.files, [e.path]: { server: { content: e.content, version: e.version }, pending: cur?.pending ?? [] } };
      const run = e.actor === 'claude' ? creditedRun(s.delegates) : -1;
      if (run < 0) return { files };
      // remember the file as it was before this run first touched it, so the run can be undone
      const delegates = [...s.delegates];
      const d = { ...delegates[run] };
      if (!(e.path in d.before)) d.before = { ...d.before, [e.path]: cur?.server?.content ?? null };
      d.after = { ...d.after, [e.path]: e.content };
      if (!d.files.includes(e.path)) d.files = [...d.files, e.path];
      delegates[run] = d;
      return { files, delegates };
    });
  } else if (e.type === 'delete') {
    set((s) => {
      const files = { ...s.files };
      delete files[e.path];
      return { files };
    });
  } else if (e.type === 'assets') {
    void import('./ds').then((m) => m.assetsChanged());
    if (get().kind === 'dashboard') void import('./dash').then((m) => m.dataChanged(e.path));
  } else if (e.type === 'journal') {
    set((s) => (s.journal.some((j) => j.id === e.entry.id) ? {} : { journal: [...s.journal, e.entry].slice(-500) }));
  } else if (e.type === 'delegate') {
    const now = Date.now();
    set((s) => {
      const list = [...s.delegates];
      const i = list.findIndex((x) => x.id === e.id);
      const d: DelegateState =
        i >= 0
          ? { ...list[i] }
          : { id: e.id, prompt: e.text ?? '', state: 'start', log: [], startedAt: e.at ?? now, files: [], before: {}, after: {}, ...(s.fast.status === 'delegated' && s.lastRun?.kind === 'fast' ? { via: 'fast' as const } : {}) };
      if (i >= 0) list[i] = d;
      else list.push(d);
      if (e.state === 'start') {
        d.prompt = e.text ?? d.prompt;
        if (e.at) d.startedAt = e.at;
      }
      if (e.state === 'progress') {
        if (e.step) {
          d.log = [...d.log, { step: e.step, at: now }].slice(-60);
          if (e.step.changed && !d.files.includes(e.step.changed)) d.files = [...d.files, e.step.changed];
        } else if (e.text) d.log = [...d.log, { say: e.text, at: now }].slice(-60);
      }
      if (e.state === 'done' || e.state === 'error' || e.state === 'stopped') {
        // a stopped run says so in the feed's own words (prompt.run.stoppedNote); the server sends no text for it
        d.result = e.state === 'stopped' ? undefined : e.text;
        d.endedAt = now;
      }
      if (e.state !== 'start') d.state = e.state;
      // a new run takes over the feed; a later event of an older run does not
      const fresh = i < 0;
      return { delegates: list.slice(-5), ...(fresh ? { lastRun: { kind: 'delegate', id: e.id } as LastRun, runHidden: false } : {}) };
    });
    if (e.state === 'done' || e.state === 'error') {
      const ok = e.state === 'done';
      if (get().fast.status === 'delegated') setFastDone(ok);
      // the feed above the prompt already says so; a toast is for when no feed is on screen
      if (!get().feeds) toast(ok ? t('app.delegate.done', { text: (e.text ?? '').slice(0, 120) }) : t('app.delegate.failed', { text: (e.text ?? '').slice(0, 200) }), ok ? 'info' : 'error');
    }
  }
}

function setFastDone(ok: boolean): void {
  set((s) => ({ fast: { ...s.fast, status: ok ? 'done' : 'error', endedAt: Date.now() } }));
}

/** The run a Claude write belongs to: the newest one running, or one that ended a moment ago (its last writes arrive late). */
function creditedRun(list: DelegateState[]): number {
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    if (d.state === 'start' || d.state === 'progress' || (d.endedAt && Date.now() - d.endedAt < 2000)) return i;
  }
  return -1;
}

/** Put back every file a Claude Code run changed, as it was before the run; files it created are removed. */
export function undoDelegate(id: string): void {
  const d = get().delegates.find((x) => x.id === id);
  if (!d || d.undone) return;
  for (const [file, after] of Object.entries(d.after)) {
    const before = d.before[file];
    if (before === null) void deleteFile(file);
    else if (before !== undefined) edit(file, (src) => rebaseSwap(src, after, before), { actor: 'undo', summary: t('app.journal.undoClaude'), undoable: false });
  }
  set((s) => ({ delegates: s.delegates.map((x) => (x.id === id ? { ...x, undone: true } : x)) }));
}

// ----------------------------------------------------------------- saving

let pendingId = 0;
const pumping = new Set<string>();

function patchEntry(file: string, fn: (e: FileEntry) => FileEntry): void {
  set((s) => ({ files: { ...s.files, [file]: fn(s.files[file] ?? { server: null, pending: [] }) } }));
}

interface EditOptions {
  actor: Actor;
  summary: string;
  prompt?: string;
  undoable?: boolean;
}

/** Queue an edit already computed against `basis`. `apply` replays it on a newer file after a conflict. */
export function enqueueResult(
  file: string,
  basis: string,
  optimistic: string,
  apply: Pending['apply'],
  opts: EditOptions,
): boolean {
  if (optimistic === basis) return false;
  const item: Pending = { id: ++pendingId, basis, optimistic, apply, actor: opts.actor, summary: opts.summary, prompt: opts.prompt };
  patchEntry(file, (e) => ({ ...e, pending: [...e.pending, item] }));
  if (opts.undoable !== false) set((s) => ({ undo: [...s.undo, { file, before: basis, after: optimistic }].slice(-100), redo: [] }));
  void pump(file);
  return true;
}

/** Queue a synchronous edit of a file's source. */
export function edit(file: string, apply: (src: string) => string, opts: EditOptions): boolean {
  const cur = display(get(), file) ?? '';
  let next: string;
  try {
    next = apply(cur);
  } catch (e) {
    toast(errorText(e), 'error');
    return false;
  }
  return enqueueResult(file, cur, next, apply, opts);
}

async function pump(file: string): Promise<void> {
  if (pumping.has(file)) return;
  pumping.add(file);
  try {
    for (;;) {
      const entry = get().files[file];
      const item = entry?.pending[0];
      const project = get().project;
      if (!item || !project) break;
      let attempts = 0;
      for (;;) {
        const server = get().files[file]?.server ?? null;
        const base = server?.content ?? '';
        let next: string;
        try {
          next = base === item.basis ? item.optimistic : await item.apply(base);
        } catch (e) {
          toast(t('app.save.editFailed', { file, error: errorText(e) }), 'error');
          dropFirst(file);
          break;
        }
        let r: Awaited<ReturnType<typeof api.put>>;
        try {
          r = await api.put(project, file, {
            content: next,
            baseVersion: server?.version ?? null,
            actor: item.actor,
            summary: item.summary,
            prompt: item.prompt,
          });
        } catch (e) {
          toast(t('app.save.failed', { file, error: (e as Error).message }), 'error');
          dropFirst(file);
          break;
        }
        if ('version' in r) {
          patchEntry(file, (e) => ({ server: { content: next, version: r.version }, pending: e.pending.slice(1) }));
          break;
        }
        // someone saved in between: take their version and replay this edit on it
        patchEntry(file, (e) => ({ ...e, server: r.conflict }));
        if (++attempts >= 3) {
          toast(t('app.save.keptChanging', { file }), 'error');
          dropFirst(file);
          break;
        }
      }
    }
  } finally {
    pumping.delete(file);
  }
}

function dropFirst(file: string): void {
  patchEntry(file, (e) => ({ ...e, pending: e.pending.slice(1) }));
}

export function isSaving(s: State): boolean {
  return Object.values(s.files).some((f) => f.pending.length > 0);
}

// ----------------------------------------------------------------- edits

let inert: Document | null = null;
export function inertDocument(): Document {
  inert ??= document.implementation.createHTMLDocument('');
  return inert;
}

export function editElement(file: string, ops: HumanOp[], actor: Actor = 'human'): boolean {
  const cur = display(get(), file);
  if (cur === undefined) return false;
  const view = get().motionView;
  if (view && view.format !== view.primary && sceneIdOf(file)) ops = editsForFormat(ops, parsed(cur), view.format);
  let first: ReturnType<typeof applyHumanOps>;
  try {
    first = applyHumanOps(cur, ops, inertDocument());
  } catch (e) {
    toast(errorText(e), 'error');
    return false;
  }
  if (!first.changed) return false;
  return enqueueResult(file, cur, first.source, (src) => applyHumanOps(src, ops, inertDocument()).source, {
    actor,
    summary: first.summary,
  });
}

export function editCanvas(mutate: (c: CanvasJson) => void, summary: string, undoable = true): boolean {
  return edit(
    CANVAS_FILE,
    (src) => {
      const c = structuredClone(parseCanvas(src));
      mutate(c);
      return stringifyCanvas(c);
    },
    { actor: 'human', summary, undoable },
  );
}

export function undo(): void {
  const item = get().undo.at(-1);
  if (!item) return;
  set((s) => ({ undo: s.undo.slice(0, -1), redo: [...s.redo, item] }));
  edit(item.file, (src) => rebaseSwap(src, item.after, item.before), { actor: 'undo', summary: 'undo', undoable: false });
}

export function redo(): void {
  const item = get().redo.at(-1);
  if (!item) return;
  set((s) => ({ redo: s.redo.slice(0, -1), undo: [...s.undo, item] }));
  edit(item.file, (src) => rebaseSwap(src, item.before, item.after), { actor: 'undo', summary: 'redo', undoable: false });
}

/** Delete a file once its queued edits are saved (a deck's slides, an artboard). */
export async function deleteFile(file: string): Promise<void> {
  const project = get().project;
  if (!project) return;
  for (let i = 0; i < 50 && (get().files[file]?.pending.length ?? 0) > 0; i++) await new Promise((r) => setTimeout(r, 100));
  const v = get().files[file]?.server?.version;
  if (v) {
    const r = await api.remove(project, file, v);
    if ('conflict' in r) return toast(t('app.save.deleteConflict', { file }), 'error');
  }
  set((s) => {
    const files = { ...s.files };
    delete files[file];
    return { files };
  });
}

export async function deleteBoard(file: string): Promise<void> {
  const project = get().project;
  if (!project) return;
  editCanvas((c) => {
    delete c.boards[file];
    c.order = c.order.filter((f) => f !== file);
  }, `artboard ${file} removed`, false);
  set({ selection: null });
  // wait for any queued edits of the file itself, then delete it
  for (let i = 0; i < 50 && (get().files[file]?.pending.length ?? 0) > 0; i++) await new Promise((r) => setTimeout(r, 100));
  const v = get().files[file]?.server?.version;
  if (v) await api.remove(project, file, v);
}

// ----------------------------------------------------------------- view

export function setView(v: Partial<State['view']>): void {
  set((s) => ({ view: { ...s.view, ...v } }));
}

export function zoomAt(factor: number, sx: number, sy: number): void {
  const { view } = get();
  const zoom = Math.min(4, Math.max(0.05, view.zoom * factor));
  const k = zoom / view.zoom;
  setView({ zoom, x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k });
}

export function fitTo(rect: { x: number; y: number; w: number; h: number }, pad = 64): void {
  const { viewport } = get();
  const zoom = Math.min(2, Math.max(0.05, Math.min((viewport.w - pad * 2) / rect.w, (viewport.h - pad * 2) / rect.h)));
  setView({ zoom, x: (viewport.w - rect.w * zoom) / 2 - rect.x * zoom, y: (viewport.h - rect.h * zoom) / 2 - rect.y * zoom });
}

/** Is a board or note on the current page? Items without a page sit on the first page. */
export function onPage(c: CanvasJson, page: string | undefined, current: string): boolean {
  const first = c.pages[0]?.id ?? '';
  const p = page ?? first;
  return (current || first) === p || (!page && !current);
}

export function contentBounds(c: CanvasJson, page = get().page): { x: number; y: number; w: number; h: number } | null {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  for (const b of Object.values(c.boards)) if (onPage(c, b.page, page)) rects.push({ x: b.x, y: b.y - 40, w: b.w, h: b.h + 40 });
  for (const n of Object.values(c.notes)) if (typeof n.x === 'number' && onPage(c, n.page, page)) rects.push(noteBox(n));
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

export function fitAll(): void {
  const b = contentBounds(canvasOf(get()));
  if (b) fitTo(b);
}

export function focusBoard(file: string): void {
  const c = canvasOf(get());
  const b = c.boards[file];
  if (!b) return;
  if (b.page && b.page !== get().page) set({ page: b.page });
  fitTo({ x: b.x, y: b.y - 40, w: b.w, h: b.h + 40 }, 80);
}

/** Zoom to whatever is selected (Shift+2). */
export function zoomToSelection(): void {
  const s = get();
  const c = canvasOf(s);
  const sel = s.selection;
  if (sel?.kind === 'board' || sel?.kind === 'el') focusBoard(sel.file);
  else if (sel?.kind === 'note' && c.notes[sel.id]) {
    const b = noteBox(c.notes[sel.id]);
    fitTo({ x: b.x, y: b.y, w: Math.max(b.w, 200), h: Math.max(b.h, 120) }, 120);
  } else fitAll();
}

export function visibleBoards(): string[] {
  const s = get();
  const c = canvasOf(s);
  const { view, viewport } = s;
  const x0 = -view.x / view.zoom;
  const y0 = -view.y / view.zoom;
  const x1 = x0 + viewport.w / view.zoom;
  const y1 = y0 + viewport.h / view.zoom;
  return c.order.filter((f) => {
    const b = c.boards[f];
    return b && onPage(c, b.page, s.page) && b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0;
  });
}

/** Screen point → canvas point. */
export function toCanvas(sx: number, sy: number): { x: number; y: number } {
  const { view } = get();
  return { x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom };
}

// ----------------------------------------------------------------- clipboard

export type Clip = { kind: 'el'; html: string } | { kind: 'items'; items: NoteEntry[] };
let clip: Clip | null = null;
export function setClip(c: Clip): void {
  clip = c;
  try {
    navigator.clipboard?.writeText(clipText()).catch(() => {});
  } catch {
    // clipboard permission is optional: the in-app clipboard still works
  }
}
export function getClip(): Clip | null {
  return clip;
}
/** The text the in-app clipboard put on the system clipboard: pasting it back is a paste, not an import. */
export function clipText(): string {
  return !clip ? '' : clip.kind === 'el' ? clip.html : JSON.stringify(clip.items, null, 2);
}

// remember whether the panel is open, per browser
useStore.subscribe((st, prev) => {
  if (st.panelOpen !== prev.panelOpen) {
    try {
      localStorage.setItem('dc.panelOpen', st.panelOpen ? '1' : '0');
    } catch {
      // storage unavailable: the default applies next time
    }
  }
});
