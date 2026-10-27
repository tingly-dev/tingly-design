import type PptxGenJS from 'pptxgenjs';
import { normalizePptx401 } from './pptxNormalize';

/** Resolved drawing data only: no HTML, CSS, URLs, original OOXML, or implicit rasterization.
 * Geometry/font sizes are pixels. Every unit uses widthIn / widthPx (including fonts).
 * Colours are concrete six-digit RGB without '#'. Object array order is paint order.
 */
export interface PptxDeck {
  title: string;
  widthPx: number;
  heightPx: number;
  widthIn: number;
  slides: PptxSlide[];
  assets?: Record<string, PptxAsset>;
}
export interface PptxSlide { background?: string; notes?: string; objects: PptxObject[] }
/** PNG/JPEG header dimensions must match the supplied dimensions; no image decoding occurs here.
 * An SVG asset carries its rendered PNG stand-in (`fallback`): readers without SVG support (and
 * previews) show it, PowerPoint shows the SVG itself. */
export interface PptxAsset { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' | 'image/svg+xml'; widthPx: number; heightPx: number; fallback?: Uint8Array }
/** `opacity` 0..1 (1 when absent); `charSpacingPx` is extra space after each character, like CSS letter-spacing. */
export interface PptxTextStyle { fontFace: string; fontSizePx: number; color?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; charSpacingPx?: number; opacity?: number }
export interface PptxRun { text: string; style?: Partial<PptxTextStyle> }
/** Spacing in pixels: before and after the paragraph, and its line height (single spacing when absent). */
export interface PptxParagraph { runs: PptxRun[]; align?: 'left' | 'center' | 'right' | 'justify'; spaceBeforePx?: number; spaceAfterPx?: number; lineHeightPx?: number }
export interface PptxBox { x: number; y: number; width: number; height: number; rotation?: number }
/** `wrap: false` keeps each paragraph on one line however the reader's fonts measure it (a line already broken by the browser). */
export interface PptxText extends PptxBox { type: 'text'; paragraphs: PptxParagraph[]; style: PptxTextStyle; verticalAlign?: 'top' | 'middle' | 'bottom'; paddingPx?: number; wrap?: boolean }
/** `radiusPx` is a roundRect's corner radius (PowerPoint's default when absent); `fillOpacity` 0..1. */
export interface PptxShape extends PptxBox { type: 'shape'; shape: 'rect' | 'roundRect' | 'ellipse' | 'line'; fill?: string; fillOpacity?: number; radiusPx?: number; stroke?: { color: string; widthPx: number } }
/** cover crops centrally, contain centers within the box, stretch fills the box. */
export interface PptxImage extends PptxBox { type: 'image'; asset: string; fit?: 'contain' | 'cover' | 'stretch' }
/** One side of a cell's border; null for none. `double` draws two same-width lines (cmpd="dbl"). */
export interface PptxCellBorder { color: string; widthPx: number; double?: boolean }
/** `borders` are top, right, bottom, left; `paddingPx` the same order. A cell spanning columns or rows
 * is listed once, in the row and column it starts at; the cells it covers are left out. `tl2br`/`tr2bl`
 * are the diagonal borders PowerPoint draws across a cell. */
export interface PptxTableCell {
  paragraphs: PptxParagraph[]; style: PptxTextStyle; colspan?: number; rowspan?: number;
  fill?: string; fillOpacity?: number; borders?: (PptxCellBorder | null)[]; paddingPx?: number[]; verticalAlign?: 'top' | 'middle' | 'bottom';
  tl2br?: PptxCellBorder | null; tr2bl?: PptxCellBorder | null;
  /** vertical cell text: `vert` runs top to bottom, `vert270` bottom to top */
  textDirection?: 'vert' | 'vert270';
}
/** A native PowerPoint table: column widths and row heights in pixels, each row's cells in column order. Never rotated. */
export interface PptxTable extends PptxBox { type: 'table'; columnsPx: number[]; rowsPx: number[]; rows: PptxTableCell[][] }
export type PptxObject = PptxText | PptxShape | PptxImage | PptxTable;

/** Conservative per-call allocation limits, not a promise of Office layout fidelity.
 * At most 500 slides, 10k objects, 50k paragraphs/runs, 2M UTF-16 text units total,
 * 1M per string, 2048 assets, 32MiB per asset/128MiB total, 40M pixels per image.
 * Page edges: 1..56 inches; pixel edges <=100k. Geometry may extend one page
 * outside the slide (for intentional bleed); widths/heights <=2 page extents.
 * Fonts must scale to 1..4000pt; strokes must scale to 1..20116800 EMU.
 * Only lines may have a zero width/height (not both). Rotation: -360..360 degrees.
 * Rejects unknown fields and unsupported objects rather than silently dropping them.
 * Validation completes and byte inputs are copied before the lazy dependency loads.
 */
/** A cell whose double borders or diagonals PptxGenJS cannot write: normalizePptx401 patches the
 * written table XML afterwards. `cell` is the cell's `<a:tc>` index inside its `<a:tbl>` (every grid
 * position, merge continuations included), `double` in top/right/bottom/left order. */
export interface PptxTablePatch { slide: number; table: number; cell: number; double: [boolean, boolean, boolean, boolean]; tl2br?: { color: string; emu: number }; tr2bl?: { color: string; emu: number } }

export async function writePptx(deck: PptxDeck): Promise<Uint8Array> {
  validate(deck);
  // Isolate the async boundary from subsequent caller edits, including asset bytes.
  const drawing = structuredClone(deck);
  const { default: Pptx } = await import('pptxgenjs');
  const pptx = new Pptx();
  if (pptx.version !== '4.0.1') throw new Error('pptx: unsupported PptxGenJS version');
  const inch = drawing.widthIn / drawing.widthPx;
  const pt = inch * 72;
  const emu = (px: number) => Math.round(px * inch * 914400);
  const patches: PptxTablePatch[] = [];
  const fallbacks: { svg: Uint8Array; png: Uint8Array }[] = [];
  const remember = (a: PptxAsset) => { if (a.mime === 'image/svg+xml' && a.fallback && !fallbacks.some(f => bytesEqual(f.svg, a.bytes))) fallbacks.push({ svg: a.bytes.slice(), png: a.fallback.slice() }); };
  for (const a of Object.values(drawing.assets ?? {})) remember(a);
  pptx.defineLayout({ name: 'DC', width: drawing.widthIn, height: drawing.heightPx * inch });
  pptx.layout = 'DC'; pptx.title = drawing.title; pptx.author = ''; pptx.subject = ''; pptx.company = '';
  const assets = new Map(Object.entries(drawing.assets ?? {}).map(([id, a], index) => [id, {
    ...a, data: `${a.mime};base64,${base64(a.bytes)}`,
    // PptxGenJS 4.0.1 deduplicates by path within a slide, even with data.
    // This is an internal key, never a caller path. Data is always provided, so no IO.
    path: `dc-asset-${index}.${a.mime === 'image/png' ? 'png' : a.mime === 'image/jpeg' ? 'jpeg' : 'svg'}`,
  }]));
  for (const [slideIndex, page] of drawing.slides.entries()) {
    const slide = pptx.addSlide();
    if (page.background) slide.background = { color: page.background };
    if (page.notes !== undefined) slide.addNotes(page.notes);
    let tables = 0;
    for (const obj of page.objects) {
      const pos = { x: obj.x * inch, y: obj.y * inch, w: obj.width * inch, h: obj.height * inch, rotate: obj.rotation ?? 0 };
      if (obj.type === 'text') {
        slide.addText(textRuns(obj.paragraphs, obj.style, pt), { ...pos, margin: (obj.paddingPx ?? 0) * pt, valign: obj.verticalAlign ?? 'top', fit: 'none', wrap: obj.wrap ?? true, paraSpaceAfter: 0, paraSpaceBefore: 0 });
      } else if (obj.type === 'table') {
        const side = (b: PptxCellBorder | null | undefined): PptxGenJS.BorderProps => b ? { type: 'solid', color: b.color, pt: b.widthPx * pt } : { type: 'none' };
        const rows: PptxGenJS.TableRow[] = obj.rows.map(row => row.map(cell => {
          const pad = (cell.paddingPx ?? [0, 0, 0, 0]).map(v => v * pt);
          return { text: textRuns(cell.paragraphs, cell.style, pt), options: {
            ...(cell.colspan && cell.colspan > 1 ? { colspan: cell.colspan } : {}), ...(cell.rowspan && cell.rowspan > 1 ? { rowspan: cell.rowspan } : {}),
            ...(cell.textDirection ? { textDirection: cell.textDirection } : {}),
            valign: cell.verticalAlign ?? 'top',
            // 4.0.1 reads a margin list as points when its first value is 1 or more, otherwise as inches
            margin: (pad[0] >= 1 ? pad : pad.map(v => v / 72)) as [number, number, number, number],
            border: [0, 1, 2, 3].map(k => side(cell.borders?.[k])) as [PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps],
            ...(cell.fill ? { fill: { color: cell.fill, transparency: transparency(cell.fillOpacity) } } : {}),
          } };
        }));
        // Cells whose borders pptxgenjs cannot express — same-width double lines and diagonals — are
        // patched into the written XML afterwards (a rotated table cannot be native, so patches are moot).
        if (!obj.rotation) {
          const nc = obj.columnsPx.length, covered = obj.rowsPx.map(() => new Array<boolean>(nc).fill(false));
          for (const [r, row] of obj.rows.entries()) {
            let col = 0;
            for (const cell of row) {
              while (covered[r][col]) col++;
              const span = (cell.colspan ?? 1) as number, down = (cell.rowspan ?? 1) as number;
              const double = [0, 1, 2, 3].map(k => !!cell.borders?.[k]?.double) as [boolean, boolean, boolean, boolean];
              if (double.some(Boolean) || cell.tl2br || cell.tr2bl) patches.push({
                slide: slideIndex, table: tables, cell: r * nc + col, double,
                ...(cell.tl2br ? { tl2br: { color: cell.tl2br.color, emu: emu(cell.tl2br.widthPx) } } : {}),
                ...(cell.tr2bl ? { tr2bl: { color: cell.tr2bl.color, emu: emu(cell.tr2bl.widthPx) } } : {}),
              });
              for (let y = r; y < r + down; y++) for (let x = col; x < col + span; x++) covered[y][x] = true;
              col += span;
            }
          }
          tables++;
        }
        slide.addTable(rows, { x: pos.x, y: pos.y, w: pos.w, h: pos.h, colW: obj.columnsPx.map(v => v * inch), rowH: obj.rowsPx.map(v => v * inch), autoPage: false });
      } else if (obj.type === 'shape') {
        slide.addShape(pptx.ShapeType[obj.shape], { ...pos,
          fill: obj.fill ? { color: obj.fill, transparency: transparency(obj.fillOpacity) } : { color: 'FFFFFF', transparency: 100 },
          ...(obj.shape === 'roundRect' && obj.radiusPx !== undefined ? { rectRadius: Math.min(obj.radiusPx, obj.width / 2, obj.height / 2) * inch } : {}),
          line: obj.stroke ? { color: obj.stroke.color, width: obj.stroke.widthPx * pt } : { color: 'FFFFFF', transparency: 100 },
        });
      } else {
        const a = assets.get(obj.asset)!;
        let geometry = { x: pos.x, y: pos.y, w: pos.w, h: pos.h };
        if (obj.fit === 'contain' || obj.fit === undefined) {
          const scale = Math.min(pos.w / a.widthPx, pos.h / a.heightPx);
          const w = a.widthPx * scale, h = a.heightPx * scale;
          geometry = { x: pos.x + (pos.w - w) / 2, y: pos.y + (pos.h - h) / 2, w, h };
        } else if (obj.fit === 'cover') {
          // Verified public ImageProps.sizing API: crop is centered in DrawingML.
          const scale = Math.max(pos.w / a.widthPx, pos.h / a.heightPx);
          slide.addImage({ data: a.data, path: a.path, ...pos, w: a.widthPx * scale, h: a.heightPx * scale, sizing: { type: 'cover', w: pos.w, h: pos.h } });
          continue;
        }
        slide.addImage({ data: a.data, path: a.path, ...pos, ...geometry });
      }
    }
  }
  const result = await pptx.write({ outputType: 'uint8array', compression: true });
  return normalizePptx401(result instanceof Uint8Array ? result : new Uint8Array(result as ArrayBuffer), drawing.slides.length, patches, fallbacks);
}
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Paragraphs as PptxGenJS runs: each run carries its paragraph's properties (4.0.1 takes them per run). */
function textRuns(paragraphs: PptxParagraph[], style: PptxTextStyle, pt: number): PptxGenJS.TextProps[] {
  const runs: PptxGenJS.TextProps[] = [];
  for (const [i, paragraph] of paragraphs.entries()) {
    // an empty paragraph (a blank line, an empty cell) keeps its place with an empty run
    for (const [j, run] of (paragraph.runs.length ? paragraph.runs : [{ text: '' }]).entries()) {
      runs.push({ text: run.text, options: {
        ...textStyle({ ...style, ...Object.fromEntries(Object.entries(run.style ?? {}).filter(([, v]) => v !== undefined)) }, pt), align: paragraph.align ?? 'left',
        ...(paragraph.spaceBeforePx ? { paraSpaceBefore: paragraph.spaceBeforePx * pt } : {}), ...(paragraph.spaceAfterPx ? { paraSpaceAfter: paragraph.spaceAfterPx * pt } : {}),
        ...(paragraph.lineHeightPx ? { lineSpacing: paragraph.lineHeightPx * pt } : {}),
        breakLine: i < paragraphs.length - 1 && j === Math.max(1, paragraph.runs.length) - 1,
      } });
    }
  }
  return runs;
}
function textStyle(s: PptxTextStyle, pt: number): PptxGenJS.TextPropsOptions {
  // 4.0.1 inserts fontFace directly into XML attributes (unlike ordinary text).
  // Keep formatting on every run, not the textbox: its inheritance treats false
  // as absent, otherwise a run cannot turn bold/underline off.
  return { fontFace: s.fontFace.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'), fontSize: s.fontSizePx * pt, color: s.color ?? '000000', bold: s.bold ?? false, italic: s.italic ?? false, underline: s.underline ? { style: 'sng' } : undefined,
    strike: s.strike ? 'sngStrike' : undefined, charSpacing: s.charSpacingPx ? s.charSpacingPx * pt : undefined, transparency: transparency(s.opacity) };
}
/** PptxGenJS transparency is a whole percentage; fully opaque writes none. */
function transparency(opacity: number | undefined): number | undefined {
  const t = Math.round((1 - (opacity ?? 1)) * 100);
  return t > 0 ? t : undefined;
}
function base64(bytes: Uint8Array): string {
  // Browser/Node, no Buffer or DOM dependency; chunk to avoid argument-stack limits.
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fail(path: string): never { throw new Error(`pptx: invalid or unsupported ${path}`); }
function record(v: unknown, path: string, keys?: string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)) fail(path);
  if (keys && Object.keys(v).some(k => !keys.includes(k))) fail(path);
}
function number(v: unknown, path: string, min: number, max: number): asserts v is number { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(path); }
function choice(v: unknown, path: string, values: readonly unknown[]) { if (!values.includes(v)) fail(path); }
function colour(v: unknown, path: string) { if (typeof v !== 'string' || !/^[\da-f]{6}$/i.test(v)) fail(path); }
function list(v: unknown, path: string, min: number, max: number): asserts v is unknown[] { if (!Array.isArray(v) || v.length < min || v.length > max) fail(path); }
const styleKeys = ['fontFace', 'fontSizePx', 'color', 'bold', 'italic', 'underline', 'strike', 'charSpacingPx', 'opacity'];
function validate(d: unknown): asserts d is PptxDeck {
  let textUnits = 0, nodes = 0, objects = 0, byteTotal = 0;
  const text = (v: unknown, p: string, max = 1_000_000) => {
    if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)) fail(p);
    textUnits += v.length; if (textUnits > 2_000_000) fail('text budget');
  };
  const style = (v: unknown, p: string, partial = false) => {
    record(v, p, styleKeys);
    if (!partial || v.fontFace !== undefined) { text(v.fontFace, `${p}.fontFace`, 256); if (!(v.fontFace as string).trim()) fail(p); }
    if (!partial || v.fontSizePx !== undefined) {
      number(v.fontSizePx, `${p}.fontSizePx`, 0.01, 100_000);
      number(v.fontSizePx * (d as PptxDeck).widthIn / (d as PptxDeck).widthPx * 72, `${p}.fontSizePt`, 1, 4000);
    }
    if (v.color !== undefined) colour(v.color, `${p}.color`);
    for (const k of ['bold', 'italic', 'underline', 'strike']) if (v[k] !== undefined && typeof v[k] !== 'boolean') fail(`${p}.${k}`);
    if (v.charSpacingPx !== undefined) number(v.charSpacingPx, `${p}.charSpacingPx`, -1000, 1000);
    if (v.opacity !== undefined) number(v.opacity, `${p}.opacity`, 0, 1);
  };
  const paragraphs = (v: unknown, q: string, empty = false) => {
    list(v, `${q}.paragraphs`, 1, 50_000);
    for (const para of v) {
      if (++nodes > 50_000) fail('text node budget'); record(para, q, ['runs', 'align', 'spaceBeforePx', 'spaceAfterPx', 'lineHeightPx']);
      if (para.align !== undefined) choice(para.align, q, ['left', 'center', 'right', 'justify']);
      for (const k of ['spaceBeforePx', 'spaceAfterPx']) if (para[k] !== undefined) number(para[k], `${q}.${k}`, 0, 10_000);
      if (para.lineHeightPx !== undefined) number(para.lineHeightPx, `${q}.lineHeightPx`, 0.01, 10_000);
      list(para.runs, `${q}.runs`, empty ? 0 : 1, 50_000);
      for (const run of para.runs) { if (++nodes > 50_000) fail('text node budget'); record(run, q, ['text', 'style']); text(run.text, `${q}.text`); if (run.style !== undefined) style(run.style, `${q}.run.style`, true); }
    }
  };
  record(d, 'deck', ['title', 'widthPx', 'heightPx', 'widthIn', 'slides', 'assets']);
  text(d.title, 'title', 4096);
  number(d.widthPx, 'widthPx', 1, 100_000); number(d.heightPx, 'heightPx', 1, 100_000); number(d.widthIn, 'widthIn', 1, 56);
  number(d.heightPx * d.widthIn / d.widthPx, 'heightIn', 1, 56);
  const assets = d.assets === undefined ? {} : d.assets;
  record(assets, 'assets'); if (Object.keys(assets).length > 2048) fail('asset count');
  for (const [id, a] of Object.entries(assets)) {
    text(id, 'asset id', 256); record(a, `asset ${id}`, ['bytes', 'mime', 'widthPx', 'heightPx', 'fallback']);
    if (!(a.bytes instanceof Uint8Array) || a.bytes.length === 0 || a.bytes.length > 32 * 1024 * 1024) fail(`asset ${id}.bytes`);
    byteTotal += a.bytes.length; if (byteTotal > 128 * 1024 * 1024) fail('media budget');
    choice(a.mime, 'asset MIME', ['image/png', 'image/jpeg', 'image/svg+xml']);
    number(a.widthPx, 'image width', 1, 40_000); number(a.heightPx, 'image height', 1, 40_000);
    if (!Number.isInteger(a.widthPx) || !Number.isInteger(a.heightPx) || a.widthPx * a.heightPx > 40_000_000) fail('image pixels');
    if (a.mime === 'image/svg+xml') {
      // an SVG stands in a real PNG: readers without SVG support (and previews) show it
      if (!(a.fallback instanceof Uint8Array) || !a.fallback.length || a.fallback.length > 32 * 1024 * 1024) fail(`asset ${id}.fallback`);
      const dim = dimensions(a.fallback, true);
      if (!dim || dim[0] !== a.widthPx || dim[1] !== a.heightPx) fail(`asset ${id}.fallback dimensions`);
    } else {
      if (a.fallback !== undefined) fail(`asset ${id}.fallback`);
      const dim = dimensions(a.bytes, a.mime === 'image/png');
      if (!dim || dim[0] !== a.widthPx || dim[1] !== a.heightPx) fail('image header/dimensions');
    }
  }
  list(d.slides, 'slides', 1, 500);
  for (const [i, s] of d.slides.entries()) {
    const p = `slides[${i}]`; record(s, p, ['background', 'notes', 'objects']);
    if (s.background !== undefined) colour(s.background, `${p}.background`);
    if (s.notes !== undefined) text(s.notes, `${p}.notes`);
    list(s.objects, `${p}.objects`, 0, 10_000); objects += s.objects.length; if (objects > 10_000) fail('object budget');
    for (const [j, o] of s.objects.entries()) {
      const q = `${p}.objects[${j}]`; record(o, q);
      const common = ['type', 'x', 'y', 'width', 'height', 'rotation'];
      choice(o.type, `${q}.type`, ['text', 'shape', 'image', 'table']);
      record(o, q, [...common, ...(o.type === 'text' ? ['paragraphs', 'style', 'verticalAlign', 'paddingPx', 'wrap'] : o.type === 'shape' ? ['shape', 'fill', 'fillOpacity', 'radiusPx', 'stroke'] : o.type === 'table' ? ['columnsPx', 'rowsPx', 'rows'] : ['asset', 'fit'])]);
      number(o.x, `${q}.x`, -d.widthPx, 2 * d.widthPx); number(o.y, `${q}.y`, -d.heightPx, 2 * d.heightPx);
      const line = o.type === 'shape' && o.shape === 'line';
      number(o.width, `${q}.width`, line ? 0 : 0.01, 2 * d.widthPx); number(o.height, `${q}.height`, line ? 0 : 0.01, 2 * d.heightPx);
      if (!o.width && !o.height) fail(q);
      if (o.rotation !== undefined) number(o.rotation, `${q}.rotation`, -360, 360);
      if (o.type === 'text') {
        style(o.style, `${q}.style`);
        if (o.verticalAlign !== undefined) choice(o.verticalAlign, q, ['top', 'middle', 'bottom']);
        if (o.paddingPx !== undefined) number(o.paddingPx, q, 0, Math.min(o.width, o.height) / 2);
        if (o.wrap !== undefined && typeof o.wrap !== 'boolean') fail(`${q}.wrap`);
        paragraphs(o.paragraphs, q);
      } else if (o.type === 'table') {
        if (o.rotation) fail(`${q}.rotation`);
        list(o.columnsPx, `${q}.columnsPx`, 1, 1000); list(o.rowsPx, `${q}.rowsPx`, 1, 1000);
        for (const w of o.columnsPx) number(w, `${q}.columnsPx`, 0.5, 2 * d.widthPx);
        for (const h of o.rowsPx) number(h, `${q}.rowsPx`, 0.5, 2 * d.heightPx);
        list(o.rows, `${q}.rows`, o.rowsPx.length, o.rowsPx.length);
        // every grid position covered by exactly one cell
        const nc = o.columnsPx.length, covered = o.rowsPx.map(() => new Array<boolean>(nc).fill(false));
        for (const [r, row] of o.rows.entries()) {
          list(row, `${q}.rows[${r}]`, 0, nc);
          let col = 0;
          for (const cell of row) {
            const c = `${q}.rows[${r}]`;
            if (++nodes > 50_000) fail('text node budget');
            record(cell, c, ['paragraphs', 'style', 'colspan', 'rowspan', 'fill', 'fillOpacity', 'borders', 'paddingPx', 'verticalAlign', 'tl2br', 'tr2bl', 'textDirection']);
            if (cell.textDirection !== undefined) choice(cell.textDirection, c, ['vert', 'vert270']);
            for (const side of ['tl2br', 'tr2bl'] as const) {
              const diag = cell[side];
              if (diag !== undefined && diag !== null) { record(diag, c, ['color', 'widthPx', 'double']); colour(diag.color, c); number(diag.widthPx, c, 0.01, 1000); number(diag.widthPx * d.widthIn / d.widthPx * 914400, `${c}.diagonal.emu`, 1, 20116800); }
            }
            const span = (cell.colspan ?? 1) as number, down = (cell.rowspan ?? 1) as number;
            if (!Number.isInteger(span) || !Number.isInteger(down) || span < 1 || down < 1) fail(`${c}.span`);
            while (col < nc && covered[r][col]) col++;
            if (col + span > nc || r + down > o.rowsPx.length) fail(`${c}.span`);
            for (let y = r; y < r + down; y++) for (let x = col; x < col + span; x++) { if (covered[y][x]) fail(`${c}.span`); covered[y][x] = true; }
            col += span;
            style(cell.style, `${c}.style`);
            paragraphs(cell.paragraphs, c, true);
            if (cell.fill !== undefined) colour(cell.fill, `${c}.fill`);
            if (cell.fillOpacity !== undefined) { if (cell.fill === undefined) fail(`${c}.fillOpacity`); number(cell.fillOpacity, `${c}.fillOpacity`, 0, 1); }
            if (cell.verticalAlign !== undefined) choice(cell.verticalAlign, c, ['top', 'middle', 'bottom']);
            if (cell.paddingPx !== undefined) { list(cell.paddingPx, `${c}.paddingPx`, 4, 4); for (const v of cell.paddingPx) number(v, `${c}.paddingPx`, 0, 2 * d.widthPx); }
            if (cell.borders !== undefined) {
              list(cell.borders, `${c}.borders`, 4, 4);
              for (const b of cell.borders) if (b !== null) { record(b, c, ['color', 'widthPx', 'double']); colour(b.color, c); number(b.widthPx, c, 0.01, 1000); if (b.double !== undefined && typeof b.double !== 'boolean') fail(`${c}.double`); number(b.widthPx * d.widthIn / d.widthPx * 914400, `${c}.border.emu`, 1, 20116800); }
            }
          }
        }
        if (covered.some(row => row.some(v => !v))) fail(`${q}.rows`);
      } else if (o.type === 'shape') {
        choice(o.shape, q, ['rect', 'roundRect', 'ellipse', 'line']);
        if (o.fill !== undefined) { if (line) fail(`${q}.fill`); colour(o.fill, q); }
        if (o.fillOpacity !== undefined) { if (o.fill === undefined) fail(`${q}.fillOpacity`); number(o.fillOpacity, `${q}.fillOpacity`, 0, 1); }
        if (o.radiusPx !== undefined) { if (o.shape !== 'roundRect') fail(`${q}.radiusPx`); number(o.radiusPx, `${q}.radiusPx`, 0, 2 * d.widthPx); }
        if (o.stroke !== undefined) { record(o.stroke, q, ['color', 'widthPx']); colour(o.stroke.color, q); number(o.stroke.widthPx, q, 0.01, 1000); number(o.stroke.widthPx * d.widthIn / d.widthPx * 914400, `${q}.stroke.emu`, 1, 20116800); }
        if (line && o.stroke === undefined) fail(`${q}.stroke`);
      } else {
        if (typeof o.asset !== 'string' || !Object.hasOwn(assets, o.asset)) fail(`${q}.asset`);
        if (o.fit !== undefined) choice(o.fit, q, ['contain', 'cover', 'stretch']);
      }
    }
  }
}
/** Bounded header inspection, not a raster decoder. JPEG segment lengths cannot escape bytes. */
function dimensions(b: Uint8Array, png: boolean): [number, number] | undefined {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (png) {
    if (b.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n) || v.getUint32(8) !== 13 || v.getUint32(12) !== 0x49484452) return;
    return [v.getUint32(16), v.getUint32(20)];
  }
  if (b.length < 4 || b[0] !== 255 || b[1] !== 216) return;
  let p = 2;
  while (p + 3 < b.length) {
    if (b[p++] !== 255) return;
    while (b[p] === 255) p++;
    const marker = b[p++];
    if (marker === 217 || marker === 218 || p + 2 > b.length) return;
    const size = v.getUint16(p);
    if (size < 2 || p + size > b.length) return;
    if ([192, 193, 194].includes(marker)) { if (size < 8) return; return [v.getUint16(p + 5), v.getUint16(p + 3)]; }
    p += size;
  }
}
