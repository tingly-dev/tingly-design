import { useMemo } from 'react';
import { create } from 'zustand';
import {
  DASH_INDEX,
  EMPTY_STATE,
  datasetFile,
  DASH_DATA_MAX,
  datasetIdOf,
  formatOf,
  isStale,
  paramsIn,
  parseDash,
  parseDataFile,
  parseDataset,
  stringifyDash,
  toTable,
  type DashJson,
  type DashPick,
  type DashReport,
  type DataState,
  type DatasetJson,
  type FileSource,
  type Params,
  type QuerySource,
  type ToDash,
} from '@dc/core';
import { api } from '../../api';
import { display, edit, openPane, toast, useStore } from '../../store';
import { currentTheme, onTheme } from '../../theme';
import { at } from '../../base';
import { t } from '../../i18n';
import { filesOf, type ImportTarget } from '../ImportHere';
import { readPref, writePref } from '../../local';

/**
 * A dashboard's data, on the editor's side: it loads each dataset the page
 * asks for (an attached file under data/, or a query through the server's
 * connectors), keeps the filters, and hands states to the page's frame.
 * The page itself (calcs, loaders, marks) runs in that frame.
 */

export interface DatasetEntry {
  id: string;
  path: string;
  dataset: DatasetJson | null;
  error?: string;
}

interface DashState {
  states: Record<string, DataState>;
  /** a query whose page declares a loader: its answer, for the frame to reshape */
  raw: Record<string, { answer: unknown; args: Record<string, unknown> }>;
  loaders: string[];
  params: Params;
  report: DashReport | null;
  derived: Record<string, DataState>;
  mode: 'page' | 'data';
  theme: 'light' | 'dark';
  /** the source open in Sources */
  open: string | null;
  pick: DashPick | null;
  /** bumped to load the page afresh */
  pageKey: number;
}

export const useDash = create<DashState>(() => ({
  states: {},
  raw: {},
  loaders: [],
  params: {},
  report: null,
  derived: {},
  mode: 'page',
  theme: savedDashTheme() ?? currentTheme()?.theme.scheme ?? 'light',
  open: null,
  pick: null,
  pageKey: 0,
}));

const dget = useDash.getState;
const dset = useDash.setState;

let frameWin: Window | null = null;
export function setFrame(w: Window | null): void {
  frameWin = w;
}
export function postFrame(m: ToDash): void {
  frameWin?.postMessage(m, '*');
}

// ------------------------------------------------------------------ files

export function useDashIndex(): DashJson {
  const text = useStore((s) => display(s, DASH_INDEX));
  return useMemo(() => parseDash(text), [text]);
}

export function datasetsOf(): DatasetEntry[] {
  const s = useStore.getState();
  const out: DatasetEntry[] = [];
  for (const path of Object.keys(s.files).sort()) {
    const id = datasetIdOf(path);
    if (!id) continue;
    const text = display(s, path);
    if (text === undefined) continue;
    out.push({ id, path, ...parseDataset(text) });
  }
  return out;
}

/** Dataset files' contents, joined: a stable key that changes when any dataset does. */
export function useDatasets(): DatasetEntry[] {
  const key = useStore((s) =>
    Object.keys(s.files)
      .filter((p) => datasetIdOf(p))
      .sort()
      .map((p) => p + '\n' + (display(s, p) ?? ''))
      .join('\n\0'),
  );
  return useMemo(() => datasetsOf(), [key]);
}

export function pageFiles(): Record<string, string> {
  const s = useStore.getState();
  const out: Record<string, string> = {};
  for (const path of Object.keys(s.files)) {
    if (!path.startsWith('files/')) continue;
    const t = display(s, path);
    if (t !== undefined) out[path.slice(6)] = t;
  }
  return out;
}

export function editDash(mutate: (d: DashJson) => void, summary: string): void {
  edit(
    DASH_INDEX,
    (src) => {
      const d = parseDash(src);
      mutate(d);
      return stringifyDash(d);
    },
    { actor: 'human', summary },
  );
}

export function editDataset(id: string, mutate: (d: DatasetJson) => DatasetJson | void, summary: string): void {
  edit(
    datasetFile(id),
    (src) => {
      const d = JSON.parse(src) as DatasetJson;
      const next = mutate(d) ?? d;
      return JSON.stringify(next, null, 2) + '\n';
    },
    { actor: 'human', summary },
  );
}

// ------------------------------------------------------------------ loading

const asked = new Set<string>();
const seq: Record<string, number> = {};
/** what each dataset was last loaded from, to know when its file changed */
const loadedFrom: Record<string, string> = {};

