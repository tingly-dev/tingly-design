/**
 * A dashboard frozen into one file so a slide can show it live: the page's files and what each dataset
 * held when it was frozen. The slide's `XDash` answers the page's `dash-want` from it and nothing is
 * queried at show time, so the slide looks the same on every machine and in every export. See
 * .design/cross-kind-embedding.md §5.3.
 */
import { EMPTY_STATE, toTable, type DataState, type Params, type Table } from './dash';

export const DASH_BUNDLE_VERSION = 1;
/** The whole bundle may hold this much; a dataset over its share is cut (and says so) so a slide's folder stays small. */
export const DASH_BUNDLE_MAX = 4 * 1024 * 1024;
/** The viewport the page is laid out in inside its element; the element scales it to cover. */
export const DASH_VIEW: [number, number] = [1280, 800];

/** One dataset as it was frozen: what the page reads, and for a query a loader reshapes, the answer it reshapes. */
export interface FrozenDataset {
  state: DataState;
  raw?: { answer: unknown; args: Record<string, unknown> };
}

export interface DashBundle {
  v: typeof DASH_BUNDLE_VERSION;
  title: string;
  /** the page's files, named as the dashboard's frame is handed them (`files/index.html` is `index.html`) */
  files: Record<string, string>;
  datasets: Record<string, FrozenDataset>;
  params: Params;
  theme: 'light' | 'dark';
  /** when the data was read */
  frozenAt: string;
  /** the datasets that could not be read, with why: the page draws them as it draws a failed source */
  failed?: Record<string, string>;
}

/** Where a frozen dashboard lives in the project that shows it. */
export function isDashBundlePath(path: string): boolean {
  return /^uploads\/linked\/[a-z0-9]{1,16}\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.dash\.json$/.test(path) && !path.includes('..');
}

/** Every dataset id a page's scripts hand a loader (`dash.loader('id', …)`): only those need the query's raw answer. */
export function loaderIds(files: Record<string, string>): { ids: string[]; dynamic: boolean } {
  const ids = new Set<string>();
  let dynamic = false;
  for (const text of Object.values(files)) {
    if (!/\bloader\s*\(/.test(text)) continue;
    let named = 0;
    for (const m of text.matchAll(/\bloader\s*\(\s*(['"`])([^'"`$]+)\1/g)) {
      ids.add(m[2]);
      named++;
    }
    // a loader whose id is computed: any query's answer may be wanted
    if (named < (text.match(/\bloader\s*\(/g) ?? []).length) dynamic = true;
  }
  return { ids: [...ids], dynamic };
}

/** The state a dataset has once its rows are in. */
export function readyState(t: Table | null, value: unknown, at: number): DataState {
  return t
    ? { status: 'ok', data: t.rows, columns: t.columns, rows: t.rows, refreshing: false, meta: t.meta ?? [], ...(t.cut ? { cut: t.cut } : {}), at }
    : { status: 'ok', data: value, columns: [], rows: [], refreshing: false, meta: [], at };
}

/** A query's frozen dataset: the table its answer makes, and the raw answer when a loader may want it. */
export function queryDataset(answer: unknown, args: Record<string, unknown>, at: number, keepRaw: boolean): FrozenDataset {
  return { state: readyState(toTable(answer), answer, at), ...(keepRaw ? { raw: { answer, args } } : {}) };
}

/** A dataset that could not be read, as the page draws it. */
export function failedDataset(message: string, status: 'error' | 'connect' | 'missing' = 'error'): FrozenDataset {
  return { state: { ...EMPTY_STATE, status, message } };
}

const size = (v: unknown): number => JSON.stringify(v)?.length ?? 0;

/**
 * Keep a bundle under `max` characters: the largest datasets lose rows (from the end, marked `cut`) until it fits.
 * Returns the ids it had to cut.
 */
export function fitBundle(b: DashBundle, max = DASH_BUNDLE_MAX): string[] {
  const cut: string[] = [];
  for (let guard = 0; size(b) > max && guard < 64; guard++) {
    const biggest = Object.entries(b.datasets)
      .map(([id, d]) => ({ id, n: size(d), rows: d.state.rows.length }))
      .filter((x) => x.rows > 1)
      .sort((a, c) => c.n - a.n)[0];
    if (!biggest) break;
    const d = b.datasets[biggest.id];
    const keep = Math.max(1, Math.floor(d.state.rows.length / 2));
    const rows = d.state.rows.slice(0, keep);
    d.state = { ...d.state, rows, data: Array.isArray(d.state.data) ? rows : d.state.data, cut: true };
    // a loader's raw answer would still be whole: it cannot be cut without breaking its shape, so it goes and the page shows the cut rows
    delete d.raw;
    if (!cut.includes(biggest.id)) cut.push(biggest.id);
  }
  return cut;
}

/**
 * The page a frozen dashboard runs in: the dashboard runtime and nothing else, with the dashboard frame's own
 * policy (scripts only from the runtime's folder, no network, pictures and fonts only as `data:`), so a page in a
 * slide can send nothing out. `dir` is where the runtime's files are served, ending in a slash.
 */
export function dashFrameDoc(dir: string): string {
  const d = dir.replace(/"/g, '&quot;');
  const csp = `default-src 'none'; script-src ${d} 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0}</style></head><body><div id="dc-app"></div><script src="${d}dash.js"></script></body></html>`;
}

export function stringifyBundle(b: DashBundle): string {
  return JSON.stringify(b) + '\n';
}

/** A bundle read back; null when it is not one this version knows. */
export function parseDashBundle(text: string | undefined): DashBundle | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as Partial<DashBundle>;
    if (!j || j.v !== DASH_BUNDLE_VERSION || typeof j.files !== 'object' || !j.files || typeof j.datasets !== 'object' || !j.datasets) return null;
    return {
      v: DASH_BUNDLE_VERSION,
      title: typeof j.title === 'string' ? j.title : 'Dashboard',
      files: j.files as Record<string, string>,
      datasets: j.datasets as Record<string, FrozenDataset>,
      params: (j.params ?? {}) as Params,
      theme: j.theme === 'dark' ? 'dark' : 'light',
      frozenAt: typeof j.frozenAt === 'string' ? j.frozenAt : '',
      ...(j.failed && typeof j.failed === 'object' ? { failed: j.failed as Record<string, string> } : {}),
    };
  } catch {
    return null;
  }
}
