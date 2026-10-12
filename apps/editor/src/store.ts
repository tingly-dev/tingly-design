import { create } from 'zustand';
import {
  applyHumanOps,
  rebaseSwap,
  parseCanvas,
  parseDc,
  type DcDoc,
  stringifyCanvas,
  CANVAS_FILE,
  type Actor,
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
}

export interface DelegateState {
  id: string;
  prompt: string;
  state: 'start' | 'progress' | 'done' | 'error';
  lines: string[];
  result?: string;
}

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
  toasts: Toast[];
  undo: UndoItem[];
  redo: UndoItem[];
}

export const useStore = create<State>(() => ({
  project: null,
  kind: null,
  slide: null,
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
  set({ project: name, loaded: false, files: {}, drafts: {}, journal: [], selection: null, undo: [], redo: [], delegates: [], slide: null, present: null });
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
      return { files: { ...s.files, [e.path]: { server: { content: e.content, version: e.version }, pending: cur?.pending ?? [] } } };
    });
  } else if (e.type === 'delete') {
    set((s) => {
      const files = { ...s.files };
      delete files[e.path];
      return { files };
    });
  } else if (e.type === 'assets') {
    void import('./ds').then((m) => m.assetsChanged());
  } else if (e.type === 'journal') {
    set((s) => (s.journal.some((j) => j.id === e.entry.id) ? {} : { journal: [...s.journal, e.entry].slice(-500) }));
  } else if (e.type === 'delegate') {
    set((s) => {
      const list = [...s.delegates];
      let d = list.find((x) => x.id === e.id);
      if (!d) {
        d = { id: e.id, prompt: e.text ?? '', state: 'start', lines: [] };
        list.push(d);
      } else {
        d = { ...d };
        list[list.indexOf(list.find((x) => x.id === e.id)!)] = d;
      }
      if (e.state === 'progress' && e.text) d.lines = [...d.lines, e.text].slice(-30);
      if (e.state === 'done' || e.state === 'error') d.result = e.text;
      if (e.state !== 'start') d.state = e.state;
      return { delegates: list.slice(-5) };
    });
    if (e.state === 'done' || e.state === 'error') {
      const ok = e.state === 'done';
      if (get().fast.status === 'delegated') {
        set((s) => ({ fast: { ...s.fast, status: ok ? 'done' : 'error', note: ok ? `Claude Code 完成：${e.text ?? ''}` : undefined } }));
      }
      toast(ok ? 'Claude Code 完成：' + (e.text ?? '').slice(0, 120) : 'Claude Code 没能完成：' + (e.text ?? '').slice(0, 200), ok ? 'info' : 'error');
    }
  }
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
    toast((e as Error).message, 'error');
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
          toast(`${file}：${(e as Error).message}`, 'error');
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
          toast(`保存 ${file} 失败：${(e as Error).message}`, 'error');
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
          toast(`${file} 一直在被其他人修改，这次编辑没有保存。`, 'error');
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
  let first: ReturnType<typeof applyHumanOps>;
  try {
    first = applyHumanOps(cur, ops, inertDocument());
  } catch (e) {
    toast((e as Error).message, 'error');
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
    if ('conflict' in r) return toast(`${file} 刚被别人改过，没有删除。`, 'error');
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
    navigator.clipboard?.writeText(c.kind === 'el' ? c.html : JSON.stringify(c.items, null, 2)).catch(() => {});
  } catch {
    // clipboard permission is optional: the in-app clipboard still works
  }
}
export function getClip(): Clip | null {
  return clip;
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
