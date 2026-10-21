import { Unzip, UnzipInflate } from 'fflate';
import { SaxesParser } from 'saxes';
import { parseDc } from './parse';
import { checkSlide } from './slides';
import { stringifyDeck } from './deck';

/**
 * Standalone, fail-closed PPTX -> editable slides conversion. No I/O or renderer.
 * Transitional OOXML only. Supported: solid rect/roundRect/ellipse/straight line,
 * uniformly styled text boxes (mixed b/i/u/color), simple placeholder inheritance,
 * solid/theme colors and solid background matrix references, Latin theme fonts,
 * local PNG/JPEG, rotation/flips, plain notes. Script fonts may be empty or equal
 * to the resolved Latin font; different script faces reject. Kerning is diagnosed.
 * Layout/master non-placeholder artwork is painted before slide artwork. Hidden
 * objects, HSL luminance transforms, groups, charts, custom geometry,
 * effects, bullets, mixed sizes/fonts and shape style-matrix references
 * reject rather than vanish. Explicit unmerged tables, paragraph line spacing
 * and srcRect image crops map to editable HTML. Font metrics/wrapping,
 * roundRect radius and default text metrics are approximate and diagnosed.
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
  v: 1; path: string; source: string; width: number; height: number;
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
    if (stack.length) stack[stack.length - 1].children.push(n); else root = n;
    stack.push(n);
  });
  const text = (s: string) => { budget(++nodes, limits.xmlNodes, 'xmlNodes', { part }); budget(++total.nodes, limits.totalXmlNodes, 'totalXmlNodes', { part }); if (stack.length) stack[stack.length - 1].text += s; };
  parser.on('text', text); parser.on('cdata', text); parser.on('closetag', () => { stack.pop(); });
  parser.on('error', () => fail('invalid_xml', { part }));
  try { parser.write(source).close(); } catch (e) { if (e instanceof ImportFailure) throw e; fail('invalid_xml', { part }); }
  if (!root) fail('invalid_xml', { part }); return root;
}
interface Relationship { type: string; target: string }
class Package {
  readonly parsed = new Map<string, X>(); readonly relations = new Map<string, Map<string, Relationship>>();
  constructor(readonly files: Map<string, Uint8Array>, readonly limits: PptxLimits) {
    const total = { nodes: 0 };
    for (const name of files.keys()) {
      if (/vba|activeX|embeddings\//i.test(name)) fail('forbidden_package', { part: name });
      if (/\.xml$|\.rels$/i.test(name)) this.parsed.set(name, xml(files.get(name)!, limits, name, total));
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
        if (at(r, 'TargetMode') === 'External') fail('external_relationship', { part: name });
        if (at(r, 'TargetMode') && at(r, 'TargetMode') !== 'Internal') fail('invalid_part', { part: name });
        if (/vba|oleObject|activeX/i.test(type)) fail('forbidden_package', { part: name });
        const resolved = resolve(base, target);
        if (!files.has(resolved)) fail('missing_part', { part: resolved });
        map.set(id, { type, target: resolved });
      }
      this.relations.set(base, map);
    }
  }
  get(part: string, uri: string, name: string) { const n = this.parsed.get(part); if (!this.files.has(part)) fail('missing_part', { part }); if (!n || n.uri !== uri || n.name !== name) fail('invalid_part', { part }); return n; }
  rel(part: string, id: string, type: string, loc: Loc = {}): string {
    const r = this.relations.get(part)?.get(id); if (!r || r.type !== `${R}/${type}`) fail('missing_relationship', { part, ...loc }, { id }); return r.target;
  }
  ofType(part: string, type: string): string | undefined {
    const list = [...(this.relations.get(part)?.values() ?? [])].filter(r => r.type === `${R}/${type}`);
    if (list.length > 1) fail('invalid_part', { part }); return list[0]?.target;
  }
}
interface Context { pkg: Package; placeholderColor?: string; defaults?: X; master?: X; diagnostics: PptxDiagnostic[]; loc: Loc; scale: number; dx: number; dy: number; theme?: X; colorMap: Record<string, string>; media: Map<string, string>; files: Record<string, Uint8Array>; prefix: string }
function warn(c: Context, code: string, params?: PptxDiagnostic['params']) { budget(c.diagnostics.length + 1, c.pkg.limits.diagnostics, 'diagnostics', c.loc); c.diagnostics.push({ level: 'warning', code, ...c.loc, ...(params ? { params } : {}) }); }
function number(value: string | undefined, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1e12) fail('invalid_value');
  return Number(value);
}
function color(n: X | undefined, c: Context, fallback?: string): string {
  if (!n) { if (fallback) return fallback; fail('unsupported_color', c.loc); }
  const clr = n.name.endsWith('Clr') ? n : n.children.find(x => x.uri === A && /Clr$/.test(x.name));
  if (!clr) { if (fallback) return fallback; fail('unsupported_color', c.loc); }
  let value: string | undefined;
  if (clr.name === 'srgbClr') value = at(clr, 'val');
  else if (clr.name === 'sysClr') value = at(clr, 'lastClr');
  else if (clr.name === 'schemeClr') {
    let name = at(clr, 'val') ?? ''; name = c.colorMap[name] ?? name;
    if (name === 'phClr' && c.placeholderColor) value = c.placeholderColor.slice(1);
    else {
      const entry = path(c.theme, [A, 'themeElements'], [A, 'clrScheme'], [A, name]);
      if (!entry) fail('unsupported_color', c.loc, { color: name });
      value = color(entry, c).slice(1);
    }
  }
  if (!value || !/^[a-f\d]{6}$/i.test(value)) fail('unsupported_color', c.loc);
  let rgb = [0, 2, 4].map(i => parseInt(value!.slice(i, i + 2), 16)); let alpha = 1;
  for (const mod of clr.children) {
    const v = number(at(mod, 'val')) / 100000;
    if (v < 0 || v > 1) fail('unsupported_color', c.loc);
    if (mod.name === 'alpha') alpha = v;
    else if (mod.name === 'tint') rgb = rgb.map(x => x + (255 - x) * v);
    else if (mod.name === 'shade') rgb = rgb.map(x => x * v);
    else fail('unsupported_color', c.loc, { modifier: mod.name });
  }
  return alpha === 1 ? '#' + rgb.map(x => Math.round(x).toString(16).padStart(2, '0')).join('') : `rgba(${rgb.map(Math.round).join(',')},${num(alpha)})`;
}
function font(value: string | undefined, c: Context): string {
  if (value?.startsWith('+')) {
    const major = value === '+mj-lt', minor = value === '+mn-lt';
    if (!major && !minor) fail('unsupported_text_style', c.loc);
    value = at(path(c.theme, [A, 'themeElements'], [A, 'fontScheme'], [A, major ? 'majorFont' : 'minorFont'], [A, 'latin']), 'typeface');
    if (!value) fail('unsupported_text_style', c.loc);
  }
  value ??= 'Arial';
  if (!/^[\p{L}\p{N} _-]{1,100}$/u.test(value)) fail('unsupported_text_style', c.loc);
  return value;
}
function unsupportedStyles(n: X | undefined, c: Context) {
  if (!n) return;
  const allowed = ['rPr', 'defRPr'].includes(n.name) ? ['solidFill', 'noFill', 'latin', 'ea', 'cs', 'effectLst', 'effectDag', 'extLst'] : n.name === 'ln' ? ['solidFill', 'noFill', 'miter', 'round', 'bevel', 'prstDash'] : ['xfrm', 'prstGeom', 'noFill', 'solidFill', 'ln', 'effectLst', 'effectDag', 'extLst'];
  if (n.children.some(x => x.uri !== A || !allowed.includes(x.name))) fail('unsupported_style', c.loc);
  for (const x of n.children) if (['gradFill', 'pattFill', 'blipFill', 'effectLst', 'effectDag', 'scene3d', 'sp3d', 'custGeom'].includes(x.name) && (x.children.length || !['effectLst', 'effectDag'].includes(x.name))) fail('unsupported_style', c.loc, { element: x.name });
}
function transform(n: X | undefined, c: Context) {
  if (!n) fail('missing_geometry', c.loc);
  const off = child(n, A, 'off'), ext = child(n, A, 'ext');
  const x = number(at(off, 'x')), y = number(at(off, 'y')), w = number(at(ext, 'cx')), h = number(at(ext, 'cy'));
  if (w < 0 || h < 0) fail('invalid_value', c.loc);
  const rot = number(at(n, 'rot'), 0) / 60000;
  const transforms = [rot ? `rotate(${num(rot)}deg)` : '', at(n, 'flipH') === '1' || at(n, 'flipH') === 'true' ? 'scaleX(-1)' : '', at(n, 'flipV') === '1' || at(n, 'flipV') === 'true' ? 'scaleY(-1)' : ''].filter(Boolean).join(' ');
  return `position:absolute;left:${num(c.dx + x * c.scale)}px;top:${num(c.dy + y * c.scale)}px;width:${num(w * c.scale)}px;height:${num(h * c.scale)}px${transforms ? `;transform:${transforms}` : ''}`;
}
const phOf = (n: X | undefined) => path(n, [P, 'nvSpPr'], [P, 'nvPr'], [P, 'ph']);
function matchPlaceholder(shape: X, root: X | undefined) {
  const ph = phOf(shape); if (!ph) return undefined;
  return walk(root, P, 'sp').find(s => { const p = phOf(s); return p && (at(ph, 'idx') !== undefined ? at(p, 'idx') === at(ph, 'idx') : (at(p, 'type') ?? 'obj') === (at(ph, 'type') ?? 'obj')); });
}
interface TextStyle { size: number; family: string; color: string; bold: boolean; italic: boolean; underline: boolean }
function applyText(base: TextStyle, n: X | undefined, c: Context): TextStyle {
  if (!n) return base;
  if (child(n, A, 'noFill')) fail('unsupported_text_style', c.loc);
  unsupportedStyles(n, c);
  if (number(at(n, 'kern'), 0) !== 0) warn(c, 'kerning_approximate');
  for (const attr of ['baseline', 'spc', 'cap', 'strike']) if (at(n, attr) !== undefined && !['0', 'none'].includes(at(n, attr)!)) fail('unsupported_text_style', c.loc, { attribute: attr });
  if (n.children.some(x => x.uri !== A || ['hlinkClick', 'hlinkMouseOver', 'highlight', 'ln', 'sym'].includes(x.name))) fail('unsupported_text_style', c.loc);
  const family = child(n, A, 'latin') ? font(at(child(n, A, 'latin'), 'typeface'), c) : base.family;
  for (const script of ['ea', 'cs']) {
    const face = at(child(n, A, script), 'typeface');
    if (face && face !== family) fail('unsupported_text_style', c.loc);
  }
  const bool = (name: string, previous: boolean) => at(n, name) === undefined ? previous : ['1', 'true'].includes(at(n, name)!);
  const size = at(n, 'sz') === undefined ? base.size : number(at(n, 'sz')) * 127 * c.scale;
  if (size <= 0) fail('invalid_value', c.loc);
  return { size, family,
    color: child(n, A, 'solidFill') ? color(child(n, A, 'solidFill'), c) : base.color,
    bold: bool('b', base.bold), italic: bool('i', base.italic), underline: at(n, 'u') === undefined ? base.underline : at(n, 'u') === 'sng' };
}
function textBody(shape: X, ancestors: X[], c: Context): string {
  const body = child(shape, P, 'txBody'); if (!body) return '';
  const bodyPr = child(body, A, 'bodyPr');
  if (at(bodyPr, 'vert') && at(bodyPr, 'vert') !== 'horz' || number(at(bodyPr, 'rot'), 0) !== 0 || number(at(bodyPr, 'numCol'), 1) !== 1 || child(bodyPr, A, 'spAutoFit')) fail('unsupported_text_style', c.loc);
  if (child(bodyPr, A, 'normAutofit')) fail('unsupported_text_style', c.loc);
  // An empty txBody is shape metadata, not a visible text object. Keep the
  // shape itself, but do not resolve unused font defaults or invent a blank line.
  if (kids(body, A, 'p').every(p => p.children.every(n => n.uri === A && ['pPr', 'endParaRPr'].includes(n.name)))) return '';
  warn(c, 'text_layout_approximate');
  let common: TextStyle | undefined;
  const paragraphs = kids(body, A, 'p').map(p => {
    const pr = child(p, A, 'pPr'); const level = number(at(pr, 'lvl'), 0);
    const zeroSpacing = (n: X) => ['spcBef', 'spcAft'].includes(n.name) && n.children.length === 1 && n.children[0].uri === A && ['spcPts', 'spcPct'].includes(n.children[0].name) && number(at(n.children[0], 'val')) === 0;
    const spacing = child(pr, A, 'lnSpc');
    let lineHeight = '1.2';
    if (spacing) {
      const value = spacing.children[0];
      if (spacing.children.length !== 1 || value.uri !== A || !['spcPct', 'spcPts'].includes(value.name)) fail('unsupported_text_style', c.loc);
      const amount = number(at(value, 'val'));
      if (amount < 0 || !Number.isInteger(amount)) fail('invalid_value', c.loc);
      lineHeight = value.name === 'spcPct' ? num(amount / 100000) : `${num(amount * 127 * c.scale)}px`;
    }
    if (level !== 0 || pr?.children.some(x => ['buChar', 'buAutoNum', 'buBlip', 'tabLst'].includes(x.name) || ['spcBef', 'spcAft'].includes(x.name) && !zeroSpacing(x)) || ['marL', 'marR', 'indent'].some(k => number(at(pr, k), 0) !== 0)) fail('unsupported_text_style', c.loc);
    const alignment = at(pr, 'algn') ?? 'l'; if (!['l', 'ctr', 'r', 'just'].includes(alignment)) fail('unsupported_text_style', c.loc);
    const base: TextStyle = { size: 18 * 12700 * c.scale, family: 'Arial', color: '#000000', bold: false, italic: false, underline: false };
    const type = at(phOf(shape), 'type');
    const styleName = ['title', 'ctrTitle'].includes(type ?? '') ? 'titleStyle' : ['body', 'subTitle', 'obj'].includes(type ?? '') ? 'bodyStyle' : 'otherStyle';
    const inherited = [path(c.defaults, [A, 'lvl1pPr'], [A, 'defRPr']),
      phOf(shape) ? path(c.master, [P, 'txStyles'], [P, styleName], [A, 'lvl1pPr'], [A, 'defRPr']) : undefined,
      ...[...ancestors].reverse().map(parent => path(parent, [P, 'txBody'], [A, 'lstStyle'], [A, 'lvl1pPr'], [A, 'defRPr'])),
      path(body, [A, 'lstStyle'], [A, 'lvl1pPr'], [A, 'defRPr']), child(pr, A, 'defRPr')];
    // Resolve cascading properties before interpreting them, so explicit run values
    // replace inherited theme/script fonts rather than triggering false failures.
    const resolved = (run?: X) => {
      const merged: X = { uri: A, name: 'rPr', attrs: {}, children: [], text: '' };
      for (const n of [...inherited, run]) if (n) {
        Object.assign(merged.attrs, n.attrs);
        for (const x of n.children) {
          merged.children = merged.children.filter(previous => !(previous.uri === x.uri && (previous.name === x.name || ['solidFill', 'noFill'].includes(previous.name) && ['solidFill', 'noFill'].includes(x.name))));
          merged.children.push(x);
        }
      }
      return applyText(base, merged, c);
    };
    let runs = '';
    for (const r of p.children) {
      if (r.uri !== A) fail('unsupported_element', c.loc, { element: r.name });
      if (r.name === 'br') { runs += '<br>'; continue; }
      if (r.name === 'pPr' || r.name === 'endParaRPr') continue;
      if (r.name !== 'r') fail('unsupported_text_style', c.loc, { element: r.name });
      if (r.children.some(x => x.uri !== A || !['rPr', 't'].includes(x.name))) fail('unsupported_element', c.loc);
      const style = resolved(child(r, A, 'rPr'));
      if (common && (common.size !== style.size || common.family !== style.family)) fail('unsupported_text_style', c.loc);
      common ??= style;
      let value = esc(child(r, A, 't')?.text ?? '');
      if (style.bold) value = `<b>${value}</b>`; if (style.italic) value = `<i>${value}</i>`; if (style.underline) value = `<u>${value}</u>`;
      if (style.color !== '#000000') value = `<span style="color:${style.color}">${value}</span>`;
      runs += value;
    }
    common ??= resolved();
    return `<p style="font-size:${num(common.size)}px;font-family:${esc(common.family)};line-height:${lineHeight};text-align:${{ l: 'left', ctr: 'center', r: 'right', just: 'justify' }[alignment]};white-space:${at(bodyPr, 'wrap') === 'none' ? 'pre' : 'pre-wrap'}">${runs || '<br>'}</p>`;
  });
  const inset = ['lIns', 'tIns', 'rIns', 'bIns'].map((k, i) => number(at(bodyPr, k), i % 2 === 0 ? 91440 : 45720) * c.scale);
  // CSS padding uses top/right/bottom/left.
  const anchor = at(bodyPr, 'anchor') ?? 't'; if (!['t', 'ctr', 'b'].includes(anchor)) fail('unsupported_text_style', c.loc);
  return `<div style="position:absolute;left:0px;top:0px;width:100%;height:100%;display:flex;flex-direction:column;justify-content:${{ t: 'flex-start', ctr: 'center', b: 'flex-end' }[anchor]};padding:${num(inset[1])}px ${num(inset[2])}px ${num(inset[3])}px ${num(inset[0])}px">${paragraphs.join('')}</div>`;
}
function imageInfo(bytes: Uint8Array, c: Context): { ext: string; width: number; height: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, ext = '';
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x) && v.getUint32(8) === 13 && utf8.decode(bytes.subarray(12, 16)) === 'IHDR') { width = v.getUint32(16); height = v.getUint32(20); ext = 'png'; }
  else if (bytes[0] === 255 && bytes[1] === 216) {
    ext = 'jpg'; let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos++] !== 255) fail('invalid_media', c.loc);
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++]; if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (pos + 2 > bytes.length) break;
      const length = v.getUint16(pos); if (length < 2 || pos + length > bytes.length) fail('invalid_media', c.loc);
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) { height = v.getUint16(pos + 3); width = v.getUint16(pos + 5); break; }
      pos += length;
    }
  }
  if (!width || !height) fail('invalid_media', c.loc);
  budget(width * height, c.pkg.limits.mediaPixels, 'mediaPixels', c.loc);
  return { ext, width, height };
}
function renderShape(shape: X, ancestors: X[], c: Context): string {
  const nv = child(shape, P, shape.name === 'pic' ? 'nvPicPr' : shape.name === 'cxnSp' ? 'nvCxnSpPr' : 'nvSpPr');
  c = { ...c, loc: { ...c.loc, object: at(child(nv, P, 'cNvPr'), 'id') } };
  if (['1', 'true'].includes(at(child(nv, P, 'cNvPr'), 'hidden') ?? '')) fail('unsupported_hidden_object', c.loc);
  const allowed = shape.name === 'pic' ? ['nvPicPr', 'blipFill', 'spPr', 'extLst'] : shape.name === 'cxnSp' ? ['nvCxnSpPr', 'spPr', 'style', 'extLst'] : ['nvSpPr', 'spPr', 'txBody', 'style', 'extLst'];
  if (shape.children.some(x => x.uri !== P || !allowed.includes(x.name))) fail('unsupported_element', c.loc);
  const props = child(shape, P, 'spPr'); unsupportedStyles(props, c);
  if (child(shape, P, 'style')) fail('unsupported_style', c.loc, { element: 'style' });
  let xf: X | undefined = child(props, A, 'xfrm'); for (const parent of ancestors) xf ??= path(parent, [P, 'spPr'], [A, 'xfrm']);
  if (shape.name === 'pic') {
    const fill = child(shape, P, 'blipFill'), blip = child(fill, A, 'blip');
    const id = at(blip, 'embed', R); if (!id) fail('missing_relationship', c.loc);
    const media = c.pkg.rel(c.loc.part!, id, 'image', c.loc);
    const sourceRect = child(fill, A, 'srcRect'), fillRect = path(fill, [A, 'stretch'], [A, 'fillRect']);
    if (fillRect && Object.values(fillRect.attrs).some(v => number(v) !== 0) || child(fill, A, 'tile') || blip?.children.length) fail('unsupported_image_style', c.loc);
    const [left, top, right, bottom] = ['l', 't', 'r', 'b'].map(k => number(at(sourceRect, k), 0) / 100000);
    const width = 1 - left - right, height = 1 - top - bottom;
    if (width <= 0 || height <= 0) fail('invalid_value', c.loc);
    let target = c.media.get(media);
    if (!target) {
      const bytes = c.pkg.files.get(media)!; const info = imageInfo(bytes, c);
      target = `${c.prefix}/media/image-${c.media.size + 1}.${info.ext}`; c.media.set(media, target); c.files[target] = bytes.slice();
    }
    const alt = esc(at(child(nv, P, 'cNvPr'), 'descr') ?? at(child(nv, P, 'cNvPr'), 'name') ?? '');
    if (left || top || right || bottom) return `<div style="${transform(xf, c)};overflow:hidden"><img src="${target}" alt="${alt}" style="position:absolute;left:${num(-left / width * 100)}%;top:${num(-top / height * 100)}%;width:${num(100 / width)}%;height:${num(100 / height)}%;object-fit:fill"></div>`;
    return `<img src="${target}" alt="${alt}" style="${transform(xf, c)};object-fit:fill">`;
  }
  let geom: X | undefined = child(props, A, 'prstGeom'); for (const parent of ancestors) geom ??= path(parent, [P, 'spPr'], [A, 'prstGeom']);
  const kind = at(geom, 'prst') ?? (child(shape, P, 'txBody') ? 'rect' : undefined);
  if (!kind || !['rect', 'roundRect', 'ellipse', 'line'].includes(kind) || child(geom, A, 'avLst')?.children.length) fail('unsupported_geometry', c.loc, { geometry: kind ?? '' });
  if (kind === 'roundRect') warn(c, 'geometry_approximate');
  let fill: X | undefined = child(props, A, 'solidFill'), noFill: X | undefined = child(props, A, 'noFill');
  for (const parent of ancestors) if (!fill && !noFill) { fill = path(parent, [P, 'spPr'], [A, 'solidFill']); noFill = path(parent, [P, 'spPr'], [A, 'noFill']); }
  const ln = child(props, A, 'ln'); unsupportedStyles(ln, c);
  if (ln?.children.some(x => !['solidFill', 'noFill', 'miter', 'round', 'bevel', 'prstDash'].includes(x.name)) || child(ln, A, 'prstDash') && at(child(ln, A, 'prstDash'), 'val') !== 'solid') fail('unsupported_style', c.loc, { element: 'line' });
  const hasStroke = ln && !child(ln, A, 'noFill') && (child(ln, A, 'solidFill') || at(ln, 'w') !== undefined);
  const border = hasStroke ? `;border:${num(number(at(ln, 'w'), 12700) * c.scale)}px solid ${color(child(ln, A, 'solidFill'), c, '#000000')}` : '';
  const lineColor = color(child(ln, A, 'solidFill'), c, '#000000');
  const lineWidth = number(at(ln, 'w'), 12700) * c.scale;
  const html = kind === 'line'
    ? `<svg aria-label="" style="${transform(xf, c)};overflow:visible"><line x1="0" y1="0" x2="100%" y2="100%" stroke="${lineColor}" stroke-width="${num(lineWidth)}"/></svg>`
    : `<x-shape kind="${kind === 'roundRect' ? 'rounded' : kind}" style="${transform(xf, c)};background:${fill ? color(fill, c) : 'transparent'}${border}"></x-shape>`;
  const text = textBody(shape, ancestors, c);
  return text ? `${html}<div style="${transform(xf, c)}">${text}</div>` : html;
}
function renderTable(frame: X, c: Context): string {
  const nv = child(frame, P, 'nvGraphicFramePr');
  c = { ...c, loc: { ...c.loc, object: at(child(nv, P, 'cNvPr'), 'id') } };
  if (['1', 'true'].includes(at(child(nv, P, 'cNvPr'), 'hidden') ?? '')) fail('unsupported_hidden_object', c.loc);
  if (frame.children.some(n => !(n.uri === P && ['nvGraphicFramePr', 'xfrm', 'extLst'].includes(n.name) || n.uri === A && n.name === 'graphic'))) fail('unsupported_element', c.loc);
  const data = path(frame, [A, 'graphic'], [A, 'graphicData']);
  const table = child(data, A, 'tbl');
  if (at(data, 'uri') !== 'http://schemas.openxmlformats.org/drawingml/2006/table' || !table || data?.children.length !== 1) fail('unsupported_element', c.loc, { element: 'graphicFrame' });
  const props = child(table, A, 'tblPr');
  if (props && (props.children.length || Object.keys(props.attrs).length)) fail('unsupported_style', c.loc, { element: 'tableStyle' });
  if (table.children.some(n => n.uri !== A || !['tblPr', 'tblGrid', 'tr'].includes(n.name))) fail('unsupported_element', c.loc);
  const columns = kids(child(table, A, 'tblGrid'), A, 'gridCol').map(n => number(at(n, 'w')));
  const rows = kids(table, A, 'tr');
  if (!columns.length || !rows.length || columns.some(w => w <= 0)) fail('invalid_value', c.loc);
  const xf = child(frame, P, 'xfrm'), ext = child(xf, A, 'ext');
  const width = columns.reduce((a, b) => a + b, 0), height = rows.reduce((a, b) => a + number(at(b, 'h')), 0);
  if (width !== number(at(ext, 'cx')) || height !== number(at(ext, 'cy'))) fail('unsupported_geometry', c.loc);
  let y = 0;
  const html = rows.map(row => {
    const h = number(at(row, 'h')), cells = kids(row, A, 'tc');
    if (h <= 0 || cells.length !== columns.length || row.children.some(n => n.uri !== A || n.name !== 'tc')) fail('unsupported_element', c.loc);
    let x = 0;
    const content = cells.map((cell, i) => {
      if (Object.keys(cell.attrs).length || cell.children.some(n => n.uri !== A || !['txBody', 'tcPr'].includes(n.name))) fail('unsupported_element', c.loc, { element: 'mergedCell' });
      const pr = child(cell, A, 'tcPr');
      const allowed = ['lnL', 'lnR', 'lnT', 'lnB', 'solidFill', 'noFill'];
      if (pr?.children.some(n => n.uri !== A || !allowed.includes(n.name)) || Object.keys(pr?.attrs ?? {}).some(k => !['marL', 'marR', 'marT', 'marB', 'anchor'].includes(k.slice(k.indexOf('}') + 1)))) fail('unsupported_style', c.loc, { element: 'tableCell' });
      const borders = [['lnL', 'left'], ['lnR', 'right'], ['lnT', 'top'], ['lnB', 'bottom']].map(([name, side]) => {
        const edge = child(pr, A, name);
        if (!edge || child(edge, A, 'noFill')) return `border-${side}:none`;
        unsupportedStyles({ ...edge, name: 'ln' }, c);
        if (!child(edge, A, 'solidFill') || child(edge, A, 'prstDash') && at(child(edge, A, 'prstDash'), 'val') !== 'solid') fail('unsupported_style', c.loc);
        return `border-${side}:${num(number(at(edge, 'w'), 12700) * c.scale)}px solid ${color(child(edge, A, 'solidFill'), c)}`;
      }).join(';');
      const source = child(cell, A, 'txBody');
      const bodyPr = child(source, A, 'bodyPr');
      const attrs = { ...bodyPr?.attrs };
      for (const [from, to, fallback] of [['marL', 'lIns', 91440], ['marR', 'rIns', 91440], ['marT', 'tIns', 45720], ['marB', 'bIns', 45720]] as const) attrs[key('', to)] = at(pr, from) ?? String(fallback);
      attrs[key('', 'anchor')] = at(pr, 'anchor') ?? 't';
      const body: X = { uri: P, name: 'txBody', attrs: {}, text: '', children: [{ uri: A, name: 'bodyPr', attrs, text: '', children: bodyPr?.children ?? [] }, ...(source?.children.filter(n => n !== bodyPr) ?? [])] };
      const text = textBody({ uri: P, name: 'sp', attrs: {}, text: '', children: [body] }, [], c);
      const fill = child(pr, A, 'solidFill');
      const value = `<td style="position:absolute;left:${num(x * c.scale)}px;top:0px;width:${num(columns[i] * c.scale)}px;height:${num(h * c.scale)}px;padding:0px;background:${fill ? color(fill, c) : 'transparent'};${borders}">${text}</td>`;
      x += columns[i]; return value;
    }).join('');
    const value = `<tr style="position:absolute;left:0px;top:${num(y * c.scale)}px;width:${num(width * c.scale)}px;height:${num(h * c.scale)}px">${content}</tr>`;
    y += h; return value;
  }).join('');
  return `<table style="${transform(xf, c)}">${html}</table>`;
}
function artwork(root: X | undefined, c: Context, inherited = false, layout?: X, master?: X): string {
  const tree = path(root, [P, 'cSld'], [P, 'spTree']); let out = '';
  for (const n of tree?.children ?? []) {
    if (n.uri === P && ['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(n.name)) continue;
    if (inherited && phOf(n)) continue;
    if (n.uri === P && n.name === 'graphicFrame') { out += renderTable(n, c); continue; }
    if (n.uri !== P || !['sp', 'pic', 'cxnSp'].includes(n.name)) fail('unsupported_element', c.loc, { element: n.name });
    const l = matchPlaceholder(n, layout), m = matchPlaceholder(l ?? n, master);
    out += renderShape(n, [l, m].filter((x): x is X => !!x), c);
  }
  return out;
}
function background(roots: (X | undefined)[], c: Context): string {
  for (const root of roots) {
    const bg = path(root, [P, 'cSld'], [P, 'bg']); if (!bg) continue;
    const ref = child(bg, P, 'bgRef');
    if (ref) {
      const index = number(at(ref, 'idx'));
      const styles = path(c.theme, [A, 'themeElements'], [A, 'fmtScheme'], [A, index >= 1001 ? 'bgFillStyleLst' : 'fillStyleLst']);
      const fill = styles?.children[index >= 1001 ? index - 1001 : index - 1];
      if (!Number.isInteger(index) || !fill || fill.uri !== A || fill.name !== 'solidFill') fail('unsupported_style', c.loc, { element: 'background' });
      return color(fill, { ...c, placeholderColor: color(ref, c) });
    }
    const pr = child(bg, P, 'bgPr'); if (!pr) fail('unsupported_style', c.loc, { element: 'background' });
    unsupportedStyles(pr, c); return color(child(pr, A, 'solidFill'), c, '#ffffff');
  }
  warn(c, 'background_defaulted'); return '#ffffff';
}
function notes(root: X, c: Context): string {
  const out: string[] = [];
  for (const s of walk(root, P, 'sp')) {
    if (at(phOf(s), 'type') !== 'body') continue;
    for (const p of walk(child(s, P, 'txBody'), A, 'p')) out.push(p.children.map(r => r.name === 'br' ? '\n' : walk(r, A, 't').map(x => x.text).join('')).join(''));
  }
  const value = out.join('\n'); if (value.length > 4000) fail('notes_too_long', c.loc, { length: value.length });
  return value ? `<aside>${esc(value)}</aside>` : '';
}

/** Caller id must be a collision-free import namespace (1..40 safe ASCII chars). */
export function importPptx(bytes: Uint8Array, options: PptxOptions): PptxResult {
  const diagnostics: PptxDiagnostic[] = [];
  try {
    if (!options || !/^[A-Za-z0-9_-]{1,40}$/.test(options.id) || typeof options.title !== 'string') fail('invalid_options');
    const limits = { ...PPTX_LIMITS, ...options.limits };
    for (const [k, v] of Object.entries(limits)) if (!Number.isSafeInteger(v) || v < 1 || v > PPTX_LIMITS[k as keyof PptxLimits]) fail('invalid_options');
    let files: Map<string, Uint8Array>; try { files = unzip(bytes, limits); } catch (e) { if (e instanceof ImportFailure) throw e; fail('invalid_zip'); }
    if (!files.has('[Content_Types].xml') || !files.has('_rels/.rels')) fail('invalid_package');
    const pkg = new Package(files, limits);
    const ct = pkg.get('[Content_Types].xml', CT, 'Types');
    for (const n of ct.children) if (/macroEnabled|vba|activeX|oleObject/i.test(at(n, 'ContentType') ?? '')) fail('forbidden_package', { part: '[Content_Types].xml' });
    const presentation = pkg.ofType('', 'officeDocument'); if (!presentation) fail('invalid_package');
    if (!ct.children.some(n => n.uri === CT && n.name === 'Override' && at(n, 'PartName') === `/${presentation}` && at(n, 'ContentType') === MIME)) fail('invalid_package');
    const root = pkg.get(presentation, P, 'presentation');
    const size = child(root, P, 'sldSz'), width = number(at(size, 'cx')), height = number(at(size, 'cy'));
    if (width <= 0 || height <= 0) fail('invalid_value', { part: presentation });
    const scale = Math.min(1920 / width, 1080 / height), dx = (1920 - width * scale) / 2, dy = (1080 - height * scale) / 2;
    if (dx || dy) diagnostics.push({ level: 'warning', code: 'page_contained', part: presentation, params: { width, height } });
    const ids = kids(child(root, P, 'sldIdLst'), P, 'sldId'); budget(ids.length, limits.slides, 'slides'); if (!ids.length) fail('invalid_package');
    const prefix = `uploads/${options.id}`, output: Record<string, Uint8Array> = {}, media = new Map<string, string>();
    const report: PptxReport = { v: 1, path: `${prefix}/report.json`, source: `${prefix}/source.pptx`, width, height, slides: [], diagnostics };
    const used = new Set<string>();
    for (let i = 0; i < ids.length; i++) {
      const part = pkg.rel(presentation, at(ids[i], 'id', R) ?? '', 'slide');
      if (used.has(part)) fail('invalid_package', { part }); used.add(part);
      const id = `${options.id}-${i + 1}`, sld = pkg.get(part, P, 'sld');
      const layoutPart = pkg.ofType(part, 'slideLayout'), layout = layoutPart ? pkg.get(layoutPart, P, 'sldLayout') : undefined;
      const masterPart = layoutPart ? pkg.ofType(layoutPart, 'slideMaster') : undefined, master = masterPart ? pkg.get(masterPart, P, 'sldMaster') : undefined;
      const themePart = (masterPart ? pkg.ofType(masterPart, 'theme') : undefined) ?? pkg.ofType(presentation, 'theme');
      const theme = themePart ? pkg.get(themePart, A, 'theme') : undefined;
      const colorMap: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
      const clrMap = child(master, P, 'clrMap'); for (const [key, value] of Object.entries(clrMap?.attrs ?? {})) colorMap[key.slice(key.indexOf('}') + 1)] = value;
      for (const r of [layout, sld]) { const map = path(r, [P, 'clrMapOvr'], [A, 'overrideClrMapping']); for (const [k, v] of Object.entries(map?.attrs ?? {})) colorMap[k.slice(k.indexOf('}') + 1)] = v; }
      const c: Context = { pkg, defaults: child(root, P, 'defaultTextStyle'), master, diagnostics, loc: { part, slide: id }, scale, dx, dy, theme, colorMap, media, files: output, prefix };
      for (const r of [sld, layout, master]) {
        if (r?.children.some(x => x.uri !== P || !['cSld', 'clrMap', 'clrMapOvr', 'txStyles', 'hf', 'sldLayoutIdLst', 'extLst'].includes(x.name))) fail('unsupported_element', c.loc);
        const common = child(r, P, 'cSld');
        if (common?.children.some(x => x.uri !== P || !['bg', 'spTree', 'extLst'].includes(x.name))) fail('unsupported_element', c.loc);
      }
      let html = `<section id="${id}"${at(sld, 'show') === '0' || at(sld, 'show') === 'false' ? ' hidden' : ''} style="background:${background([sld, layout, master], c)};color:#000000;font-family:Arial">`;
      if (at(sld, 'showMasterSp') !== '0' && at(sld, 'showMasterSp') !== 'false') {
        if (master) html += artwork(master, { ...c, loc: { ...c.loc, part: masterPart } }, true);
        if (layout) html += artwork(layout, { ...c, loc: { ...c.loc, part: layoutPart } }, true);
      }
      html += artwork(sld, c, false, layout, master);
      const notesPart = pkg.ofType(part, 'notesSlide'); if (notesPart) html += notes(pkg.get(notesPart, P, 'notes'), { ...c, loc: { ...c.loc, part: notesPart } });
      html += '</section>\n';
      const issues = checkSlide(parseDc(html), id); if (issues.some(x => x.level === 'error')) fail('generated_slide_invalid', c.loc, { errors: issues.filter(x => x.level === 'error').length });
      output[`slides/${id}.html`] = encode(html); report.slides.push({ id, part });
    }
    output['deck.json'] = encode(stringifyDeck({ v: 4, title: options.title, order: report.slides.map(s => s.id), cover: report.slides[0].id, sections: {}, faces: {}, designSystems: [], pptxImport: report.path }));
    output[report.source] = bytes.slice(); output[report.path] = encode(JSON.stringify(report, null, 2) + '\n');
    return { ok: true, files: output, report, diagnostics };
  } catch (e) {
    return { ok: false, diagnostics: [...diagnostics, e instanceof ImportFailure ? e.diagnostic : { level: 'error', code: 'invalid_package' }] };
  }
}
