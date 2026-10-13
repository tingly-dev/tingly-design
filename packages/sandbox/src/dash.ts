/**
 * The frame a dashboard's page runs in. It does what the original Dashboard
 * runtime does inside its own document (read from its bundle,
 * artifact/claude-dashboard/FINDINGS.md): puts files/index.html into
 * #dash-root without the elements the type drops, runs the page's scripts
 * with `dash` (and d3 as a global), hands them data, works out calcs, runs
 * loaders, stamps loading and failure states on marks, and checks every
 * marked number against the cell it names. Unlike the original it is its
 * own sandboxed frame, so the page's CSS and scripts cannot reach the editor.
 */
import * as d3 from 'd3';
import {
  EMPTY_STATE,
  checkMark,
  isCellMark,
  markOf,
  resolveMark,
  toTable,
  type CalcInfo,
  type DashPick,
  type DashReport,
  type DataState,
  type FromDash,
  type MarkProblem,
  type PageError,
  type Params,
  type Row,
  type Table,
  type ToDash,
} from '@dc/core';
import { msg } from './msg';

(window as unknown as { d3: typeof d3 }).d3 = d3;

const post = (m: FromDash) => parent.postMessage(m, '*');

// ------------------------------------------------------------------ theme

const TOKENS = `
:root {
  color-scheme: light;
  --font-anthropic-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
  --font-anthropic-serif: "Source Serif 4", "Iowan Old Style", Georgia, "Songti SC", "Noto Serif SC", serif;
  --color-fg: #1f1e1b; --color-fg-muted: #6b6860; --color-bg: #faf9f5; --color-panel: #ffffff;
  --color-border-line: #e6e3da; --color-ok: #2f7d4f; --color-warn: #9a6200; --color-bad: #c0392b;
  --cds-gap-xs: 4px; --cds-gap-sm: 8px; --cds-gap-md: 16px; --cds-gap-lg: 24px; --cds-gap-xl: 40px;
  --cds-pad-xs: 4px; --cds-pad-sm: 8px; --cds-pad-md: 12px; --cds-pad-lg: 20px; --cds-pad-xl: 32px;
  --cds-font-size-caption: 12px; --cds-font-size-body: 14px; --cds-font-size-heading: 16px; --cds-font-size-title: 28px;
  --cds-font-weight-medium: 550; --cds-radius: 10px;
  --cds-chart-axis: #b9b5aa; --cds-chart-grid: #ece9e1; --cds-chart-muted: #c9c5bb; --cds-chart-reference: #8f8b81; --cds-chart-status-critical: #d4553f;
  --cds-chart-categorical-1: #c96442; --cds-chart-categorical-2: #3a6ea5; --cds-chart-categorical-3: #6a9f4b; --cds-chart-categorical-4: #b08b2e;
  --cds-chart-categorical-5: #8a5fb0; --cds-chart-categorical-6: #2f9a9a; --cds-chart-categorical-7: #b5577a; --cds-chart-categorical-8: #6b6860;
  --cds-surface-popover: #ffffff; --cds-shadow-popover: 0 4px 16px rgba(31,30,27,.12); --cds-border: #e0ddd3; --cds-text-secondary: #6b6860;
  --cds-dur-slow: 400ms; --cds-ease-out: cubic-bezier(.2,.7,.2,1);
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --color-fg: #ece9e1; --color-fg-muted: #a29e94; --color-bg: #1c1b19; --color-panel: #262522;
  --color-border-line: #3a3834; --color-ok: #6cc28f; --color-warn: #e0b04a; --color-bad: #f07a68;
  --cds-chart-axis: #6b6860; --cds-chart-grid: #33312d; --cds-chart-muted: #57544e; --cds-chart-reference: #8f8b81; --cds-chart-status-critical: #f07a68;
  --cds-chart-categorical-1: #e08a68; --cds-chart-categorical-2: #74a3d6; --cds-chart-categorical-3: #94c477; --cds-chart-categorical-4: #d8b55a;
  --cds-chart-categorical-5: #b48fd6; --cds-chart-categorical-6: #5cc2c2; --cds-chart-categorical-7: #dc86a6; --cds-chart-categorical-8: #a29e94;
  --cds-surface-popover: #2e2d29; --cds-shadow-popover: 0 4px 16px rgba(0,0,0,.4); --cds-border: #45423d; --cds-text-secondary: #a29e94;
}
html, body { margin: 0; background: var(--color-bg); color: var(--color-fg); font-family: var(--font-anthropic-sans); font-size: var(--cds-font-size-body); line-height: 1.45; }
#dash-root { --dash-gutter: clamp(16px, 3vw, 40px); padding: var(--dash-gutter); min-height: 100vh; box-sizing: border-box; }
[data-appifact-content] :is(b, strong) { font-weight: 700; }
.dash-skeleton { color: transparent !important; position: relative; }
.dash-skeleton::after { content: ""; position: absolute; left: 0; top: 50%; width: min(6em, 100%); height: .7em; transform: translateY(-50%); border-radius: 999px; background: var(--color-border-line); animation: dash-pulse 1.4s ease-in-out infinite; }
.dash-skeleton:empty::after { top: 0; width: 100%; height: 100%; transform: none; border-radius: var(--cds-radius); }
@keyframes dash-pulse { 50% { opacity: .5; } }
.dash-stopped { position: sticky; top: 0; z-index: 2147483647; margin: 0 0 8px; padding: 6px 12px; font: 12px/1.4 var(--font-anthropic-sans); background: #fde8e4; color: #8a2414; border-bottom: 1px solid #f3b9ae; }
html.dash-data-mode [data-source] { outline: 1px dashed color-mix(in srgb, var(--cds-chart-categorical-2) 70%, transparent); outline-offset: 2px; cursor: pointer; }
html.dash-data-mode [data-source]:hover { outline: 2px solid var(--cds-chart-categorical-2); }
html.dash-data-mode [data-dash-flag] { outline: 2px solid var(--color-bad) !important; }
[data-dash-spot] { outline: 2px solid var(--cds-chart-categorical-2) !important; outline-offset: 2px; }
`;

