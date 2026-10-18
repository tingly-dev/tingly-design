import { create } from 'zustand';
import {
  applyHumanOps,
  planRetype,
  RetypeError,
  setListItemField,
  setPropDefault,
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
  DECK_FILE,
  deckOrder,
  parseDeck,
  projectKind,
  slideFile,
  stringifyDeck,
  type DeckJson,
  type ProjectKind,
  type Conversation,
  isDataPath,
} from '@dc/core';
import { api, type FileState, type Health, type ServerEvent } from './api';
import { t } from './i18n';
import { headlessRun } from './headless';
import { readPref, writePref } from './local';

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
  /** Claude Code's session id, once it reports one: the next request can continue it */
  session?: string;
  /** this run continued an earlier session instead of starting a fresh one */
  continued?: boolean;
  /** project files the run changed, in the order it first touched them */
  files: string[];
  /** each changed file before the run touched it (null: the run created it) and as the run left it, to undo the run */
  before: Record<string, string | null>;
  after: Record<string, string>;
  undone?: boolean;
}

/** One request in the history list above the prompt, from either agent. */
export interface RunRecord {
  id: string;
  agent: 'fast' | 'claude';
  prompt: string;
  at: number;
  state: 'running' | 'done' | 'error' | 'stopped';
  /** Claude Code: continued an earlier session (true) or started a fresh one (false) */
  continued?: boolean;
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

export interface State {
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
  fast: FastState;
  delegates: DelegateState[];
  /** jQuery typed by hand in the Code tab (also filled from the run feed) */
  jqDraft: string;
  /** the run the feed above the prompt shows, and whether the person closed it */
  lastRun: LastRun;
  runHidden: boolean;
  /** how many run feeds are on screen: when none is, a finished run is announced by a toast instead */
  feeds: number;
  /** the prompt bar folded to a pill (kept across sessions) */
  barCollapsed: boolean;
  /** where the prompt lives: the bar at the bottom of the stage (`float`, the default), or a column on the right edge that hides until the pointer comes (`auto`) */
  barMode: BarMode;
  /** the list of earlier requests open above the bar */
  historyOpen: boolean;
  /** every request of this editor session, oldest first */
  history: RunRecord[];
  /** the project's Claude Code conversation, kept by the server: the next request continues it */
  conversation: Conversation | null;
  /** the next Claude Code request starts a fresh session even though one could be continued */
  freshNext: boolean;
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
  fast: { status: 'idle', mode: 'ai', lines: [] },
  delegates: [],
  conversation: null,
  jqDraft: '',
  lastRun: null,
  runHidden: false,
  feeds: 0,
  barCollapsed: readPref('dc.barCollapsed') === '1',
  barMode: readPref('dc.barMode') === 'auto' ? 'auto' : 'float',
  historyOpen: false,
  history: [],
  freshNext: false,
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
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']): void {
  // an export run from the command line reports its errors there, and nothing else needs showing
  if (headlessRun(text, kind)) return;
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts, { id, text, kind, action }].slice(-4) }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : action ? 6000 : Math.max(3500, text.length * 60));
}

// ----------------------------------------------------------------- loading

let stopEvents: (() => void) | null = null;

