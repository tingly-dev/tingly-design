/**
 * A dashboard: datasets the page reads, and the page that reads them. The
 * original Dashboard type keeps these as documents in the artifact's own
 * store (`dash/meta`, `dash/params`, `datasets/<id>`, `files/<name>`); here
 * they are files of the project, one per document:
 *
 *   dash.json            {title, params}
 *   datasets/<id>.json   {title, description, source, updated, …}
 *   files/<name>         the page: files/index.html, and what it links
 *   data/<name>          attached data files (csv, tsv, json) and SQLite
 *                        databases a query reads
 */

import type { DrawnFinding } from './drawnCheck';

export const DASH_INDEX = 'dash.json';
export const DASH_PAGE = 'files/index.html';
/** The latest report from an open page: what failed, threw or is mis-marked (not tracked). */
export const DASH_RUNS = '.runs.json';

export const DATASET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const DASH_FILE_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;
/** The store refuses a document over 256 KB; so do we, for a page file. */
export const DASH_FILE_MAX = 256 * 1024;
/** A dataset's data: an attached file or a query's answer. */
export const DASH_DATA_MAX = 8 * 1024 * 1024;
export const SQL_MAX = 16000;

export type ParamValue = string | number | boolean | null | (string | number | boolean | null)[];
export type Params = Record<string, ParamValue>;

export interface DashJson {
  title: string;
  params: Params;
  [k: string]: unknown;
}

export interface FileSource {
  kind: 'file';
  /** a path under data/ in this project */
  url: string;
  name?: string;
  format?: 'csv' | 'tsv' | 'json';
}