const style = document.createElement('style');
style.textContent = TOKENS;
document.head.appendChild(style);

const root = document.createElement('div');
root.id = 'dash-root';
root.setAttribute('data-appifact-content', '');
document.body.appendChild(root);
const banner = document.createElement('div');
banner.className = 'dash-stopped';
banner.hidden = true;
document.body.insertBefore(banner, root);

// ------------------------------------------------------------------ state

let datasetIds = new Set<string>();
const states = new Map<string, DataState>();
const raw = new Map<string, { answer: unknown; args: Record<string, unknown>; seq: number }>();
let params: Params = {};
const read = new Set<string>();
const asked = new Set<string>();
let toAsk: string[] = [];

interface Calc {
  info: CalcInfo;
  fn: (...a: unknown[]) => unknown;
}
const calcs = new Map<string, Calc>();
const calcCache = new Map<string, DataState>();
const loaders = new Map<string, { description?: string; fn: (a: unknown) => unknown }>();
const loaded = new Map<string, DataState>();
const callbacks: (() => void)[] = [];
const errors = new Map<string, PageError>();

function noteError(kind: PageError['kind'], e: unknown, file?: string): void {
  const err = e instanceof Error ? e : new Error(String(e));
  const key = `${kind}|${err.name}|${file ?? ''}`;
  const cur = errors.get(key);
  if (cur) cur.count++;
  else errors.set(key, { kind, name: err.name || 'Error', message: String(err.message).slice(0, 300), file, count: 1 });
  if (kind === 'stopped') {
    banner.hidden = false;
    banner.textContent = msg('pageStopped', { file: file ?? msg('script'), message: err.message });
  }
  console.error(err);
  scheduleReport();
}

addEventListener('error', (e) => noteError('error', e.error ?? e.message));
addEventListener('unhandledrejection', (e) => noteError('rejection', e.reason));

function stateOf(id: string): DataState {
  if (calcs.has(id)) return calcState(id);
  if (loaded.has(id)) return loaded.get(id)!;
  if (!datasetIds.has(id)) return { ...EMPTY_STATE, status: 'missing', message: `no dataset or calc “${id}”` };
  const s = states.get(id);
  if (s) return loaders.has(id) && s.status === 'ok' ? { ...s, status: 'loading' } : s;
  return { ...EMPTY_STATE, status: 'loading' };
}

