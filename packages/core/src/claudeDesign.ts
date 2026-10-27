import { CANVAS_FILE } from './canvas';
import { DASH_INDEX, DASH_PAGE, DATASET_ID_RE, DASH_DATA_TYPES, parseDash, stringifyDash, tableToCsv, type DatasetJson, type Table } from './dash';
import { DECK_FILE } from './deck';
import { DS_INDEX } from './designSystem';
import { DEFAULT_SETTINGS, DOC_INDEX, stringifyDoc, tabFile, type DocJson } from './docs';
import type { ProjectKind } from './deck';
import { archiveKeeps } from './projectArchive';

/**
 * Claude's own Design artifacts as files, both ways (.design/claude-design-format.md). The original
 * types keep their work in the layout their SKILL.md describes: Design, Slides and Design System
 * under `project/`, a Dashboard as documents of its store (`dash/meta`, `dash/params`,
 * `datasets/<id>`, `files/<name>`), and Docs in a service of their own. A package is that layout
 * as plain files, which is what Claude Code saves when it reads an artifact and what it publishes
 * from; this module is the rules for turning one into a Tingly Design project and back. It has no
 * file system: files in, files out, and notes as data for the editor and the command line to word.
 */

/** The kinds that have an original type with files to exchange; docs go through Markdown, motion has no original. */
export type ClaudeDesignKind = 'design' | 'slides' | 'design-system' | 'dashboard';

export const CLAUDE_DESIGN_KINDS: ClaudeDesignKind[] = ['design', 'slides', 'design-system', 'dashboard'];

export function hasClaudeDesign(kind: ProjectKind): kind is ClaudeDesignKind {
  return (CLAUDE_DESIGN_KINDS as string[]).includes(kind);
}

/** Something the person should know after an exchange; the editor and command line say it in words (`claudeDesign.note.<key>`). */
export interface ClaudeDesignNote {
  key: 'missingPictures' | 'missingData' | 'connector' | 'localSystem' | 'slidePictures' | 'sqlite' | 'queryData';
  params?: Record<string, string | number>;
}

export type Files = Record<string, Uint8Array>;

const enc = new TextEncoder();
const dec = new TextDecoder();
const text = (b: Uint8Array) => dec.decode(b);
const bytes = (s: string) => enc.encode(s);

/** The prefix a package keeps a kind's index under. */
const PROJECT_DIR = 'project/';

const FILE_INDEX: [string, 'slides' | 'design' | 'design-system'][] = [
  [DECK_FILE, 'slides'],
  [CANVAS_FILE, 'design'],
  [DS_INDEX, 'design-system'],
];

export interface PackageMatch {
  kind: ClaudeDesignKind;
  /** the folder the package starts in (`''` at the top, `x/` when the zip wraps it in a folder) */
  root: string;
}

/** Where the package is in a file list, or null when it is not one. Shortest wrapper wins; deck, canvas, design system in that order. */
export function detectClaudeDesign(paths: string[]): PackageMatch | null {
  let best: PackageMatch | null = null;
  const rank = (m: PackageMatch) => m.root.split('/').length;
  const offer = (m: PackageMatch) => {
    if (!best || rank(m) < rank(best)) best = m;
  };
  for (const p of paths) {
    for (const [file, kind] of FILE_INDEX) {
      const m = new RegExp(`^(.*/)?${PROJECT_DIR}${file.replace('.', '\\.')}$`).exec(p);
      if (m) offer({ kind, root: m[1] ?? '' });
    }
    const d = /^(.*\/)?dash\/meta(\.json)?$/.exec(p);
    if (d) offer({ kind: 'dashboard', root: d[1] ?? '' });
  }
  if (best) return best;
  // a dashboard saved without its meta document: datasets and a page beside them are enough,
  // unless a dash.json says it is one of ours (a Tingly dashboard folder, zipped by hand or imported as a folder)
  const roots = new Set(paths.map((p) => /^(.*\/)?datasets\/[^/]+(\.json)?$/.exec(p)).filter((m) => m).map((m) => m![1] ?? ''));
  for (const root of [...roots].sort((a, b) => a.split('/').length - b.split('/').length)) {
    const hasPage = paths.includes(`${root}index.html`) || paths.includes(`${root}files/index.html`);
    if (hasPage && !paths.includes(`${root}${DASH_INDEX}`)) return { kind: 'dashboard', root };
  }
  return null;
}

