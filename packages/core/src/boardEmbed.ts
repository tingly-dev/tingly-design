/**
 * An artboard of a canvas brought into a slide or a motion scene: importing
 * from a project (see .design/import-from-project.md). The artboard is copied
 * into the target project under uploads/ and shown by an `<x-embed src>`
 * that runs it in its own frame, with the artboard's own tweaks overridden by
 * the embed's `data-props`.
 *
 * An artboard that declares `"$time"` in its data-props changes with time:
 * the frame hands it a `time` prop (ms), so a motion piece can draw it frame
 * by frame and a slide can loop it while presenting. It draws from `time`
 * alone, never from a clock of its own.
 */
import { CANVAS_FILE, isBoardFile, parseCanvas, type CanvasJson } from './canvas';
import { parseTime } from './motion';
import { parseDc, type DcDoc, type PropSpec } from './parse';

/** Where an embed may point: an artboard file kept under uploads/. */
export function isBoardEmbedPath(path: string): boolean {
  return path.startsWith('uploads/') && isBoardFile(path);
}

/** How an artboard moves with time, from its `$time` declaration. */
export interface TimeSpec {
  /** ms after which it starts over; none = it keeps going */
  loop?: number;
  /** the moment it is shown at when nothing drives it (editing, thumbnails) */
  still: number;
}

const ms = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.round(v);
  if (typeof v === 'string') {
    const t = parseTime(v);
    if (t != null && t >= 0) return t;
  }
  return undefined;
};

/** The `$time` declaration of an artboard (`{"loop": "6s", "still": "1.5s"}`, or `true`), or null when it does not move. */
export function timeSpec(props: Record<string, PropSpec> | undefined): TimeSpec | null {
  const raw = (props as Record<string, unknown> | undefined)?.$time;
  if (raw === undefined || raw === null || raw === false) return null;
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const loop = ms(o.loop);
  return { loop: loop && loop > 0 ? loop : undefined, still: ms(o.still) ?? 0 };
}

/** The `time` an artboard is given at `t` (or its still when nothing drives it). */
export function boardTime(spec: TimeSpec, t: number | null | undefined): number {
  const v = t == null || !Number.isFinite(t) ? spec.still : Math.max(0, t);
  return spec.loop ? v % spec.loop : v;
}

/** The size an artboard is drawn at (`$preview`), if it says. */
export function boardSize(props: Record<string, PropSpec> | undefined): [number, number] | null {
  const p = (props as Record<string, unknown> | undefined)?.$preview as { width?: unknown; height?: unknown } | undefined;
  const w = Number(p?.width);
  const h = Number(p?.height);
  return w > 0 && h > 0 ? [Math.round(w), Math.round(h)] : null;
}

/**
 * How a prop that names no `editor` is edited, by the type of its default: a
 * boolean is a switch, a number a number field, anything else text.
 */
export function tweakEditor(spec: PropSpec): NonNullable<PropSpec['editor']> {
  if (spec.editor) return spec.editor;
  if (typeof spec.default === 'boolean') return 'boolean';
  if (typeof spec.default === 'number') return 'float';
  return 'text';
}

/**
 * Every prop an artboard declares in `data-props` (minus `$…` keys): what a
 * person can set on the artboard and on an embed of it. A prop without an
 * `editor` is listed too, as the editor its default suggests; leaving it out
 * would hide a field the template is already bound to.
 */
export function boardTweaks(props: Record<string, PropSpec> | undefined): [string, PropSpec][] {
  return Object.entries(props ?? {})
    .filter(([k, s]) => !k.startsWith('$') && s && typeof s === 'object' && !Array.isArray(s) && (!!s.editor || 'default' in s))
    .map(([k, s]): [string, PropSpec] => [k, { ...s, editor: tweakEditor(s) }]);
}

/** The template values of one artboard, as the canvas panel lists them. */
export interface BoardValues {
  file: string;
  /** what the canvas calls the artboard (its title, else its file name) */
  title: string;
  values: [string, PropSpec][];
}

/**
 * The values every artboard of a canvas declares, in canvas order, for a
 * panel that shows the whole canvas at once. An artboard that declares none
 * (or whose file is not loaded yet) is left out. Same rules as `boardTweaks`.
 */
export function canvasTemplateValues(canvas: Pick<CanvasJson, 'boards' | 'order'>, sourceOf: (file: string) => string | undefined): BoardValues[] {
  const out: BoardValues[] = [];
  for (const file of canvas.order) {
    const src = sourceOf(file);
    const entry = canvas.boards[file];
    if (src === undefined || !entry) continue;
    const values = boardTweaks(parseDc(src).props);
    if (values.length) out.push({ file, title: entry.title || file.replace(/\.dc\.html$/, ''), values });
  }
  return out;
}