function setState(id: string, st: DataState, raw?: { answer: unknown; args: Record<string, unknown> }): void {
  dset((s) => {
    const r = { ...s.raw };
    if (raw) r[id] = raw;
    else delete r[id];
    return { states: { ...s.states, [id]: st }, raw: r };
  });
  postFrame({ dc: 'dash-data', states: { [id]: st }, ...(raw ? { raw: { [id]: raw } } : {}) });
}

function failed(message: string, status: DataState['status'] = 'error'): DataState {
  return { ...EMPTY_STATE, status, message, at: Date.now() };
}

async function fetchText(path: string): Promise<string> {
  const project = useStore.getState().project!;
  const res = await fetch(api.rawBase(project) + path.split('/').map(encodeURIComponent).join('/'), { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? `no file ${path}` : `${path}: ${res.status}`);
  const text = await res.text();
  if (text.length > 8 * 1024 * 1024) throw new Error('the file is over 8 MB');
  return text;
}

/** Run a query's call with the filters as they are: the answer, or why it failed. */
export async function runQuery(src: QuerySource, params: Params): Promise<{ ok: true; answer: unknown; ms: number } | { ok: false; state: string; message: string }> {
  const project = useStore.getState().project!;
  const res = await fetch(at(`api/projects/${encodeURIComponent(project)}/query`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ connector: src.connector, tool: src.tool, args: src.args, params }),
  });
  const body = await res.json().catch(() => ({ ok: false, state: 'failed', message: res.statusText }));
  if (!res.ok && body.ok === undefined) return { ok: false, state: 'failed', message: body.error ?? res.statusText };
  return body;
}

export async function load(id: string, refresh = false): Promise<void> {
  const entry = datasetsOf().find((d) => d.id === id);
  const n = (seq[id] = (seq[id] ?? 0) + 1);
  const prev = dget().states[id];
  if (!entry) return setState(id, failed(`no dataset “${id}”`, 'missing'));
  if (!entry.dataset || entry.error) return setState(id, failed(entry.error ?? 'unreadable'));
  const src = entry.dataset.source;
  loadedFrom[id] = JSON.stringify(src);
  if (prev?.status === 'ok' && refresh) setState(id, { ...prev, refreshing: true });
  else setState(id, { ...EMPTY_STATE, status: 'loading' });
  const t0 = performance.now();
  let st: DataState;
  let raw: { answer: unknown; args: Record<string, unknown> } | undefined;
  try {
    if (src.kind === 'file') {
      const f = src as FileSource;
      const path = f.url.replace(/^\.?\//, '');
      const { table, value } = parseDataFile(await fetchText(path), formatOf(f));
      st = table
        ? { status: 'ok', data: table.rows, columns: table.columns, rows: table.rows, refreshing: false, meta: table.meta ?? [] }
        : { status: 'ok', data: value, columns: [], rows: [], refreshing: false, meta: [] };
    } else {
      const q = src as QuerySource;
      const r = await runQuery(q, dget().params);
      if (!r.ok) {
        st = failed(r.message, r.state === 'absent' ? 'connect' : 'error');
      } else if (dget().loaders.includes(id)) {
        raw = { answer: r.answer, args: q.args };
        st = { ...EMPTY_STATE, status: 'ok', data: [], refreshing: false };
      } else {
        const t = toTable(r.answer);
        st = t
          ? { status: 'ok', data: t.rows, columns: t.columns, rows: t.rows, refreshing: false, meta: t.meta ?? [], cut: t.cut }
          : { status: 'ok', data: r.answer, columns: [], rows: [], refreshing: false, meta: [] };
      }
    }
  } catch (e) {
    st = failed((e as Error).message);
  }
  if (seq[id] !== n) return;
  st.at = Date.now();
  st.ms = Math.round(performance.now() - t0);
  setState(id, st, raw);
  scheduleRuns();
}

/** The page asked for these. */
export function want(ids: string[]): void {
  for (const id of ids) {
    const have = dget().states[id];
    if (asked.has(id) && have) {
      postFrame({ dc: 'dash-data', states: { [id]: have }, ...(dget().raw[id] ? { raw: { [id]: dget().raw[id] } } : {}) });
      continue;
    }
    asked.add(id);
    void load(id);
  }
}

export function refreshAll(): void {
  for (const d of datasetsOf()) if (asked.has(d.id)) void load(d.id, true);
}

/** A data file changed on disk (an upload, Claude Code, a terminal): reload what reads it. */
export function dataChanged(path?: string): void {
  if (!path) return;
  for (const d of datasetsOf()) {
    const src = d.dataset?.source as Record<string, unknown> | undefined;
    if (!src || !asked.has(d.id)) continue;
    const uses = (typeof src.url === 'string' && src.url.replace(/^\.?\//, '') === path) || (src.args && (src.args as Record<string, unknown>).db === path);
    if (uses) void load(d.id, true);
  }
}

/** Dataset files changed: reload the ones whose source changed. */
export function datasetsChanged(list: DatasetEntry[]): void {
  for (const d of list) {
    if (!asked.has(d.id)) continue;
    if (loadedFrom[d.id] !== JSON.stringify(d.dataset?.source)) void load(d.id, true);
  }
  // a dataset removed while the page reads it
  for (const id of Object.keys(dget().states)) if (!list.some((d) => d.id === id) && asked.has(id)) setState(id, failed(`no dataset “${id}”`, 'missing'));
}

export function resetDash(): void {
  asked.clear();
  for (const k of Object.keys(loadedFrom)) delete loadedFrom[k];
  dset({ states: {}, raw: {}, loaders: [], report: null, derived: {}, params: parseDash(display(useStore.getState(), DASH_INDEX)).params, open: null, pick: null });
}

/** The page loads afresh (its files changed): keep the data, which it will ask for again. */
export function reloadPage(): void {
  dset((s) => ({ pageKey: s.pageKey + 1, report: null, derived: {}, loaders: [] }));
}

// ------------------------------------------------------------------ filters

export function setParams(p: Params | null): void {
  const before = dget().params;
  const next = p === null ? parseDash(display(useStore.getState(), DASH_INDEX)).params : { ...before, ...p };
  const changed = new Set([...Object.keys(before), ...Object.keys(next)].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k])));
  dset({ params: next });
  postFrame({ dc: 'dash-params', params: next });
  if (!changed.size) return;
  for (const d of datasetsOf()) {
    if (!asked.has(d.id) || d.dataset?.source.kind !== 'query') continue;
    if (paramsIn((d.dataset.source as QuerySource).args).some((k) => changed.has(k))) void load(d.id, true);
  }
  scheduleRuns();
}

