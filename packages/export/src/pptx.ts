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
/** PNG/JPEG header dimensions must match the supplied dimensions; no image decoding occurs here. */
export interface PptxAsset { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg'; widthPx: number; heightPx: number }
export interface PptxTextStyle { fontFace: string; fontSizePx: number; color?: string; bold?: boolean; italic?: boolean; underline?: boolean }
export interface PptxRun { text: string; style?: Partial<PptxTextStyle> }
export interface PptxParagraph { runs: PptxRun[]; align?: 'left' | 'center' | 'right' | 'justify' }
export interface PptxBox { x: number; y: number; width: number; height: number; rotation?: number }
export interface PptxText extends PptxBox { type: 'text'; paragraphs: PptxParagraph[]; style: PptxTextStyle; verticalAlign?: 'top' | 'middle' | 'bottom'; paddingPx?: number }
export interface PptxShape extends PptxBox { type: 'shape'; shape: 'rect' | 'roundRect' | 'ellipse' | 'line'; fill?: string; stroke?: { color: string; widthPx: number } }
/** cover crops centrally, contain centers within the box, stretch fills the box. */
export interface PptxImage extends PptxBox { type: 'image'; asset: string; fit?: 'contain' | 'cover' | 'stretch' }
export type PptxObject = PptxText | PptxShape | PptxImage;

/** Conservative per-call allocation limits, not a promise of Office layout fidelity.
 * At most 500 slides, 10k objects, 50k paragraphs/runs, 2M UTF-16 text units total,
 * 1M per string, 256 assets, 32MiB per asset/128MiB total, 40M pixels per image.
 * Page edges: 1..56 inches; pixel edges <=100k. Geometry may extend one page
 * outside the slide (for intentional bleed); widths/heights <=2 page extents.
 * Fonts must scale to 1..4000pt; strokes must scale to 1..20116800 EMU.
 * Only lines may have a zero width/height (not both). Rotation: -360..360 degrees.
 * Rejects unknown fields and unsupported objects rather than silently dropping them.
 * Validation completes and byte inputs are copied before the lazy dependency loads.
 */
export async function writePptx(deck: PptxDeck): Promise<Uint8Array> {
  validate(deck);
  // Isolate the async boundary from subsequent caller edits, including asset bytes.
  const drawing = structuredClone(deck);
  const { default: Pptx } = await import('pptxgenjs');
  const pptx = new Pptx();
  if (pptx.version !== '4.0.1') throw new Error('pptx: unsupported PptxGenJS version');
  const inch = drawing.widthIn / drawing.widthPx;
  const pt = inch * 72;
  pptx.defineLayout({ name: 'DC', width: drawing.widthIn, height: drawing.heightPx * inch });
  pptx.layout = 'DC'; pptx.title = drawing.title; pptx.author = ''; pptx.subject = ''; pptx.company = '';
  const assets = new Map(Object.entries(drawing.assets ?? {}).map(([id, a], index) => [id, {
    ...a, data: `${a.mime};base64,${base64(a.bytes)}`,
    // PptxGenJS 4.0.1 deduplicates by path within a slide, even with data.
    // This is an internal key, never a caller path. Data is always provided, so no IO.
    path: `dc-asset-${index}.${a.mime === 'image/png' ? 'png' : 'jpeg'}`,
  }]));
  for (const page of drawing.slides) {
    const slide = pptx.addSlide();
    if (page.background) slide.background = { color: page.background };
    if (page.notes !== undefined) slide.addNotes(page.notes);
    for (const obj of page.objects) {
      const pos = { x: obj.x * inch, y: obj.y * inch, w: obj.width * inch, h: obj.height * inch, rotate: obj.rotation ?? 0 };
      if (obj.type === 'text') {
        const runs: PptxGenJS.TextProps[] = [];
        for (const [i, paragraph] of obj.paragraphs.entries()) {
          for (const [j, run] of paragraph.runs.entries()) {
            runs.push({ text: run.text, options: {
              ...textStyle({ ...obj.style, ...Object.fromEntries(Object.entries(run.style ?? {}).filter(([, v]) => v !== undefined)) }, pt), align: paragraph.align ?? 'left',
              breakLine: i < obj.paragraphs.length - 1 && j === paragraph.runs.length - 1,
            } });
          }
        }
        slide.addText(runs, { ...pos, margin: (obj.paddingPx ?? 0) * pt, valign: obj.verticalAlign ?? 'top', fit: 'none', paraSpaceAfter: 0, paraSpaceBefore: 0 });
      } else if (obj.type === 'shape') {
        slide.addShape(pptx.ShapeType[obj.shape], { ...pos,
          fill: obj.fill ? { color: obj.fill } : { color: 'FFFFFF', transparency: 100 },
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
  return normalizePptx401(result instanceof Uint8Array ? result : new Uint8Array(result as ArrayBuffer), drawing.slides.length);
}

function textStyle(s: PptxTextStyle, pt: number): PptxGenJS.TextPropsOptions {
  // 4.0.1 inserts fontFace directly into XML attributes (unlike ordinary text).
  // Keep formatting on every run, not the textbox: its inheritance treats false
  // as absent, otherwise a run cannot turn bold/underline off.
  return { fontFace: s.fontFace.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'), fontSize: s.fontSizePx * pt, color: s.color ?? '000000', bold: s.bold ?? false, italic: s.italic ?? false, underline: s.underline ? { style: 'sng' } : undefined };
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
const styleKeys = ['fontFace', 'fontSizePx', 'color', 'bold', 'italic', 'underline'];
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
    for (const k of ['bold', 'italic', 'underline']) if (v[k] !== undefined && typeof v[k] !== 'boolean') fail(`${p}.${k}`);
  };
  record(d, 'deck', ['title', 'widthPx', 'heightPx', 'widthIn', 'slides', 'assets']);
  text(d.title, 'title', 4096);
  number(d.widthPx, 'widthPx', 1, 100_000); number(d.heightPx, 'heightPx', 1, 100_000); number(d.widthIn, 'widthIn', 1, 56);
  number(d.heightPx * d.widthIn / d.widthPx, 'heightIn', 1, 56);
  const assets = d.assets === undefined ? {} : d.assets;
  record(assets, 'assets'); if (Object.keys(assets).length > 256) fail('asset count');
  for (const [id, a] of Object.entries(assets)) {
    text(id, 'asset id', 256); record(a, `asset ${id}`, ['bytes', 'mime', 'widthPx', 'heightPx']);
    if (!(a.bytes instanceof Uint8Array) || a.bytes.length === 0 || a.bytes.length > 32 * 1024 * 1024) fail(`asset ${id}.bytes`);
    byteTotal += a.bytes.length; if (byteTotal > 128 * 1024 * 1024) fail('media budget');
    choice(a.mime, 'asset MIME', ['image/png', 'image/jpeg']);
    number(a.widthPx, 'image width', 1, 40_000); number(a.heightPx, 'image height', 1, 40_000);
    if (!Number.isInteger(a.widthPx) || !Number.isInteger(a.heightPx) || a.widthPx * a.heightPx > 40_000_000) fail('image pixels');
    const dim = dimensions(a.bytes, a.mime === 'image/png');
    if (!dim || dim[0] !== a.widthPx || dim[1] !== a.heightPx) fail('image header/dimensions');
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
      choice(o.type, `${q}.type`, ['text', 'shape', 'image']);
      record(o, q, [...common, ...(o.type === 'text' ? ['paragraphs', 'style', 'verticalAlign', 'paddingPx'] : o.type === 'shape' ? ['shape', 'fill', 'stroke'] : ['asset', 'fit'])]);
      number(o.x, `${q}.x`, -d.widthPx, 2 * d.widthPx); number(o.y, `${q}.y`, -d.heightPx, 2 * d.heightPx);
      const line = o.type === 'shape' && o.shape === 'line';
      number(o.width, `${q}.width`, line ? 0 : 0.01, 2 * d.widthPx); number(o.height, `${q}.height`, line ? 0 : 0.01, 2 * d.heightPx);
      if (!o.width && !o.height) fail(q);
      if (o.rotation !== undefined) number(o.rotation, `${q}.rotation`, -360, 360);
      if (o.type === 'text') {
        style(o.style, `${q}.style`);
        if (o.verticalAlign !== undefined) choice(o.verticalAlign, q, ['top', 'middle', 'bottom']);
        if (o.paddingPx !== undefined) number(o.paddingPx, q, 0, Math.min(o.width, o.height) / 2);
        list(o.paragraphs, `${q}.paragraphs`, 1, 50_000);
        for (const para of o.paragraphs) {
          if (++nodes > 50_000) fail('text node budget'); record(para, q, ['runs', 'align']);
          if (para.align !== undefined) choice(para.align, q, ['left', 'center', 'right', 'justify']);
          list(para.runs, `${q}.runs`, 1, 50_000);
          for (const run of para.runs) { if (++nodes > 50_000) fail('text node budget'); record(run, q, ['text', 'style']); text(run.text, `${q}.text`); if (run.style !== undefined) style(run.style, `${q}.run.style`, true); }
        }
      } else if (o.type === 'shape') {
        choice(o.shape, q, ['rect', 'roundRect', 'ellipse', 'line']);
        if (o.fill !== undefined) { if (line) fail(`${q}.fill`); colour(o.fill, q); }
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