// ------------------------------------------------------------------ pictures

/** `/_blob/<id>`: how the original refers to a picture or file in its asset store. */
const BLOB_RE = /(?<![\w.~%/-])(?:\.{1,2})?\/?_blob\/([0-9a-f]{32})\b/g;
const TEXT_FILE_RE = /\.(html?|css|js|json|md|svg|txt)$/i;

/** Files in the package that look like stored assets: named `<id>.<ext>` or just `<id>`, which is how Claude Code saves an asset it reads. */
function assetsIn(files: Files, skip: (p: string) => boolean): Map<string, { path: string; ext: string }> {
  const out = new Map<string, { path: string; ext: string }>();
  for (const p of Object.keys(files)) {
    if (skip(p)) continue;
    const m = /(?:^|\/)([0-9a-f]{32})(\.[A-Za-z0-9]{1,8})?$/.exec(p);
    if (m && !out.has(m[1])) out.set(m[1], { path: p, ext: m[2] ?? '' });
  }
  return out;
}

/** Every `/_blob/<id>` in the project's text files, pointed at `uploads/<id>.<ext>` where the package carries it. */
function bringPictures(project: Files, assets: Map<string, { path: string; ext: string }>, all: Files, notes: ClaudeDesignNote[], fromFile: boolean): void {
  const missing = new Set<string>();
  for (const [rel, data] of Object.entries(project)) {
    if (!TEXT_FILE_RE.test(rel)) continue;
    const src = text(data);
    if (!src.includes('_blob/')) continue;
    const next = src.replace(BLOB_RE, (_m, id: string) => {
      const a = assets.get(id);
      if (!a) {
        missing.add(id);
        return _m;
      }
      const to = `uploads/${id}${a.ext}`;
      if (!project[to]) project[to] = all[a.path];
      // a design system's component files are drawn in a frame based at components/<name>/ (bundle.css and
      // bundle.js inlined into it too); everything else, and canvases and slides, resolve from the project's folder
      return fromFile && rel.startsWith('components/') && !/\.(json|md)$/i.test(rel) ? `../../${to}` : to;
    });
    if (next !== src) project[rel] = bytes(next);
  }
  if (missing.size) notes.push({ key: 'missingPictures', params: { count: missing.size } });
}

const OUTSIDE = /^(artifact-type\/|SKILL\.md$|_files\.json$|index\.html$|README\.md$)/;

// ------------------------------------------------------------------ in

export interface ClaudeDesignImport {
  kind: ClaudeDesignKind;
  /** the project's files, by path inside its folder */
  files: Files;
  /** the title in its index, to name the project after */
  title?: string;
  notes: ClaudeDesignNote[];
}

/** The project a package holds. `all` is every file of the package, `match` from `detectClaudeDesign`. */
export function fromClaudeDesign(all: Files, match: PackageMatch): ClaudeDesignImport {
  const notes: ClaudeDesignNote[] = [];
  const inside = (p: string) => (p.startsWith(match.root) ? p.slice(match.root.length) : null);
  const here: Files = {};
  for (const [p, d] of Object.entries(all)) {
    const rel = inside(p);
    if (rel) here[rel] = d;
  }
  if (match.kind === 'dashboard') return dashboardFrom(here, notes);
  const project: Files = {};
  for (const [rel, d] of Object.entries(here)) {
    if (!rel.startsWith(PROJECT_DIR)) continue;
    const r = rel.slice(PROJECT_DIR.length);
    if (r && archiveKeeps(r, { journal: false })) project[r] = d;
  }
  const assets = assetsIn(here, (p) => p.startsWith(PROJECT_DIR) || OUTSIDE.test(p));
  bringPictures(project, assets, here, notes, match.kind === 'design-system');
  const index = project[match.kind === 'design' ? CANVAS_FILE : match.kind === 'slides' ? DECK_FILE : DS_INDEX];
  return { kind: match.kind, files: project, title: titleOf(index), notes };
}

function titleOf(index: Uint8Array | undefined): string | undefined {
  try {
    const t = JSON.parse(text(index ?? new Uint8Array())).title;
    return typeof t === 'string' && t.trim() ? t.trim() : undefined;
  } catch {
    return undefined;
  }
}

const safeDataName = (n: string) => n.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[-.]+/, '') || 'data';