/** Filters set away from dash.json's defaults. */
export function changedParams(params: Params, defaults: Params): string[] {
  return [...new Set([...Object.keys(params), ...Object.keys(defaults)])].filter((k) => JSON.stringify(params[k] ?? null) !== JSON.stringify(defaults[k] ?? null));
}

// ---------------------------------------------------------- the runs report

let runsTimer = 0;
/** The original's runs document, written where Claude Code can read it: .runs.json in the dashboard folder. */
export function scheduleRuns(): void {
  clearTimeout(runsTimer);
  runsTimer = window.setTimeout(() => {
    const project = useStore.getState().project;
    if (!project) return;
    const { states, report, params, derived } = dget();
    const datasets: Record<string, unknown> = {};
    for (const [id, s] of Object.entries({ ...states, ...derived })) {
      if (s.status === 'loading') continue;
      datasets[id] = { status: s.status === 'ok' ? 'ok' : s.status === 'connect' ? 'absent' : 'failed', message: s.message, rows: s.rows.length || undefined, cut: s.cut, ms: s.ms, at: s.at ? new Date(s.at).toISOString() : undefined };
    }
    const runs = { at: new Date().toISOString(), params, datasets, marks: report?.marks ?? [], flagged: report?.flagged ?? 0, errors: report?.errors ?? [] };
    void fetch(at(`api/projects/${encodeURIComponent(project)}/runs`), { method: 'PUT', body: JSON.stringify(runs, null, 1) }).catch(() => {});
  }, 1500);
}

// ------------------------------------------------------------------ helpers

/** How long ago, in the language showing. Components pass their own `t` so it follows a language change. */
export function ago(at: number | string | undefined, tr: typeof t = t): string {
  if (!at) return '';
  const when = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(when)) return '';
  const s = Math.max(0, Math.round((Date.now() - when) / 1000));
  if (s < 60) return tr('dash.ago.justNow');
  if (s < 3600) return tr('dash.ago.minutes', { count: Math.round(s / 60) });
  if (s < 86400) return tr('dash.ago.hours', { count: Math.round(s / 3600) });
  return tr('dash.ago.days', { count: Math.round(s / 86400) });
}

export function staleOf(d: DatasetJson | null): boolean {
  return !!d && isStale(d);
}

function savedDashTheme(): 'light' | 'dark' | null {
  const v = readPref('dc.dashTheme');
  return v === 'light' || v === 'dark' ? v : null;
}

// until someone flips the dashboard's own switch, its page follows the editor's light or dark
onTheme(() => {
  const scheme = currentTheme()?.theme.scheme;
  if (!scheme || savedDashTheme() || useDash.getState().theme === scheme) return;
  dset({ theme: scheme });
  postFrame({ dc: 'dash-theme', theme: scheme });
});

export function setTheme(theme: 'light' | 'dark'): void {
  dset({ theme });
  writePref('dc.dashTheme', theme);
  postFrame({ dc: 'dash-theme', theme });
}

