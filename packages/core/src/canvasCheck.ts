/**
 * Read-only lint of a canvas folder: the rules `.claude/skills/dc-canvas/SKILL.md`
 * says fail silently. Pure text in, data out, so it runs without the editor or a
 * browser. Core carries no wording: an issue is a rule id plus the values it
 * needs, and whoever shows it (the CLI, the editor) words it.
 */
import { CANVAS_FILE, isBoardFile } from './canvas';

export type CanvasRule =
  | 'canvas-json'
  | 'board-file-missing'
  | 'board-unlisted'
  | 'order-unknown'
  | 'order-missing'
  | 'order-duplicate'
  | 'no-x-dc'
  | 'no-support-script'
  | 'root-missing'
  | 'root-size-missing'
  | 'root-size'
  | 'preview-size'
  | 'whole-svg'
  | 'unquoted-attr'
  | 'unclosed-tag'
  | 'stray-close';

export interface CanvasIssue {
  /** path in the canvas folder: `canvas.json` or a board file */
  file: string;
  /** 1-based line, 1 when the issue is about the whole file */
  line: number;
  rule: CanvasRule;
  level: 'error' | 'warning';
  /** the values the wording needs (names, sizes), never prose */
  params?: Record<string, string | number>;
}

export interface CanvasFiles {
  /** text of `canvas.json`; undefined when the folder has none */
  canvas: string | undefined;
  /** board source by path, every `*.dc.html` in the folder */
  boards: Record<string, string>;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea']);

interface Tag {
  name: string;
  close: boolean;
  selfClose: boolean;
  attrs: Attr[];
  offset: number;
}
interface Attr {
  name: string;
  value: string | null;
  quoted: boolean;
}

function parseAttrs(s: string): Attr[] {
  const out: Attr[] = [];
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const v = m[2] ?? m[3];
    out.push({ name: m[1], value: v ?? m[4] ?? null, quoted: v !== undefined || m[4] === undefined });
  }
  return out;
}

function* tags(src: string): Generator<Tag> {
  const re = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (!m[2]) continue;
    const name = m[2].toLowerCase();
    const body = m[3];
    const t: Tag = { name, close: m[1] === '/', selfClose: /\/\s*$/.test(body), attrs: parseAttrs(body.replace(/\/\s*$/, '')), offset: m.index };
    yield t;
    if (!t.close && RAW.has(name) && !t.selfClose) {
      const end = src.toLowerCase().indexOf(`</${name}`, re.lastIndex);
      if (end >= 0) re.lastIndex = end;
    }
  }
}

function decl(style: string, prop: string): string | undefined {
  for (const d of style.split(';')) {
    const i = d.indexOf(':');
    if (i > 0 && d.slice(0, i).trim().toLowerCase() === prop) return d.slice(i + 1).trim();
  }
}

function px(v: string | undefined): number | null {
  const m = v === undefined ? null : /^(-?\d+(?:\.\d+)?)(?:px)?$/.exec(v.trim());
  return m ? Number(m[1]) : null;
}

const attrOf = (t: Tag, name: string) => t.attrs.find((a) => a.name.toLowerCase() === name)?.value ?? undefined;

/** Check `canvas.json` and every artboard of one canvas folder. */
export function checkCanvas(files: CanvasFiles): CanvasIssue[] {
  const out: CanvasIssue[] = [];
  const add = (file: string, line: number, rule: CanvasRule, level: CanvasIssue['level'], params?: CanvasIssue['params']) =>
    out.push(params ? { file, line, rule, level, params } : { file, line, rule, level });

  let index: { boards?: Record<string, { w?: number; h?: number; expand?: string }>; order?: unknown } = {};
  if (files.canvas !== undefined) {
    try {
      index = JSON.parse(files.canvas);
    } catch {
      add(CANVAS_FILE, 1, 'canvas-json', 'error');
      return out;
    }
  }
  const boards = index.boards ?? {};
  const lineOfKey = (key: string) => {
    const i = files.canvas?.indexOf(`"${key}"`) ?? -1;
    return i < 0 || !files.canvas ? 1 : files.canvas.slice(0, i).split('\n').length;
  };

  for (const f of Object.keys(boards)) {
    if (files.boards[f] === undefined) add(CANVAS_FILE, lineOfKey(f), 'board-file-missing', 'error', { file: f });
  }
  for (const f of Object.keys(files.boards)) {
    if (isBoardFile(f) && !boards[f] && files.canvas !== undefined) add(f, 1, 'board-unlisted', 'warning');
  }
  if (Array.isArray(index.order)) {
    const seen = new Set<string>();
    for (const f of index.order as string[]) {
      if (!boards[f]) add(CANVAS_FILE, lineOfKey('order'), 'order-unknown', 'error', { file: f });
      else if (seen.has(f)) add(CANVAS_FILE, lineOfKey('order'), 'order-duplicate', 'error', { file: f });
      seen.add(f);
    }
    for (const f of Object.keys(boards)) if (!seen.has(f)) add(CANVAS_FILE, lineOfKey('order'), 'order-missing', 'warning', { file: f });
  }

  for (const [file, src] of Object.entries(files.boards)) checkBoard(file, src, boards[file], add);
  return out;
}