export async function openProject(name: string): Promise<void> {
  stopEvents?.();
  set({ project: name, loaded: false, files: {}, drafts: {}, journal: [], selection: null, undo: [], redo: [], delegates: [], conversation: null, lastRun: null, runHidden: false, history: [], historyOpen: false, freshNext: false, slide: null, present: null, motionView: null });
  const [{ files }, journal, conversation] = await Promise.all([api.files(name), api.journal(name), api.conversation(name).catch(() => null)]);
  const entries: Record<string, FileEntry> = {};
  for (const [path, st] of Object.entries(files)) entries[path] = { server: st, pending: [] };
  const kind = projectKind(Object.keys(files));
  set((s) => ({ files: entries, journal, loaded: true, kind, conversation: s.conversation ?? conversation }));
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
        if (e.continued) d.continued = true;
      }
      if (e.session) d.session = e.session;
      if (e.continued === false) d.continued = false;
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
      const base = e.continued === false ? s.history.map((h) => (h.id === e.id ? { ...h, continued: false } : h)) : s.history;
      const history = recordRun(base, { id: e.id, agent: 'claude', prompt: d.prompt, at: d.startedAt, state: 'running', continued: !!d.continued }, e.state === 'start' || e.state === 'progress' ? undefined : e.state === 'done' ? 'done' : e.state === 'stopped' ? 'stopped' : 'error');
      // the server keeps the conversation from the moment a run reports its session, whatever the run's end
      const conversation = e.session ? { session: e.session, prompt: d.prompt, at: now } : s.conversation;
      return { delegates: list.slice(-5), history, conversation, ...(fresh ? { lastRun: { kind: 'delegate', id: e.id } as LastRun, runHidden: false } : {}) };
    });
    if (e.state === 'done' || e.state === 'error') {
      const ok = e.state === 'done';
      if (get().fast.status === 'delegated') setFastDone(ok);
      // the feed above the prompt already says so; a toast is for when no feed is on screen
      if (!get().feeds) toast(ok ? t('app.delegate.done', { text: (e.text ?? '').slice(0, 120) }) : t('app.delegate.failed', { text: (e.text ?? '').slice(0, 200) }), ok ? 'info' : 'error');
    }
  }
}

/** Add a request to the history, or move an existing one to its end state. */
export function recordRun(history: RunRecord[], rec: RunRecord, end?: RunRecord['state']): RunRecord[] {
  const i = history.findIndex((h) => h.id === rec.id);
  if (i < 0) return [...history, end ? { ...rec, state: end } : rec].slice(-50);
  if (!end || history[i].state === end) return history;
  const next = [...history];
  next[i] = { ...next[i], state: end };
  return next;
}

export type BarMode = 'auto' | 'float';

/** Where the prompt lives (kept across sessions, the same in every kind). */
export function setBarMode(mode: BarMode): void {
  writePref('dc.barMode', mode);
  set({ barMode: mode, historyOpen: false });
}

export function setBarCollapsed(on: boolean): void {
  writePref('dc.barCollapsed', on ? '1' : '0');
  set({ barCollapsed: on, historyOpen: false });
}

// a fast-model request is one store value; its entry in the history follows it
useStore.subscribe((s, prev) => {
  if (s.fast === prev.fast || s.fast.status === 'idle' || s.fast.mode !== 'ai' || !s.fast.startedAt) return;
  const id = `fast-${s.fast.startedAt}`;
  const end = s.fast.status === 'running' ? undefined : s.fast.status === 'error' ? 'error' : 'done';
  const history = recordRun(s.history, { id, agent: 'fast', prompt: s.fast.prompt ?? '', at: s.fast.startedAt, state: 'running' }, end);
  if (history !== s.history) set({ history });
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

/**
 * Text with holes in it, retyped on the artboard (`Hello {{name}}!`): the edit
 * lands in the template's literal text or in the tweak the hole shows, and the
 * hole stays. Says why when it cannot (`.design/template-text-editing.md`).
 */
export function retypeText(file: string, tid: number, from: string, to: string, item: number | null): boolean {
  const apply = (src: string) => {
    const doc = parsed(src);
    const el = doc.elements.find((e) => e.tid === tid);
    if (!el) throw new Error(`element ${tid} is no longer in the design`);
    const plan = planRetype(doc, el, from, to, item);
    let out = plan.template === null ? src : applyHumanOps(src, [{ kind: 'text', tid, text: plan.template }], inertDocument()).source;
    for (const s of plan.sets) out = ('index' in s ? setListItemField(out, s.prop, s.index, s.key, s.value) : setPropDefault(out, s.prop, s.value)).source;
    return out;
  };
  const cur = display(get(), file);
  if (cur === undefined) return false;
  try {
    apply(cur);
  } catch (e) {
    if (e instanceof RetypeError) {
      toast(t(`canvas.text.noedit.${e.code}`), 'error');
      return false;
    }
  }
  return edit(file, apply, { actor: 'human', summary: `text → ${JSON.stringify(to.length > 40 ? to.slice(0, 39) + '…' : to)}` });
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

// remember whether the panel is open, per browser
useStore.subscribe((st, prev) => {
  if (st.panelOpen !== prev.panelOpen) writePref('dc.panelOpen', st.panelOpen ? '1' : '0');
});
