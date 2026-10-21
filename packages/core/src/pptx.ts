import { Unzip, UnzipInflate } from 'fflate';
import { SaxesParser } from 'saxes';
import { parseDc } from './parse';
import { checkSlide } from './slides';
import { stringifyDeck } from './deck';

/**
 * Standalone PPTX -> editable slides conversion. No I/O or renderer. Transitional OOXML only.
 * Best effort inside a strict package: a hostile or broken package (ZIP, XML, relationships,
 * macros, budgets) refuses the whole file, while anything inside one object that cannot be
 * converted leaves out only that object, with a located note. Text, lists, shapes (presets,
 * custom outlines, lines and connectors), pictures and crops, groups, tables with their
 * styles, SmartArt drawings, gradients, the theme's style matrix and colour transforms map to
 * editable slide markup; charts are redrawn from their own data as a drawing; embedded objects
 * without a picture become an empty frame in their place; animations and some effects are
 * dropped with a note. The deck keeps the presentation's page shape. Font metrics and wrapping
 * are approximate and noted.
 * Limits are conservative module defaults, not corpus-validated product promises.
 */
export interface PptxLimits {
  compressedBytes: number; expandedBytes: number; entries: number; partBytes: number;
  xmlBytes: number; xmlDepth: number; xmlNodes: number; totalXmlNodes: number; diagnostics: number; slides: number; mediaPixels: number;
}
export const PPTX_LIMITS: Readonly<PptxLimits> = Object.freeze({
  compressedBytes: 32 * 1024 * 1024, expandedBytes: 128 * 1024 * 1024, entries: 2048,
  partBytes: 16 * 1024 * 1024, xmlBytes: 4 * 1024 * 1024, xmlDepth: 64,
  xmlNodes: 100000, totalXmlNodes: 500000, diagnostics: 1000, slides: 300, mediaPixels: 40000000,
});
export interface PptxOptions { id: string; title: string; limits?: Partial<PptxLimits> }
export interface PptxDiagnostic {
  level: 'error' | 'warning'; code: string; part?: string; slide?: string; object?: string;
  params?: Record<string, string | number>;
}
export interface PptxReport {
  v: 1; path: string; source: string; width: number; height: number; size: [number, number];
  slides: { id: string; part: string }[]; diagnostics: PptxDiagnostic[];
}
export type PptxResult = { ok: true; files: Record<string, Uint8Array>; report: PptxReport; diagnostics: PptxDiagnostic[] }
  | { ok: false; diagnostics: PptxDiagnostic[] };
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const utf8 = new TextDecoder('utf-8', { fatal: true });
const encode = (s: string) => new TextEncoder().encode(s);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number) => String(Math.round(n * 1000) / 1000);
class ImportFailure extends Error { constructor(readonly diagnostic: PptxDiagnostic) { super(diagnostic.code); } }
type Loc = Pick<PptxDiagnostic, 'part' | 'slide' | 'object'>;
function fail(code: string, loc: Loc = {}, params?: PptxDiagnostic['params']): never { throw new ImportFailure({ level: 'error', code, ...loc, ...(params ? { params } : {}) }); }
function budget(value: number, max: number, name: string, loc: Loc = {}) { if (value > max) fail('limit_exceeded', loc, { budget: name, max }); }
function safePath(s: string) { return !!s && !/[\\%\x00-\x20:#?]/.test(s) && !s.startsWith('/') && s.split('/').every(x => x && x !== '.' && x !== '..'); }
function resolve(base: string, target: string): string {
  if (!target || /[\\%\x00-\x20:#?]/.test(target)) fail('unsafe_relationship', { part: base });
  const out = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const seg of target.replace(/^\//, '').split('/')) {
    if (seg === '..') { if (!out.length) fail('unsafe_relationship', { part: base }); out.pop(); }
    else if (seg && seg !== '.') out.push(seg);
    else if (!seg) fail('unsafe_relationship', { part: base });
  }
  const path = out.join('/');
  if (!safePath(path)) fail('unsafe_relationship', { part: base });
  return path;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, v) => { for (let i = 0; i < 8; i++) v = (v >>> 1) ^ (v & 1 ? 0xedb88320 : 0); return v >>> 0; });
function crc32(bytes: Uint8Array) { let v = 0xffffffff; for (const b of bytes) v = (v >>> 8) ^ crcTable[(v ^ b) & 255]; return (v ^ 0xffffffff) >>> 0; }
/** Inspect ZIP metadata, but leave all decompression to fflate. No ZIP64/encryption. */
function unzip(bytes: Uint8Array, limits: PptxLimits): Map<string, Uint8Array> {
  budget(bytes.length, limits.compressedBytes, 'compressedBytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  if (end < 0) fail('invalid_zip');
  const count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true), size = view.getUint32(end + 12, true);
  if (view.getUint32(end + 4, true) !== 0 || view.getUint16(end + 8, true) !== count || count === 65535 || start + size !== end) fail('invalid_zip');
  budget(count, limits.entries, 'entries');
  const metadata = new Map<string, { size: number; crc: number }>();
  let pos = start, declared = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) fail('invalid_zip');
    const flags = view.getUint16(pos + 8, true), method = view.getUint16(pos + 10, true);
    const length = view.getUint16(pos + 28, true), extra = view.getUint16(pos + 30, true), comment = view.getUint16(pos + 32, true);
    if (pos + 46 + length + extra + comment > end) fail('invalid_zip');
    const name = utf8.decode(bytes.subarray(pos + 46, pos + 46 + length));
    const directory = name.endsWith('/'), normalized = directory ? name.slice(0, -1) : name;
    if (!safePath(normalized)) fail('unsafe_path', { part: name });
    if (metadata.has(normalized)) fail('duplicate_path', { part: name });
    if ((flags & 1) || (flags & 64)) fail('forbidden_package', { part: name });
    if (method !== 0 && method !== 8) fail('invalid_zip', { part: name });
    const n = view.getUint32(pos + 24, true), compressed = view.getUint32(pos + 20, true), offset = view.getUint32(pos + 42, true);
    if (n === 0xffffffff || offset + 30 > start || view.getUint32(offset, true) !== 0x04034b50 || view.getUint16(offset + 6, true) !== flags || view.getUint16(offset + 8, true) !== method) fail('invalid_zip');
    const localLength = view.getUint16(offset + 26, true), localExtra = view.getUint16(offset + 28, true);
    if (offset + 30 + localLength + localExtra + compressed > start || utf8.decode(bytes.subarray(offset + 30, offset + 30 + localLength)) !== name) fail('invalid_zip');
    budget(n, limits.partBytes, 'partBytes', { part: name });
    declared += n; budget(declared, limits.expandedBytes, 'expandedBytes');
    metadata.set(normalized, { size: n, crc: view.getUint32(pos + 16, true) });
    pos += 46 + length + extra + comment;
  }
  if (pos !== end) fail('invalid_zip');
  const output = new Map<string, Uint8Array>(), seen = new Set<string>();
  let expanded = 0;
  const stream = new Unzip(file => {
    const directory = file.name.endsWith('/'), name = directory ? file.name.slice(0, -1) : file.name;
    const meta = metadata.get(name);
    if (!meta || seen.has(name)) fail('invalid_zip', { part: name });
    seen.add(name);
    const chunks: Uint8Array[] = []; let length = 0;
    file.ondata = (error, data, final) => {
      if (error) fail('invalid_zip', { part: name });
      length += data.length; expanded += data.length;
      budget(length, limits.partBytes, 'partBytes', { part: name }); budget(expanded, limits.expandedBytes, 'expandedBytes');
      chunks.push(data);
      if (final) {
        if (length !== meta.size) fail('invalid_zip', { part: name });
        const all = new Uint8Array(length); let at = 0; for (const c of chunks) { all.set(c, at); at += c.length; }
        if (crc32(all) !== meta.crc) fail('invalid_zip', { part: name });
        if (!directory) output.set(name, all);
      }
    };
    file.start();
  });
  stream.register(UnzipInflate);
  // Small input chunks cap fflate's transient inflate allocation even for lying headers.
  for (let i = 0; i < bytes.length; i += 1024) stream.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
  if (seen.size !== metadata.size) fail('invalid_zip');
  return output;
}
interface X { uri: string; name: string; attrs: Record<string, string>; children: X[]; text: string }
const key = (uri: string, name: string) => `{${uri}}${name}`;
const at = (n: X | undefined, name: string, uri = '') => n?.attrs[key(uri, name)];
const kids = (n: X | undefined, uri: string, name: string) => n?.children.filter(x => x.uri === uri && x.name === name) ?? [];
const child = (n: X | undefined, uri: string, name: string) => kids(n, uri, name)[0];
const path = (n: X | undefined, ...steps: [string, string][]) => steps.reduce<X | undefined>((p, [uri, name]) => child(p, uri, name), n);
function walk(n: X | undefined, uri: string, name: string): X[] { return n ? [...(n.uri === uri && n.name === name ? [n] : []), ...n.children.flatMap(c => walk(c, uri, name))] : []; }
/** The part a picture reference was read from: its id resolves in that part's relationships,
 * whether the fill sits on the slide, a layout or master, the theme or a SmartArt drawing. */
const blipPart = new WeakMap<X, string>();
function xml(bytes: Uint8Array, limits: PptxLimits, part: string, total: { nodes: number }): X {
  budget(bytes.length, limits.xmlBytes, 'xmlBytes', { part });
  let source: string; try { source = utf8.decode(bytes); } catch { fail('invalid_xml', { part }); }
  const parser = new SaxesParser({ xmlns: true }); const stack: X[] = []; let root: X | undefined, nodes = 0;
  parser.on('doctype', () => fail('forbidden_xml', { part }));
  parser.on('processinginstruction', () => fail('forbidden_xml', { part }));
  parser.on('opentag', tag => {
    budget(++nodes, limits.xmlNodes, 'xmlNodes', { part }); budget(++total.nodes, limits.totalXmlNodes, 'totalXmlNodes', { part }); budget(stack.length + 1, limits.xmlDepth, 'xmlDepth', { part });
    const n: X = { uri: tag.uri, name: tag.local, attrs: {}, children: [], text: '' };
    for (const a of Object.values(tag.attributes)) n.attrs[key(a.uri, a.local)] = a.value;
    if (n.name === 'blip') blipPart.set(n, part);
    if (stack.length) stack[stack.length - 1].children.push(n); else root = n;
    stack.push(n);
  });
  const text = (s: string) => { budget(++nodes, limits.xmlNodes, 'xmlNodes', { part }); budget(++total.nodes, limits.totalXmlNodes, 'totalXmlNodes', { part }); if (stack.length) stack[stack.length - 1].text += s; };
  parser.on('text', text); parser.on('cdata', text); parser.on('closetag', () => { stack.pop(); });
  parser.on('error', () => fail('invalid_xml', { part }));
  try { parser.write(source).close(); } catch (e) { if (e instanceof ImportFailure) throw e; fail('invalid_xml', { part }); }
  if (!root) fail('invalid_xml', { part }); return root;
}
interface Relationship { type: string; target: string; external?: boolean }
class Package {
  readonly parsed = new Map<string, X>(); readonly relations = new Map<string, Map<string, Relationship>>();
  constructor(readonly files: Map<string, Uint8Array>, readonly limits: PptxLimits) {
    const total = { nodes: 0 };
    for (const name of files.keys()) {
      // Macros and controls refuse the file. Embedded workbooks and OLE payloads are kept in the
      // original but never read or unpacked.
      if (/vbaProject|activeX/i.test(name)) fail('forbidden_package', { part: name });
      if (/\.xml$|\.rels$/i.test(name) && !/(^|\/)embeddings\//i.test(name)) this.parsed.set(name, xml(files.get(name)!, limits, name, total));
    }
    // Validate all relationships, even unused ones; this module never fetches URLs.
    for (const name of files.keys()) if (name.endsWith('.rels')) {
      const base = name === '_rels/.rels' ? '' : name.replace(/(^|\/)_(rels)\/([^/]+)\.rels$/, '$1$3');
      if (base === name) fail('invalid_package', { part: name });
      const root = this.get(name, REL, 'Relationships'), map = new Map<string, Relationship>();
      for (const r of root.children) {
        if (r.uri !== REL || r.name !== 'Relationship') fail('invalid_part', { part: name });
        const id = at(r, 'Id'), type = at(r, 'Type'), target = at(r, 'Target');
        if (!id || !type || !target) fail('invalid_part', { part: name });
        if (map.has(id)) fail('duplicate_relationship', { part: name });
        const mode = at(r, 'TargetMode');
        if (mode && mode !== 'Internal' && mode !== 'External') fail('invalid_part', { part: name });
        if (/vbaProject|activeX/i.test(type)) fail('forbidden_package', { part: name });
        // A link or a linked picture outside the file is recorded, never followed.
        if (mode === 'External') { map.set(id, { type, target: '', external: true }); continue; }
        map.set(id, { type, target: resolve(base, target) });
      }
      this.relations.set(base, map);
    }
  }
  get(part: string, uri: string, name: string) { const n = this.parsed.get(part); if (!this.files.has(part)) fail('missing_part', { part }); if (!n || n.uri !== uri || n.name !== name) fail('invalid_part', { part }); return n; }
  /** An internal relationship's existing target. `type` is a short officeDocument type or a full URI; omitted, any type. */
  rel(part: string, id: string, type?: string, loc: Loc = {}): string {
    const r = this.relations.get(part)?.get(id);
    if (!r || r.external || type && r.type !== (type.startsWith('http') ? type : `${R}/${type}`)) fail('missing_relationship', { part, ...loc }, { id });
    if (!this.files.has(r.target)) fail('missing_part', { ...loc, part: r.target });
    return r.target;
  }
  ofType(part: string, type: string): string | undefined {
    return [...(this.relations.get(part)?.values() ?? [])].find(r => !r.external && r.type === `${R}/${type}` && this.files.has(r.target))?.target;
  }
}

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const DSP = 'http://schemas.microsoft.com/office/drawing/2008/diagram';
const TABLE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/table';
const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const DIAGRAM_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
const OLE_URI = 'http://schemas.openxmlformats.org/presentationml/2006/ole';
/** Problems with the package itself refuse the file. Anything else leaves out only the object (or slide) it is in, with a note. */
const FATAL = new Set(['limit_exceeded', 'invalid_zip', 'invalid_xml', 'forbidden_xml', 'forbidden_package', 'unsafe_path', 'unsafe_relationship', 'duplicate_path', 'duplicate_relationship', 'invalid_options', 'invalid_package']);
const fatal = (e: unknown) => !(e instanceof Error) || e instanceof ImportFailure && FATAL.has(e.diagnostic.code);
const reason = (e: unknown) => e instanceof ImportFailure ? e.diagnostic.code : 'invalid_value';
/** Notes said once per slide, however many objects they apply to. */
const ONCE = new Set(['text_layout_approximate', 'geometry_approximate', 'style_approximate', 'effect_dropped', 'link_dropped', 'animation_dropped', 'media_poster']);

/** A box in slide pixels, with its own rotation (degrees, clockwise) and flips. */
interface Box { x: number; y: number; w: number; h: number; rot: number; fh: boolean; fv: boolean }
interface Context {
  pkg: Package; diagnostics: PptxDiagnostic[]; seen: Set<string>; loc: Loc;
  /** Font and line scale (EMU to px), and where a box in the current coordinate space lands on the slide. */
  scale: number; place: (b: Box) => Box;
  theme?: X; colorMap: Record<string, string>; placeholderColor?: number[];
  defaults?: X; master?: X; tableStyles?: X; groupFill?: X;
  media: Map<string, string>; files: Record<string, Uint8Array>; prefix: string; page: number;
}
interface Obj { html: string; object?: string }
function warn(c: Pick<Context, 'diagnostics' | 'seen' | 'loc' | 'pkg'>, code: string, params?: PptxDiagnostic['params']) {
  const once = ONCE.has(code);
  const loc: Loc = once ? { part: c.loc.part, slide: c.loc.slide } : c.loc;
  const k = [code, loc.part, loc.slide, loc.object, JSON.stringify(params ?? {})].join('|');
  // past the budget the report stops growing and the import goes on; a left-out slide is still said (at most one per slide)
  if (c.seen.has(k) || c.diagnostics.length >= c.pkg.limits.diagnostics && code !== 'slide_skipped' && code !== 'objects_dropped') return;
  c.seen.add(k); c.diagnostics.push({ level: 'warning', code, ...loc, ...(params ? { params } : {}) });
}
function number(value: string | undefined, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1e12) fail('invalid_value');
  return Number(value);
}
const truthy = (v: string | undefined) => v === '1' || v === 'true' || v === 'on';
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const withObject = (c: Context, n: X | undefined): Context => ({ ...c, loc: { ...c.loc, object: at(n, 'id') ?? c.loc.object } });
const cNvPrOf = (n: X) => walk(n, P, 'cNvPr')[0];

// ---- colour -------------------------------------------------------------------------------
const PRESET_COLORS: Record<string, string> = {
  black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', cyan: '00ffff', magenta: 'ff00ff',
  gray: '808080', grey: '808080', ltGray: 'd3d3d3', dkGray: 'a9a9a9', silver: 'c0c0c0', orange: 'ffa500', purple: '800080', navy: '000080',
  maroon: '800000', olive: '808000', teal: '008080', lime: '00ff00', pink: 'ffc0cb', brown: 'a52a2a', gold: 'ffd700', indigo: '4b0082',
};
function hex(value: string | undefined, c: Context): number[] {
  if (!value || !/^[a-f\d]{6}$/i.test(value)) fail('unsupported_color', c.loc);
  return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
}
function toHsl([r, g, b]: number[]): number[] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl([h, s, l]: number[]): number[] {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map(n => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
}
const toLinear = (x: number) => { const v = x / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toSrgb = (v: number) => 255 * clamp(v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
/** A colour element (or the element holding one) as [r, g, b, alpha]. */
function rgba(n: X | undefined, c: Context): number[] | undefined {
  const clr = n && (n.uri === A && /Clr$/.test(n.name) ? n : n.children.find(x => x.uri === A && /Clr$/.test(x.name)));
  if (!clr) return undefined;
  let rgb: number[], alpha = 1;
  if (clr.name === 'srgbClr') rgb = hex(at(clr, 'val'), c);
  else if (clr.name === 'sysClr') rgb = hex(at(clr, 'lastClr') ?? (at(clr, 'val') === 'window' ? 'ffffff' : '000000'), c);
  else if (clr.name === 'prstClr') { const v = PRESET_COLORS[at(clr, 'val') ?? '']; if (!v) warn(c, 'style_approximate'); rgb = hex(v ?? '000000', c); }
  else if (clr.name === 'scrgbClr') rgb = ['r', 'g', 'b'].map(k => toSrgb(clamp(number(at(clr, k), 0) / 100000)));
  else if (clr.name === 'hslClr') rgb = fromHsl([number(at(clr, 'hue'), 0) / 60000, clamp(number(at(clr, 'sat'), 0) / 100000), clamp(number(at(clr, 'lum'), 0) / 100000)]);
  else if (clr.name === 'schemeClr') {
    let name = at(clr, 'val') ?? ''; name = c.colorMap[name] ?? name;
    if (name === 'phClr') [rgb, alpha] = c.placeholderColor ? [c.placeholderColor.slice(0, 3), c.placeholderColor[3]] : [[0, 0, 0], 1];
    else {
      const entry = rgba(path(c.theme, [A, 'themeElements'], [A, 'clrScheme'], [A, name]), c);
      if (!entry) fail('unsupported_color', c.loc, { color: name });
      rgb = entry.slice(0, 3); alpha = entry[3];
    }
  } else fail('unsupported_color', c.loc, { color: clr.name });
  for (const mod of clr.children) {
    if (mod.uri !== A) continue;
    const raw = number(at(mod, 'val'), 0), v = raw / 100000;
    const hsl = (f: (x: number[]) => number[]) => { rgb = fromHsl(f(toHsl(rgb))); };
    switch (mod.name) {
      case 'alpha': alpha = v; break;
      case 'alphaMod': alpha *= v; break;
      case 'alphaOff': alpha += v; break;
      // tint and shade mix with white and black in linear light, as Office draws them
      case 'tint': rgb = rgb.map(x => toSrgb(toLinear(x) * v + (1 - v))); break;
      case 'shade': rgb = rgb.map(x => toSrgb(toLinear(x) * v)); break;
      case 'lumMod': hsl(([h, s, l]) => [h, s, clamp(l * v)]); break;
      case 'lumOff': hsl(([h, s, l]) => [h, s, clamp(l + v)]); break;
      case 'lum': hsl(([h, s]) => [h, s, clamp(v)]); break;
      case 'satMod': hsl(([h, s, l]) => [h, clamp(s * v), l]); break;
      case 'satOff': hsl(([h, s, l]) => [h, clamp(s + v), l]); break;
      case 'sat': hsl(([h, , l]) => [h, clamp(v), l]); break;
      case 'hueMod': hsl(([h, s, l]) => [(h * v) % 360, s, l]); break;
      case 'hueOff': hsl(([h, s, l]) => [((h + raw / 60000) % 360 + 360) % 360, s, l]); break;
      case 'hue': hsl(([, s, l]) => [(raw / 60000) % 360, s, l]); break;
      case 'comp': hsl(([h, s, l]) => [(h + 180) % 360, s, l]); break;
      case 'inv': rgb = rgb.map(x => 255 - x); break;
      case 'gray': { const y = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]; rgb = [y, y, y]; break; }
      case 'red': case 'green': case 'blue': rgb[['red', 'green', 'blue'].indexOf(mod.name)] = 255 * clamp(v); break;
      case 'redMod': case 'greenMod': case 'blueMod': { const i = ['redMod', 'greenMod', 'blueMod'].indexOf(mod.name); rgb[i] = clamp(rgb[i] * v, 0, 255); break; }
      case 'redOff': case 'greenOff': case 'blueOff': { const i = ['redOff', 'greenOff', 'blueOff'].indexOf(mod.name); rgb[i] = clamp(rgb[i] + 255 * v, 0, 255); break; }
      case 'gamma': case 'invGamma': break;
      default: warn(c, 'style_approximate', { modifier: mod.name });
    }
  }
  return [...rgb.map(x => clamp(Math.round(x), 0, 255)), clamp(alpha)];
}
const cssColor = ([r, g, b, a]: number[]) => a >= 1 ? '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('') : `rgba(${r},${g},${b},${num(a)})`;
function color(n: X | undefined, c: Context, fallback?: string): string {
  const v = rgba(n, c);
  if (v) return cssColor(v);
  if (fallback) return fallback;
  fail('unsupported_color', c.loc);
}

// ---- fills, lines, effects ------------------------------------------------------------------
const FILLS = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'];
const fillIn = (n: X | undefined) => n?.children.find(x => x.uri === A && FILLS.includes(x.name));
/** The theme's style matrix entry a `*Ref` names, with that reference's colour as its placeholder colour. */
function themeStyle(ref: X | undefined, list: string, c: Context): { node?: X; c: Context } {
  const idx = number(at(ref, 'idx'), 0);
  const ctx = { ...c, placeholderColor: rgba(ref, c) ?? c.placeholderColor };
  if (!ref || !idx) return { c: ctx };
  const lists = path(c.theme, [A, 'themeElements'], [A, 'fmtScheme']);
  const bg = list === 'fillStyleLst' && idx >= 1001;
  const node = child(lists, A, bg ? 'bgFillStyleLst' : list)?.children[bg ? idx - 1001 : idx - 1];
  return { node, c: ctx };
}
interface Paint { css: string; stops?: [number, string][]; angle?: number; radial?: boolean; image?: X }
/** A fill element as CSS: none, a colour, a gradient, or a picture to place under the shape. */
function paint(fill: X | undefined, c: Context): Paint | null {
  if (!fill || fill.name === 'noFill') return null;
  if (fill.name === 'solidFill') return { css: color(fill, c, '#000000') };
  if (fill.name === 'grpFill') return c.groupFill ? paint(c.groupFill, { ...c, groupFill: undefined }) : null;
  if (fill.name === 'gradFill') {
    const stops = kids(child(fill, A, 'gsLst'), A, 'gs').map(g => [clamp(number(at(g, 'pos'), 0) / 100000), color(g, c, '#000000')] as [number, string]).sort((a, b) => a[0] - b[0]);
    if (!stops.length) return null;
    if (stops.length === 1) return { css: stops[0][1] };
    const lin = child(fill, A, 'lin'), shape = child(fill, A, 'path');
    const list = stops.map(([p, col]) => `${col} ${num(p * 100)}%`).join(', ');
    if (shape) {
      const r = child(shape, A, 'fillToRect');
      const cx = (number(at(r, 'l'), 50000) + 100000 - number(at(r, 'r'), 50000)) / 2000, cy = (number(at(r, 't'), 50000) + 100000 - number(at(r, 'b'), 50000)) / 2000;
      return { css: `radial-gradient(${at(shape, 'path') === 'circle' ? 'circle' : 'ellipse'} at ${num(cx)}% ${num(cy)}%, ${list})`, stops, radial: true };
    }
    const angle = number(at(lin, 'ang'), 0) / 60000;
    return { css: `linear-gradient(${num((angle + 90) % 360)}deg, ${list})`, stops, angle };
  }
  if (fill.name === 'pattFill') {
    warn(c, 'style_approximate', { fill: 'pattern' });
    const fg = color(child(fill, A, 'fgClr'), c, '#000000'), bg = color(child(fill, A, 'bgClr'), c, '#ffffff');
    return { css: `repeating-linear-gradient(45deg, ${fg} 0px, ${fg} 2px, ${bg} 2px, ${bg} 6px)`, stops: [[0, fg], [1, bg]], angle: 45 };
  }
  return { css: 'transparent', image: fill };
}
interface Stroke { width: number; color: string; dash: 'solid' | 'dashed' | 'dotted'; head: string; tail: string }
/** A line from its own properties over the theme line its style names. */
function stroke(own: X | undefined, style: X | undefined, c: Context, fallbackBlack: boolean): Stroke | null {
  const ref = themeStyle(child(style, A, 'lnRef'), 'lnStyleLst', c);
  const base = ref.node;
  if (!own && !base) return null;
  const merged = merge([base, own]);
  const fill = fillIn(merged);
  if (fill?.name === 'noFill') return null;
  const colorCtx = fillIn(own) ? c : ref.c;
  const p = fill ? paint(fill, colorCtx) : null;
  // a line with neither colour nor width of its own, and no theme line, draws nothing
  if (!fill && !base && (!fallbackBlack || at(own, 'w') === undefined)) return null;
  if (p?.stops) warn(c, 'style_approximate', { line: 'gradient' });
  const dash = at(child(merged, A, 'prstDash'), 'val') ?? (child(merged, A, 'custDash') ? 'dash' : 'solid');
  const end = (n: X | undefined) => { const t = at(n, 'type') ?? 'none'; return t === 'none' ? 'none' : t === 'arrow' ? 'open' : 'filled'; };
  return {
    width: number(at(merged, 'w'), 9525) * c.scale,
    color: p?.stops ? p.stops[0][1] : p?.css && p.css !== 'transparent' ? p.css : '#000000',
    dash: dash === 'solid' ? 'solid' : /dot/i.test(dash) && !/dash/i.test(dash) ? 'dotted' : 'dashed',
    head: end(child(merged, A, 'headEnd')), tail: end(child(merged, A, 'tailEnd')),
  };
}
/** Merged properties: later attributes win, and a later child replaces an earlier one of its kind. */
const GROUPS = [FILLS, ['effectLst', 'effectDag'], ['buNone', 'buAutoNum', 'buChar', 'buBlip'], ['buClrTx', 'buClr'], ['buSzTx', 'buSzPct', 'buSzPts'], ['buFontTx', 'buFont']];
function merge(list: (X | undefined)[], name = 'merged'): X {
  const out: X = { uri: A, name, attrs: {}, children: [], text: '' };
  for (const n of list) if (n) {
    Object.assign(out.attrs, n.attrs);
    for (const x of n.children) {
      const group = GROUPS.find(g => g.includes(x.name));
      out.children = out.children.filter(p => !(p.uri === x.uri && (p.name === x.name || group?.includes(p.name))));
      out.children.push(x);
    }
  }
  return out;
}
/** Shadows as CSS; glow, reflection and 3-D are left out with a note. */
function shadow(own: X | undefined, style: X | undefined, c: Context, kind: 'box' | 'drop' | 'text'): string {
  let list = own ? child(own, A, 'effectLst') : undefined, ctx = c;
  if (own && (child(own, A, 'effectDag') || child(own, A, 'sp3d')?.children.length || Object.keys(child(own, A, 'sp3d')?.attrs ?? {}).length)) warn(c, 'effect_dropped');
  if (!list && !child(own, A, 'effectDag')) {
    const ref = themeStyle(child(style, A, 'effectRef'), 'effectStyleLst', c);
    list = child(ref.node, A, 'effectLst'); ctx = ref.c;
  }
  const out: string[] = [];
  for (const e of list?.children ?? []) {
    if (e.uri !== A) continue;
    if (e.name === 'outerShdw' || e.name === 'innerShdw' || e.name === 'prstShdw') {
      const dist = number(at(e, 'dist'), 0) * c.scale, dir = number(at(e, 'dir'), 0) / 60000 * Math.PI / 180, blur = number(at(e, 'blurRad'), 0) * c.scale;
      const col = color(e, ctx, 'rgba(0,0,0,0.35)');
      const inset = e.name === 'innerShdw';
      if (inset && kind !== 'box') continue;
      const value = `${num(Math.cos(dir) * dist)}px ${num(Math.sin(dir) * dist)}px ${num(blur)}px ${col}`;
      out.push(kind === 'drop' ? `drop-shadow(${value})` : inset ? `inset ${value}` : value);
    } else warn(c, 'effect_dropped', { effect: e.name });
  }
  return out.join(kind === 'drop' ? ' ' : ', ');
}

// ---- geometry -------------------------------------------------------------------------------
function boxOf(xf: X | undefined, c: Context): Box {
  if (!xf) fail('missing_geometry', c.loc);
  const off = child(xf, A, 'off'), ext = child(xf, A, 'ext');
  const w = number(at(ext, 'cx')), h = number(at(ext, 'cy'));
  if (w < 0 || h < 0) fail('invalid_value', c.loc);
  return c.place({ x: number(at(off, 'x')), y: number(at(off, 'y')), w, h, rot: number(at(xf, 'rot'), 0) / 60000, fh: truthy(at(xf, 'flipH')), fv: truthy(at(xf, 'flipV')) });
}
function css(b: Box): string {
  const rot = ((b.rot % 360) + 360) % 360;
  const t = [rot ? `rotate(${num(rot)}deg)` : '', b.fh ? 'scaleX(-1)' : '', b.fv ? 'scaleY(-1)' : ''].filter(Boolean).join(' ');
  return `position:absolute;left:${num(b.x)}px;top:${num(b.y)}px;width:${num(b.w)}px;height:${num(b.h)}px${t ? `;transform:${t}` : ''}`;
}
/** Text is never mirrored: a vertical flip turns it upside down, a horizontal one leaves it. */
const textBox = (b: Box): Box => ({ ...b, rot: b.rot + (b.fv ? 180 : 0), fh: false, fv: false });
/** Children of a group are laid out in its child space, then moved, flipped and turned with it. */
function groupPlace(xf: X, c: Context): Context['place'] {
  const n = (k: string, a: string) => number(at(child(xf, A, k), a));
  const ox = n('off', 'x'), oy = n('off', 'y'), ew = n('ext', 'cx'), eh = n('ext', 'cy');
  const cox = child(xf, A, 'chOff') ? n('chOff', 'x') : ox, coy = child(xf, A, 'chOff') ? n('chOff', 'y') : oy;
  const cw = child(xf, A, 'chExt') ? n('chExt', 'cx') : ew, ch = child(xf, A, 'chExt') ? n('chExt', 'cy') : eh;
  const sx = cw ? ew / cw : 1, sy = ch ? eh / ch : 1;
  const rot = number(at(xf, 'rot'), 0) / 60000, fh = truthy(at(xf, 'flipH')), fv = truthy(at(xf, 'flipV'));
  const gx = ox + ew / 2, gy = oy + eh / 2, rad = rot * Math.PI / 180;
  return b => {
    const w = b.w * sx, h = b.h * sy;
    let cx = ox + (b.x + b.w / 2 - cox) * sx, cy = oy + (b.y + b.h / 2 - coy) * sy, r = b.rot, bh = b.fh, bv = b.fv;
    if (fh) { cx = 2 * gx - cx; bh = !bh; r = -r; }
    if (fv) { cy = 2 * gy - cy; bv = !bv; r = -r; }
    if (rot) { const dx = cx - gx, dy = cy - gy; cx = gx + dx * Math.cos(rad) - dy * Math.sin(rad); cy = gy + dx * Math.sin(rad) + dy * Math.cos(rad); r += rot; }
    return c.place({ x: cx - w / 2, y: cy - h / 2, w, h, rot: r, fh: bh, fv: bv });
  };
}
/** Our own drawings of common preset outlines, on a 100-unit box. */
const PRESET_PATHS: Record<string, string> = {
  triangle: 'M50 0L100 100H0Z', flowChartExtract: 'M50 0L100 100H0Z', rtTriangle: 'M0 0L100 100H0Z',
  parallelogram: 'M25 0H100L75 100H0Z', flowChartInputOutput: 'M20 0H100L80 100H0Z', trapezoid: 'M25 0H75L100 100H0Z',
  pentagon: 'M50 0L100 38L81 100H19L0 38Z', homePlate: 'M0 0H80L100 50L80 100H0Z', chevron: 'M0 0H80L100 50L80 100H0L20 50Z',
  hexagon: 'M25 0H75L100 50L75 100H25L0 50Z', flowChartPreparation: 'M20 0H80L100 50L80 100H20L0 50Z', octagon: 'M29 0H71L100 29V71L71 100H29L0 71V29Z',
  star5: 'M50 0L61.2 34.5H97.6L68.2 55.9L79.4 90.5L50 69.1L20.6 90.5L31.8 55.9L2.4 34.5H38.8Z',
  star4: 'M50 0L62 38L100 50L62 62L50 100L38 62L0 50L38 38Z', plus: 'M33 0H67V33H100V67H67V100H33V67H0V33H33Z', mathPlus: 'M38 10H62V38H90V62H62V90H38V62H10V38H38Z',
  snip1Rect: 'M0 0H83L100 17V100H0Z', leftRightArrow: 'M0 50L20 0V25H80V0L100 50L80 100V75H20V100Z', upDownArrow: 'M50 0L100 20H75V80H100L50 100L0 80H25V20H0Z',
  notchedRightArrow: 'M0 25H60V0L100 50L60 100V75H0L15 50Z', donut: 'M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50ZM25 50A25 25 0 1 1 75 50A25 25 0 1 1 25 50Z',
  flowChartManualInput: 'M0 20L100 0V100H0Z', flowChartManualOperation: 'M0 0H100L80 100H20Z', flowChartOffpageConnector: 'M0 0H100V80L50 100L0 80Z',
  flowChartMerge: 'M0 0H100L50 100Z', flowChartPunchedCard: 'M20 0H100V100H0V20Z', wedgeRectCallout: 'M0 0H100V75H58L35 100L42 75H0Z',
  heart: 'M50 25C50 0 0 0 0 30C0 60 50 80 50 100C50 80 100 60 100 30C100 0 50 0 50 25Z',
};
/** Kinds the slide's own `<x-shape>` draws. */
const SHAPE_KINDS_OF: Record<string, string> = {
  rect: 'rect', flowChartProcess: 'rect', roundRect: 'rounded', flowChartAlternateProcess: 'rounded', flowChartTerminator: 'rounded',
  ellipse: 'ellipse', flowChartConnector: 'ellipse', diamond: 'diamond', flowChartDecision: 'diamond',
  rightArrow: 'arrow-right', leftArrow: 'arrow-left', upArrow: 'arrow-up', downArrow: 'arrow-down',
};
const LINE_KINDS = ['line', 'straightConnector1', 'bentConnector2', 'bentConnector3', 'bentConnector4', 'bentConnector5', 'curvedConnector2', 'curvedConnector3', 'curvedConnector4', 'curvedConnector5'];
const adjust = (geom: X | undefined, name: string, fallback: number) => {
  const gd = kids(child(geom, A, 'avLst'), A, 'gd').find(g => at(g, 'name') === name);
  const m = /^val (-?\d+)$/.exec(at(gd, 'fmla') ?? '');
  return m ? Number(m[1]) : fallback;
};
/** A custom outline as SVG path data in the shape's own pixel box. */
function customPath(geom: X, box: Box, c: Context): { d: string; fill: boolean; stroke: boolean }[] {
  const out: { d: string; fill: boolean; stroke: boolean }[] = [];
  for (const p of kids(child(geom, A, 'pathLst'), A, 'path')) {
    const pw = number(at(p, 'w'), 0), ph = number(at(p, 'h'), 0);
    const sx = pw ? box.w / pw : c.scale, sy = ph ? box.h / ph : c.scale;
    const pt = (n: X | undefined): [number, number] => [number(at(n, 'x')) * sx, number(at(n, 'y')) * sy];
    let d = '', x = 0, y = 0;
    for (const s of p.children) {
      if (s.uri !== A) continue;
      const pts = kids(s, A, 'pt').map(pt);
      if (s.name === 'moveTo' || s.name === 'lnTo') { [x, y] = pts[0]; d += `${s.name === 'moveTo' ? 'M' : 'L'}${num(x)} ${num(y)}`; }
      else if (s.name === 'cubicBezTo' && pts.length === 3) { d += `C${pts.map(q => `${num(q[0])} ${num(q[1])}`).join(' ')}`; [x, y] = pts[2]; }
      else if (s.name === 'quadBezTo' && pts.length === 2) { d += `Q${pts.map(q => `${num(q[0])} ${num(q[1])}`).join(' ')}`; [x, y] = pts[1]; }
      else if (s.name === 'arcTo') {
        const rx = number(at(s, 'wR')) * sx, ry = number(at(s, 'hR')) * sy, st = number(at(s, 'stAng')) / 60000 * Math.PI / 180, sw = number(at(s, 'swAng')) / 60000 * Math.PI / 180;
        const cx = x - rx * Math.cos(st), cy = y - ry * Math.sin(st);
        x = cx + rx * Math.cos(st + sw); y = cy + ry * Math.sin(st + sw);
        d += `A${num(rx)} ${num(ry)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${num(x)} ${num(y)}`;
      } else if (s.name === 'close') d += 'Z';
      else fail('unsupported_geometry', c.loc, { geometry: s.name });
    }
    if (d) out.push({ d, fill: at(p, 'fill') !== 'none', stroke: at(p, 'stroke') !== '0' && at(p, 'stroke') !== 'false' });
  }
  if (!out.length) fail('unsupported_geometry', c.loc, { geometry: 'custGeom' });
  return out;
}
/** Gradient ids, counted from 1 again by each import so the same file gives the same slides. */
let gradients = 0;
function svgShape(box: Box, paths: { d: string; fill: boolean; stroke: boolean }[], viewBox: string, fill: Paint | null, line: Stroke | null, drop: string, evenOdd = false): string {
  let defs = '', fillValue = fill ? fill.css : 'none';
  if (fill?.stops) {
    const id = `dcg${++gradients}`, stops = fill.stops.map(([p, col]) => `<stop offset="${num(p * 100)}%" stop-color="${col}"/>`).join('');
    if (fill.radial) defs = `<radialGradient id="${id}">${stops}</radialGradient>`;
    else { const a = (fill.angle ?? 0) * Math.PI / 180, dx = Math.cos(a) / 2, dy = Math.sin(a) / 2; defs = `<linearGradient id="${id}" x1="${num(0.5 - dx)}" y1="${num(0.5 - dy)}" x2="${num(0.5 + dx)}" y2="${num(0.5 + dy)}">${stops}</linearGradient>`; }
    fillValue = `url(#${id})`;
  } else if (fill?.image) fillValue = 'none';
  const dash = line?.dash === 'dashed' ? ` stroke-dasharray="${num(line.width * 3)} ${num(line.width * 2)}"` : line?.dash === 'dotted' ? ` stroke-dasharray="${num(line.width)} ${num(line.width * 1.5)}"` : '';
  const body = paths.map(p => `<path d="${p.d}" fill="${p.fill ? fillValue : 'none'}"${evenOdd ? ' fill-rule="evenodd"' : ''} stroke="${line && p.stroke ? line.color : 'none'}" stroke-width="${num(line && p.stroke ? line.width : 0)}"${dash} stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join('');
  return `<svg aria-label="" viewBox="${viewBox}" preserveAspectRatio="none" style="${css(box)};overflow:visible${drop ? `;filter:${drop}` : ''}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
}
/** A straight or elbow line as the slide's own connector, its ends in slide pixels. */
function connector(kind: string, geom: X | undefined, box: Box, line: Stroke, c: Context): string {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, a = box.rot * Math.PI / 180;
  const end = (sx: number, sy: number) => {
    const dx = (box.fh ? -sx : sx) * box.w / 2, dy = (box.fv ? -sy : sy) * box.h / 2;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
  };
  const [x1, y1] = end(-1, -1), [x2, y2] = end(1, 1);
  const turned = Math.round(((box.rot % 180) + 180) % 180 / 90) === 1;
  let route = 'straight';
  if (kind === 'bentConnector2') route = turned ? 'vh' : 'hv';
  else if (kind === 'bentConnector3') { route = turned ? 'vh' : 'elbow'; if (turned || adjust(geom, 'adj1', 50000) !== 50000) warn(c, 'geometry_approximate', { geometry: kind }); }
  else if (kind !== 'line' && kind !== 'straightConnector1') warn(c, 'geometry_approximate', { geometry: kind });
  const style = `color:${line.color};border-width:${num(Math.max(line.width, 0.5))}px${line.dash !== 'solid' ? `;border-style:${line.dash}` : ''}`;
  return `<x-connector x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"${route !== 'straight' ? ` route="${route}"` : ''} head-start="${line.head}" head-end="${line.tail}" style="${style}"></x-connector>`;
}

// ---- text -----------------------------------------------------------------------------------
interface TextStyle {
  size: number; latin: string; ea?: string; color: string; bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  caps: string; spacing: number; baseline: number; highlight?: string; outline?: string; shadow?: string;
}
const familyOf = (s: TextStyle) => s.ea && s.ea !== s.latin ? `${s.latin}, ${s.ea}` : s.latin;
function face(value: string | undefined, c: Context): string | undefined {
  if (value?.startsWith('+')) {
    const m = /^\+(mj|mn)-(lt|ea|cs)$/.exec(value); if (!m) return undefined;
    value = at(path(c.theme, [A, 'themeElements'], [A, 'fontScheme'], [A, m[1] === 'mj' ? 'majorFont' : 'minorFont'], [A, { lt: 'latin', ea: 'ea', cs: 'cs' }[m[2]]!]), 'typeface');
  }
  return value && /^[\p{L}\p{N} _-]{1,100}$/u.test(value) ? value : undefined;
}
function applyText(base: TextStyle, n: X, c: Context): TextStyle {
  const fill = fillIn(n);
  let col = base.color;
  if (fill?.name === 'noFill') col = 'transparent';
  else if (fill) { const p = paint(fill, c); col = p?.stops ? p.stops[0][1] : p && !p.image ? p.css : base.color; if (p?.stops || p?.image) warn(c, 'style_approximate', { text: fill.name }); }
  if (child(n, A, 'hlinkClick') || child(n, A, 'hlinkMouseOver')) warn(c, 'link_dropped');
  const latin = face(at(child(n, A, 'latin'), 'typeface'), c) ?? base.latin;
  const ea = face(at(child(n, A, 'ea'), 'typeface'), c) ?? base.ea;
  const bool = (name: string, previous: boolean) => at(n, name) === undefined ? previous : truthy(at(n, name));
  const size = at(n, 'sz') === undefined ? base.size : number(at(n, 'sz')) * 127 * c.scale;
  if (size <= 0) fail('invalid_value', c.loc);
  const ln = child(n, A, 'ln'), lnFill = fillIn(ln);
  const outline = lnFill && lnFill.name !== 'noFill' ? `${num(Math.max(0.5, number(at(ln, 'w'), 9525) * c.scale))}px ${color(lnFill, c, '#000000')}` : ln && lnFill?.name === 'noFill' ? undefined : base.outline;
  const hl = child(n, A, 'highlight');
  const shadowed = child(n, A, 'effectLst') ? shadow(n, undefined, c, 'text') || undefined : base.shadow;
  return {
    size, latin, ea, color: col,
    bold: bool('b', base.bold), italic: bool('i', base.italic),
    underline: at(n, 'u') === undefined ? base.underline : at(n, 'u') !== 'none',
    strike: at(n, 'strike') === undefined ? base.strike : at(n, 'strike') !== 'noStrike',
    caps: at(n, 'cap') ?? base.caps,
    spacing: at(n, 'spc') === undefined ? base.spacing : number(at(n, 'spc')) * 127 * c.scale,
    baseline: at(n, 'baseline') === undefined ? base.baseline : number(at(n, 'baseline')) / 100000,
    highlight: hl ? color(hl, c, undefined) : base.highlight, outline, shadow: shadowed,
  };
}
const ANCHORS: Record<string, string> = { t: 'flex-start', ctr: 'center', b: 'flex-end', just: 'flex-start', dist: 'flex-start' };
const ALIGNS: Record<string, string> = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify', justLow: 'justify', thaiDist: 'justify' };
const NUMBERED = /^(arabic|alpha|roman)/;
interface Text { box: string; inner: string; vert: number; rot: number }
/**
 * A shape's text as editable paragraphs and lists. Paragraph and run properties cascade
 * from the presentation defaults, the master's text styles (placeholders), the shape's style,
 * inherited placeholders' list styles, the shape's own list style, then the paragraph.
 */
function textBody(shape: X, ancestors: X[], c: Context, extra: X[] = []): Text | null {
  const body = child(shape, P, 'txBody'); if (!body) return null;
  if (kids(body, A, 'p').every(p => p.children.every(n => n.uri === A && ['pPr', 'endParaRPr'].includes(n.name)))) return null;
  const outer = [...ancestors].reverse();
  const bodyPr = merge([...outer.map(a => path(a, [P, 'txBody'], [A, 'bodyPr'])), child(body, A, 'bodyPr')]);
  warn(c, 'text_layout_approximate');
  const vertical = at(bodyPr, 'vert') ?? 'horz';
  const vert = vertical === 'horz' ? 0 : vertical === 'vert270' ? 270 : 90;
  if (!['horz', 'vert', 'vert270'].includes(vertical) || number(at(bodyPr, 'numCol'), 1) !== 1) warn(c, 'style_approximate', { text: vertical !== 'horz' ? vertical : 'columns' });
  const autofit = child(bodyPr, A, 'normAutofit');
  const fontScale = number(at(autofit, 'fontScale'), 100000) / 100000, lineScale = 1 - number(at(autofit, 'lnSpcReduction'), 0) / 100000;
  const type = at(phOf(shape), 'type');
  const styleName = ['title', 'ctrTitle'].includes(type ?? '') ? 'titleStyle' : ['body', 'subTitle', 'obj'].includes(type ?? '') || phOf(shape) && !type ? 'bodyStyle' : 'otherStyle';
  const fontRef = child(child(shape, P, 'style'), A, 'fontRef');
  if (fontRef) {
    const latin = at(fontRef, 'idx') === 'major' ? '+mj-lt' : at(fontRef, 'idx') === 'minor' ? '+mn-lt' : undefined, ea = latin?.replace('lt', 'ea');
    const col = rgba(fontRef, c);
    extra = [{ uri: A, name: 'defRPr', attrs: {}, text: '', children: [...(col ? [{ uri: A, name: 'solidFill', attrs: {}, text: '', children: [{ uri: A, name: 'srgbClr', attrs: { [key('', 'val')]: cssColor([...col.slice(0, 3), 1]).slice(1) }, text: '', children: col[3] < 1 ? [{ uri: A, name: 'alpha', attrs: { [key('', 'val')]: String(Math.round(col[3] * 100000)) }, text: '', children: [] }] : [] }] }] : []), ...(latin ? [{ uri: A, name: 'latin', attrs: { [key('', 'typeface')]: latin }, text: '', children: [] }, { uri: A, name: 'ea', attrs: { [key('', 'typeface')]: ea! }, text: '', children: [] }] : [])] }, ...extra];
  }
  const base: TextStyle = { size: 18 * 12700 * c.scale, latin: 'Arial', color: '#000000', bold: false, italic: false, underline: false, strike: false, caps: 'none', spacing: 0, baseline: 0 };
  let counter = 0, lastList = '';
  const blocks = kids(body, A, 'p').map(p => {
    const own = child(p, A, 'pPr'), level = clamp(Math.round(number(at(own, 'lvl'), 0)), 0, 8), lvl = `lvl${level + 1}pPr`;
    const levels = [path(c.defaults, [A, lvl]), phOf(shape) ? path(c.master, [P, 'txStyles'], [P, styleName], [A, lvl]) : undefined,
      ...outer.map(parent => path(parent, [P, 'txBody'], [A, 'lstStyle'], [A, lvl])), path(body, [A, 'lstStyle'], [A, lvl])];
    const pr = merge([...levels, own]);
    const runChain = [...levels.slice(0, 2).map(x => child(x, A, 'defRPr')), ...extra, ...levels.slice(2).map(x => child(x, A, 'defRPr')), child(own, A, 'defRPr')];
    const resolved = (run?: X) => { const s = applyText(base, merge([...runChain, run], 'rPr'), c); return { ...s, size: s.size * fontScale, spacing: s.spacing * fontScale }; };
    const items: { style: TextStyle; html: string }[] = [];
    for (const r of p.children) {
      if (r.uri !== A || ['pPr', 'endParaRPr'].includes(r.name)) continue;
      if (r.name === 'br') { items.push({ style: resolved(child(r, A, 'rPr')), html: '<br>' }); continue; }
      if (r.name !== 'r' && r.name !== 'fld') { warn(c, 'style_approximate', { text: r.name }); continue; }
      const text = r.name === 'fld' && at(r, 'type') === 'slidenum' ? String(c.page) : child(r, A, 't')?.text ?? '';
      items.push({ style: resolved(child(r, A, 'rPr')), html: text });
    }
    const first = items.find(x => x.html !== '<br>')?.style ?? resolved(child(p, A, 'endParaRPr'));
    const runs = items.map(({ style: s, html }) => {
      if (html === '<br>') return html;
      let v = esc(html);
      if (s.bold !== first.bold || s.bold) v = s.bold ? `<b>${v}</b>` : v;
      if (s.italic) v = `<i>${v}</i>`;
      if (s.underline && !s.strike) v = `<u>${v}</u>`;
      const span: string[] = [];
      if (s.color !== first.color) span.push(`color:${s.color}`);
      const size = s.baseline ? s.size * 0.65 : s.caps === 'small' ? s.size * 0.8 : s.size;
      if (Math.abs(size - first.size) > 0.01) span.push(`font-size:${num(size)}px`);
      if (familyOf(s) !== familyOf(first)) span.push(`font-family:${esc(familyOf(s))}`);
      if (s.spacing !== first.spacing) span.push(`letter-spacing:${num(s.spacing)}px`);
      if (s.caps !== 'none' && s.caps !== first.caps) span.push('text-transform:uppercase');
      if (s.strike) span.push(`text-decoration:${s.underline ? 'underline ' : ''}line-through`);
      if (s.highlight) span.push(`background:${s.highlight}`);
      if (s.outline !== first.outline && s.outline) span.push(`-webkit-text-stroke:${s.outline}`);
      if (s.shadow !== first.shadow && s.shadow) span.push(`text-shadow:${s.shadow}`);
      if (s.baseline) span.push(`position:relative;top:${num(-s.baseline * s.size)}px`);
      return span.length ? `<span style="${span.join(';')}">${v}</span>` : v;
    }).join('');
    const spacing = (n: X | undefined, size: number) => {
      const v = child(n, A, 'spcPts') ?? child(n, A, 'spcPct');
      if (!v) return undefined;
      const amount = number(at(v, 'val'));
      if (amount < 0) fail('invalid_value', c.loc);
      return v.name === 'spcPts' ? amount * 127 * c.scale : amount / 100000 * size * 1.2;
    };
    const line = child(pr, A, 'lnSpc');
    let lineHeight = num(1.2 * lineScale);
    if (line) {
      const v = child(line, A, 'spcPct') ?? child(line, A, 'spcPts');
      if (!v) fail('unsupported_text_style', c.loc);
      const amount = number(at(v, 'val'));
      if (amount < 0) fail('invalid_value', c.loc);
      lineHeight = v.name === 'spcPct' ? num(amount / 100000 * 1.2 * lineScale) : `${num(amount * 127 * c.scale * lineScale)}px`;
    }
    const before = spacing(child(pr, A, 'spcBef'), first.size) ?? 0, after = spacing(child(pr, A, 'spcAft'), first.size) ?? 0;
    const marL = number(at(pr, 'marL'), 0) * c.scale, indent = number(at(pr, 'indent'), 0) * c.scale;
    const hasText = items.some(x => x.html !== '<br>' && x.html.trim());
    const bullet = hasText ? pr.children.find(x => ['buNone', 'buAutoNum', 'buChar', 'buBlip'].includes(x.name)) : undefined;
    let list = bullet && bullet.name !== 'buNone' ? bullet.name === 'buAutoNum' ? 'ol' : 'ul' : '';
    if (bullet?.name === 'buChar' && !['•', '●', '·', '▪', '■', '-', '–'].includes(at(bullet, 'char') ?? '•') || bullet?.name === 'buBlip' || bullet?.name === 'buAutoNum' && !/^arabic/.test(at(bullet, 'type') ?? 'arabicPeriod')) warn(c, 'style_approximate', { bullet: at(bullet, 'char') ?? at(bullet, 'type') ?? bullet.name });
    if (list === 'ol') { const start = number(at(bullet, 'startAt'), 1); if (lastList !== `ol${marL}`) counter = start; else counter++; if (!NUMBERED.test(at(bullet, 'type') ?? 'arabic')) list = 'ul'; }
    lastList = list ? `${list}${marL}` : '';
    const align = ALIGNS[at(pr, 'algn') ?? 'l'] ?? 'left';
    const pad = (left: number) => before || after || left ? `;padding:${num(before)}px 0px ${num(after)}px ${num(left)}px` : '';
    const style = `font-size:${num(first.size)}px;font-family:${esc(familyOf(first))};line-height:${lineHeight};text-align:${align};white-space:${at(bodyPr, 'wrap') === 'none' ? 'pre' : 'pre-wrap'}${first.color !== '#000000' ? `;color:${first.color}` : ''}${first.spacing ? `;letter-spacing:${num(first.spacing)}px` : ''}${first.caps !== 'none' ? ';text-transform:uppercase' : ''}${first.outline ? `;-webkit-text-stroke:${first.outline}` : ''}${first.shadow ? `;text-shadow:${first.shadow}` : ''}`;
    return list
      ? { list, marL, start: counter, html: `<li style="${style}${pad(0)};margin:0">${runs || '<br>'}</li>` }
      : { list: '', marL, start: 0, html: `<p style="${style}${pad(Math.max(0, marL + indent))}">${runs || '<br>'}</p>` };
  });
  let inner = '';
  for (let i = 0; i < blocks.length;) {
    const b = blocks[i];
    if (!b.list) { inner += b.html; i++; continue; }
    let j = i; while (j < blocks.length && blocks[j].list === b.list && blocks[j].marL === b.marL) j++;
    inner += `<${b.list}${b.list === 'ol' && b.start !== 1 ? ` start="${b.start}"` : ''} style="padding:0px 0px 0px ${num(Math.max(b.marL, 1))}px">${blocks.slice(i, j).map(x => x.html).join('')}</${b.list}>`;
    i = j;
  }
  const inset = ['lIns', 'tIns', 'rIns', 'bIns'].map((k, i) => number(at(bodyPr, k), i % 2 === 0 ? 91440 : 45720) * c.scale);
  return {
    box: `display:flex;flex-direction:column;justify-content:${ANCHORS[at(bodyPr, 'anchor') ?? 't'] ?? 'flex-start'};padding:${num(inset[1])}px ${num(inset[2])}px ${num(inset[3])}px ${num(inset[0])}px`,
    inner, vert, rot: number(at(bodyPr, 'rot'), 0) / 60000,
  };
}
function placeText(text: Text, box: Box): string {
  let b = textBox(box);
  if (text.vert) b = { ...b, x: b.x + b.w / 2 - b.h / 2, y: b.y + b.h / 2 - b.w / 2, w: b.h, h: b.w, rot: b.rot + text.vert };
  if (text.rot) b = { ...b, rot: b.rot + text.rot };
  return `<div style="${css(b)};${text.box}">${text.inner}</div>`;
}

// ---- pictures -------------------------------------------------------------------------------
function imageInfo(bytes: Uint8Array, c: Context): { ext: string; width: number; height: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, ext = '';
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x) && v.getUint32(8) === 13 && utf8.decode(bytes.subarray(12, 16)) === 'IHDR') { width = v.getUint32(16); height = v.getUint32(20); ext = 'png'; }
  else if (bytes.length >= 10 && /^GIF8[79]a$/.test(String.fromCharCode(...bytes.subarray(0, 6)))) { width = v.getUint16(6, true); height = v.getUint16(8, true); ext = 'gif'; }
  else if (bytes[0] === 255 && bytes[1] === 216) {
    ext = 'jpg'; let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos++] !== 255) fail('invalid_media', c.loc);
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++]; if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (pos + 2 > bytes.length) break;
      const length = v.getUint16(pos); if (length < 2 || pos + length > bytes.length) fail('invalid_media', c.loc);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 8) { height = v.getUint16(pos + 3); width = v.getUint16(pos + 5); break; }
      pos += length;
    }
  }
  if (!width || !height) fail('invalid_media', c.loc);
  budget(width * height, c.pkg.limits.mediaPixels, 'mediaPixels', c.loc);
  return { ext, width, height };
}
/** A picture fill placed in a box: the original bytes, kept once, cropped by an editable clip. */
function picture(fill: X, box: Box, c: Context, alt: string, extra = ''): string {
  const blip = child(fill, A, 'blip');
  const id = at(blip, 'embed', R); if (!id) fail('missing_relationship', c.loc);
  const media = c.pkg.rel(blipPart.get(blip!) ?? c.loc.part!, id, 'image', c.loc);
  let target = c.media.get(media);
  if (!target) {
    const bytes = c.pkg.files.get(media)!; const info = imageInfo(bytes, c);
    target = `${c.prefix}/media/image-${c.media.size + 1}.${info.ext}`; c.media.set(media, target); c.files[target] = bytes.slice();
  }
  const look: string[] = [];
  for (const e of blip?.children ?? []) {
    if (e.uri !== A || e.name === 'extLst') continue;
    if (e.name === 'alphaModFix') look.push(`opacity:${num(clamp(number(at(e, 'amt'), 100000) / 100000))}`);
    else if (e.name === 'grayscl') look.push('filter:grayscale(1)');
    else warn(c, 'style_approximate', { image: e.name });
  }
  if (child(fill, A, 'tile') || Object.values(path(fill, [A, 'stretch'], [A, 'fillRect'])?.attrs ?? {}).some(v => number(v) !== 0)) warn(c, 'style_approximate', { image: 'fill' });
  const [left, top, right, bottom] = ['l', 't', 'r', 'b'].map(k => number(at(child(fill, A, 'srcRect'), k), 0) / 100000);
  const width = 1 - left - right, height = 1 - top - bottom;
  if (width <= 0 || height <= 0) fail('invalid_value', c.loc);
  const own = [extra, ...look].filter(Boolean).join(';');
  if (left || top || right || bottom) return `<div style="${css(box)};overflow:hidden${own ? `;${own}` : ''}"><img src="${target}" alt="${esc(alt)}" style="position:absolute;left:${num(-left / width * 100)}%;top:${num(-top / height * 100)}%;width:${num(100 / width)}%;height:${num(100 / height)}%;object-fit:fill"></div>`;
  return `<img src="${target}" alt="${esc(alt)}" style="${css(box)};object-fit:fill${own ? `;${own}` : ''}">`;
}