function dashboardFrom(here: Files, notes: ClaudeDesignNote[]): ClaudeDesignImport {
  const pick = (name: string) => here[`${name}.json`] ?? here[name];
  const json = (b: Uint8Array | undefined): Record<string, unknown> | null => {
    if (!b) return null;
    try {
      const j = JSON.parse(text(b));
      return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
    } catch {
      return null;
    }
  };
  const meta = json(pick('dash/meta'));
  const params = json(pick('dash/params'));
  const files: Files = {};
  files[DASH_INDEX] = bytes(stringifyDash(parseDash(JSON.stringify({ title: meta?.title, params: params ?? {} }))));

  // the page: files/<name> documents are {text}; a plain file is taken as it is; a saved index.html at the top works too
  let hasPage = false;
  for (const [rel, d] of Object.entries(here)) {
    const m = /^files\/([A-Za-z0-9_-][A-Za-z0-9_.-]{0,63})$/.exec(rel);
    if (!m) continue;
    let body = text(d);
    if (/\.(html?|css|js)$/i.test(m[1])) {
      const doc = json(d);
      if (doc && typeof doc.text === 'string') body = doc.text;
    }
    files[`files/${m[1]}`] = bytes(body);
    if (m[1] === 'index.html') hasPage = true;
  }
  if (!hasPage && here['index.html']) files[DASH_PAGE] = here['index.html'];

  const blobs = assetsIn(here, (p) => OUTSIDE.test(p) || p.startsWith('datasets/') || p.startsWith('dash/') || p.startsWith('files/'));
  const taken = new Set<string>();
  const byName = (n: string) => Object.keys(here).find((p) => !p.startsWith('datasets/') && !p.startsWith('dash/') && !p.startsWith('files/') && (p === n || p.endsWith(`/${n}`)));
  const connectors = new Set<string>();
  let missing = 0;
  for (const [rel, d] of Object.entries(here)) {
    const m = /^datasets\/([^/]+?)(?:\.json)?$/.exec(rel);
    if (!m || !DATASET_ID_RE.test(m[1])) continue;
    const ds = json(d) as DatasetJson | null;
    if (!ds) continue;
    const src = ds.source as { kind?: string; url?: string; name?: string; connector?: string } | undefined;
    if (src?.kind === 'file') {
      const id = /_blob\/([0-9a-f]{32})/.exec(src.url ?? '')?.[1];
      const from = (id && blobs.get(id)?.path) || (src.url && byName(src.url.replace(/^\/+/, '').split('/').pop()!)) || (src.name && byName(src.name)) || undefined;
      // a blob's name may be missing: then its saved file's extension, then the dataset's format
      const named = /\.([A-Za-z0-9]+)$/.exec(src.name ?? '')?.[1] || (id ? blobs.get(id)?.ext.slice(1) : '') || /\.([A-Za-z0-9]+)$/.exec(src.url ?? '')?.[1] || (src as { format?: string }).format || '';
      const ext = named.toLowerCase();
      if (from && DASH_DATA_TYPES[ext]) {
        let n = safeDataName(src.name ?? (id && from === blobs.get(id)?.path ? `${m[1]}.${ext}` : from.split('/').pop()!));
        // the dashboard reads a data file by its extension
        if (!n.toLowerCase().endsWith(`.${ext}`)) n = `${n}.${ext}`;
        while (taken.has(n)) n = `${m[1]}-${n}`;
        taken.add(n);
        files[`data/${n}`] = here[from];
        ds.source = { ...src, kind: 'file', url: `data/${n}` } as DatasetJson['source'];
      } else missing++;
    } else if (src?.kind === 'query' && src.connector !== 'sqlite') connectors.add(String(src.connector ?? '?'));
    files[`datasets/${m[1]}.json`] = bytes(JSON.stringify(ds, null, 2) + '\n');
  }
  if (missing) notes.push({ key: 'missingData', params: { count: missing } });
  if (connectors.size) notes.push({ key: 'connector', params: { names: [...connectors].join(', ') } });
  return { kind: 'dashboard', files, title: typeof meta?.title === 'string' ? meta.title : undefined, notes };
}

// ------------------------------------------------------------------ out

export interface ClaudeDesignExport {
  files: Files;
  notes: ClaudeDesignNote[];
}

/** The package for a project's files (`rel` paths, what the archive keeps): the original layout, and a README that says how to publish it.
 *  `queries` holds the rows a caller ran for SQLite query datasets, by dataset id; a dashboard's query that has rows here goes out as the CSV
 *  the rows make, with the call kept in the dataset's `request`. */
