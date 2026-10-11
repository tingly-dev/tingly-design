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

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

interface State {
  project: string | null;
  health: Health | null;
  connected: boolean;
  loaded: boolean;
  files: Record<string, FileEntry>;
  drafts: Record<string, string>;
  journal: JournalEntry[];
  selection: Selection;
  tool: 'select' | 'hand';
  mode: Mode;
  view: { x: number; y: number; zoom: number };
  viewport: { w: number; h: number };
  runtimeErrors: Record<string, string | null>;
  fast: FastState;
  delegates: DelegateState[];
  toasts: Toast[];
  undo: UndoItem[];
  redo: UndoItem[];
  leftTab: 'boards' | 'journal';
}

export const useStore = create<State>(() => ({
  project: null,
  health: null,
  connected: false,
  loaded: false,
  files: {},
  drafts: {},
  journal: [],
  selection: null,
  tool: 'select',
  mode: 'edit',
  view: { x: 80, y: 120, zoom: 0.5 },
  viewport: { w: 1000, h: 700 },
  runtimeErrors: {},
  fast: { status: 'idle', mode: 'ai', lines: [] },
  delegates: [],
  toasts: [],
  undo: [],
  redo: [],
  leftTab: 'boards',
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
  set({ project: name, loaded: false, files: {}, drafts: {}, journal: [], selection: null, undo: [], redo: [], delegates: [] });
  const [{ files }, journal] = await Promise.all([api.files(name), api.journal(name)]);
  const entries: Record<string, FileEntry> = {};
  for (const [path, st] of Object.entries(files)) entries[path] = { server: st, pending: [] };
  set({ files: entries, journal, loaded: true });
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

export function fitTo(rect: { x: number; y: number; w: number; h: number }, pad = 60): void {
  const { viewport } = get();
  const zoom = Math.min(2, Math.max(0.05, Math.min((viewport.w - pad * 2) / rect.w, (viewport.h - pad * 2 - 80) / rect.h)));
  setView({ zoom, x: (viewport.w - rect.w * zoom) / 2 - rect.x * zoom, y: (viewport.h - 80 - rect.h * zoom) / 2 - rect.y * zoom });
}

export function contentBounds(c: CanvasJson): { x: number; y: number; w: number; h: number } | null {
  const rects: { x: number; y: number; w: number; h: number }[] = Object.values(c.boards).map((b) => ({ x: b.x, y: b.y - 40, w: b.w, h: b.h + 40 }));
  for (const n of Object.values(c.notes)) {
    if (typeof n.x !== 'number') continue;
    const w = n.kind === 'title1' ? Math.min(n.maxW ?? 1600, 1600) : n.w ?? 320;
    const h = n.kind === 'title1' ? 90 : n.maxH ?? (n.w ?? 320) * (4 / 3);
    rects.push({ x: n.x, y: n.y, w, h });
  }
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
  const b = canvasOf(get()).boards[file];
  if (b) fitTo({ x: b.x, y: b.y - 40, w: b.w, h: b.h + 40 }, 80);
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
    return b && b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0;
  });
}