export interface QuerySource {
  kind: 'query';
  connector: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface DatasetJson {
  title: string;
  description?: string;
  source: FileSource | QuerySource | { kind: string; [k: string]: unknown };
  updated?: { at: string; by?: string };
  schedule?: string;
  staleAfterHours?: number;
  /** a paused query: the call this file holds the rows of */
  request?: { connector: string; tool: string; args: Record<string, unknown> };
  lastAttempt?: { at: string; ok: boolean; error?: string; by?: string };
  pausedBy?: string;
  [k: string]: unknown;
}

export function isDatasetId(id: string): boolean {
  return DATASET_ID_RE.test(id);
}

export function datasetFile(id: string): string {
  return `datasets/${id}.json`;
}

export function datasetIdOf(path: string): string | null {
  const m = /^datasets\/([A-Za-z0-9_-]{1,64})\.json$/.exec(path);
  return m ? m[1] : null;
}

/** A text file of a dashboard the editor reads and writes. */
export function isDashFile(path: string): boolean {
  if (path === DASH_INDEX || datasetIdOf(path)) return true;
  const m = /^files\/(.+)$/.exec(path);
  return !!m && DASH_FILE_RE.test(m[1]) && /\.(html|css|js|json|md|txt)$/.test(m[1]);
}

export const DASH_DATA_TYPES: Record<string, string> = {
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  tab: 'text/tab-separated-values; charset=utf-8',
  json: 'application/json; charset=utf-8',
  db: 'application/vnd.sqlite3',
  sqlite: 'application/vnd.sqlite3',
  sqlite3: 'application/vnd.sqlite3',
};

/** An attached data file: data/<name>, read by a file dataset or a query. */
export function isDataPath(path: string): boolean {
  const m = /^data\/([A-Za-z0-9_-][A-Za-z0-9_.-]{0,120})\.([a-z0-9]+)$/i.exec(path);
  return !!m && !path.includes('..') && !!DASH_DATA_TYPES[m[2].toLowerCase()];
}

export function isDatabasePath(path: string): boolean {
  return isDataPath(path) && /\.(db|sqlite3?)$/i.test(path);
}

// ------------------------------------------------------------- dash.json

export function parseDash(text: string | undefined): DashJson {
  let raw: Record<string, unknown> = {};
  try {
    const j = JSON.parse(text ?? '{}');
    if (j && typeof j === 'object' && !Array.isArray(j)) raw = j;
  } catch {
    // an unreadable index reads as an empty one
  }
  return { ...raw, title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : 'Dashboard', params: cleanParams(raw.params) ?? {} };
}

export function stringifyDash(d: DashJson): string {
  return JSON.stringify(d, null, 2) + '\n';
}

export function newDash(title: string): DashJson {
  return { title, params: {} };
}

function cleanValue(v: unknown): ParamValue | undefined {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return /[\r\n]/.test(v) || v.length > 1000 ? undefined : v;
  return undefined;
}

/** Filter values as the original keeps them: text on one line, a number, a boolean, null, or a list of them. */
export function cleanParams(p: unknown): Params | null {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const out: Params = {};
  for (const [k, v] of Object.entries(p)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) continue;
    if (Array.isArray(v)) {
      const list = v.map(cleanValue);
      if (list.length <= 1000 && list.every((x) => x !== undefined && !Array.isArray(x))) out[k] = list as (string | number | boolean | null)[];
      continue;
    }
    const c = cleanValue(v);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

// ---------------------------------------------------------------- datasets

export interface DatasetIssue {
  message: string;
}

export function parseDataset(text: string | undefined): { dataset: DatasetJson | null; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text ?? '');
  } catch {
    return { dataset: null, error: 'not valid JSON' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { dataset: null, error: 'not an object' };
  const d = raw as DatasetJson;
  const src = d.source as Record<string, unknown> | undefined;
  if (!src || typeof src !== 'object') return { dataset: null, error: 'no source' };
  const title = typeof d.title === 'string' && d.title.trim() ? d.title : '';
  if (src.kind === 'file') {
    if (typeof src.url !== 'string' || !isDataPath(src.url.replace(/^\.?\//, ''))) return { dataset: { ...d, title }, error: `a file source's url is a path under data/ (csv, tsv or json), not ${JSON.stringify(src.url)}` };
    if (isDatabasePath(src.url.replace(/^\.?\//, ''))) return { dataset: { ...d, title }, error: 'a database is read by a query, not as a file' };
  } else if (src.kind === 'query') {
    if (typeof src.connector !== 'string' || !src.connector) return { dataset: { ...d, title }, error: 'a query names its connector' };
    if (typeof src.tool !== 'string' || !src.tool) return { dataset: { ...d, title }, error: 'a query names its tool' };
    if (!src.args || typeof src.args !== 'object' || Array.isArray(src.args)) return { dataset: { ...d, title }, error: 'a query has args' };
  } else if (src.kind === 'rows') {
    return { dataset: { ...d, title }, error: 'an old rows dataset: make its rows a JSON file under data/' };
  } else {
    return { dataset: { ...d, title }, error: `unknown source kind ${JSON.stringify(src.kind)}` };
  }
  return { dataset: { ...d, title } };
}

export function formatOf(src: FileSource): 'csv' | 'tsv' | 'json' {
  if (src.format === 'csv' || src.format === 'tsv' || src.format === 'json') return src.format;
  const name = (src.name || src.url).toLowerCase();
  if (/\.(tsv|tab)$/.test(name)) return 'tsv';
  if (/\.json$/.test(name)) return 'json';
  return 'csv';
}

/** A file dataset older than its staleAfterHours. */
export function isStale(d: DatasetJson, now = Date.now()): boolean {
  if (!d.updated?.at || typeof d.staleAfterHours !== 'number' || !(d.staleAfterHours > 0)) return false;
  const at = Date.parse(d.updated.at);
  return Number.isFinite(at) && now - at > d.staleAfterHours * 3600000;
}

// ------------------------------------------------------------------ tables

export type Cell = string | number | boolean | null;
export type Row = Record<string, unknown>;

export interface Table {
  columns: string[];
  rows: Row[];
  cut?: boolean;
  meta?: MetaItem[];
}

export interface MetaItem {
  label: string;
  value: string;
  type?: 'text' | 'code';
  lang?: string;
}

/** CSV or TSV: a BOM stripped, quoted cells, the first row names the columns, empty cells are null. */
export function parseDelimited(text: string, sep = ','): Table {
  let s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!s.endsWith('\n')) s += '\n';
  const records: (string | null)[][] = [];
  let row: (string | null)[] = [];
  let i = 0;
  while (i < s.length) {
    let cell: string;
    let quoted = false;
    if (s[i] === '"') {
      quoted = true;
      let out = '';
      i++;
      while (i < s.length) {
        if (s[i] === '"') {
          if (s[i + 1] === '"') {
            out += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        out += s[i++];
      }
      // anything up to the separator after a closing quote is kept
      while (i < s.length && s[i] !== sep && s[i] !== '\n' && s[i] !== '\r') out += s[i++];
      cell = out;
    } else {
      const start = i;
      while (i < s.length && s[i] !== sep && s[i] !== '\n' && s[i] !== '\r') i++;
      cell = s.slice(start, i);
    }
    row.push(cell === '' && !quoted ? null : cell);
    if (s[i] === sep) {
      i++;
      continue;
    }
    if (s[i] === '\r') i++;
    if (s[i] === '\n') i++;
    if (!(row.length === 1 && row[0] === null)) records.push(row);
    row = [];
  }
  const head = records.shift() ?? [];
  const columns: string[] = [];
  head.forEach((h, n) => {
    let name = (h ?? '').trim() || `column_${n + 1}`;
    while (columns.includes(name)) name += '_';
    columns.push(name);
  });
  const rows = records.map((r) => Object.fromEntries(columns.map((c, n) => [c, r[n] ?? null])));
  return { columns, rows };
}

function isPlainRow(x: unknown): x is Row {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/** Row objects, bare or under rows/data/results, as a table; anything else is not one. */
export function toTable(answer: unknown): Table | null {
  let list: unknown = answer;
  let columns: string[] | undefined;
  let meta: MetaItem[] | undefined;
  let cut: boolean | undefined;
  if (isPlainRow(answer)) {
    const key = ['rows', 'data', 'results'].find((k) => Array.isArray((answer as Row)[k]));
    if (!key) return null;
    list = (answer as Row)[key];
    const c = (answer as Row).columns;
    if (Array.isArray(c) && c.every((x) => typeof x === 'string')) columns = c as string[];
    else if (Array.isArray(c) && c.every((x) => isPlainRow(x) && typeof x.name === 'string')) columns = (c as Row[]).map((x) => x.name as string);
    const m = (answer as Row).meta;
    if (Array.isArray(m)) meta = m.filter((x): x is MetaItem => isPlainRow(x) && typeof x.label === 'string' && typeof x.value === 'string');
    if ((answer as Row).cut === true) cut = true;
  }
  if (!Array.isArray(list) || !list.every(isPlainRow)) return null;
  if (!columns) {
    const seen = new Set<string>();
    for (const r of list) for (const k of Object.keys(r)) seen.add(k);
    columns = [...seen];
  }
  const t: Table = { columns, rows: list as Row[] };
  if (meta?.length) t.meta = meta;
  if (cut) t.cut = cut;
  return t;
}

/** An attached file's data: a table, or (JSON that is not rows) the value as it came. */
export function parseDataFile(text: string, format: 'csv' | 'tsv' | 'json'): { table: Table | null; value: unknown } {
  if (format === 'json') {
    const value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return { table: toTable(value), value };
  }
  const table = parseDelimited(text, format === 'tsv' ? '\t' : ',');
  return { table, value: table.rows };
}

export function tableToCsv(t: Table): string {
  const q = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [t.columns.map(q).join(','), ...t.rows.map((r) => t.columns.map((c) => q(r[c])).join(','))].join('\n') + '\n';
}

// --------------------------------------------------------------------- SQL

export interface SqlToken {
  kind: 'space' | 'comment' | 'string' | 'name' | 'word' | 'number' | 'placeholder' | 'punct';
  text: string;
  open?: boolean;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/y;

/** Strings, quoted names, comments, words, numbers and {{placeholders}}, in order. */
export function tokenizeSql(sql: string): SqlToken[] {
  const out: SqlToken[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    let kind: SqlToken['kind'] = 'punct';
    let j = i + 1;
    let open = false;
    if (/\s/.test(c)) {
      kind = 'space';
      while (j < n && /\s/.test(sql[j])) j++;
    } else if ((c === '-' && sql[i + 1] === '-') || c === '#') {
      kind = 'comment';
      while (j < n && sql[j] !== '\n') j++;
    } else if (c === '/' && sql[i + 1] === '*') {
      kind = 'comment';
      const e = sql.indexOf('*/', i + 2);
      open = e < 0;
      j = open ? n : e + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      kind = c === "'" ? 'string' : 'name';
      j = -1;
      for (let k = i + 1; k < n; k++) {
        if (sql[k] === '\\' && c !== '`') {
          k++;
          continue;
        }
        if (sql[k] === c) {
          if (sql[k + 1] === c) {
            k++;
            continue;
          }
          j = k + 1;
          break;
        }
      }
      open = j < 0;
      if (open) j = n;
    } else if (/[A-Za-z_]/.test(c)) {
      kind = 'word';
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
    } else if (/[0-9.]/.test(c) && /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)/.test(sql.slice(i, i + 64))) {
      kind = 'number';
      j = i + /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(sql.slice(i, i + 256))![0].length;
    } else if (c === '{') {
      PLACEHOLDER.lastIndex = i;
      if (PLACEHOLDER.test(sql)) {
        kind = 'placeholder';
        j = PLACEHOLDER.lastIndex;
      }
    }
    out.push(open ? { kind, text: sql.slice(i, j), open } : { kind, text: sql.slice(i, j) });
    i = j;
  }
  return out;
}

export const SQL_FORBIDDEN = 'INSERT UPDATE DELETE MERGE DROP ALTER CREATE TRUNCATE GRANT REVOKE CALL EXEC EXECUTE COPY EXPORT LOAD INTO RETURNING DECLARE SET BEGIN COMMIT ATTACH DETACH PRAGMA VACUUM REINDEX REPLACE'.split(' ');
const FORBIDDEN = new Set(SQL_FORBIDDEN);

/** Why the page refuses this SQL, or null: one SELECT or WITH statement, read only. */
export function checkSql(sql: unknown): string | null {
  if (typeof sql !== 'string' || !sql.trim()) return 'the query has no SQL';
  if (sql.length > SQL_MAX) return `the SQL is over ${SQL_MAX} characters`;
  const toks = tokenizeSql(sql);
  const open = toks.find((t) => t.open);
  if (open) return `an unclosed ${open.kind === 'comment' ? 'comment' : 'quote'}`;
  const code = toks.filter((t) => t.kind !== 'space' && t.kind !== 'comment');
  const first = code[0];
  if (!first || first.kind !== 'word' || !/^(SELECT|WITH)$/i.test(first.text)) return 'the query is one SELECT or WITH statement';
  const semi = code.findIndex((t) => t.text === ';');
  if (semi >= 0 && semi !== code.length - 1) return 'one statement only';
  const bad = code.find((t) => t.kind === 'word' && FORBIDDEN.has(t.text.toUpperCase()));
  if (bad) return `${bad.text.toUpperCase()} is not allowed in a dashboard query (backtick a column so named)`;
  for (const t of toks) if (t.kind === 'string' && /\{\{\s*[A-Za-z_]/.test(t.text)) return `a {{filter}} fills one whole literal: CONCAT('%', {{q}}, '%'), not ${t.text}`;
  return null;
}

/** The filter names a call uses, in any argument. */
export function paramsIn(args: unknown): string[] {
  const out = new Set<string>();
  const visit = (v: unknown) => {
    if (typeof v === 'string') for (const m of v.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g)) out.add(m[1]);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(args);
  return [...out];
}

/**
 * SQL with its {{filters}} as bound parameters: each fills ONE literal
 * (a list fills `(?, ?)`, an empty one `(NULL)`, which matches nothing).
 * An unset filter is NULL.
 */
export function bindSql(sql: string, params: Params): { sql: string; values: (string | number | null)[] } | { error: string } {
  const why = checkSql(sql);
  if (why) return { error: why };
  const values: (string | number | null)[] = [];
  const lit = (v: string | number | boolean | null) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);
  let out = '';
  for (const t of tokenizeSql(sql)) {
    if (t.kind !== 'placeholder') {
      out += t.text;
      continue;
    }
    const name = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(t.text)![1];
    const v = params[name] ?? null;
    if (Array.isArray(v)) {
      out += v.length ? `(${v.map(() => '?').join(', ')})` : '(NULL)';
      values.push(...v.map(lit));
    } else {
      out += '?';
      values.push(lit(v));
    }
  }
  return { sql: out, values };
}

/** Any other argument: a whole "{{x}}" is the typed value; inside other text, plain text. */
export function fillArgs(args: Record<string, unknown>, params: Params, skip: string[] = ['sql']): Record<string, unknown> {
  const fill = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const whole = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}$/.exec(v);
      if (whole) return params[whole[1]] ?? null;
      return v.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g, (_, k: string) => {
        const p = params[k];
        return p === null || p === undefined ? '' : Array.isArray(p) ? p.join(',') : String(p);
      });
    }
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, skip.includes(k) ? v : fill(v)]));
}

// ------------------------------------------------------------------- marks

export interface Mark {
  source: string;
  field?: string;
  where?: { column: string; value: string }[];
  row?: number;
}

export function parseWhere(s: string): { column: string; value: string }[] {
  const dec = (x: string) => {
    try {
      return decodeURIComponent(x);
    } catch {
      return x;
    }
  };
  const out: { column: string; value: string }[] = [];
  for (const part of s.split('&')) {
    const at = part.indexOf('=');
    const column = at <= 0 ? '' : dec(part.slice(0, at)).trim();
    if (!column) continue;
    out.push({ column, value: dec(part.slice(at + 1)) });
  }
  return out;
}

/** A mark from an element's data-source / data-field / data-where / data-row. */
export function markOf(attrs: { source: string | null; field?: string | null; where?: string | null; row?: string | null }, source?: string): Mark {
  const m: Mark = { source: source ?? (attrs.source ?? '').split(/\s+/).filter(Boolean)[0] ?? '' };
  const f = attrs.field?.trim();
  if (f) m.field = f;
  if (attrs.where != null) m.where = parseWhere(attrs.where);
  else if (attrs.row != null) m.row = /^\d+$/.test(attrs.row.trim()) ? Number(attrs.row.trim()) : -1;
  return m;
}

export function isCellMark(m: Mark): boolean {
  return m.field !== undefined || m.where !== undefined || m.row !== undefined;
}

/** A cell as text, the way data-where compares it. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** The rows a mark names, or why it names none. */
export function resolveMark(m: Mark, t: Table): number[] | string {
  if (m.field !== undefined && !t.columns.includes(m.field)) return `no column “${m.field}”`;
  if (m.where !== undefined) {
    if (!m.where.length) return 'data-where isn’t col=value';
    const missing = m.where.find((w) => !t.columns.includes(w.column));
    if (missing) return `no column “${missing.column}”`;
    const rows: number[] = [];
    t.rows.forEach((r, i) => {
      if (m.where!.every((w) => cellText(r[w.column]) === w.value)) rows.push(i);
    });
    return rows.length ? rows : 'no matching row';
  }
  if (m.row !== undefined) return m.row >= 0 && m.row < t.rows.length ? [m.row] : `no row ${m.row < 0 ? 'by that number' : m.row}`;
  return t.rows.map((_, i) => i);
}

const SUFFIX: Record<string, number> = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9, 万: 1e4, 亿: 1e8 };

/**
 * The number a mark shows, read as people write numbers: group and decimal
 * separators of either kind, a K/M/B (or 万/亿) suffix, a percent sign, a
 * sign (also − and +). `step` is what the shown precision allows.
 */
export function readShownNumber(text: string): { value: number; step: number; percent: boolean } | null {
  const s = text.replace(/−/g, '-').replace(/[   ]/g, ' ').trim();
  const nums = s.match(/\d[\d,.' ]*\d|\d/g);
  if (!nums || nums.length !== 1) return null;
  const m = /([+-]?)\s*([^\d+-]{0,3}?)\s*(\d[\d,.' ]*\d|\d)\s*([kKmMbB万亿](?![A-Za-z]))?\s*(%?)/.exec(s);
  if (!m) return null;
  let body = m[3].replace(/[ ']/g, '');
  const lastDot = body.lastIndexOf('.');
  const lastComma = body.lastIndexOf(',');
  let decimals = 0;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const grp = dec === '.' ? ',' : '.';
    body = body.split(grp).join('');
    decimals = body.length - body.indexOf(dec) - 1;
    body = body.replace(dec, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = body.split(sep);
    const grouped = parts.length > 2 || (parts[parts.length - 1].length === 3 && parts[0].length <= 3 && sep === ',');
    if (grouped && parts.slice(1).every((p) => p.length === 3)) body = parts.join('');
    else if (parts.length === 2) {
      decimals = parts[1].length;
      body = parts.join('.');
    } else return null;
  }
  const n = Number(body);
  if (!Number.isFinite(n)) return null;
  const mult = m[4] ? SUFFIX[m[4]] : 1;
  const sign = m[1] === '-' || /^\(.*\)$/.test(s) ? -1 : 1;
  return { value: sign * n * mult, step: Math.pow(10, -decimals) * mult, percent: m[5] === '%' };
}

export type MarkVerdict =
  | { status: 'match'; rows: number[] }
  | { status: 'mismatch'; rows: number[]; shown: string; inData: string }
  | { status: 'unresolved'; reason: string }
  | { status: 'plain' | 'resolves'; rows: number[] };

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

/** Does a shown number agree with the cell, at the precision it is shown, in the cell's own unit or a scaled one? */
export function numberAgrees(shown: { value: number; step: number; percent: boolean }, cell: number): boolean {
  const tol = shown.step / 2 + 1e-9 * Math.max(1, Math.abs(shown.value));
  const scales = shown.percent ? [100, 1] : [1, 1e-3, 1e3, 1e-6, 1e6, 1e-9, 1e9];
  return scales.some((k) => Math.abs(cell * k - shown.value) <= tol || Math.abs(Math.abs(cell * k) - Math.abs(shown.value)) <= tol);
}

/** Check one mark of one cell against the table it names. */
export function checkMark(m: Mark, t: Table, shownText: string): MarkVerdict {
  const rows = resolveMark(m, t);
  if (typeof rows === 'string') return { status: 'unresolved', reason: rows };
  const shown = shownText.trim();
  if (m.field === undefined || rows.length !== 1) return { status: 'plain', rows };
  const cell = t.rows[rows[0]][m.field];
  if (!shown || /^[—–-]$/.test(shown)) return { status: cell === null || cell === undefined || cell === '' ? 'resolves' : 'mismatch', rows, ...(cell === null || cell === undefined || cell === '' ? {} : { shown, inData: cellText(cell) }) } as MarkVerdict;
  const num = asNumber(cell);
  if (num === null) {
    if (typeof cell === 'string' && cell.trim() && shown === cell.trim()) return { status: 'match', rows };
    return { status: 'plain', rows };
  }
  const s = readShownNumber(shown);
  if (!s) return { status: 'plain', rows };
  return numberAgrees(s, num) ? { status: 'match', rows } : { status: 'mismatch', rows, shown, inData: cellText(cell) };
}

// -------------------------------------------------------- what a page reports

export type SourceStatus = 'missing' | 'error' | 'loading' | 'connect' | 'declined' | 'ok';

/** One dataset as the page sees it: `dash.data(id)`. */
export interface DataState {
  status: SourceStatus;
  data: unknown;
  columns: string[];
  rows: Row[];
  message?: string;
  refreshing: boolean;
  meta: MetaItem[];
  cut?: boolean;
  /** when the data was read (ms) */
  at?: number;
  ms?: number;
}

export interface MarkProblem {
  mark: string;
  source: string;
  field?: string;
  where?: string;
  row?: number;
  shown?: string;
  inData?: string;
  reason?: string;
}

export interface PageError {
  kind: 'error' | 'rejection' | 'stopped';
  name: string;
  message: string;
  file?: string;
  count: number;
}

export interface CalcInfo {
  id: string;
  title?: string;
  description?: string;
  inputs: string[];
  fn: string;
}

/** What an open page tells the editor after each draw (the original's runs document, and Sources' calc views). */
export interface DashReport {
  /** datasets and calcs the page read */
  read: string[];
  /** datasets and calcs some mark names */
  marked: string[];
  marks: MarkProblem[];
  /** what the page drew that looks wrong: NaN, an empty chart, labels over each other or cut off */
  drawn: DrawnFinding[];
  flagged: number;
  errors: PageError[];
  calcs: CalcInfo[];
  loaders: { id: string; description?: string; fn: string }[];
}

export const EMPTY_STATE: DataState = { status: 'missing', data: [], columns: [], rows: [], refreshing: false, meta: [] };

/** A new dashboard's page; TITLE and HINT are filled in by whoever creates it. */
export const DASH_STARTER_PAGE = `<style>
.st { font-family: var(--font-anthropic-sans); color: var(--color-fg); }
.st h1 { font-family: var(--font-anthropic-serif); font-weight: 400; font-size: var(--cds-font-size-title); margin: 0 0 var(--cds-gap-xs); }
.st p { color: var(--color-fg-muted); margin: 0; }
</style>
<div class="st">
  <h1>TITLE</h1>
  <p>HINT</p>
</div>
`;
