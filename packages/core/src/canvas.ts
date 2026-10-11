/** The canvas index (`canvas.json`) and the shared journal types. */

export interface BoardEntry {
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
  page?: string;
  expand?: 'fill';
  is_interactive?: boolean;
  radius?: number;
  [k: string]: unknown;
}

export type NoteFill = 'gray' | 'red' | 'orange' | 'green' | 'teal' | 'blue' | 'purple' | 'pink';

export type ShapeKind = 'rect' | 'oval' | 'line' | 'arrow' | 'pen' | 'image';
export type ArrowHead = 'none' | 'open' | 'filled';

/**
 * Everything on the canvas that isn't an artboard: sticky notes (no kind),
 * titles (`title1`) and shapes. Field names follow the original editor so
 * canvases move between the two.
 */
export interface NoteEntry {
  x: number;
  y: number;
  text?: string;
  kind?: 'title1' | ShapeKind | string;
  /** shapes: box size (rect/oval/pen/image) */
  h?: number;
  /** line/arrow: the end point */
  x2?: number;
  y2?: number;
  headStart?: ArrowHead;
  headEnd?: ArrowHead;
  /** pen: SVG path in box coordinates */
  d?: string;
  /** image */
  src?: string;
  alt?: string;
  rotate?: number;
  flipX?: boolean;
  flipY?: boolean;
  /** shape styling: background, border-*, opacity, box-shadow, stroke, stroke-width… */
  css?: Record<string, string>;
  w?: number;
  maxW?: number;
  maxH?: number;
  size?: number | 's' | 'm' | 'l' | 'xl' | 'xxl';
  fill?: NoteFill | 'default';
  color?: NoteFill | 'default';
  bold?: boolean;
  italic?: boolean;
  page?: string;
  [k: string]: unknown;
}

export interface CanvasJson {
  v: number;
  title: string;
  boards: Record<string, BoardEntry>;
  order: string[];
  notes: Record<string, NoteEntry>;
  pages: { id: string; name: string }[];
  launch: { view: 'canvas' | 'focused'; file?: string; page?: string };
  designSystems: unknown[];
  [k: string]: unknown;
}

export const CANVAS_FILE = 'canvas.json';

export const NOTE_SIZES = { s: 14, m: 24, l: 40, xl: 72, xxl: 120 } as const;

export function isShape(n: NoteEntry): boolean {
  return n.kind === 'rect' || n.kind === 'oval' || n.kind === 'line' || n.kind === 'arrow' || n.kind === 'pen' || n.kind === 'image';
}

/** Bounding box of any canvas item, in canvas px. */
export function noteBox(n: NoteEntry): { x: number; y: number; w: number; h: number } {
  if (n.kind === 'line' || n.kind === 'arrow') {
    const x2 = n.x2 ?? n.x;
    const y2 = n.y2 ?? n.y;
    return { x: Math.min(n.x, x2), y: Math.min(n.y, y2), w: Math.abs(x2 - n.x), h: Math.abs(y2 - n.y) };
  }
  if (isShape(n)) return { x: n.x, y: n.y, w: n.w ?? 0, h: n.h ?? 0 };
  const size = typeof n.size === 'number' ? n.size : n.size ? NOTE_SIZES[n.size as keyof typeof NOTE_SIZES] : n.kind === 'title1' ? 72 : 14;
  const w = n.kind === 'title1' ? Math.min(n.maxW ?? 1600, Math.max(200, (n.text ?? '').length * size * 0.9)) : n.w ?? 240;
  const lines = Math.max(1, (n.text ?? '').split('\n').length);
  return { x: n.x, y: n.y, w, h: Math.min(n.maxH ?? 99999, Math.round(size * 1.45 * lines) + (n.kind === 'title1' ? 0 : 32)) };
}

export function uniqueNoteId(c: CanvasJson, prefix = 'n'): string {
  let i = Object.keys(c.notes).length + 1;
  while (c.notes[prefix + i]) i++;
  return prefix + i;
}

export function parseCanvas(text: string | undefined): CanvasJson {
  let raw: Partial<CanvasJson> = {};
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    raw = {};
  }
  const boards = raw.boards ?? {};
  const order = (raw.order ?? []).filter((f) => boards[f]);
  for (const f of Object.keys(boards)) if (!order.includes(f)) order.push(f);
  return {
    ...raw,
    v: raw.v ?? 3,
    title: raw.title ?? 'Untitled canvas',
    boards,
    order,
    notes: raw.notes ?? {},
    pages: raw.pages ?? [],
    launch: raw.launch ?? { view: 'canvas' },
    designSystems: raw.designSystems ?? [],
  };
}

export function stringifyCanvas(c: CanvasJson): string {
  return JSON.stringify(c, null, 2) + '\n';
}

export function isBoardFile(path: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*\.dc\.html$/.test(path) && !path.includes('..');
}

/** A new, empty artboard file. */
export function newBoardSource(opts: { title: string; w: number; h: number; lang?: string }): string {
  const { title, w, h, lang = 'zh' } = opts;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${title.replace(/</g, '&lt;')}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
body{margin:0;font-family:system-ui,-apple-system,"PingFang SC","Noto Sans SC",sans-serif;color:#1f2430}
</style>
</helmet>
<div style="width:${w}px;height:${h}px;box-sizing:border-box;padding:48px;display:flex;flex-direction:column;gap:16px;background:#ffffff">
  <h1 style="margin:0;font-size:32px">${title.replace(/</g, '&lt;')}</h1>
  <p style="margin:0;color:#5b6475;font-size:16px">双击改字，或在下方让 AI 修改。</p>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
  renderVals() {
    return {};
  }
}
</script>
</body>
</html>
`;
}

/** Where a new artboard goes: to the right of the top row. */
export function nextBoardPosition(c: CanvasJson, w: number): { x: number; y: number } {
  const top = Object.values(c.boards).filter((b) => b.y <= 0 + 40);
  if (!top.length) return { x: 0, y: 0 };
  const right = Math.max(...top.map((b) => b.x + b.w));
  void w;
  return { x: right + 80, y: 0 };
}

export function uniqueBoardName(c: CanvasJson, stem: string): string {
  const clean = stem.replace(/[^A-Za-z0-9_-]/g, '') || 'Board';
  const base = /^[A-Za-z0-9_]/.test(clean) ? clean : 'B' + clean;
  let name = `${base}.dc.html`;
  for (let i = 2; c.boards[name]; i++) name = `${base}${i}.dc.html`;
  return name;
}

export type Actor = 'human' | 'jquery' | 'fast-edit' | 'claude' | 'external' | 'undo';

export interface JournalEntry {
  id: string;
  at: string;
  actor: Actor;
  file: string;
  summary: string;
  prompt?: string;
  version?: string;
}

export const ACTOR_LABEL: Record<Actor, string> = {
  human: '手改',
  jquery: 'jQuery',
  'fast-edit': '快速 AI',
  claude: 'Claude',
  external: '外部',
  undo: '撤销',
};