function ask(id: string): void {
  if (calcs.has(id)) {
    for (const i of calcs.get(id)!.info.inputs) ask(i);
    return;
  }
  if (!datasetIds.has(id) || asked.has(id)) return;
  asked.add(id);
  toAsk.push(id);
  queueMicrotask(() => {
    if (!toAsk.length) return;
    post({ dc: 'dash-want', ids: toAsk });
    toAsk = [];
  });
}

/** What dash.data(id) returns: the original's fields, old and new. */
function view(s: DataState): Record<string, unknown> {
  return {
    status: s.status,
    data: s.status === 'ok' ? s.data : [],
    columns: s.columns,
    rows: s.rows,
    value: Array.isArray(s.data) ? undefined : s.data,
    message: s.message,
    refreshing: s.refreshing,
    meta: s.meta,
    cut: s.cut,
  };
}

function stateFromTable(t: Table | null, value: unknown): DataState {
  if (t) return { status: 'ok', data: t.rows, columns: t.columns, rows: t.rows, refreshing: false, meta: t.meta ?? [], cut: t.cut };
  return { status: 'ok', data: value, columns: [], rows: [], refreshing: false, meta: [] };
}

const WORST: DataState['status'][] = ['missing', 'error', 'declined', 'connect', 'loading'];

function calcState(id: string, stack: string[] = []): DataState {
  const hit = calcCache.get(id);
  if (hit) return hit;
  const c = calcs.get(id)!;
  if (stack.includes(id)) return { ...EMPTY_STATE, status: 'error', message: `calc ${id} uses itself` };
  const ins = c.info.inputs.map((i) => (calcs.has(i) ? calcState(i, [...stack, id]) : stateOf(i)));
  let out: DataState;
  const bad = WORST.map((w) => ins.findIndex((s) => s.status === w)).find((i) => i >= 0);
  if (bad !== undefined) {
    const s = ins[bad];
    out = { ...EMPTY_STATE, status: s.status === 'missing' ? 'error' : s.status, message: s.status === 'loading' ? undefined : `${c.info.inputs[bad]}: ${s.message ?? s.status}` };
  } else {
    try {
      const value = c.fn(...ins.map((s) => (s.rows.length || Array.isArray(s.data) ? (Array.isArray(s.data) ? s.data : s.rows) : s.data)));
      const t = Array.isArray(value) ? toTable(value) : null;
      out = stateFromTable(t, value);
      out.refreshing = ins.some((s) => s.refreshing);
    } catch (e) {
      out = { ...EMPTY_STATE, status: 'error', message: `didn’t run: ${(e as Error).message}` };
    }
  }
  calcCache.set(id, out);
  return out;
}

// ------------------------------------------------------------------- draw

let drawQueued = false;
function redraw(): void {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    calcCache.clear();
    for (const fn of callbacks) runCallback(fn);
    stamp();
  });
}

function runCallback(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    noteError('stopped', e, 'dash.onData');
  }
}

let lastWidth = 0;
new ResizeObserver(() => {
  if (root.clientWidth !== lastWidth) {
    lastWidth = root.clientWidth;
    redraw();
  }
}).observe(root);

// ------------------------------------------------------------------- dash

let callSeq = 0;
const pendingCalls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