export function toClaudeDesign(kind: ClaudeDesignKind, project: Files, title: string, queries: Record<string, Table> = {}): ClaudeDesignExport {
  const notes: ClaudeDesignNote[] = [];
  const out: Files = {};
  if (kind === 'dashboard') dashboardTo(project, out, notes, queries);
  else {
    for (const [rel, d] of Object.entries(project)) if (archiveKeeps(rel, { journal: false })) out[`${PROJECT_DIR}${rel}`] = d;
    const index = project[kind === 'design' ? CANVAS_FILE : kind === 'slides' ? DECK_FILE : DS_INDEX];
    const local = localSystems(index);
    if (local) notes.push({ key: 'localSystem', params: { count: local } });
    if (kind === 'slides') {
      const pics = new Set<string>();
      for (const [rel, d] of Object.entries(project)) if (/^slides\/.+\.html$/.test(rel)) for (const m of text(d).matchAll(/\bsrc="(uploads\/[^"]+)"/g)) pics.add(m[1]);
      if (pics.size) notes.push({ key: 'slidePictures', params: { count: pics.size } });
    }
  }
  out['README.md'] = bytes(readme(kind, title, Object.keys(out).filter((p) => p !== 'README.md'), notes));
  return { files: out, notes };
}

function localSystems(index: Uint8Array | undefined): number {
  try {
    const list = JSON.parse(text(index ?? new Uint8Array())).designSystems;
    return Array.isArray(list) ? list.filter((r) => /^projects\//.test(String(r?.artifact ?? ''))).length : 0;
  } catch {
    return 0;
  }
}

function dashboardTo(project: Files, out: Files, notes: ClaudeDesignNote[], queries: Record<string, Table>): void {
  const dash = parseDash(project[DASH_INDEX] ? text(project[DASH_INDEX]) : undefined);
  out['dash/meta.json'] = bytes(JSON.stringify({ title: dash.title }, null, 2) + '\n');
  if (Object.keys(dash.params).length) out['dash/params.json'] = bytes(JSON.stringify(dash.params, null, 2) + '\n');
  let sqlite = false;
  let materialized = 0;
  let sqliteQueries = 0;
  const queriesOut = new Set<string>();
  for (const [rel, d] of Object.entries(project)) {
    const ds = /^datasets\/([A-Za-z0-9_-]{1,64})\.json$/.exec(rel);
    if (ds) {
      let j: DatasetJson;
      try {
        j = JSON.parse(text(d)) as DatasetJson;
      } catch {
        // a dataset that does not parse goes as written; the original reports it the same way the editor does
        out[rel] = d;
        continue;
      }
      const src = j.source as { kind?: string; url?: string; connector?: string; tool?: string; args?: Record<string, unknown> };
      if (src?.kind === 'file' && src.url) src.url = `blobs/${src.url.replace(/^data\//, '')}`;
      // a SQLite query with rows the caller ran goes out as the CSV they make; the call stays in `request`,
      // the paused-query shape the editor already reads. Other connectors stay queries.
      const isSqlite = src?.kind === 'query' && src.connector === 'sqlite';
      if (isSqlite) sqliteQueries++;
      const rows = isSqlite ? queries[ds[1]] : undefined;
      if (src?.kind === 'query') {
        if (rows) {
          j.request = { connector: src.connector!, tool: src.tool ?? 'query', args: src.args ?? {} };
          j.source = { kind: 'file', url: `blobs/${ds[1]}.csv`, name: `${ds[1]}.csv` };
          out[`blobs/${ds[1]}.csv`] = bytes(tableToCsv(rows));
          materialized++;
        } else if (src.connector && src.connector !== 'sqlite') queriesOut.add(src.connector);
      }
      out[rel] = bytes(JSON.stringify(j, null, 2) + '\n');
    } else if (rel.startsWith('files/')) out[rel] = d;
    else if (rel.startsWith('data/')) {
      if (/\.(db|sqlite3?)$/i.test(rel)) sqlite = true;
      else out[`blobs/${rel.slice('data/'.length)}`] = d;
    }
  }
  if (queriesOut.size) notes.push({ key: 'connector', params: { names: [...queriesOut].join(', ') } });
  if (materialized) notes.push({ key: 'queryData', params: { count: materialized } });
  // the database itself never goes; saying so is only worth a note when rows did not replace it
  if (sqlite && (sqliteQueries === 0 || sqliteQueries > materialized)) notes.push({ key: 'sqlite' });
}

const KIND_NAME: Record<ClaudeDesignKind, string> = { design: 'Design', slides: 'Slides', 'design-system': 'Design System', dashboard: 'Dashboard' };

/** The hand-over, for Claude Code: what this folder is and how to publish it as the original artifact type. English on purpose, like the skills. */
function readme(kind: ClaudeDesignKind, title: string, files: string[], notes: ClaudeDesignNote[]): string {
  const lines: string[] = [`# ${title}`, '', `This folder is a **${KIND_NAME[kind]}** artifact for Claude, exported from Tingly Design in the original layout. Nothing in it is specific to Tingly Design.`, ''];
  if (kind === 'dashboard') {
    lines.push(
      'A Dashboard keeps its work as documents in the artifact\'s own store, so each file here is one document:',
      '',
      '| File | Write it as the document |',
      '|---|---|',
      '| `dash/meta.json` | `dash/meta` |',
      '| `dash/params.json` (if present) | `dash/params` |',
      '| `datasets/<id>.json` | `datasets/<id>` |',
      '| `files/<name>` | `files/<name>` as `{"text": "<the file>"}` |',
      '| `blobs/<name>` | upload each as an asset, then set that dataset\'s `source.url` to the `url` of the reply |',
      '',
      'To publish: create a Dashboard from the type (`Artifact` quickstart / `type_url`), read its `SKILL.md`, then write the documents with `write_db` in one batch (`dash/meta` first).',
    );
  } else {
    lines.push(
      'Everything the artifact owns is under `project/`; the files below are exactly what the type\'s SKILL.md describes.',
      '',
      `To publish: create a ${KIND_NAME[kind]} artifact from its type (\`Artifact\` quickstart / \`type_url\`), read its \`SKILL.md\`, then publish this folder with \`root\` set to it, \`file_path\` the index (\`project/${kind === 'design' ? 'canvas' : kind === 'slides' ? 'deck' : 'design-system'}.json\`) and every other file of \`project/\` in \`files\`.`,
    );
  }
  const hints: Partial<Record<ClaudeDesignNote['key'], string>> = {
    slidePictures: '- Pictures under `project/uploads/` are referenced by relative path. A slide may only use `/_blob/<id>` or a design system\'s file: upload them as assets and point each `<img src>` at the reply\'s `url` before publishing.',
    localSystem: '- `designSystems` still names a design system that lived in Tingly Design (`projects/<name>`). Install the real one as the SKILL.md says, or drop the record.',
    connector: '- Some datasets query a connector (`source.kind: "query"`) that may not exist in the artifact\'s workspace; point them at one that does or replace them with an attached file.',
    queryData: '- SQLite queries went out with their rows: each has a `blobs/<id>.csv`, its dataset points at it (`source.kind: "file"`) and keeps the call in `request`. Upload the CSV as an asset and set that dataset\'s `source.url` to the reply\'s `url`.',
    sqlite: '- The project read a local SQLite database; the database itself is not included, because the original Dashboard cannot read one. Queries whose rows could not be read are still `source.kind: "query"` — run them and attach the rows as a file.',
  };
  const extra = notes.map((n) => hints[n.key]).filter(Boolean);
  if (extra.length) lines.push('', '## Before you publish', '', ...(extra as string[]));
  lines.push('', '## Files', '', ...files.map((f) => `- \`${f}\``), '');
  return lines.join('\n');
}

// ------------------------------------------------------------------ docs

/** A Claude Docs export (Markdown) as a new doc: one tab, titled by its first heading. */
export function docFromMarkdown(source: string, fallbackTitle: string, lang: string = /[\u3400-\u9fff]/.test(source) ? 'zh-CN' : 'en'): Files {
  // a closing run of # only after a space, as the doc export writes it: `# C#` is titled C#
  const heading = /^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/m.exec(source)?.[1];
  const title = heading ?? fallbackTitle;
  const d: DocJson = { title, tabs: [{ id: 'main', title }], settings: { ...DEFAULT_SETTINGS, lang } };
  return { [DOC_INDEX]: bytes(stringifyDoc(d)), [tabFile('main')]: bytes(source.endsWith('\n') ? source : source + '\n') };
}