/** An embed's `data-props` as an object (an unreadable one is empty). */
export function embedProps(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const v = JSON.parse(value);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * What an artboard file needs beside itself: the sibling artboards it mounts
 * (`<dc-import name>`, as paths from the project's root) and the files it shows
 * (`uploads/…`, `assets/…`).
 */
export function boardDeps(source: string, file: string): { boards: string[]; files: string[] } {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
  const boards = new Set<string>();
  for (const m of source.matchAll(/<dc-import\b[^>]*\bname\s*=\s*"([^"{}]+)"/g)) {
    const name = m[1].trim();
    const target = name.startsWith('/') ? name.slice(1) + '.dc.html' : dir + name + '.dc.html';
    if (isBoardFile(target)) boards.add(target);
  }
  const files = new Set<string>();
  for (const m of source.matchAll(/(?:\b(?:src|href)\s*=\s*["']|url\(\s*["']?)((?:uploads|assets)\/[^"')\s]+)/g)) {
    if (!m[1].includes('..')) files.add(m[1]);
  }
  return { boards: [...boards], files: [...files] };
}

/** Every artboard a project's file set could hand out: a canvas's boards, in its order. */
export function boardsOf(files: Record<string, string | undefined>): { file: string; title: string; size: [number, number] | null }[] {
  const canvas = files[CANVAS_FILE];
  if (canvas === undefined) return [];
  const c = parseCanvas(canvas);
  return c.order.filter((f) => files[f] !== undefined && c.boards[f]).map((f) => ({ file: f, title: c.boards[f].title ?? f.replace(/\.dc\.html$/, ''), size: [c.boards[f].w, c.boards[f].h] }));
}

/** Where an imported artboard lives in the project that takes it: one folder per source artboard, so importing again updates it in place. */
export function importedBoardDir(from: string, board: string): string {
  const stem = board.replace(/\.dc\.html$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'board';
  return `uploads/${from}-${stem}`;
}

/** The record a deck or motion piece keeps per imported artboard (`imports` in its index), so it can be updated from where it came from. */
export interface BoardImport {
  /** the copy in this project: uploads/<from>-<stem>/<board> */
  path: string;
  /** the project it came from: projects/<name> */
  from: string;
  /** the artboard's file in that project */
  board: string;
  copiedAt: string;
}

export function boardImportsOf(index: { imports?: unknown } | undefined): BoardImport[] {
  const raw = index?.imports;
  return Array.isArray(raw)
    ? raw.filter((r): r is BoardImport => !!r && typeof r.path === 'string' && typeof r.from === 'string' && typeof r.board === 'string' && isBoardEmbedPath(r.path))
    : [];
}

/** The `src` of every artboard embed in a slide or scene file. */
export function boardEmbedsIn(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/<x-embed\b[^>]*?\bsrc\s*=\s*"([^"]+)"/g)) if (isBoardEmbedPath(m[1])) out.add(m[1]);
  return [...out];
}

/**
 * The artboard files a frame needs to draw the embeds in `sources`: each one
 * and the siblings it mounts, read from `files` (a project's text files).
 */
export function boardFilesFor(sources: Iterable<string | undefined>, files: (path: string) => string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const todo: string[] = [];
  for (const s of sources) if (s) todo.push(...boardEmbedsIn(s));
  while (todo.length) {
    const f = todo.pop()!;
    if (f in out) continue;
    const src = files(f);
    if (src === undefined) continue;
    out[f] = src;
    todo.push(...boardDeps(src, f).boards);
  }
  return out;
}

/**
 * The page an artboard embed runs in: the artboard runtime and nothing else.
 * `runtime` is where runtime.js is served, or its text for a page that must
 * stand alone (an exported deck, a single-file player).
 */
export function boardFrameDoc(runtime: { src: string } | { inline: string }): string {
  const script = 'src' in runtime ? `<script src="${runtime.src.replace(/"/g, '&quot;')}"></script>` : `<script>${runtime.inline.replace(/<\/(script)/gi, '<\\/$1')}</script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}</style></head><body><div id="dc-app"></div>${script}</body></html>`;
}

/** Scale an artboard drawn at `size` to fill a `box`, cropping what overflows (an effect fills its box). */
export function coverFit(size: [number, number], box: [number, number]): { scale: number; x: number; y: number } {
  const scale = Math.max(box[0] / size[0], box[1] / size[1]);
  return { scale, x: (box[0] - size[0] * scale) / 2, y: (box[1] - size[1] * scale) / 2 };
}

/** The doc's `$time`, read off a parsed artboard. */
export function docTime(doc: Pick<DcDoc, 'props'>): TimeSpec | null {
  return timeSpec(doc.props);
}