function checkBoard(
  file: string,
  src: string,
  entry: { w?: number; h?: number; expand?: string } | undefined,
  add: (file: string, line: number, rule: CanvasRule, level: CanvasIssue['level'], params?: CanvasIssue['params']) => void,
) {
  const lineAt = (offset: number) => src.slice(0, offset).split('\n').length;
  const stack: Tag[] = [];
  let sawX = false;
  let sawSupport = false;
  let inX = 0; // stack depth of <x-dc>, 0 when outside
  let root: { tag: Tag; depth: number } | null = null;
  let rootKids = 0;
  let svgDirect: Tag | null = null;
  let preview: { width: number; height: number; line: number } | null = null;

  for (const t of tags(src)) {
    if (t.name === 'script' && !t.close) {
      // the size the board is drawn at when another file embeds it
      const raw = attrOf(t, 'data-props');
      if (raw) {
        try {
          const p = (JSON.parse(raw.replace(/&#39;/g, "'").replace(/&amp;/g, '&')) as { $preview?: { width?: unknown; height?: unknown } }).$preview;
          if (typeof p?.width === 'number' && typeof p?.height === 'number') preview = { width: p.width, height: p.height, line: lineAt(t.offset) };
        } catch {
          // props that are not JSON are the editor's to report
        }
      }
    }
    if (t.name === 'script' && !t.close && /support\.js$/.test(attrOf(t, 'src') ?? '')) sawSupport = true;
    if (t.close) {
      const at = stack.map((s) => s.name).lastIndexOf(t.name);
      if (at < 0) {
        if (!VOID.has(t.name)) add(file, lineAt(t.offset), 'stray-close', 'error', { tag: t.name });
        continue;
      }
      for (const open of stack.splice(at + 1)) add(file, lineAt(open.offset), 'unclosed-tag', 'error', { tag: open.name });
      stack.pop();
      if (t.name === 'x-dc') inX = 0;
      continue;
    }
    if (inX || t.name === 'x-dc') {
      for (const a of t.attrs) if (!a.quoted) add(file, lineAt(t.offset), 'unquoted-attr', 'error', { tag: t.name, attr: a.name });
    }
    if (t.name === 'x-dc') sawX = true;
    if (inX && stack.length === inX && t.name !== 'helmet') {
      if (!root) root = { tag: t, depth: stack.length };
    }
    if (inX && root && stack.length === root.depth + 1 && stack[root.depth] === root.tag) {
      rootKids++;
      if (t.name === 'svg') svgDirect = t;
    }
    if (t.name === 'x-dc') inX = stack.length + 1;
    if (!t.selfClose && !VOID.has(t.name)) stack.push(t);
  }
  for (const open of stack) add(file, lineAt(open.offset), 'unclosed-tag', 'error', { tag: open.name });

  if (!sawX) return add(file, 1, 'no-x-dc', 'error');
  if (!sawSupport) add(file, 1, 'no-support-script', 'error');
  if (!root) return add(file, 1, 'root-missing', 'error');

  const style = attrOf(root.tag, 'style') ?? '';
  const w = px(decl(style, 'width'));
  const h = px(decl(style, 'height'));
  const line = lineAt(root.tag.offset);
  if (w === null || h === null) add(file, line, 'root-size-missing', 'error');
  else if (entry && entry.expand !== 'fill' && typeof entry.w === 'number' && typeof entry.h === 'number' && (w !== entry.w || h !== entry.h)) {
    add(file, line, 'root-size', 'error', { width: w, height: h, boardWidth: entry.w, boardHeight: entry.h });
  }

  if (preview && w !== null && h !== null && (preview.width !== w || preview.height !== h)) {
    add(file, preview.line, 'preview-size', 'warning', { previewWidth: preview.width, previewHeight: preview.height, width: w, height: h });
  }

  // a diagram is absolutely positioned boxes with small <svg> arrows; one <svg> that
  // is the whole board is picked as a single block
  const bw = w ?? entry?.w;
  const bh = h ?? entry?.h;
  const whole = (s: Tag) => {
    const st = attrOf(s, 'style') ?? '';
    const sw = px(attrOf(s, 'width') ?? decl(st, 'width'));
    const sh = px(attrOf(s, 'height') ?? decl(st, 'height'));
    return bw && bh && sw !== null && sh !== null && sw >= bw * 0.9 && sh >= bh * 0.9;
  };
  if (svgDirect && (rootKids === 1 || whole(svgDirect))) add(file, lineAt((svgDirect as Tag).offset), 'whole-svg', 'error');
}
