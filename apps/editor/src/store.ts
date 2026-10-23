import { create } from 'zustand';
import { turnOfDelegate, turnOfFast } from './turns';
import { agentInitial, agentReset, delegateEventPatch, endTurnPatch, type AgentState, type BarMode, type DelegateState } from './store/agent';
import {
  rebaseSwap,
  parseCanvas,
  parseDc,
  type DcDoc,
  CANVAS_FILE,
  type Actor,
  type Turn,
  type CanvasJson,
  type JournalEntry,
  type Mode,
  type Inspect,
  DECK_FILE,
  deckOrder,
  parseDeck,
  projectKind,
  stringifyDeck,
  type DeckJson,
  type ProjectKind,
  isDataPath,
} from '@dc/core';
import { api, type FileState, type Health, type ServerEvent } from './api';
import { t } from './i18n';
import { headlessRun } from './headless';
import { readPref, writePref } from './local';
import { deleteFile, edit } from './editEngine';

export { deleteBoard, deleteFile, edit, editCanvas, editElement, enqueueResult, inertDocument, isSaving, redo, retypeText, undo } from './editEngine';

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
  /** one thing the toast offers to do, such as undoing what it reports */
  action?: { label: string; run: () => void };
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

export interface State extends AgentState {
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
  /** the AI settings dialog (components/AiSettings.tsx), opened from the launcher, the project menu and the prompt bar */
  aiSettingsOpen: boolean;
  connected: boolean;
  /** counts the outside changes to pictures and fonts, so frames drawing them ask for the new file (api.frameBase) */
  assetRev: number;
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
  /** jQuery typed by hand in the Code tab (also filled from the run feed) */
  jqDraft: string;
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
  aiSettingsOpen: false,
  connected: false,
  assetRev: 0,
  loaded: false,
  files: {},
  drafts: {},
  journal: [],
  selection: null,
  tool: 'select',
  mode: 'edit',
  panelOpen: readPref('dc.panelOpen') !== '0',
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
  jqDraft: '',
  ...agentInitial(),
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

// ----------------------------------------------------------------- toasts

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']): void {
  // an export run from the command line reports its errors there, and nothing else needs showing
  if (headlessRun(text, kind)) return;
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts, { id, text, kind, action }].slice(-4) }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : action ? 6000 : Math.max(3500, text.length * 60));
}

// ----------------------------------------------------------------- loading

let stopEvents: (() => void) | null = null;

export async function openProject(asked: string): Promise<void> {
  stopEvents?.();
  // an address from an older version names the project as it was named then
  const name = await api.resolve(asked).then((r) => r.name, () => asked);
  if (name !== asked) history.replaceState(null, '', `${location.pathname}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), p: name })}`);
  set({ project: name, loaded: false, files: {}, drafts: {}, journal: [], selection: null, undo: [], redo: [], ...agentReset(), slide: null, present: null, motionView: null });
  const [{ files }, journal, conversation, turns] = await Promise.all([api.files(name), api.journal(name), api.conversation(name).catch(() => null), api.transcript(name).catch(() => [] as Turn[])]);
  const entries: Record<string, FileEntry> = {};
  for (const [path, st] of Object.entries(files)) entries[path] = { server: st, pending: [] };
  const kind = projectKind(Object.keys(files));
  set((s) => ({ files: entries, journal, loaded: true, kind, conversation: s.conversation ?? conversation, turns }));
  if (kind === 'slides') {
    const ids = slideIds(get());
    const want = new URLSearchParams(location.search).get('s');
    set({ slide: want && ids.includes(want) ? want : ids[0] ?? null });
  }
  stopEvents = api.events(name, onEvent, (st) => set({ connected: st === 'open' }));
}

let assetTimer: ReturnType<typeof setTimeout> | undefined;
/** An import or an agent can touch many pictures in a burst; the frames redraw once after it. */
function bumpAssetRev(): void {
  clearTimeout(assetTimer);
  assetTimer = setTimeout(() => set((s) => ({ assetRev: s.assetRev + 1 })), 150);
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
    void import('./components/ds/ds').then((m) => m.assetsChanged());
    if (e.path && !isDataPath(e.path)) bumpAssetRev();
    if (get().kind === 'dashboard') void import('./components/dash/dash').then((m) => m.dataChanged(e.path));
  } else if (e.type === 'journal') {
    set((s) => (s.journal.some((j) => j.id === e.entry.id) ? {} : { journal: [...s.journal, e.entry].slice(-500) }));
  } else if (e.type === 'delegate') {
    const now = Date.now();
    set((s) => delegateEventPatch(s, e, now));
    if (e.state === 'done' || e.state === 'error' || e.state === 'stopped') {
      const d = get().delegates.find((x) => x.id === e.id);
      if (d) endTurn(turnOfDelegate(d));
    }
    if (e.state === 'done' || e.state === 'error') {
      const ok = e.state === 'done';
      if (get().fast.status === 'delegated') setFastDone(ok);
      // the feed above the prompt already says so; a toast is for when no feed is on screen
      if (!get().feeds) toast(ok ? t('app.delegate.done', { text: (e.text ?? '').slice(0, 120) }) : t('app.delegate.failed', { text: (e.text ?? '').slice(0, 200) }), ok ? 'info' : 'error');
    }
  }
}

/** Where the prompt lives (kept across sessions, the same in every kind). */
export function setBarMode(mode: BarMode): void {
  writePref('dc.barMode', mode);
  set({ barMode: mode, historyOpen: false, chatNote: null });
}

export function setBarCollapsed(on: boolean): void {
  writePref('dc.barCollapsed', on ? '1' : '0');
  set({ barCollapsed: on, historyOpen: false });
}

const endTurn = (turn: Turn): void => set((s) => endTurnPatch(s, turn));

// a fast-model request is one store value; when it ends it becomes a turn, kept here and by the server
const settled = new Set<number>();
useStore.subscribe((s, prev) => {
  if (s.fast === prev.fast || !s.fast.startedAt) return;
  // a hand-over to Claude Code is Claude Code's turn, not the fast model's
  if (s.fast.status === 'delegated') settled.add(s.fast.startedAt);
  if (s.fast.status !== 'done' && s.fast.status !== 'error') return;
  if (settled.has(s.fast.startedAt)) return;
  const turn = turnOfFast(s.fast);
  if (!turn) return;
  settled.add(s.fast.startedAt);
  endTurn(turn);
  if (s.project) api.keepTurn(s.project, turn);
});

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

// remember whether the panel is open, per browser
useStore.subscribe((st, prev) => {
  if (st.panelOpen !== prev.panelOpen) writePref('dc.panelOpen', st.panelOpen ? '1' : '0');
});