// ---- objects --------------------------------------------------------------------------------
const phOf = (n: X | undefined) => path(n, [P, n?.name === 'pic' ? 'nvPicPr' : n?.name === 'cxnSp' ? 'nvCxnSpPr' : 'nvSpPr'], [P, 'nvPr'], [P, 'ph']);
function matchPlaceholder(shape: X, root: X | undefined) {
  const ph = phOf(shape); if (!ph || !root) return undefined;
  const all = walk(root, P, 'sp').filter(s => phOf(s));
  const kind = (p: X) => { const t = at(p, 'type') ?? 'obj'; return t === 'obj' ? 'body' : t; };
  return (at(ph, 'idx') !== undefined ? all.find(s => at(phOf(s), 'idx') === at(ph, 'idx')) : undefined) ?? all.find(s => kind(phOf(s)!) === kind(ph));
}
function renderShape(shape: X, ancestors: X[], c: Context): string {
  const nv = child(shape, P, shape.name === 'pic' ? 'nvPicPr' : shape.name === 'cxnSp' ? 'nvCxnSpPr' : 'nvSpPr'), cNvPr = child(nv, P, 'cNvPr');
  c = withObject(c, cNvPr);
  if (truthy(at(cNvPr, 'hidden'))) { warn(c, 'hidden_skipped'); return ''; }
  const props = child(shape, P, 'spPr'), style = child(shape, P, 'style');
  const inherited = (name: string) => child(props, A, name) ?? ancestors.map(a => path(a, [P, 'spPr'], [A, name])).find(Boolean);
  const box = boxOf(inherited('xfrm'), c);
  const geom = inherited('prstGeom'), custom = child(props, A, 'custGeom');
  const kind = custom ? 'custom' : at(geom, 'prst') ?? 'rect';
  const line = stroke(child(props, A, 'ln') ?? ancestors.map(a => path(a, [P, 'spPr'], [A, 'ln'])).find(Boolean), style, c, true);
  const drop = (k: 'box' | 'drop') => shadow(props, style, c, k);
  const alt = at(cNvPr, 'descr') ?? at(cNvPr, 'name') ?? '';
  if (shape.name === 'pic') {
    if (walk(nv, A, 'videoFile').length || walk(nv, A, 'audioFile').length || walk(nv, A, 'quickTimeFile').length) warn(c, 'media_poster');
    const radius = kind === 'ellipse' ? '50%' : kind === 'roundRect' ? `${num(adjust(geom, 'adj', 16667) / 100000 * Math.min(box.w, box.h))}px` : '';
    if (!['rect', 'ellipse', 'roundRect'].includes(kind)) warn(c, 'geometry_approximate', { geometry: kind });
    const extra = [radius ? `border-radius:${radius}` : '', line ? `border:${num(line.width)}px ${line.dash} ${line.color}` : '', drop('box') ? `box-shadow:${drop('box')}` : ''].filter(Boolean).join(';');
    return picture(child(shape, P, 'blipFill') ?? fail('missing_relationship', c.loc), box, c, alt, extra);
  }
  const ownFill = fillIn(props) ?? ancestors.map(a => fillIn(child(a, P, 'spPr'))).find(Boolean);
  const ref = themeStyle(child(style, A, 'fillRef'), 'fillStyleLst', c);
  const fill = ownFill ? paint(ownFill, c) : ref.node ? paint(ref.node, ref.c) : null;
  let art = '';
  if (LINE_KINDS.includes(kind)) {
    if (line) art = connector(kind, geom, box, line, c);
  } else if (kind === 'custom' || PRESET_PATHS[kind] || SHAPE_KINDS_OF[kind] && !['rect', 'rounded', 'ellipse'].includes(SHAPE_KINDS_OF[kind]) && (fill?.stops || fill?.image)) {
    const preset = PRESET_PATHS[kind] ?? (kind === 'custom' ? undefined : { diamond: 'M50 0L100 50L50 100L0 50Z', 'arrow-right': 'M0 25H50V0L100 50L50 100V75H0Z', 'arrow-left': 'M100 25H50V0L0 50L50 100V75H100Z', 'arrow-up': 'M25 100V50H0L50 0L100 50H75V100Z', 'arrow-down': 'M25 0V50H0L50 100L100 50H75V0Z' }[SHAPE_KINDS_OF[kind]]);
    if (kind !== 'custom' && child(geom, A, 'avLst')?.children.length) warn(c, 'geometry_approximate', { geometry: kind });
    if (fill?.image) warn(c, 'style_approximate', { fill: 'picture' });
    art = preset
      ? svgShape(box, [{ d: preset, fill: true, stroke: true }], '0 0 100 100', fill, line, drop('drop'), kind === 'donut')
      : svgShape(box, customPath(custom!, box, c), `0 0 ${num(box.w)} ${num(box.h)}`, fill, line, drop('drop'));
  } else {
    const xKind = SHAPE_KINDS_OF[kind] ?? 'rect';
    if (!SHAPE_KINDS_OF[kind]) warn(c, 'geometry_approximate', { geometry: kind });
    const radius = kind === 'flowChartTerminator' ? Math.min(box.w, box.h) / 2 : kind === 'roundRect' || kind === 'flowChartAlternateProcess' ? adjust(geom, 'adj', 16667) / 100000 * Math.min(box.w, box.h) : 0;
    const shade = drop('box');
    if (fill?.image) art += picture(fill.image, box, c, alt, xKind === 'ellipse' ? 'border-radius:50%' : radius ? `border-radius:${num(radius)}px` : '');
    if (fill && !fill.image || line || shade) {
      const border = line ? `;border:${num(line.width)}px ${line.dash} ${line.color}` : '';
      art += `<x-shape kind="${xKind}" style="${css(box)};background:${fill && !fill.image ? fill.css : 'transparent'}${border}${radius ? `;border-radius:${num(radius)}px` : ''}${shade ? `;box-shadow:${shade}` : ''}"></x-shape>`;
    }
  }
  const text = textBody(shape, ancestors, c);
  return art + (text ? placeText(text, child(shape, P, 'txXfrm') ? boxOf(child(shape, P, 'txXfrm'), c) : box) : '');
}
function renderTable(frame: X, box: Box, c: Context): string {
  const table = path(frame, [A, 'graphic'], [A, 'graphicData'], [A, 'tbl']);
  if (!table) fail('unsupported_element', c.loc, { element: 'graphicFrame' });
  const props = child(table, A, 'tblPr');
  const flag = (k: string) => truthy(at(props, k));
  const styleId = child(props, A, 'tableStyleId')?.text.trim();
  const tstyle = styleId ? kids(c.tableStyles, A, 'tblStyle').find(s => at(s, 'styleId') === styleId) ?? builtinTableStyle(styleId) : undefined;
  if (styleId && !tstyle) warn(c, 'style_approximate', { table: styleId });
  const columns = kids(child(table, A, 'tblGrid'), A, 'gridCol').map(n => number(at(n, 'w')) * box.w / Math.max(1, number(at(path(frame, [P, 'xfrm'], [A, 'ext']), 'cx'), 1)));
  const rows = kids(table, A, 'tr');
  if (!columns.length || !rows.length || columns.some(w => w <= 0)) fail('invalid_value', c.loc);
  const yScale = box.h / Math.max(1, number(at(path(frame, [P, 'xfrm'], [A, 'ext']), 'cy'), 1));
  const heights = rows.map(r => number(at(r, 'h')) * yScale);
  const nr = rows.length, nc = columns.length;
  const partsFor = (r: number, col: number) => {
    const out = ['wholeTbl'], dataRow = r - (flag('firstRow') ? 1 : 0), dataCol = col - (flag('firstCol') ? 1 : 0);
    if (flag('bandRow') && !(flag('firstRow') && r === 0) && !(flag('lastRow') && r === nr - 1)) out.push(dataRow % 2 ? 'band2H' : 'band1H');
    if (flag('bandCol') && !(flag('firstCol') && col === 0) && !(flag('lastCol') && col === nc - 1)) out.push(dataCol % 2 ? 'band2V' : 'band1V');
    if (flag('lastCol') && col === nc - 1) out.push('lastCol');
    if (flag('firstCol') && col === 0) out.push('firstCol');
    if (flag('lastRow') && r === nr - 1) out.push('lastRow');
    if (flag('firstRow') && r === 0) out.push('firstRow');
    return out.map(name => ({ name, node: child(tstyle, A, name) })).filter(x => x.node);
  };
  const edgeOf = (part: string, side: string, r: number, col: number, lastRow: number, lastCol: number) => {
    const rowPart = ['firstRow', 'lastRow', 'band1H', 'band2H'].includes(part), colPart = ['firstCol', 'lastCol', 'band1V', 'band2V'].includes(part);
    if (side === 'left') return colPart || col === 0 ? 'left' : 'insideV';
    if (side === 'right') return colPart || lastCol === nc - 1 ? 'right' : 'insideV';
    if (side === 'top') return rowPart || r === 0 ? 'top' : 'insideH';
    return rowPart || lastRow === nr - 1 ? 'bottom' : 'insideH';
  };
  const lineCss = (n: X | undefined, ctx: Context) => {
    if (!n) return undefined;
    let ln: X | undefined = n.name === 'ln' || /^ln[LRTB]$/.test(n.name) ? n : child(n, A, 'ln');
    let lc = ctx;
    if (!ln && child(n, A, 'lnRef')) { const ref = themeStyle(child(n, A, 'lnRef'), 'lnStyleLst', ctx); ln = ref.node; lc = ref.c; }
    if (!ln) return undefined;
    const s = stroke(ln, undefined, lc, false);
    return s ? `${num(s.width)}px ${s.dash} ${s.color}` : 'none';
  };
  const fillCss = (n: X | undefined, ctx: Context) => {
    const f = fillIn(n);
    if (f) { const p = paint(f, ctx); return p && !p.image ? p.css : 'transparent'; }
    const ref = child(n, A, 'fillRef');
    if (ref) { const t = themeStyle(ref, 'fillStyleLst', ctx); const p = t.node ? paint(t.node, t.c) : null; return p && !p.image ? p.css : 'transparent'; }
    return undefined;
  };
  let y = 0, html = '';
  for (let r = 0; r < nr; r++) {
    const cells = kids(rows[r], A, 'tc');
    let x = 0, content = '';
    for (let col = 0; col < nc; col++) {
      const cell = cells[col], width = columns[col];
      if (!cell || truthy(at(cell, 'hMerge')) || truthy(at(cell, 'vMerge'))) { x += width; continue; }
      const span = Math.max(1, Math.round(number(at(cell, 'gridSpan'), 1))), down = Math.max(1, Math.round(number(at(cell, 'rowSpan'), 1)));
      const w = columns.slice(col, col + span).reduce((a, b) => a + b, 0), h = heights.slice(r, r + down).reduce((a, b) => a + b, 0);
      const pr = child(cell, A, 'tcPr');
      let background: string | undefined; const edges: Record<string, string | undefined> = {};
      const runs: X[] = [];
      for (const part of partsFor(r, col)) {
        const tc = child(part.node, A, 'tcStyle');
        background = fillCss(child(tc, A, 'fill') ?? tc, c) ?? background;
        for (const side of ['left', 'right', 'top', 'bottom']) edges[side] = lineCss(child(child(tc, A, 'tcBdr'), A, edgeOf(part.name, side, r, col, r + down - 1, col + span - 1)), c) ?? edges[side];
        const tx = child(part.node, A, 'tcTxStyle');
        if (tx) {
          const fontRef = child(tx, A, 'fontRef'), col0 = rgba(tx, c) ?? rgba(fontRef, c);
          runs.push({ uri: A, name: 'defRPr', text: '', attrs: { ...(at(tx, 'b') ? { [key('', 'b')]: truthy(at(tx, 'b')) ? '1' : '0' } : {}), ...(at(tx, 'i') ? { [key('', 'i')]: truthy(at(tx, 'i')) ? '1' : '0' } : {}) },
            children: [...(col0 ? [{ uri: A, name: 'solidFill', attrs: {}, text: '', children: [{ uri: A, name: 'srgbClr', attrs: { [key('', 'val')]: cssColor([...col0.slice(0, 3), 1]).slice(1) }, text: '', children: [] }] }] : []),
              ...(at(fontRef, 'idx') ? [{ uri: A, name: 'latin', attrs: { [key('', 'typeface')]: at(fontRef, 'idx') === 'major' ? '+mj-lt' : '+mn-lt' }, text: '', children: [] }] : [])] });
        }
      }
      background = fillCss(pr, c) ?? background;
      for (const [name, side] of [['lnL', 'left'], ['lnR', 'right'], ['lnT', 'top'], ['lnB', 'bottom']]) edges[side] = lineCss(child(pr, A, name), c) ?? edges[side];
      // Neighbours share an edge: each cell draws its right and bottom, the first column and row also their left and top.
      if (col > 0) edges.left = undefined;
      if (r > 0) edges.top = undefined;
      const borders = ['left', 'right', 'top', 'bottom'].map(side => `border-${side}:${edges[side] ?? 'none'}`).join(';');
      const source = child(cell, A, 'txBody'), bodyPr = child(source, A, 'bodyPr');
      const attrs = { ...bodyPr?.attrs };
      for (const [from, to, fallback] of [['marL', 'lIns', 91440], ['marR', 'rIns', 91440], ['marT', 'tIns', 45720], ['marB', 'bIns', 45720]] as const) attrs[key('', to)] = at(pr, from) ?? String(fallback);
      attrs[key('', 'anchor')] = at(pr, 'anchor') ?? 't';
      const body: X = { uri: P, name: 'txBody', attrs: {}, text: '', children: [{ uri: A, name: 'bodyPr', attrs, text: '', children: bodyPr?.children ?? [] }, ...(source?.children.filter(n => n !== bodyPr) ?? [])] };
      const text = textBody({ uri: P, name: 'sp', attrs: {}, text: '', children: [body] }, [], c, runs);
      content += `<td style="position:absolute;left:${num(x)}px;top:0px;width:${num(w)}px;height:${num(h)}px;padding:0px;background:${background ?? 'transparent'};${borders}">${text ? `<div style="position:absolute;left:0px;top:0px;width:100%;height:100%;${text.box}">${text.inner}</div>` : ''}</td>`;
      x += w; col += span - 1;
    }
    html += `<tr style="position:absolute;left:0px;top:${num(y)}px;width:${num(box.w)}px;height:${num(heights[r])}px">${content}</tr>`;
    y += heights[r];
  }
  return `<table style="${css({ ...box, rot: 0, fh: false, fv: false })}">${html}</table>`;
}
/**
 * PowerPoint names its built-in table styles by id without writing them into the file. The
 * default family (Medium Style 2, one per accent) is written out here; other ids are noted
 * and drawn plain.
 */