export function setMode(mode: 'page' | 'data'): void {
  dset({ mode });
  postFrame({ dc: 'dash-mode', mode });
}

/** Keep a query's current answer as a file everyone sees; readers then never run the query. */
export async function pauseQuery(id: string): Promise<void> {
  const project = useStore.getState().project!;
  const d = datasetsOf().find((x) => x.id === id)?.dataset;
  if (!d || d.source.kind !== 'query') return;
  const q = d.source as QuerySource;
  if (paramsIn(q.args).length) return void toast(t('dash.toast.pauseFollowsFilters'), 'error');
  const st = dget().derived[id] ?? dget().states[id];
  if (!st || st.status !== 'ok' || !st.rows.length) return void toast(t('dash.toast.pauseNeedsResult'), 'error');
  if (st.cut) return void toast(t('dash.toast.pauseCut'), 'error');
  const file = new File([JSON.stringify({ columns: st.columns, rows: st.rows, meta: st.meta }, null, 1) + '\n'], `${id}.json`, { type: 'application/json' });
  const up = await api.upload(project, file, 'data');
  const now = new Date().toISOString();
  const by = t('dash.actor.editor');
  editDataset(
    id,
    (cur) => ({
      ...cur,
      source: { kind: 'file', url: up.path, name: `${id}.json`, format: 'json' },
      request: { connector: q.connector, tool: q.tool, args: q.args },
      updated: { at: now, by },
      lastAttempt: { at: now, ok: true, by },
      pausedBy: by,
    }),
    `${id}: saved results, not refreshing`,
  );
}

export function resumeQuery(id: string): void {
  editDataset(
    id,
    (cur) => {
      if (!cur.request) return cur;
      const { request, pausedBy: _p, lastAttempt: _l, updated: _u, ...rest } = cur;
      return { ...rest, source: { kind: 'query', ...request } };
    },
    `${id}: live again`,
  );
}

export function rawUrl(path: string): string {
  return api.rawBase(useStore.getState().project!) + path.split('/').map(encodeURIComponent).join('/');
}

// ------------------------------------------------------------------ import

/**
 * What a dashboard takes: each CSV, TSV or JSON table becomes a dataset of
 * its own, its file kept under data/ (the one place a dashboard reads files
 * from) and opened in Sources so the next step, using it on the page, is at
 * hand. A file that is not a table is refused before anything is written.
 */
export const dashImport: ImportTarget = {
  accepts: ['data'],
  get what() {
    return t('dash.import.what');
  },
  run: async (picked) => {
    const project = useStore.getState().project!;
    const files = filesOf(picked, 'data');
    const taken = new Set([...datasetsOf().map((d) => d.id), ...(await api.assets(project)).map((a) => a.path.replace(/^data\//, '').replace(/\.[^.]+$/, ''))]);
    // every file is read before any is written, so a bad one leaves nothing half-imported
    const tables = files.map((f) => {
      const name = f.path.split('/').pop()!;
      const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
      const format = ext === 'json' ? 'json' : ext === 'csv' ? 'csv' : 'tsv';
      if (f.bytes.length > DASH_DATA_MAX) throw new Error(t('dash.import.tooLarge', { name }));
      try {
        const { table } = parseDataFile(new TextDecoder().decode(f.bytes), format);
        if (!table) throw new Error();
        return { f, name, ext, format, rows: table.rows.length };
      } catch {
        throw new Error(t('dash.import.notTable', { name }));
      }
    });
    const added: string[] = [];
    for (const { f, name, ext, format, rows } of tables) {
      const stem = name.replace(/\.[^.]+$/, '');
      // the server keeps at most 40 characters of a data file's name; leave room for "-2"
      const base = stem.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 36).replace(/-+$/, '') || 'data';
      let id = base;
      for (let k = 2; taken.has(id); k++) id = `${base}-${k}`;
      taken.add(id);
      const up = await api.upload(project, new File([f.bytes as Uint8Array<ArrayBuffer>], `${id}.${ext}`, { type: f.type }), 'data');
      const now = new Date().toISOString();
      const dataset: DatasetJson = { title: stem, description: t('dash.import.description', { name, count: rows }), source: { kind: 'file', url: up.path, name, format }, updated: { at: now, by: t('dash.actor.editor') } };
      edit(datasetFile(id), () => JSON.stringify(dataset, null, 2) + '\n', { actor: 'human', summary: `dataset ${id} imported from ${name}`, undoable: false });
      added.push(id);
    }
    dset({ open: added[0] ?? null });
    openPane('sources');
    return added.length === 1 ? t('dash.import.addedOne', { file: files[0].path.split('/').pop(), id: added[0] }) : t('dash.import.addedMany', { count: added.length });
  },
};