const dash = {
  data(id: string) {
    id = String(id);
    read.add(id);
    ask(id);
    return view(stateOf(id));
  },
  onData(fn: () => void) {
    if (typeof fn !== 'function') throw new TypeError('dash.onData takes a function');
    callbacks.push(fn);
    runCallback(fn);
  },
  calc(id: string, o: { inputs: string[]; fn: (...a: unknown[]) => unknown; title?: string; description?: string }) {
    if (datasetIds.has(id)) throw new Error(`dash.calc: “${id}” is a dataset’s id`);
    if (!o || typeof o.fn !== 'function' || !Array.isArray(o.inputs)) throw new Error('dash.calc(id, {inputs, fn})');
    calcs.set(id, { info: { id, title: o.title, description: o.description, inputs: o.inputs.map(String), fn: o.fn.toString() }, fn: o.fn });
    calcCache.clear();
  },
  loader(id: string, o: { description?: string; fn: (a: unknown) => unknown }) {
    if (!o || typeof o.fn !== 'function') throw new Error('dash.loader(id, {fn})');
    loaders.set(id, o);
  },
  params: () => ({ ...params }),
  setParams(p: Params) {
    if (!p || typeof p !== 'object') return;
    params = { ...params, ...p };
    post({ dc: 'dash-set-params', params: p });
    redraw();
  },
  resetParams() {
    post({ dc: 'dash-set-params', params: null });
  },
  setLink(name: string) {
    name = String(name ?? '');
    try {
      history.replaceState(null, '', name ? '#' + name : location.pathname);
    } catch {
      // an opaque frame may not touch its history
    }
    post({ dc: 'dash-link', name });
  },
  refresh(id?: string) {
    post({ dc: 'dash-refresh', id });
  },
  colors: Array.from({ length: 8 }, (_, i) => `var(--cds-chart-categorical-${i + 1})`),
};
Object.freeze(dash.colors);
(window as unknown as { dash: typeof dash }).dash = dash;

async function runLoader(id: string): Promise<void> {
  const r = raw.get(id);
  const l = loaders.get(id);
  if (!r || !l) return;
  const seq = r.seq;
  const call = (tool: string, args: Record<string, unknown>) =>
    new Promise((resolve, reject) => {
      const n = ++callSeq;
      pendingCalls.set(n, { resolve, reject });
      post({ dc: 'dash-call', call: n, id, tool: String(tool), args: args ?? {} });
    });
  let out: DataState;
  try {
    const v = await l.fn({ answer: r.answer, call, args: r.args, read: {} });
    const t = toTable(v) ?? (v && typeof v === 'object' && 'data' in (v as Row) ? toTable({ ...(v as Row), rows: (v as Row).data }) : null);
    if (!t) throw new Error(`the loader returned no rows (it returned ${Array.isArray(v) ? 'a list' : typeof v})`);
    out = stateFromTable(t, null);
  } catch (e) {
    const keys = r.answer && typeof r.answer === 'object' ? Object.keys(r.answer as Row).slice(0, 8).join(', ') : typeof r.answer;
    out = { ...EMPTY_STATE, status: 'error', message: `${(e as Error).message} (the answer has ${keys})` };
  }
  if (raw.get(id)?.seq !== seq) return;
  loaded.set(id, out);
  redraw();
}

// --------------------------------------------------------------- the page

const DROP = 'script,link,meta,base,form,iframe,frame,frameset,object,embed,portal,fencedframe';

function mount(files: Record<string, string>): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = files['index.html'] ?? '';
  const scripts: { code: string; file: string }[] = [];
  let n = 0;
  for (const el of Array.from(tpl.content.querySelectorAll('script, link'))) {
    if (el.closest('template') !== null && el.closest('template') !== tpl) continue;
    if (el.tagName === 'LINK') {
      const href = (el.getAttribute('href') ?? '').replace(/^\.?\//, '');
      if (/stylesheet/i.test(el.getAttribute('rel') ?? '') && Object.hasOwn(files, href)) {
        const s = document.createElement('style');
        s.textContent = files[href];
        el.replaceWith(s);
      }
      continue;
    }
    const type = el.getAttribute('type');
    if (type && !/^(text|application)\/(java|ecma)script$|^module$/i.test(type)) continue;
    const src = el.getAttribute('src');
    if (src) {
      const name = src.replace(/^\.?\//, '');
      if (Object.hasOwn(files, name)) scripts.push({ code: files[name], file: name });
    } else scripts.push({ code: el.textContent ?? '', file: `index.html#script${++n}` });
  }
  tpl.content.querySelectorAll(DROP).forEach((el) => el.remove());
  const walk = (node: ParentNode) => {
    for (const el of Array.from(node.querySelectorAll('*'))) {
      for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name) || a.name === 'ping') el.removeAttribute(a.name);
      if (el.tagName === 'TEMPLATE') walk((el as HTMLTemplateElement).content);
      for (const a of ['href', 'src', 'xlink:href', 'action', 'formaction']) {
        const v = el.getAttribute(a);
        if (v && /^\s*javascript:/i.test(v)) el.removeAttribute(a);
      }
    }
  };
  walk(tpl.content);
  root.replaceChildren(tpl.content);
  for (const s of scripts) {
    try {
      // each script in its own scope, `dash` handed in, as the original runs them
      new Function('dash', `(function(){\n${s.code}\n}).call(this)\n//# sourceURL=dash/files/${s.file}`).call(window, dash);
    } catch (e) {
      noteError('stopped', e, s.file);
    }
  }
  post({ dc: 'dash-declared', loaders: [...loaders.keys()] });
}