const BUILTIN_TABLE_STYLES: Record<string, string> = {
  '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}': 'accent1', '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}': 'accent2', '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}': 'accent3',
  '{00A15C55-8517-42AA-B614-E9B94910E393}': 'accent4', '{7DF18680-E054-41AD-8BC1-D1AEF772440D}': 'accent5', '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}': 'accent6',
  '{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}': 'dk1',
};
function builtinTableStyle(id: string): X | undefined {
  const accent = BUILTIN_TABLE_STYLES[id];
  if (!accent) return undefined;
  const ln = (w: number) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln>`;
  const fill = (tint?: number) => `<a:fill><a:solidFill><a:schemeClr val="${accent}">${tint ? `<a:tint val="${tint}"/>` : ''}</a:schemeClr></a:solidFill></a:fill>`;
  const strong = (border: string) => `<a:tcTxStyle b="on"><a:fontRef idx="minor"/><a:schemeClr val="lt1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>${border}</a:tcBdr>${fill()}</a:tcStyle>`;
  const all = ['left', 'right', 'top', 'bottom', 'insideH', 'insideV'].map(e => `<a:${e}>${ln(12700)}</a:${e}>`).join('');
  const source = `<a:tblStyle xmlns:a="${A}" styleId="${id}"><a:wholeTbl><a:tcTxStyle><a:fontRef idx="minor"/><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>${all}</a:tcBdr>${fill(20000)}</a:tcStyle></a:wholeTbl>`
    + `<a:band1H><a:tcStyle>${fill(40000)}</a:tcStyle></a:band1H><a:band1V><a:tcStyle>${fill(40000)}</a:tcStyle></a:band1V>`
    + `<a:lastCol>${strong('')}</a:lastCol><a:firstCol>${strong('')}</a:firstCol><a:lastRow>${strong(`<a:top>${ln(38100)}</a:top>`)}</a:lastRow><a:firstRow>${strong(`<a:bottom>${ln(38100)}</a:bottom>`)}</a:firstRow></a:tblStyle>`;
  return xml(encode(source), PPTX_LIMITS, 'builtin', { nodes: 0 });
}
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const svgText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A round step for a value axis: 1, 2 or 5 times a power of ten. */
function niceStep(span: number, ticks = 5) {
  const raw = span / ticks || 1, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
/**
 * A chart redrawn from the values the file saved with it: bars, columns, lines, areas, pies
 * and doughnuts, with title, axes, gridlines and legend. A drawing, not live data.
 */
/** Points read from one chart series: more cannot be drawn legibly in a slide-sized chart. */
const CHART_POINTS = 1000;
function renderChart(frame: X, box: Box, c: Context): string | undefined {
  const ref = walk(path(frame, [A, 'graphic'], [A, 'graphicData']), C, 'chart')[0];
  const id = at(ref, 'id', R); if (!id) return undefined;
  const space = c.pkg.parsed.get(c.pkg.rel(c.loc.part!, id, 'chart', c.loc));
  const chart = child(space, C, 'chart'), plot = child(chart, C, 'plotArea');
  const kinds = ['barChart', 'bar3DChart', 'lineChart', 'line3DChart', 'areaChart', 'pieChart', 'pie3DChart', 'doughnutChart'];
  const groups = plot?.children.filter(n => n.uri === C && kinds.includes(n.name)) ?? [];
  if (!groups.length) return undefined;
  if (plot!.children.some(n => n.uri === C && /Chart$/.test(n.name) && !kinds.includes(n.name))) warn(c, 'style_approximate', { chart: 'type' });
  const val = (n: X | undefined) => at(child(n, C, 'val'), 'val');
  const cache = (n: X | undefined) => {
    const pts = walk(n, C, 'pt');
    const out: string[] = [];
    for (const p of pts) { const i = Math.round(number(at(p, 'idx'), 0)); if (i >= 0 && i < CHART_POINTS) out[i] = child(p, C, 'v')?.text ?? ''; }
    return out;
  };
  const accents = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
  // without a theme, Office's own default accents
  const fallback = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'];
  const themeColor = (i: number) => { try { return color({ uri: A, name: 'schemeClr', attrs: { [key('', 'val')]: accents[i % 6] }, text: '', children: [] }, c, fallback[i % 6]); } catch (e) { if (fatal(e)) throw e; return fallback[i % 6]; } };
  const sz = number(at(walk(child(space, C, 'txPr'), A, 'defRPr')[0], 'sz'), 1000) * 127 * c.scale;
  const font = face('+mn-lt', c) ?? 'Arial';
  const W = box.w, H = box.h, pad = sz * 0.6;
  let series = groups.flatMap(g => kids(g, C, 'ser').map(ser => ({ g, ser })));
  const pie = ['pieChart', 'pie3DChart', 'doughnutChart'].includes(groups[0].name);
  if (pie) series = series.slice(0, 1);
  const data = series.map(({ g, ser }, i) => {
    const sp = child(ser, C, 'spPr'), f = fillIn(sp), lnFill = fillIn(child(sp, A, 'ln'));
    const p = f ? paint(f, c) : null;
    const fill = p?.stops ? p.stops[0][1] : p && !p.image ? p.css : themeColor(Math.round(number(val(ser.children.find(x => x.name === 'idx')), i)));
    const stroke = lnFill && lnFill.name !== 'noFill' ? color(lnFill, c, fill) : fill;
    return { g, name: cache(child(ser, C, 'tx'))[0] ?? `Series ${i + 1}`, cats: cache(child(ser, C, 'cat')), vals: cache(child(ser, C, 'val')).map(v => Number(v)), fill, stroke, ser };
  });
  const cats = data.reduce<string[]>((best, d) => d.cats.length > best.length ? d.cats : best, []);
  const count = Math.max(cats.length, ...data.map(d => d.vals.length));
  const out: string[] = [];
  const text = (x: number, y: number, t: string, anchor = 'middle', size = sz, weight = 400) => `<text x="${num(x)}" y="${num(y)}" font-size="${num(size)}" font-family="${esc(font)}" fill="#595959" text-anchor="${anchor}"${weight !== 400 ? ` font-weight="${weight}"` : ''}>${svgText(t)}</text>`;
  let top = pad, bottom = H - pad, left = pad, right = W - pad;
  const titleNode = child(chart, C, 'title');
  const title = titleNode ? walk(titleNode, A, 't').map(t => t.text).join('') || (data.length === 1 ? data[0].name : '') : val(child(chart, C, 'autoTitleDeleted')) !== '1' && data.length === 1 ? data[0].name : '';
  if (title) { out.push(text(W / 2, top + sz * 1.3, title, 'middle', sz * 1.4, 700)); top += sz * 2.2; }
  const legend = child(chart, C, 'legend');
  const entries = pie ? cats.map((t, i) => ({ t, fill: themeColorFor(i) })) : data.map(d => ({ t: d.name, fill: d.fill }));
  function themeColorFor(i: number) {
    const dPt = kids(data[0]?.ser, C, 'dPt').find(p => number(val(child(p, C, 'idx')), -1) === i);
    const f = fillIn(child(dPt, C, 'spPr'));
    const p = f ? paint(f, c) : null;
    return p && !p.image && !p.stops ? p.css : themeColor(i);
  }
  if (legend && entries.length) {
    const pos = val(child(legend, C, 'legendPos')) ?? 'r';
    const item = (e: { t: string; fill: string }, x: number, y: number) => `<rect x="${num(x)}" y="${num(y - sz * 0.75)}" width="${num(sz * 0.8)}" height="${num(sz * 0.8)}" fill="${e.fill}"/>${text(x + sz * 1.2, y, e.t, 'start')}`;
    if (pos === 'r' || pos === 'l') {
      const width = Math.max(...entries.map(e => e.t.length)) * sz * 0.6 + sz * 2;
      const x = pos === 'r' ? right - width : left, y0 = (top + bottom) / 2 - entries.length * sz * 0.75;
      entries.forEach((e, i) => out.push(item(e, x, y0 + i * sz * 1.5 + sz)));
      if (pos === 'r') right -= width + pad; else left += width + pad;
    } else {
      const widths = entries.map(e => e.t.length * sz * 0.6 + sz * 2.4), total = widths.reduce((a, b) => a + b, 0);
      let x = W / 2 - total / 2; const y = pos === 't' ? top + sz : bottom - sz * 0.3;
      entries.forEach((e, i) => { out.push(item(e, x, y)); x += widths[i]; });
      if (pos === 't') top += sz * 2; else bottom -= sz * 2;
    }
  }
  if (pie) {
    const vals = data[0]?.vals.map(v => Number.isFinite(v) && v > 0 ? v : 0) ?? [], sum = vals.reduce((a, b) => a + b, 0) || 1;
    const r = Math.max(1, Math.min(right - left, bottom - top) / 2), cx = (left + right) / 2, cy = (top + bottom) / 2;
    const hole = groups[0].name === 'doughnutChart' ? r * number(val(child(groups[0], C, 'holeSize')), 50) / 100 : 0;
    let a = (number(val(child(groups[0], C, 'firstSliceAng')), 0) - 90) * Math.PI / 180;
    vals.forEach((v, i) => {
      const b = a + v / sum * Math.PI * 2, large = b - a > Math.PI ? 1 : 0;
      const pt = (ang: number, rad: number) => `${num(cx + rad * Math.cos(ang))} ${num(cy + rad * Math.sin(ang))}`;
      const d = v >= sum ? `M${pt(a, r)}A${num(r)} ${num(r)} 0 1 1 ${pt(a + Math.PI, r)}A${num(r)} ${num(r)} 0 1 1 ${pt(a, r)}Z` + (hole ? `M${pt(a, hole)}A${num(hole)} ${num(hole)} 0 1 0 ${pt(a + Math.PI, hole)}A${num(hole)} ${num(hole)} 0 1 0 ${pt(a, hole)}Z` : '')
        : hole ? `M${pt(a, r)}A${num(r)} ${num(r)} 0 ${large} 1 ${pt(b, r)}L${pt(b, hole)}A${num(hole)} ${num(hole)} 0 ${large} 0 ${pt(a, hole)}Z` : `M${num(cx)} ${num(cy)}L${pt(a, r)}A${num(r)} ${num(r)} 0 ${large} 1 ${pt(b, r)}Z`;
      if (v > 0) out.push(`<path d="${d}" fill="${themeColorFor(i)}" fill-rule="evenodd" stroke="#ffffff" stroke-width="${num(Math.max(1, sz / 12))}"/>`);
      a = b;
    });
  } else {
    const horizontal = groups.some(g => val(child(g, C, 'barDir')) === 'bar');
    const grouping = (g: X) => val(child(g, C, 'grouping')) ?? 'clustered';
    const stacked = (g: X) => /stacked/i.test(grouping(g));
    const percent = (g: X) => grouping(g) === 'percentStacked';
    const valuesAt = (d: typeof data[number], i: number) => Number.isFinite(d.vals[i]) ? d.vals[i] : 0;
    const level = (d: typeof data[number], i: number) => {
      if (!stacked(d.g)) return [0, valuesAt(d, i)];
      const same = data.filter(x => x.g === d.g), k = same.indexOf(d), total = percent(d.g) ? same.reduce((s, x) => s + Math.abs(valuesAt(x, i)), 0) || 1 : 1;
      const below = same.slice(0, k).reduce((s, x) => s + valuesAt(x, i), 0);
      return [below / total * (percent(d.g) ? 100 : 1), (below + valuesAt(d, i)) / total * (percent(d.g) ? 100 : 1)];
    };
    const levels = data.flatMap(d => Array.from({ length: count }, (_, i) => level(d, i))).flat();
    const lo = Math.min(0, ...levels), hi = Math.max(0, ...levels);
    const valAx = child(plot, C, 'valAx'), scaling = child(valAx, C, 'scaling');
    let step = niceStep(hi - lo || 1);
    const min = at(child(scaling, C, 'min'), 'val') !== undefined ? number(at(child(scaling, C, 'min'), 'val')) : Math.floor(lo / step) * step;
    const max = at(child(scaling, C, 'max'), 'val') !== undefined ? number(at(child(scaling, C, 'max'), 'val')) : hi > 0 ? (Math.floor(hi / step) + 1) * step : Math.ceil(hi / step) * step || step; // like Office, a step of room above the highest value
    if (!(max > min)) fail('invalid_value', c.loc);
    step = Math.max(step, niceStep(max - min, 10)); // the file's own bounds can be far from the data
    const ticks: number[] = []; for (let t = min; t <= max + step / 1e6 && ticks.length <= 40; t += step) ticks.push(Math.round(t / step) * step);
    const label = (t: number) => String(Number(t.toPrecision(6))) + (data.some(d => percent(d.g)) ? '%' : '');
    const valueWidth = Math.max(...ticks.map(t => label(t).length)) * sz * 0.6 + pad;
    const catHeight = sz * 1.6;
    if (horizontal) { left += Math.max(...cats.map(t => t.length), 1) * sz * 0.6 + pad; bottom -= catHeight; }
    else { left += valueWidth; bottom -= catHeight; }
    const pw = Math.max(1, right - left), ph = Math.max(1, bottom - top);
    const vpos = (v: number) => horizontal ? left + (v - min) / (max - min || 1) * pw : bottom - (v - min) / (max - min || 1) * ph;
    if (valAx && child(valAx, C, 'majorGridlines')) for (const t of ticks) out.push(horizontal ? `<line x1="${num(vpos(t))}" y1="${num(top)}" x2="${num(vpos(t))}" y2="${num(bottom)}" stroke="#d9d9d9" stroke-width="1"/>` : `<line x1="${num(left)}" y1="${num(vpos(t))}" x2="${num(right)}" y2="${num(vpos(t))}" stroke="#d9d9d9" stroke-width="1"/>`);
    if (val(child(valAx, C, 'delete')) !== '1') for (const t of ticks) out.push(horizontal ? text(vpos(t), bottom + sz * 1.2, label(t)) : text(left - pad / 2, vpos(t) + sz * 0.35, label(t), 'end'));
    const band = (horizontal ? ph : pw) / Math.max(1, count);
    const catAx = child(plot, C, 'catAx') ?? child(plot, C, 'dateAx');
    if (val(child(catAx, C, 'delete')) !== '1') cats.forEach((t, i) => out.push(horizontal ? text(left - pad / 2, top + (count - i - 0.5) * band + sz * 0.35, t, 'end') : text(left + (i + 0.5) * band, bottom + sz * 1.2, t)));
    const zero = vpos(Math.max(min, Math.min(max, 0)));
    out.push(horizontal ? `<line x1="${num(zero)}" y1="${num(top)}" x2="${num(zero)}" y2="${num(bottom)}" stroke="#bfbfbf" stroke-width="1"/>` : `<line x1="${num(left)}" y1="${num(zero)}" x2="${num(right)}" y2="${num(zero)}" stroke="#bfbfbf" stroke-width="1"/>`);
    const bars = data.filter(d => ['barChart', 'bar3DChart'].includes(d.g.name));
    const clusters = [...new Set(bars.map(d => stacked(d.g) ? d.g : d))];
    const gap = number(val(child(bars[0]?.g, C, 'gapWidth')), 150) / 100, slot = band / (clusters.length + gap);
    for (const d of data) {
      if (['barChart', 'bar3DChart'].includes(d.g.name)) {
        const k = clusters.indexOf(stacked(d.g) ? d.g : d);
        for (let i = 0; i < count; i++) {
          const [a, b] = level(d, i), from = vpos(Math.max(min, Math.min(max, a))), to = vpos(Math.max(min, Math.min(max, b)));
          const offset = (horizontal ? top + (count - i - 1) * band : left + i * band) + slot * (gap / 2 + k);
          out.push(horizontal ? `<rect x="${num(Math.min(from, to))}" y="${num(offset)}" width="${num(Math.abs(to - from))}" height="${num(slot)}" fill="${d.fill}"/>` : `<rect x="${num(offset)}" y="${num(Math.min(from, to))}" width="${num(slot)}" height="${num(Math.abs(to - from))}" fill="${d.fill}"/>`);
        }
      } else {
        const pts = Array.from({ length: count }, (_, i) => [left + (i + 0.5) * band, vpos(level(d, i)[1])]);
        const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x)} ${num(y)}`).join('');
        if (d.g.name === 'areaChart') {
          const base = Array.from({ length: count }, (_, i) => [left + (i + 0.5) * band, vpos(level(d, i)[0])]).reverse();
          out.push(`<path d="${line}${base.map(([x, y]) => `L${num(x)} ${num(y)}`).join('')}Z" fill="${d.fill}" fill-opacity="0.85"/>`);
        } else out.push(`<path d="${line}" fill="none" stroke="${d.stroke}" stroke-width="${num(Math.max(1.5, sz / 6))}" stroke-linejoin="round" stroke-linecap="round"/>`);
      }
    }
  }
  warn(c, 'chart_redrawn');
  return `<svg aria-label="${esc(title || 'Chart')}" viewBox="0 0 ${num(W)} ${num(H)}" style="${css({ ...box, rot: 0, fh: false, fv: false })};overflow:visible">${out.join('')}</svg>`;
}
/** A copy of a SmartArt drawing's tree in the slide's own namespace, so shapes read the same way. */
function asSlideTree(n: X): X { return { ...n, uri: n.uri === DSP ? P : n.uri, children: n.children.map(asSlideTree) }; }
function graphicFrame(n: X, c: Context): Obj[] {
  const cNvPr = path(n, [P, 'nvGraphicFramePr'], [P, 'cNvPr']);
  c = withObject(c, cNvPr);
  if (truthy(at(cNvPr, 'hidden'))) { warn(c, 'hidden_skipped'); return []; }
  const xf = child(n, P, 'xfrm'), box = boxOf(xf, c);
  const data = path(n, [A, 'graphic'], [A, 'graphicData']), uri = at(data, 'uri');
  if (uri === TABLE_URI) return [{ html: renderTable(n, box, c), object: c.loc.object }];
  if (uri === DIAGRAM_URI) {
    const ids = walk(data, 'http://schemas.openxmlformats.org/drawingml/2006/diagram', 'relIds')[0];
    const dm = at(ids, 'dm', R), model = dm ? c.pkg.parsed.get(c.pkg.rel(c.loc.part!, dm, undefined, c.loc)) : undefined;
    const drawingId = model && walk(model, DSP, 'dataModelExt').map(e => at(e, 'relId')).find(Boolean);
    const drawing = drawingId ? c.pkg.parsed.get(c.pkg.rel(c.loc.part!, drawingId, undefined, c.loc)) : undefined;
    const tree = drawing && child(drawing, DSP, 'spTree');
    if (tree) {
      const ext = child(xf, A, 'ext');
      const frameXf: X = { uri: A, name: 'xfrm', attrs: {}, text: '', children: [child(xf, A, 'off')!, ext!, { uri: A, name: 'chOff', attrs: { [key('', 'x')]: '0', [key('', 'y')]: '0' }, text: '', children: [] }, { uri: A, name: 'chExt', attrs: ext!.attrs, text: '', children: [] }] };
      return shapes(asSlideTree(tree).children, { ...c, place: groupPlace(frameXf, c) }, false);
    }
  }
  if (uri === CHART_URI) {
    try { const drawn = renderChart(n, box, c); if (drawn) return [{ html: drawn, object: c.loc.object }]; } catch (e) { if (fatal(e)) throw e; }
  }
  if (uri === OLE_URI) {
    const pic = walk(data, P, 'pic')[0];
    if (pic) return [{ html: renderShape({ ...pic, children: pic.children.map(k => k.uri === P && k.name === 'spPr' ? { ...k, children: [{ ...xf!, uri: A }, ...k.children.filter(x => x.name !== 'xfrm')] } : k) }, [], c), object: c.loc.object }];
  }
  warn(c, 'object_placeholder', { element: uri === CHART_URI ? 'chart' : uri === DIAGRAM_URI ? 'diagram' : uri === OLE_URI ? 'object' : 'other' });
  return [{ html: `<x-shape kind="rect" style="${css(box)};background:rgba(128,128,128,0.08);border:2px dashed #9ca3af"></x-shape>`, object: c.loc.object }];
}
function group(n: X, c: Context, inherited: boolean): Obj[] {
  const cNvPr = path(n, [P, 'nvGrpSpPr'], [P, 'cNvPr']);
  if (truthy(at(cNvPr, 'hidden'))) { warn(withObject(c, cNvPr), 'hidden_skipped'); return []; }
  const pr = child(n, P, 'grpSpPr'), xf = child(pr, A, 'xfrm');
  return shapes(n.children, { ...c, place: xf ? groupPlace(xf, c) : c.place, groupFill: fillIn(pr) ?? c.groupFill }, inherited);
}
/** Every object of a shape tree in paint order. One that cannot be converted is left out with a note; the rest still come in. */
function shapes(nodes: X[], c: Context, inherited: boolean, layout?: X, master?: X): Obj[] {
  const out: Obj[] = [];
  for (const n of nodes) {
    if (n.uri === P && ['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(n.name)) continue;
    if (inherited && phOf(n)) continue;
    try {
      if (n.uri === MC && n.name === 'AlternateContent') { out.push(...shapes((child(n, MC, 'Fallback') ?? child(n, MC, 'Choice'))?.children ?? [], c, inherited, layout, master)); continue; }
      if (n.uri !== P) fail('unsupported_element', c.loc, { element: n.name });
      if (n.name === 'grpSp') { out.push(...group(n, c, inherited)); continue; }
      if (n.name === 'graphicFrame') { out.push(...graphicFrame(n, c)); continue; }
      if (!['sp', 'pic', 'cxnSp'].includes(n.name)) fail('unsupported_element', c.loc, { element: n.name });
      const l = matchPlaceholder(n, layout), m = matchPlaceholder(l ?? n, master);
      const html = renderShape(n, [l, m].filter((x): x is X => !!x), c);
      if (html) out.push({ html, object: at(cNvPrOf(n), 'id') });
    } catch (e) {
      if (fatal(e)) throw e;
      warn({ ...c, loc: { ...c.loc, object: at(cNvPrOf(n), 'id') ?? c.loc.object } }, 'object_skipped', { element: n.name, reason: reason(e) });
    }
  }
  return out;
}
/** The slide's background: a colour or gradient on the section, a picture as its first object. */
function background(roots: (X | undefined)[], c: Context, page: Box): { css: string; html: string } {
  try {
    for (const root of roots) {
      const bg = path(root, [P, 'cSld'], [P, 'bg']); if (!bg) continue;
      const ref = child(bg, P, 'bgRef');
      const t = ref ? themeStyle(ref, 'fillStyleLst', c) : { node: fillIn(child(bg, P, 'bgPr')), c };
      const p = t.node ? paint(t.node, t.c) : null;
      if (p?.image) return { css: '#ffffff', html: picture(p.image, page, t.c, '') };
      return { css: p ? p.css : '#ffffff', html: '' };
    }
  } catch (e) { if (fatal(e)) throw e; }
  warn(c, 'background_defaulted'); return { css: '#ffffff', html: '' };
}
function notes(root: X, c: Context): string {
  const out: string[] = [];
  for (const s of walk(root, P, 'sp')) {
    if (at(phOf(s), 'type') !== 'body') continue;
    for (const p of walk(child(s, P, 'txBody'), A, 'p')) out.push(p.children.map(r => r.name === 'br' ? '\n' : walk(r, A, 't').map(x => x.text).join('')).join(''));
  }
  let value = out.join('\n');
  if (value.length > 4000) { warn(c, 'notes_too_long', { length: value.length }); value = value.slice(0, 4000); }
  return value ? `<aside>${esc(value)}</aside>` : '';
}
const sectionOk = (html: string, id: string) => !checkSlide(parseDc(html), id).some(x => x.level === 'error');

/** Codes a conversion note can carry, each with its own wording in the editor and the command line. */
export const PPTX_NOTES = ['limit_exceeded', 'object_skipped', 'invalid_media', 'object_placeholder', 'chart_redrawn', 'slide_skipped', 'objects_dropped', 'hidden_skipped', 'animation_dropped', 'effect_dropped', 'style_approximate', 'link_dropped', 'media_poster', 'notes_too_long', 'text_layout_approximate', 'geometry_approximate', 'background_defaulted'] as const;
export type PptxNote = typeof PPTX_NOTES[number] | 'unsafe' | 'unsupported' | 'invalid';
/** The wording key (`launcher.pptx.reason.<key>`) for a diagnostic; a picture in a format slides cannot show gets its own. */
export function pptxNote(d: Pick<PptxDiagnostic, 'code' | 'params'>): PptxNote {
  if (d.code === 'object_skipped' && d.params?.reason === 'invalid_media') return 'invalid_media';
  if ((PPTX_NOTES as readonly string[]).includes(d.code)) return d.code as PptxNote;
  return /forbidden|unsafe|external|duplicate/.test(d.code) ? 'unsafe' : d.code.startsWith('unsupported_') ? 'unsupported' : 'invalid';
}

/** Caller id must be a collision-free import namespace (1..40 safe ASCII chars). */
export function importPptx(bytes: Uint8Array, options: PptxOptions): PptxResult {
  const diagnostics: PptxDiagnostic[] = [], seen = new Set<string>();
  gradients = 0;
  try {
    if (!options || !/^[A-Za-z0-9_-]{1,40}$/.test(options.id) || typeof options.title !== 'string') fail('invalid_options');
    const limits = { ...PPTX_LIMITS, ...options.limits };
    for (const [k, v] of Object.entries(limits)) if (!Number.isSafeInteger(v) || v < 1 || v > PPTX_LIMITS[k as keyof PptxLimits]) fail('invalid_options');
    let files: Map<string, Uint8Array>; try { files = unzip(bytes, limits); } catch (e) { if (e instanceof ImportFailure) throw e; fail('invalid_zip'); }
    if (!files.has('[Content_Types].xml') || !files.has('_rels/.rels')) fail('invalid_package');
    const pkg = new Package(files, limits);
    const ct = pkg.get('[Content_Types].xml', CT, 'Types');
    for (const n of ct.children) if (/macroEnabled|vbaProject|activeX/i.test(at(n, 'ContentType') ?? '')) fail('forbidden_package', { part: '[Content_Types].xml' });
    const presentation = pkg.ofType('', 'officeDocument'); if (!presentation) fail('invalid_package');
    if (!ct.children.some(n => n.uri === CT && n.name === 'Override' && at(n, 'PartName') === `/${presentation}` && at(n, 'ContentType') === MIME)) fail('invalid_package');
    const root = pkg.get(presentation, P, 'presentation');
    const sz = child(root, P, 'sldSz'), width = number(at(sz, 'cx')), height = number(at(sz, 'cy'));
    if (width <= 0 || height <= 0) fail('invalid_value', { part: presentation });
    // The deck takes the presentation's own shape: landscape pages fit 1920×1080, portrait ones 1080×1920.
    const scale = height > width ? Math.min(1080 / width, 1920 / height) : Math.min(1920 / width, 1080 / height);
    const size: [number, number] = [Math.round(width * scale), Math.round(height * scale)];
    const ids = kids(child(root, P, 'sldIdLst'), P, 'sldId'); budget(ids.length, limits.slides, 'slides'); if (!ids.length) fail('invalid_package');
    const prefix = `uploads/${options.id}`, output: Record<string, Uint8Array> = {}, media = new Map<string, string>();
    const report: PptxReport = { v: 1, path: `${prefix}/report.json`, source: `${prefix}/source.pptx`, width, height, size, slides: [], diagnostics };
    const tableStylesPart = pkg.ofType(presentation, 'tableStyles');
    const tableStyles = tableStylesPart ? pkg.parsed.get(tableStylesPart) : undefined;
    const used = new Set<string>();
    let firstFailure: ImportFailure | undefined;
    for (let i = 0; i < ids.length; i++) {
      const id = `${options.id}-${i + 1}`;
      let part = '';
      try {
        part = pkg.rel(presentation, at(ids[i], 'id', R) ?? '', 'slide');
        if (used.has(part)) fail('invalid_package', { part }); used.add(part);
        const sld = pkg.get(part, P, 'sld');
        const layoutPart = pkg.ofType(part, 'slideLayout'), layout = layoutPart ? pkg.get(layoutPart, P, 'sldLayout') : undefined;
        const masterPart = layoutPart ? pkg.ofType(layoutPart, 'slideMaster') : undefined, master = masterPart ? pkg.get(masterPart, P, 'sldMaster') : undefined;
        const themePart = (masterPart ? pkg.ofType(masterPart, 'theme') : undefined) ?? pkg.ofType(presentation, 'theme');
        const theme = themePart ? pkg.get(themePart, A, 'theme') : undefined;
        const colorMap: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
        const clrMap = child(master, P, 'clrMap'); for (const [k, v] of Object.entries(clrMap?.attrs ?? {})) colorMap[k.slice(k.indexOf('}') + 1)] = v;
        for (const r of [layout, sld]) { const map = path(r, [P, 'clrMapOvr'], [A, 'overrideClrMapping']); for (const [k, v] of Object.entries(map?.attrs ?? {})) colorMap[k.slice(k.indexOf('}') + 1)] = v; }
        const c: Context = {
          pkg, diagnostics, seen, loc: { part, slide: id }, scale, place: b => ({ ...b, x: b.x * scale, y: b.y * scale, w: b.w * scale, h: b.h * scale }),
          theme, colorMap, defaults: child(root, P, 'defaultTextStyle'), master, tableStyles, media, files: output, prefix, page: i + 1,
        };
        // a transition with an effect, or any animation; a bare speed changes nothing on the page
        const effects = walk(sld, P, 'transition').some(t => t.children.length) || ['set', 'anim', 'animEffect', 'animMotion', 'animScale', 'animRot', 'animClr'].some(k => walk(child(sld, P, 'timing'), P, k).length);
        if (effects) warn(c, 'animation_dropped');
        const page: Box = { x: 0, y: 0, w: size[0], h: size[1], rot: 0, fh: false, fv: false };
        const bg = background([sld, layout, master], c, page);
        const objects: Obj[] = bg.html ? [{ html: bg.html }] : [];
        const showMaster = (r: X | undefined) => at(r, 'showMasterSp') !== '0' && at(r, 'showMasterSp') !== 'false';
        if (showMaster(sld)) {
          if (master && showMaster(layout)) objects.push(...shapes(path(master, [P, 'cSld'], [P, 'spTree'])?.children ?? [], { ...c, loc: { ...c.loc, part: masterPart } }, true));
          if (layout) objects.push(...shapes(path(layout, [P, 'cSld'], [P, 'spTree'])?.children ?? [], { ...c, loc: { ...c.loc, part: layoutPart } }, true));
        }
        objects.push(...shapes(path(sld, [P, 'cSld'], [P, 'spTree'])?.children ?? [], c, false, layout, master));
        const notesPart = pkg.ofType(part, 'notesSlide');
        let aside = '';
        if (notesPart) try { aside = notes(pkg.get(notesPart, P, 'notes'), { ...c, loc: { ...c.loc, part: notesPart } }); } catch (e) { if (fatal(e)) throw e; warn(c, 'object_skipped', { element: 'notes', reason: reason(e) }); }
        const open = `<section id="${id}"${at(sld, 'show') === '0' || at(sld, 'show') === 'false' ? ' hidden' : ''} style="background:${bg.css};color:#000000;font-family:Arial">`;
        // Each object has to be valid slide markup on its own; then as many as the slide can hold.
        let kept = objects.filter(o => {
          if (sectionOk(`${open}${o.html}</section>`, id)) return true;
          warn({ ...c, loc: { ...c.loc, object: o.object } }, 'object_skipped', { reason: 'generated_slide_invalid' });
          return false;
        });
        const compose = (list: Obj[]) => `${open}${list.map(o => o.html).join('')}${aside}</section>\n`;
        if (!sectionOk(compose(kept), id)) {
          let lo = 0, hi = kept.length;
          while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (sectionOk(compose(kept.slice(0, mid)), id)) lo = mid; else hi = mid - 1; }
          warn(c, 'objects_dropped', { count: kept.length - lo });
          kept = kept.slice(0, lo);
          if (!sectionOk(compose(kept), id)) { aside = ''; if (!sectionOk(compose(kept), id)) fail('generated_slide_invalid', c.loc); }
        }
        output[`slides/${id}.html`] = encode(compose(kept)); report.slides.push({ id, part });
      } catch (e) {
        if (fatal(e)) throw e;
        firstFailure ??= e instanceof ImportFailure ? e : undefined;
        warn({ pkg, diagnostics, seen, loc: { part: part || presentation, slide: id } }, 'slide_skipped', { reason: reason(e) });
      }
    }
    if (!report.slides.length) throw firstFailure ?? new ImportFailure({ level: 'error', code: 'invalid_package' });
    const sized = size[0] !== 1920 || size[1] !== 1080 ? { size } : {};
    output['deck.json'] = encode(stringifyDeck({ v: 4, title: options.title, ...sized, order: report.slides.map(s => s.id), cover: report.slides[0].id, sections: {}, faces: {}, designSystems: [], pptxImport: report.path }));
    output[report.source] = bytes.slice(); output[report.path] = encode(JSON.stringify(report, null, 2) + '\n');
    return { ok: true, files: output, report, diagnostics };
  } catch (e) {
    return { ok: false, diagnostics: [...diagnostics, e instanceof ImportFailure ? e.diagnostic : { level: 'error', code: 'invalid_package' }] };
  }
}