// ------------------------------------------------- states and mark checking

let loadingSince = 0;
let flagged = 0;
let marksOut: MarkProblem[] = [];
const marked = new Set<string>();

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  return `<${tag}${id}${cls}>`;
}

function tableOf(s: DataState): Table | null {
  if (s.status !== 'ok') return null;
  if (s.columns.length) return { columns: s.columns, rows: s.rows };
  return toTable(s.data);
}

function stamp(): void {
  const problems: MarkProblem[] = [];
  marked.clear();
  let anyLoading = false;
  let anyError = false;
  const els = root.querySelectorAll('[data-source]');
  for (const el of Array.from(els)) {
    const ids = (el.getAttribute('data-source') ?? '').split(/\s+/).filter(Boolean);
    ids.forEach((i) => {
      marked.add(i);
      ask(i);
    });
    const sts = ids.map((i) => stateOf(i));
    let st: string | null = null;
    if (sts.some((s) => s.status === 'error' || s.status === 'missing' || s.status === 'connect' || s.status === 'declined')) st = 'error';
    else if (sts.some((s) => s.status === 'loading')) st = 'loading';
    else if (sts.some((s) => s.refreshing)) st = 'refreshing';
    el.removeAttribute('data-dash-flag');
    if (!ids.length) continue;
    const m = markOf({ source: el.getAttribute('data-source'), field: el.getAttribute('data-field'), where: el.getAttribute('data-where'), row: el.getAttribute('data-row') });
    const shown = (el.textContent ?? '').trim();
    if (!st && isCellMark(m) && el.tagName !== 'TABLE' && (!shown || /^[—–-]$/.test(shown))) st = 'empty';
    if (st === 'loading') anyLoading = true;
    if (st === 'error') anyError = true;
    if (st) el.setAttribute('data-dash-source-state', st);
    else el.removeAttribute('data-dash-source-state');
    if (st === 'loading') el.setAttribute('aria-busy', 'true');
    else el.removeAttribute('aria-busy');
    if (sts[0].status !== 'ok' || sts[0].refreshing) continue;
    const t = tableOf(sts[0]);
    if (el.tagName === 'TABLE' && el.hasAttribute('data-row-key')) {
      checkTable(el as HTMLTableElement, m.source, t, problems);
      continue;
    }
    if (!isCellMark(m)) continue;
    if (!t) {
      if (m.field || m.where || m.row !== undefined) problems.push({ mark: describe(el), source: m.source, reason: 'the source is not a table', field: m.field });
      continue;
    }
    const v = checkMark(m, t, shown);
    if (v.status === 'unresolved' || v.status === 'mismatch') {
      el.setAttribute('data-dash-flag', '');
      problems.push({
        mark: describe(el),
        source: m.source,
        field: m.field,
        where: el.getAttribute('data-where') ?? undefined,
        row: m.row,
        ...(v.status === 'mismatch' ? { shown: v.shown, inData: v.inData } : { reason: v.reason }),
      });
    }
  }
  if (anyLoading) {
    loadingSince ||= Date.now();
    setTimeout(stampRoot, 520);
  } else loadingSince = 0;
  root.toggleAttribute('data-dash-has-error', anyError);
  stampRoot();
  flagged = problems.length;
  marksOut = problems.slice(0, 20);
  scheduleReport();
}

function stampRoot(): void {
  const err = root.hasAttribute('data-dash-has-error');
  const loading = loadingSince && Date.now() - loadingSince >= 500;
  if (err) root.setAttribute('data-dash-state', 'error');
  else if (loading) root.setAttribute('data-dash-state', 'loading');
  else root.removeAttribute('data-dash-state');
}

/** A table drawn from rows: each body row names one row of the data by its key; each cell under a named column is checked. */
function checkTable(table: HTMLTableElement, source: string, t: Table | null, out: MarkProblem[]): void {
  const keyCols = (table.getAttribute('data-row-key') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const mark = describe(table);
  if (!t) return void out.push({ mark, source, reason: 'the source is not a table' });
  const missing = keyCols.find((k) => !t.columns.includes(k));
  if (missing) return void out.push({ mark, source, reason: `no column “${missing}”` });
  const head = table.tHead?.rows[0] ?? table.rows[0];
  const fields: (string | null)[] = head ? Array.from(head.cells).map((c) => c.getAttribute('data-field')) : [];
  const own: boolean[] = head ? Array.from(head.cells).map((c) => !c.hasAttribute('data-source') || c.getAttribute('data-source') === source) : [];
  fields.forEach((f, i) => {
    if (f && own[i] && !t.columns.includes(f)) out.push({ mark: describe(head!.cells[i]), source, field: f, reason: `no column “${f}”` });
  });
  const bodies = table.tBodies.length ? Array.from(table.tBodies).flatMap((b) => Array.from(b.rows)) : Array.from(table.rows).slice(1);
  for (const tr of bodies) {
    let key: string[] | null = null;
    const dk = tr.getAttribute('data-key');
    if (dk !== null) key = keyCols.length === 1 ? [dk] : dk.split(',').map((p) => decodeURIComponent(p));
    else {
      key = keyCols.map((k) => {
        const i = fields.indexOf(k);
        return i >= 0 && tr.cells[i] ? (tr.cells[i].textContent ?? '').trim() : '';
      });
    }
    const where = keyCols.map((k, i) => ({ column: k, value: key![i] ?? '' }));
    const rows = resolveMark({ source, where }, t);
    tr.setAttribute('data-row-key-value', where.map((w) => encodeURIComponent(w.value)).join(','));
    if (typeof rows === 'string' || rows.length !== 1) {
      tr.setAttribute('data-dash-flag', '');
      out.push({ mark: describe(tr), source, where: where.map((w) => `${w.column}=${w.value}`).join('&'), reason: typeof rows === 'string' ? rows : 'the key names more than one row' });
      continue;
    }
    tr.removeAttribute('data-dash-flag');
    fields.forEach((f, i) => {
      const td = tr.cells[i];
      if (!f || !own[i] || !td || keyCols.includes(f) || !t.columns.includes(f)) return;
      const v = checkMark({ source, field: f, row: rows[0] }, t, td.textContent ?? '');
      if (v.status === 'mismatch') {
        td.setAttribute('data-dash-flag', '');
        out.push({ mark: describe(td), source, field: f, where: where.map((w) => `${w.column}=${w.value}`).join('&'), shown: v.shown, inData: v.inData });
      } else td.removeAttribute('data-dash-flag');
    });
  }
}

let reportTimer = 0;
let lastReport = '';
function scheduleReport(): void {
  clearTimeout(reportTimer);
  reportTimer = window.setTimeout(() => {
    const report: DashReport = {
      read: [...read],
      marked: [...marked],
      marks: marksOut,
      flagged,
      errors: [...errors.values()],
      calcs: [...calcs.values()].map((c) => c.info),
      loaders: [...loaders.entries()].map(([id, l]) => ({ id, description: l.description, fn: l.fn.toString() })),
    };
    const derived: Record<string, DataState> = {};
    for (const id of calcs.keys()) derived[id] = trim(calcState(id));
    for (const [id, s] of loaded) derived[id] = trim(s);
    const text = JSON.stringify({ report, derived });
    if (text === lastReport) return;
    lastReport = text;
    post({ dc: 'dash-report', report, derived });
  }, 250);
}

/** Enough of a calc's or loader's result for Sources to show. */
function trim(s: DataState): DataState {
  if (s.rows.length <= 1000) return s;
  return { ...s, rows: s.rows.slice(0, 1000), data: s.rows.slice(0, 1000), cut: true };
}

// --------------------------------------------------------------- data mode

let dataMode = false;
function setMode(mode: 'page' | 'data'): void {
  dataMode = mode === 'data';
  document.documentElement.classList.toggle('dash-data-mode', dataMode);
}

document.addEventListener(
  'click',
  (e) => {
    if (!dataMode) return;
    const target = e.target as Element;
    const el = target.closest?.('[data-source]');
    if (!el || !root.contains(el)) return;
    e.preventDefault();
    e.stopPropagation();
    const sources = (el.getAttribute('data-source') ?? '').split(/\s+/).filter(Boolean);
    const pick: DashPick = { sources, at: target.closest('[id]')?.id || undefined };
    if (el.tagName === 'TABLE') {
      const td = target.closest('td, th') as HTMLTableCellElement | null;
      const tr = target.closest('tr');
      const head = (el as HTMLTableElement).tHead?.rows[0];
      const field = td && head ? head.cells[td.cellIndex]?.getAttribute('data-field') : null;
      const key = tr?.getAttribute('data-row-key-value');
      const keyCols = (el.getAttribute('data-row-key') ?? '').split(',').map((s) => s.trim());
      if (field) pick.field = field;
      if (key && tr?.parentElement?.tagName !== 'THEAD') pick.where = keyCols.map((k, i) => `${encodeURIComponent(k)}=${key.split(',')[i] ?? ''}`).join('&');
      if (td) pick.shown = (td.textContent ?? '').trim();
    } else {
      const m = markOf({ source: el.getAttribute('data-source'), field: el.getAttribute('data-field'), where: el.getAttribute('data-where'), row: el.getAttribute('data-row') });
      if (m.field) pick.field = m.field;
      const w = el.getAttribute('data-where');
      if (w !== null) pick.where = w;
      else if (m.row !== undefined) pick.row = m.row;
      if (isCellMark(m)) pick.shown = (el.textContent ?? '').trim();
    }
    post({ dc: 'dash-pick', pick });
  },
  true,
);

function spot(ids: string[]): void {
  root.querySelectorAll('[data-dash-spot]').forEach((e) => e.removeAttribute('data-dash-spot'));
  if (!ids.length) return;
  let first: Element | null = null;
  for (const el of Array.from(root.querySelectorAll('[data-source]'))) {
    const s = (el.getAttribute('data-source') ?? '').split(/\s+/);
    if (s.some((x) => ids.includes(x))) {
      el.setAttribute('data-dash-spot', '');
      first ??= el;
    }
  }
  first?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// keys the editor handles (refresh, data mode) still reach it while the page has the focus
addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.key === 'Escape') post({ dc: 'key', key: e.key, meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
});

// -------------------------------------------------------------- messages

let mounted = false;
addEventListener('message', (e) => {
  if (e.source !== parent) return;
  const m = e.data as ToDash;
  if (!m || typeof m !== 'object' || typeof m.dc !== 'string') return;
  switch (m.dc) {
    case 'dash-page':
      if (mounted) return;
      mounted = true;
      datasetIds = new Set(m.datasets);
      params = { ...m.params };
      document.documentElement.setAttribute('data-theme', m.theme);
      setMode(m.mode);
      if (m.link) {
        try {
          history.replaceState(null, '', '#' + m.link);
        } catch {
          // ignore
        }
      }
      mount(m.files);
      redraw();
      break;
    case 'dash-data':
      for (const [id, s] of Object.entries(m.states)) {
        states.set(id, s);
        if (!loaders.has(id) || s.status !== 'ok') {
          loaded.delete(id);
          raw.delete(id);
        } else if (s.refreshing && loaded.has(id)) {
          loaded.set(id, { ...loaded.get(id)!, refreshing: true });
        }
      }
      for (const [id, r] of Object.entries(m.raw ?? {})) {
        raw.set(id, { ...r, seq: (raw.get(id)?.seq ?? 0) + 1 });
        void runLoader(id);
      }
      redraw();
      break;
    case 'dash-params':
      params = { ...m.params };
      redraw();
      break;
    case 'dash-theme':
      document.documentElement.setAttribute('data-theme', m.theme);
      redraw();
      break;
    case 'dash-mode':
      setMode(m.mode);
      break;
    case 'dash-spot':
      spot(m.ids);
      break;
    case 'dash-call-result': {
      const p = pendingCalls.get(m.call);
      if (!p) return;
      pendingCalls.delete(m.call);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m.answer);
      break;
    }
  }
});

post({ dc: 'ready' });
