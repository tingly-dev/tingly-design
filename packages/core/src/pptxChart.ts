import { type X, at, child, kids, path, walk } from './pptxXml';

/**
 * A chart redrawn from the values the file saved with it, as one SVG drawing: a picture of the
 * chart, not live data. Classic charts (`c:chartSpace`): bars and columns, lines, areas, pies,
 * doughnuts, bar or pie of pie, scatter, bubbles, radar, stock and surface, 3-D ones flat,
 * combined on primary and secondary axes; with titles, axes and their titles, gridlines, number
 * formats, legends, data labels, markers, trendlines and error bars, in the colours and sizes
 * the chart sets. Office 2016 charts (`cx:chartSpace`): waterfall, funnel, histogram, Pareto,
 * box and whisker, treemap and sunburst.
 */
export interface ChartEnv {
  /** A colour element, or an element holding one, as CSS; scheme colours through the slide's theme. */
  color(n: X | undefined): string | undefined;
  /** A fill element as CSS (gradients with their stops); null for no fill. */
  paint(fill: X | undefined): { css: string; stops?: [number, string][]; angle?: number; radial?: boolean } | null;
  /** A typeface as written (`+mn-lt` names the theme's), or undefined when it cannot be used. */
  face(typeface: string | undefined): string | undefined;
  /** Pixels per EMU. */
  scale: number;
  /** A prefix that keeps this drawing's gradient ids apart from other drawings on the slide. */
  id: string;
  warn(code: string, params?: Record<string, string | number>): void;
}
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
const CS = 'http://schemas.microsoft.com/office/drawing/2012/chartStyle';
/** Points read from one series: more cannot be drawn legibly in a slide-sized chart. */
export const CHART_POINTS = 1000;
const num = (n: number) => String(Math.round(n * 100) / 100);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const val = (n: X | undefined, name: string, uri = C) => at(child(n, uri, name), 'val');
const flag = (n: X | undefined, name: string, fallback = false, uri = C) => { const v = val(n, name, uri); return v === undefined ? child(n, uri, name) ? true : fallback : v === '1' || v === 'true'; };
const finite = (v: string | undefined, fallback: number) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback; };
/** A rough text width: wide scripts take a full em, the rest a little over half. */
const width = (s: string, size: number) => [...s].reduce((w, ch) => w + (/[\u1100-\uffff]/.test(ch) ? 1 : /[il.,:;'|!]/.test(ch) ? 0.3 : /[mwMW@]/.test(ch) ? 0.85 : 0.56), 0) * size;

// ---- number formats ---------------------------------------------------------------------------
/** The Excel number format a chart saved with its values, applied to one value. */
export function formatValue(v: number, code = 'General', date1904 = false): string {
  if (!Number.isFinite(v)) return '';
  const sections: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') quoted = !quoted;
    if (ch === '\\' && !quoted) { cur += ch + (code[i + 1] ?? ''); i++; continue; }
    if (ch === ';' && !quoted) { sections.push(cur); cur = ''; continue; }
    cur += ch;
  }
  sections.push(cur);
  let section = sections[0], value = v;
  if (v < 0 && sections.length > 1 && sections[1] !== '') { section = sections[1]; value = -v; }
  else if (v === 0 && sections.length > 2 && sections[2] !== '') section = sections[2];
  // colours, conditions and locales say nothing about the text; a currency's symbol is kept
  section = section.replace(/\[\$([^-\]]*)(-[^\]]*)?\]/g, (_, s: string) => s ? `"${s}"` : '').replace(/\[[^\]]*\]/g, '');
  if (!section.trim() || /^general$/i.test(section.trim())) return general(value) ;
  const bare = section.replace(/"[^"]*"|\\./g, '');
  if (/[ymdhs]/i.test(bare) && !/[0#?]/.test(bare)) return formatDate(value, section, date1904);
  if (/^@$/.test(bare.trim())) return general(value);
  const percent = (bare.match(/%/g) ?? []).length;
  let x = value * 100 ** percent;
  const sci = /E[+-]/i.exec(bare);
  const numPart = /[0#?][0#?,.]*|\.[0#?]+/.exec(bare)?.[0] ?? '';
  let out: string;
  if (sci) {
    const mantissa = bare.slice(0, sci.index), decimals = (mantissa.split('.')[1] ?? '').replace(/[^0#?]/g, '').length;
    const exp = x === 0 ? 0 : Math.floor(Math.log10(Math.abs(x)));
    out = `${(x / 10 ** exp).toFixed(decimals)}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart((bare.slice(sci.index + 2).match(/0/g) ?? []).length || 2, '0')}`;
  } else {
    const trailing = /,+$/.exec(numPart.replace(/\.[0#?]*$/, ''))?.[0].length ?? 0;
    x /= 1000 ** trailing;
    const [intPart, fracPart = ''] = numPart.replace(/,+$/, '').split('.');
    const decimals = fracPart.replace(/[^0#?]/g, '').length, required = (fracPart.match(/0/g) ?? []).length;
    let s = Math.abs(x).toFixed(decimals);
    if (required < decimals) s = s.replace(new RegExp(`0{0,${decimals - required}}$`), '').replace(/\.$/, '');
    let [i, f] = s.split('.');
    const minInt = (intPart.match(/0/g) ?? []).length;
    if (i === '0' && minInt === 0) i = '';
    i = i.padStart(minInt, '0');
    if (intPart.includes(',')) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    out = (x < 0 && !(v < 0 && section !== sections[0]) ? '-' : '') + i + (f ? '.' + f : '');
  }
  // the literal text around the number
  const at0 = section.search(/[0#?.]/), at1 = (() => { let j = -1; for (let i = section.length - 1; i >= 0; i--) if (/[0#?,.E+\-]/i.test(section[i]) && !/[" ]/.test(section[i])) { j = i; break; } return j; })();
  const literal = (s: string) => s.replace(/"([^"]*)"|\\(.)|_.|\*.|([^"\\])/g, (_, q?: string, e?: string, c?: string) => q ?? e ?? (c === '%' ? '%' : c && /[$€£¥ ()\-+/:^'{}<>=!&~%A-Za-z]/.test(c) ? c : _?.startsWith('_') ? ' ' : ''));
  return at0 < 0 ? literal(section) : literal(section.slice(0, at0)) + out + literal(section.slice(at1 + 1));
}
function general(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e11 || a < 1e-9) return v.toExponential(5).replace(/\.?0+e/, 'E').replace('E+', 'E+').replace(/E(-?)(\d)$/, 'E$10$2').replace(/E(\d)/, 'E+$1');
  return String(Number(v.toPrecision(10)));
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function formatDate(serial: number, code: string, date1904: boolean): string {
  // serial days since 1899-12-30 (Excel's 1900 leap-year bug folded in), or since 1904-01-01
  const ms = Math.round(((date1904 ? serial + 1462 : serial) - 25569) * 86400000);
  const d = new Date(ms);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), h = d.getUTCHours(), m = d.getUTCMinutes(), s = d.getUTCSeconds();
  const ampm = /AM\/PM|A\/P/i.test(code);
  let out = '', i = 0, lastWasHour = false;
  while (i < code.length) {
    const rest = code.slice(i), ch = code[i];
    if (ch === '"') { const j = code.indexOf('"', i + 1); out += code.slice(i + 1, j < 0 ? undefined : j); i = j < 0 ? code.length : j + 1; continue; }
    if (ch === '\\') { out += code[i + 1] ?? ''; i += 2; continue; }
    const run = /^(y+|m+|d+|h+|s+|AM\/PM|A\/P)/i.exec(rest)?.[0];
    if (!run) { if (ch !== '_' && ch !== '*') out += ch; i += ch === '_' || ch === '*' ? 2 : 1; continue; }
    const k = run[0].toLowerCase(), n = run.length;
    if (k === 'y') out += n <= 2 ? String(Y % 100).padStart(2, '0') : String(Y);
    else if (k === 'm' && (lastWasHour || /^m+:?s/i.test(rest.replace(/^m+/, (x) => x + (rest[n] === ':' ? '' : ''))) && /^[:]?s/i.test(rest.slice(n).replace(/^:/, ':')) && rest[n] === ':')) out += String(m).padStart(n >= 2 ? 2 : 1, '0');
    else if (k === 'm') out += n === 1 ? String(M + 1) : n === 2 ? String(M + 1).padStart(2, '0') : n === 3 ? MONTHS[M].slice(0, 3) : n === 5 ? MONTHS[M][0] : MONTHS[M];
    else if (k === 'd') out += n === 1 ? String(D) : n === 2 ? String(D).padStart(2, '0') : n === 3 ? DAYS[d.getUTCDay()].slice(0, 3) : DAYS[d.getUTCDay()];
    else if (k === 'h') { const hh = ampm ? (h % 12 || 12) : h; out += n >= 2 ? String(hh).padStart(2, '0') : String(hh); }
    else if (k === 's') out += String(s).padStart(n >= 2 ? 2 : 1, '0');
    else out += run.length > 3 ? (h < 12 ? 'AM' : 'PM') : (h < 12 ? 'A' : 'P');
    lastWasHour = k === 'h';
    i += n;
  }
  return out;
}

// ---- the drawing ----------------------------------------------------------------------------
interface Font { size: number; color: string; bold: boolean; italic: boolean; face: string }
interface Line { color: string; width: number; dash?: string }
/** One SVG drawing being built, with what every part of a chart shares. */
class Drawing {
  out: string[] = []; defs: string[] = []; private grads = 0;
  constructor(readonly env: ChartEnv, readonly base: Font) {}
  /** Text properties from `c:txPr` / `c:rich` (or `cx:txPr`) over a base. */
  font(n: X | undefined, base: Font = this.base, scale = 1): Font {
    const def = walk(n, A, 'defRPr')[0], run = walk(n, A, 'rPr')[0];
    let f = { ...base, size: base.size * scale };
    for (const r of [def, run]) {
      if (!r) continue;
      const sz = at(r, 'sz');
      const fill = child(r, A, 'solidFill') ?? child(r, A, 'gradFill');
      f = {
        size: sz !== undefined && Number(sz) > 0 ? Number(sz) * 127 * this.env.scale : f.size,
        color: fill ? this.env.paint(fill)?.stops?.[0][1] ?? this.env.paint(fill)?.css ?? f.color : f.color,
        bold: at(r, 'b') !== undefined ? at(r, 'b') === '1' || at(r, 'b') === 'true' : f.bold,
        italic: at(r, 'i') !== undefined ? at(r, 'i') === '1' || at(r, 'i') === 'true' : f.italic,
        face: this.env.face(at(child(r, A, 'latin'), 'typeface')) ?? f.face,
      };
    }
    return f;
  }
  text(x: number, y: number, s: string, f: Font, anchor: 'start' | 'middle' | 'end' = 'middle', rotate = 0, baseline: 'top' | 'middle' | 'bottom' | 'alphabetic' = 'middle') {
    if (!s) return;
    const dy = baseline === 'middle' ? f.size * 0.35 : baseline === 'top' ? f.size * 0.8 : baseline === 'bottom' ? -f.size * 0.25 : 0;
    const lines = s.split('\n');
    const tx = (line: string, k: number) => `<text x="${num(x)}" y="${num(y + dy + (k - (lines.length - 1) / 2) * f.size * 1.2)}" font-size="${num(f.size)}" font-family="${esc(f.face)}" fill="${f.color}" text-anchor="${anchor}"${f.bold ? ' font-weight="700"' : ''}${f.italic ? ' font-style="italic"' : ''}${rotate ? ` transform="rotate(${num(rotate)} ${num(x)} ${num(y)})"` : ''}>${esc(line)}</text>`;
    this.out.push(lines.map(tx).join(''));
  }
  /** A fill from `c:spPr` as an SVG paint, or undefined when it says nothing; `none` for no fill. */
  fill(spPr: X | undefined): string | undefined {
    const f = spPr?.children.find(x => x.uri === A && ['noFill', 'solidFill', 'gradFill', 'pattFill', 'blipFill'].includes(x.name));
    if (!f) return undefined;
    if (f.name === 'noFill') return 'none';
    if (f.name === 'solidFill' && !f.children.length) return undefined;
    const p = this.env.paint(f);
    if (!p) return 'none';
    if (!p.stops) return p.css === 'transparent' ? 'none' : p.css;
    if (f.name === 'pattFill') return p.stops[0][1];
    const id = `${this.env.id}g${this.grads++}`, a = ((p.angle ?? 0) * Math.PI) / 180;
    const stops = p.stops.map(([o, c]) => `<stop offset="${num(o)}" stop-color="${c}"/>`).join('');
    this.defs.push(p.radial ? `<radialGradient id="${id}">${stops}</radialGradient>`
      : `<linearGradient id="${id}" x1="${num(0.5 - Math.cos(a) / 2)}" y1="${num(0.5 - Math.sin(a) / 2)}" x2="${num(0.5 + Math.cos(a) / 2)}" y2="${num(0.5 + Math.sin(a) / 2)}">${stops}</linearGradient>`);
    return `url(#${id})`;
  }
  /** A line from `c:spPr/a:ln`: undefined when it says nothing, null for no line. */
  line(spPr: X | undefined, base?: Line): Line | null | undefined {
    const ln = child(spPr, A, 'ln');
    if (!ln) return base;
    const f = ln.children.find(x => x.uri === A && ['noFill', 'solidFill', 'gradFill', 'pattFill'].includes(x.name));
    if (f?.name === 'noFill') return null;
    const p = f && !(f.name === 'solidFill' && !f.children.length) ? this.env.paint(f) : null;
    const w = at(ln, 'w') !== undefined ? Math.max(0.5, Number(at(ln, 'w')) * this.env.scale) : base?.width ?? 1;
    const dash = at(child(ln, A, 'prstDash'), 'val');
    const dashes: Record<string, number[]> = { dash: [4, 3], dashDot: [4, 3, 1, 3], lgDash: [8, 3], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDash: [3, 1], sysDot: [1, 1], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1], dot: [1, 3] };
    return { color: p?.stops ? p.stops[0][1] : p?.css ?? base?.color ?? '#000000', width: w, dash: dash && dashes[dash] ? dashes[dash].map(d => num(d * w)).join(' ') : base?.dash };
  }
  stroke(l: Line | null | undefined) { return l ? ` stroke="${l.color}" stroke-width="${num(l.width)}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ''}` : ' stroke="none"'; }
  svg(w: number, h: number, label: string, css: string) {
    return `<svg aria-label="${esc(label)}" viewBox="0 0 ${num(w)} ${num(h)}" style="${css};overflow:visible">${this.defs.length ? `<defs>${this.defs.join('')}</defs>` : ''}${this.out.join('')}</svg>`;
  }
}

// colours a series takes when it sets none: the chart's colour style, or Office's defaults
const VARIATIONS: [number, number][] = [[100000, 0], [60000, 0], [80000, 20000], [80000, 0], [60000, 40000], [50000, 0], [70000, 30000], [70000, 0], [50000, 50000]];
const scheme = (name: string, mods: [string, number][] = []): X => ({ uri: A, name: 'schemeClr', attrs: { '{}val': name }, text: '', children: mods.map(([n, v]) => ({ uri: A, name: n, attrs: { '{}val': String(v) }, text: '', children: [] })) });
// lines Office draws when the file sets none
const GRID = '#b3b3b3', AXIS = '#868686';
const FALLBACK = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'];
function palette(env: ChartEnv, style: X | undefined, colors: X | undefined) {
  const cycle = colors ? colors.children.filter(n => n.uri === A && /Clr$/.test(n.name)) : [];
  const variations = colors ? kids(colors, CS, 'variation') : [];
  const meth = at(colors, 'meth') ?? 'cycle';
  const n = Number(val(style, 'style') ?? 2), family = ((n - 1) % 8 + 8) % 8;
  return (i: number, count: number): string => {
    if (cycle.length && meth === 'cycle') {
      const base = cycle[i % cycle.length], v = variations[Math.floor(i / cycle.length) % Math.max(1, variations.length)];
      return env.color({ ...base, children: [...base.children, ...(v?.children ?? [])] }) ?? FALLBACK[i % 6];
    }
    // one colour from dark to light across the series
    if (cycle.length || family !== 1) {
      const base = cycle[0] ?? scheme(family === 0 ? 'tx1' : `accent${family - 1}`);
      const t = count <= 1 ? 0.5 : i / (count - 1);
      const mods: [string, number][] = t < 0.5 ? [['shade', Math.round((0.5 + t) * 100000)]] : [['tint', Math.round((1.5 - t) * 100000)]];
      if (family === 0 && !cycle.length) return env.color(scheme('tx1', [['lumMod', 50000], ['lumOff', Math.round(t * 45000)]])) ?? '#808080';
      return env.color({ ...base, children: [...base.children, ...mods.map(([k, v]) => ({ uri: A, name: k, attrs: { '{}val': String(v) }, text: '', children: [] }))] }) ?? FALLBACK[0];
    }
    const [mod, off] = VARIATIONS[Math.floor(i / 6) % VARIATIONS.length];
    return env.color(scheme(`accent${i % 6 + 1}`, [...(mod !== 100000 ? [['lumMod', mod] as [string, number]] : []), ...(off ? [['lumOff', off] as [string, number]] : [])])) ?? FALLBACK[i % 6];
  };
}

// ---- classic charts ---------------------------------------------------------------------------
interface Cache { values: (string | undefined)[]; format?: string; count: number }
function cache(n: X | undefined): Cache {
  const src = n && (child(n, C, 'numRef') ?? child(n, C, 'strRef') ?? child(n, C, 'numLit') ?? child(n, C, 'strLit') ?? child(n, C, 'multiLvlStrRef'));
  if (!src) return { values: [], count: 0 };
  const store = child(src, C, 'numCache') ?? child(src, C, 'strCache') ?? child(src, C, 'multiLvlStrCache') ?? src;
  // several levels: the first is the one next to the axis
  const level = child(store, C, 'lvl') ?? store;
  const values: (string | undefined)[] = [];
  for (const p of kids(level, C, 'pt')) { const i = Math.round(Number(at(p, 'idx'))); if (i >= 0 && i < CHART_POINTS) values[i] = child(p, C, 'v')?.text ?? ''; }
  const count = Math.min(CHART_POINTS, Math.round(finite(val(store, 'ptCount'), values.length)));
  return { values, format: child(store, C, 'formatCode')?.text, count: Math.max(count, values.length) };
}
const numbers = (c: Cache) => Array.from({ length: c.count }, (_, i) => { const v = c.values[i]; const n = v === undefined || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : null; });
interface Series {
  node: X; group: X; type: string; index: number; order: number; name: string;
  cats: string[]; catNums: (number | null)[]; catFormat?: string; vals: (number | null)[]; valFormat?: string; xs?: (number | null)[]; sizes?: (number | null)[];
  fill: string; line: Line | null; marker?: { symbol: string; size: number; fill: string; line: Line | null };
  secondary: boolean;
}
interface Axis { node: X; id: string; kind: string; pos: string; deleted: boolean; min: number; max: number; log?: number; reverse: boolean; ticks: number[]; format: string; pct?: boolean }
type Rect = { x: number; y: number; w: number; h: number };
const BAR = ['barChart', 'bar3DChart'], LINE = ['lineChart', 'line3DChart', 'stockChart'], AREA = ['areaChart', 'area3DChart'], PIE = ['pieChart', 'pie3DChart', 'doughnutChart', 'ofPieChart'];
const XY = ['scatterChart', 'bubbleChart'], SURFACE = ['surfaceChart', 'surface3DChart'];
const KINDS = [...BAR, ...LINE, ...AREA, ...PIE, ...XY, 'radarChart', ...SURFACE];
/** The smallest round step (1, 2 or 5 times a power of ten) that crosses `span` in at most `most` intervals. */
function niceStep(span: number, most = 10) {
  const s = Math.abs(span) || 1;
  let p = 10 ** Math.floor(Math.log10(s / most));
  for (let k = 0; k < 40; k++, p *= 10) for (const m of [1, 2, 5]) if (s / (m * p) <= most + 1e-9) return m * p;
  return s;
}
/** Office's automatic scale: from zero (or below the lowest value) to a twentieth of room above the highest, in the smallest round step that keeps to `most` intervals. */
export function autoScale(lo: number, hi: number, most = 10, unit?: number): { min: number; max: number; step: number } {
  const room = (hi - lo || Math.abs(hi) || 1) / 20;
  const bounds = (step: number) => {
    const min = lo >= 0 ? 0 : Math.floor((lo - room) / step) * step;
    const max = hi <= 0 ? (lo >= 0 ? step : 0) : Math.ceil((hi + room) / step - 1e-9) * step;
    return { min, max, step };
  };
  if (unit && unit > 0) return bounds(unit);
  let step = niceStep(hi - lo, most);
  for (let k = 0; k < 6; k++) {
    const b = bounds(step);
    if ((b.max - b.min) / step <= most + 1e-9) return b;
    step = niceStep(step * most * 1.0001, most);
  }
  return bounds(step);
}
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 3) return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x)} ${num(y)}`).join('');
  let d = `M${num(pts[0][0])} ${num(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    d += `C${num(p1[0] + (p2[0] - p0[0]) / 6)} ${num(p1[1] + (p2[1] - p0[1]) / 6)} ${num(p2[0] - (p3[0] - p1[0]) / 6)} ${num(p2[1] - (p3[1] - p1[1]) / 6)} ${num(p2[0])} ${num(p2[1])}`;
  }
  return d;
}
function marker(d: Drawing, x: number, y: number, m: NonNullable<Series['marker']>) {
  const r = m.size / 2, s = d.stroke(m.line), f = `fill="${m.fill}"`;
  const at = (dx: number, dy: number) => `${num(x + dx)} ${num(y + dy)}`;
  switch (m.symbol) {
    case 'none': return;
    case 'square': d.out.push(`<rect x="${num(x - r)}" y="${num(y - r)}" width="${num(2 * r)}" height="${num(2 * r)}" ${f}${s}/>`); return;
    case 'diamond': d.out.push(`<path d="M${at(0, -r)}L${at(r, 0)}L${at(0, r)}L${at(-r, 0)}Z" ${f}${s}/>`); return;
    case 'triangle': d.out.push(`<path d="M${at(0, -r)}L${at(r, r)}L${at(-r, r)}Z" ${f}${s}/>`); return;
    case 'x': d.out.push(`<path d="M${at(-r, -r)}L${at(r, r)}M${at(r, -r)}L${at(-r, r)}" fill="none"${d.stroke(m.line ?? { color: m.fill, width: 1 })}/>`); return;
    case 'plus': d.out.push(`<path d="M${at(0, -r)}L${at(0, r)}M${at(-r, 0)}L${at(r, 0)}" fill="none"${d.stroke(m.line ?? { color: m.fill, width: 1 })}/>`); return;
    case 'star': d.out.push(`<path d="M${at(-r, -r)}L${at(r, r)}M${at(r, -r)}L${at(-r, r)}M${at(0, -r)}L${at(0, r)}" fill="none"${d.stroke(m.line ?? { color: m.fill, width: 1 })}/>`); return;
    case 'dash': d.out.push(`<rect x="${num(x - r)}" y="${num(y - r / 4)}" width="${num(2 * r)}" height="${num(r / 2)}" ${f}${s}/>`); return;
    case 'dot': d.out.push(`<rect x="${num(x - r / 4)}" y="${num(y - r / 4)}" width="${num(r / 2)}" height="${num(r / 2)}" ${f}${s}/>`); return;
    default: d.out.push(`<circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}" ${f}${s}/>`);
  }
}
const AUTO_MARKERS = ['diamond', 'square', 'triangle', 'x', 'star', 'circle', 'plus', 'dot', 'dash'];

/** The drawing of a classic chart part, sized `w` × `h` px, or undefined when it holds no chart this draws. */
export function drawChart(space: X, w: number, h: number, css: string, env: ChartEnv, colors?: X): { svg: string; title: string } | undefined {
  const chart = child(space, C, 'chart'), plot = child(chart, C, 'plotArea');
  const groups = plot?.children.filter(n => n.uri === C && KINDS.includes(n.name)) ?? [];
  if (!groups.length) return undefined;
  if (plot!.children.some(n => n.uri === C && /Chart$/.test(n.name) && !KINDS.includes(n.name))) env.warn('style_approximate', { chart: 'type' });
  if (groups.some(g => /3D/.test(g.name))) env.warn('style_approximate', { chart: '3d' });
  const date1904 = flag(space, 'date1904');
  const face = env.face('+mn-lt') ?? 'Arial';
  // with no text properties, Office draws chart text in the theme's text colour; titles bold and larger
  const d = new Drawing(env, { size: 10 * 12700 * env.scale, color: env.color(scheme('tx1')) ?? '#000000', bold: false, italic: false, face });
  const base = d.font(child(space, C, 'txPr'));
  (d as { base: Font }).base = base;
  const color = palette(env, child(space, C, 'style'), colors);
  // the chart's own box, then its plot area
  const spaceFill = d.fill(child(space, C, 'spPr')), spaceLine = d.line(child(space, C, 'spPr'));
  const rounded = flag(space, 'roundedCorners', false);
  if (spaceFill && spaceFill !== 'none' || spaceLine) d.out.push(`<rect x="0" y="0" width="${num(w)}" height="${num(h)}"${rounded ? ` rx="${num(Math.min(w, h) * 0.04)}"` : ''} fill="${spaceFill ?? 'none'}"${d.stroke(spaceLine)}/>`);
  const pad = base.size * 0.7;
  let box: Rect = { x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad };

  // series, in the order the chart plots them
  const all: Series[] = [];
  for (const g of groups) {
    const varyColors = flag(g, 'varyColors', false);
    for (const ser of kids(g, C, 'ser')) {
      const index = Math.round(finite(val(ser, 'idx'), all.length)), order = Math.round(finite(val(ser, 'order'), index));
      const tx = child(ser, C, 'tx');
      const name = tx ? cache(tx).values[0] ?? child(tx, C, 'v')?.text ?? '' : `Series ${index + 1}`;
      const catNode = child(ser, C, 'cat') ?? child(ser, C, 'xVal');
      const cat = cache(catNode), value = cache(child(ser, C, 'val') ?? child(ser, C, 'yVal'));
      const spPr = child(ser, C, 'spPr');
      const auto = color(index, kids(g, C, 'ser').length > 1 || !varyColors ? Math.max(...groups.flatMap(x => kids(x, C, 'ser')).map(s => finite(val(s, 'idx'), 0))) + 1 : 1);
      const ownFill = d.fill(spPr);
      const isLine = LINE.includes(g.name) || g.name === 'scatterChart' || g.name === 'radarChart' && val(g, 'radarStyle') !== 'filled';
      const lineBase: Line = { color: auto, width: (isLine ? 2.25 : 0.75) * 12700 * env.scale };
      let line = d.line(spPr, isLine ? lineBase : undefined);
      if (isLine && line === undefined) line = lineBase;
      if (g.name === 'scatterChart' && /^(marker|none)$/.test(val(g, 'scatterStyle') ?? '') && !child(child(spPr, A, 'ln'), A, 'solidFill')) line = val(g, 'scatterStyle') === 'marker' ? null : line;
      const m = child(ser, C, 'marker');
      const groupMarker = g.name === 'lineChart' ? flag(g, 'marker', false) : g.name === 'scatterChart' ? /marker|lineMarker|smoothMarker/i.test(val(g, 'scatterStyle') ?? 'lineMarker') : g.name === 'radarChart' ? val(g, 'radarStyle') === 'marker' : g.name === 'stockChart';
      let symbol = val(m, 'symbol') ?? (groupMarker ? (g.name === 'stockChart' ? 'none' : AUTO_MARKERS[index % AUTO_MARKERS.length]) : 'none');
      if (symbol === 'auto') symbol = AUTO_MARKERS[index % AUTO_MARKERS.length];
      const mFill = d.fill(child(m, C, 'spPr'));
      all.push({
        node: ser, group: g, type: g.name, index, order, name,
        cats: Array.from({ length: cat.count }, (_, i) => { const v = cat.values[i] ?? ''; const n = Number(v); return cat.format && v !== '' && Number.isFinite(n) ? formatValue(n, cat.format, date1904) : v; }),
        catNums: numbers(cat), catFormat: cat.format,
        vals: numbers(value), valFormat: value.format,
        xs: XY.includes(g.name) ? (child(ser, C, 'xVal') ? numbers(cat) : undefined) : undefined,
        sizes: g.name === 'bubbleChart' ? numbers(cache(child(ser, C, 'bubbleSize'))) : undefined,
        fill: ownFill ?? (isLine && line ? line.color : auto),
        line: isLine ? line ?? null : d.line(spPr) ?? null,
        marker: symbol === 'none' ? undefined : { symbol, size: finite(val(m, 'size'), 5) * 12700 * env.scale * 1.4, fill: mFill && mFill !== 'none' ? mFill : mFill === 'none' ? 'none' : auto, line: d.line(child(m, C, 'spPr'), { color: auto, width: 0.75 * 12700 * env.scale }) ?? null },
        secondary: false,
      });
    }
  }
  if (!all.length) return undefined;
  all.sort((a, b) => a.order - b.order);
  const pie = PIE.includes(groups[0].name);
  const pointColor = (s: Series, i: number, count: number) => {
    const dPt = kids(s.node, C, 'dPt').find(p => Number(val(p, 'idx')) === i);
    const own = d.fill(child(dPt, C, 'spPr'));
    if (own) return own;
    // pies vary by point in every series (a doughnut's rings repeat the colours); other kinds only with one series
    const vary = flag(s.group, 'varyColors', PIE.includes(s.type)) && !d.fill(child(s.node, C, 'spPr'));
    return vary && (PIE.includes(s.type) || all.filter(x => x.group === s.group).length === 1) ? color(i, count) : s.fill;
  };

  const surfaceList = all.filter(s => SURFACE.includes(s.type));
  const bands = surfaceList.length ? surfaceBands(d, surfaceList, plot!, color, date1904) : undefined;

  // title
  const titleNode = child(chart, C, 'title');
  const autoDeleted = flag(chart, 'autoTitleDeleted', false);
  const titleText = titleNode ? richText(child(titleNode, C, 'tx')) || (all.length === 1 ? all[0].name : 'Chart Title') : !autoDeleted && all.length === 1 ? all[0].name : '';
  if (titleText) {
    const f = d.font(child(titleNode, C, 'txPr') ?? path(titleNode, [C, 'tx'], [C, 'rich']), { ...base, size: base.size * 1.3, bold: true });
    const lines = titleText.split('\n').length;
    d.text(w / 2, box.y + f.size * 0.6 * lines, titleText, f, 'middle');
    if (!flag(titleNode, 'overlay', false)) { box = { ...box, y: box.y + f.size * 1.3 * lines + pad / 2, h: box.h - f.size * 1.3 * lines - pad / 2 }; }
  }

  const horizontalBars = groups.some(g => BAR.includes(g.name) && val(g, 'barDir') === 'bar');
  // legend
  const legend = child(chart, C, 'legend');
  if (legend) {
    const hidden = new Set(kids(legend, C, 'legendEntry').filter(e => flag(e, 'delete', false)).map(e => Number(val(e, 'idx'))));
    const single = pie && flag(groups[0], 'varyColors', true) && !d.fill(child(all[0].node, C, 'spPr')) || all.length === 1 && flag(all[0].group, 'varyColors', false);
    // trendlines follow the series, named as Office names them
    const TREND: Record<string, string> = { linear: 'Linear', exp: 'Expon.', log: 'Log.', poly: 'Poly.', power: 'Power', movingAvg: 'Mov. Avg.' };
    const trendEntries = all.flatMap(s => kids(s.node, C, 'trendline').map(t => ({ t: child(t, C, 'name')?.text || `${val(t, 'trendlineType') === 'movingAvg' ? `${val(t, 'period') ?? 2} per. ` : ''}${TREND[val(t, 'trendlineType') ?? 'linear'] ?? 'Linear'} (${s.name})`, fill: d.line(child(t, C, 'spPr'))?.color ?? (s.fill.startsWith('url(') ? '#595959' : s.fill), line: true, marker: undefined as Series['marker'] })));
    const entries = (bands ? bands.ticks.slice(1).map((_, k) => ({ t: bands.label(k), fill: bands.fill(k), line: false, marker: undefined as Series['marker'] })) : single ? all[0].cats.map((t, i) => ({ t, fill: pointColor(all[0], i, all[0].cats.length), line: false, marker: undefined as Series['marker'] })) : all.map(s => ({ t: s.name, fill: s.type === 'scatterChart' && s.marker && !s.line ? s.marker.fill : s.fill, line: (LINE.includes(s.type) || s.type === 'scatterChart' || s.type === 'radarChart') && !!s.line, marker: s.marker })).concat(trendEntries)).filter((_, i) => !hidden.has(i));
    const f = d.font(child(legend, C, 'txPr'));
    const pos = val(legend, 'legendPos') ?? 'r', overlay = flag(legend, 'overlay', false);
    // a side legend lists stacked columns and areas top down, as they pile up
    if (!single && !bands && /^(r|l|tr)$/.test(pos) && !horizontalBars && all.every(s => (BAR.includes(s.type) || AREA.includes(s.type)) && /stacked/i.test(val(s.group, 'grouping') ?? ''))) entries.reverse();
    const key = f.size * 0.7, row = f.size * 1.45;
    const item = (e: typeof entries[number], x: number, y: number) => {
      const long = e.line || !!e.marker;
      if (e.line) d.out.push(`<line x1="${num(x)}" y1="${num(y)}" x2="${num(x + key * 1.8)}" y2="${num(y)}" stroke="${e.fill}" stroke-width="${num(Math.max(1.5, key / 4))}"/>`);
      if (e.marker) marker(d, x + key * 0.9, y, { ...e.marker, size: Math.min(e.marker.size, key * 1.1) });
      else if (!e.line) d.out.push(`<rect x="${num(x)}" y="${num(y - key / 2)}" width="${num(key)}" height="${num(key)}" fill="${e.fill}"/>`);
      d.text(x + (long ? key * 2.2 : key * 1.5), y, e.t, f, 'start');
    };
    const keyW = entries.some(e => e.line || e.marker) ? key * 2.2 : key * 1.5;
    if (entries.length && (pos === 'r' || pos === 'l' || pos === 'tr')) {
      const lw = Math.min(box.w * 0.4, Math.max(...entries.map(e => width(e.t, f.size))) + keyW + pad);
      const x = pos === 'l' ? box.x : box.x + box.w - lw + pad / 2, y0 = pos === 'tr' ? box.y + row / 2 : box.y + box.h / 2 - (entries.length - 1) * row / 2;
      entries.forEach((e, i) => item(e, x, y0 + i * row));
      if (!overlay) box = pos === 'l' ? { ...box, x: box.x + lw + pad, w: box.w - lw - pad } : { ...box, w: box.w - lw - pad };
    } else if (entries.length) {
      const widths = entries.map(e => width(e.t, f.size) + keyW + f.size);
      const lines: number[][] = [[]];
      let used = 0;
      widths.forEach((ew, i) => { if (used + ew > box.w && lines[lines.length - 1].length) { lines.push([]); used = 0; } lines[lines.length - 1].push(i); used += ew; });
      const total = lines.length * row;
      const y0 = pos === 't' ? box.y + row / 2 : box.y + box.h - total + row / 2;
      lines.forEach((ids, k) => {
        let x = box.x + box.w / 2 - ids.reduce((s, i) => s + widths[i], 0) / 2;
        for (const i of ids) { item(entries[i], x, y0 + k * row); x += widths[i]; }
      });
      if (!overlay) box = pos === 't' ? { ...box, y: box.y + total + pad / 2, h: box.h - total - pad / 2 } : { ...box, h: box.h - total - pad / 2 };
    }
  }

  // the plot area: where the file placed it, or what the title and legend leave
  const layout = path(plot, [C, 'layout'], [C, 'manualLayout']);
  let inner: Rect | undefined;
  if (layout && val(layout, 'x') !== undefined && val(layout, 'w') !== undefined) {
    const r = { x: finite(val(layout, 'x'), 0) * w, y: finite(val(layout, 'y'), 0) * h, w: finite(val(layout, 'w'), 1) * w, h: finite(val(layout, 'h'), 1) * h };
    if (r.w > 4 && r.h > 4) { if (val(layout, 'layoutTarget') === 'inner') inner = r; else box = r; }
  }
  const plotFill = d.fill(child(plot, C, 'spPr')), plotLine = d.line(child(plot, C, 'spPr'));
  const textOf = (n: X | undefined) => d.font(child(n, C, 'txPr'));

  if (pie) {
    drawPies(d, all.filter(s => PIE.includes(s.type)), inner ?? box, pointColor, base, date1904, env);
    return { svg: d.svg(w, h, titleText || all.map(s => s.name).filter(Boolean).join(', ') || 'Chart', css), title: titleText };
  }
  if (surfaceList.length) {
    drawSurface(d, surfaceList, inner ?? box, plot!, bands!, base);
    env.warn('chart_redrawn');
    return { svg: d.svg(w, h, titleText || all.map(s => s.name).filter(Boolean).join(', ') || 'Chart', css), title: titleText };
  }
  if (groups.some(g => g.name === 'radarChart')) {
    drawRadar(d, all.filter(s => s.type === 'radarChart'), inner ?? box, plot!, base, date1904);
    env.warn('chart_redrawn');
    return { svg: d.svg(w, h, titleText || all.map(s => s.name).filter(Boolean).join(', ') || 'Chart', css), title: titleText };
  }

  // axes: each group names its own pair; a value axis on the right is a secondary one
  const axisNodes = plot!.children.filter(n => n.uri === C && /^(catAx|valAx|dateAx|serAx)$/.test(n.name));
  const byId = new Map(axisNodes.map(a => [val(a, 'axId') ?? '', a]));
  const pairOf = (g: X) => {
    const ids = kids(g, C, 'axId').map(a => at(a, 'val') ?? '');
    const nodes = ids.map(id => byId.get(id)).filter((a): a is X => !!a);
    const xy = XY.includes(g.name);
    const cat = xy ? nodes.find(a => a.name === 'valAx' && /^[bt]$/.test(val(a, 'axPos') ?? 'b')) ?? nodes[0] : nodes.find(a => a.name !== 'valAx' && a.name !== 'serAx') ?? axisNodes.find(a => a.name === 'catAx' || a.name === 'dateAx');
    const value = nodes.find(a => a.name === 'valAx' && a !== cat) ?? axisNodes.find(a => a.name === 'valAx' && a !== cat);
    return { cat, value };
  };
  const horizontal = groups.some(g => BAR.includes(g.name) && val(g, 'barDir') === 'bar');
  const primary = pairOf(groups[0]);
  for (const s of all) { const p = pairOf(s.group); s.secondary = !!p.value && !!primary.value && p.value !== primary.value; }
  const count = Math.max(1, ...all.map(s => Math.max(s.cats.length, s.vals.length)));
  const cats = all.reduce<string[]>((best, s) => s.cats.length > best.length ? s.cats : best, []);
  const grouping = (g: X) => val(g, 'grouping') ?? (BAR.includes(g.name) ? 'clustered' : 'standard');
  const stacked = (g: X) => /stacked/i.test(grouping(g));
  const percent = (g: X) => grouping(g) === 'percentStacked';
  const blanks = val(chart, 'dispBlanksAs') ?? 'gap';
  /** A series' value at a category, from the level below it to its own (stacked groups pile up). */
  const level = (s: Series, i: number): [number, number] | null => {
    const v = s.vals[i];
    if (!stacked(s.group)) return v === null || v === undefined ? (blanks === 'zero' ? [0, 0] : null) : [0, v];
    const same = all.filter(x => x.group === s.group), k = same.indexOf(s);
    const at = (x: Series) => x.vals[i] ?? 0;
    const total = percent(s.group) ? same.reduce((sum, x) => sum + Math.abs(at(x)), 0) || 1 : 1, f = percent(s.group) ? 100 / total : 1;
    const own = at(s), below = same.slice(0, k).filter(x => Math.sign(at(x)) === Math.sign(own) || own === 0).reduce((sum, x) => sum + at(x), 0);
    return [below * f, (below + own) * f];
  };
  const axisFor = (node: X | undefined, values: number[], kind: 'value' | 'x'): Axis => {
    const scaling = child(node, C, 'scaling');
    const log = val(scaling, 'logBase') !== undefined ? clamp(finite(val(scaling, 'logBase'), 10), 2, 1000) : undefined;
    const lo0 = Math.min(...values), hi0 = Math.max(...values);
    let lo = Number.isFinite(lo0) ? lo0 : 0, hi = Number.isFinite(hi0) ? hi0 : 1;
    const own = (k: string) => { const v = val(scaling, k); return v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined; };
    const fmt = child(node, C, 'numFmt');
    const format = at(fmt, 'formatCode') && at(fmt, 'sourceLinked') !== '1' ? at(fmt, 'formatCode')! : (kind === 'x' ? all.find(s => s.catFormat)?.catFormat : all.find(s => s.valFormat)?.valFormat) ?? 'General';
    const pct = all.some(s => percent(s.group)) && kind === 'value';
    if (log) {
      const min = own('min') ?? log ** Math.floor(Math.log(Math.max(1e-12, lo > 0 ? lo : 1)) / Math.log(log));
      const max = own('max') ?? log ** Math.ceil(Math.log(Math.max(min * log, hi)) / Math.log(log));
      const ticks: number[] = []; for (let t = min; t <= max * 1.0001 && ticks.length < 40; t *= log) ticks.push(t);
      return { node: node!, id: val(node, 'axId') ?? '', kind: node?.name ?? 'valAx', pos: val(node, 'axPos') ?? 'l', deleted: flag(node, 'delete', false), min, max, log, reverse: val(scaling, 'orientation') === 'maxMin', ticks, format: pct && format === 'General' ? '0%' : format, pct };
    }
    lo = Math.min(0, lo); hi = Math.max(0, hi);
    if (pct) { lo = Math.min(lo, 0); hi = Math.max(hi, 0) > 0 ? 100 : 0; }
    // as many intervals as the axis has room for, ten at most
    const along = kind === 'x' || horizontal ? box.w : box.h;
    const most = clamp(Math.floor(along / (base.size * (kind === 'x' || horizontal ? 5 : 2.2))), 2, 10);
    const unit = finite(val(node, 'majorUnit'), 0) > 0 ? Number(val(node, 'majorUnit')) : undefined;
    let { min, max, step } = autoScale(lo, hi, most, unit);
    min = own('min') ?? min; max = own('max') ?? max;
    if (!(max > min)) max = min + (step || 1);
    // the file's own bounds can be far from the data
    if (!unit && (own('min') !== undefined || own('max') !== undefined)) step = niceStep(max - min, most);
    if (pct && own('max') === undefined) { max = 100; min = own('min') ?? (lo < 0 ? -100 : 0); step = finite(val(node, 'majorUnit'), 0) > 0 ? Number(val(node, 'majorUnit')) : Math.max(step, 10); }
    const ticks: number[] = []; for (let t = Math.ceil(min / step - 1e-9) * step; t <= max + step / 1e6 && ticks.length <= 40; t += step) ticks.push(Math.round(t / step) * step);
    return { node: node!, id: val(node, 'axId') ?? '', kind: node?.name ?? 'valAx', pos: val(node, 'axPos') ?? (kind === 'x' ? 'b' : 'l'), deleted: flag(node, 'delete', false), min, max, reverse: val(scaling, 'orientation') === 'maxMin', ticks, format: pct && format === 'General' ? '0%' : format, pct };
  };
  const levelsOf = (list: Series[]) => list.flatMap(s => Array.from({ length: count }, (_, i) => level(s, i) ?? []).flat()).concat(list.flatMap(s => errorExtent(s)));
  const errorExtent = (s: Series) => kids(s.node, C, 'errBars').filter(e => val(e, 'errDir') !== 'x').flatMap(e => s.vals.flatMap((v, i) => v === null ? [] : errorRange(e, s, i, v, 'y')));
  const xyValues = all.filter(s => XY.includes(s.type));
  const xAxis = xyValues.length ? axisFor(primary.cat, xyValues.flatMap(s => (s.xs ?? s.vals.map((_, i) => i + 1)).filter((v): v is number => v !== null)), 'x') : undefined;
  if (xAxis && !xyValues.some(s => s.xs)) { xAxis.min = Math.min(xAxis.min, 0); }
  const yPrimary = axisFor(primary.value, levelsOf(all.filter(s => !s.secondary)), 'value');
  const secondaryNode = all.find(s => s.secondary) ? pairOf(all.find(s => s.secondary)!.group).value : undefined;
  const ySecondary = secondaryNode ? axisFor(secondaryNode, levelsOf(all.filter(s => s.secondary)), 'value') : undefined;
  if (ySecondary && !val(secondaryNode, 'axPos')) ySecondary.pos = 'r';
  const catNode = primary.cat;
  const catDeleted = !xAxis && flag(catNode, 'delete', false);

  // room for tick labels and axis titles
  const valFont = textOf(primary.value), catFont = textOf(catNode);
  // a 100% stacked axis runs 0 to 100 and reads as a fraction
  const label = (a: Axis, t: number) => formatValue(a.pct ? t / 100 : t, a.format, date1904);
  const valLabelWidth = (a?: Axis) => a && !a.deleted && val(a.node, 'tickLblPos') !== 'none' ? Math.max(...a.ticks.map(t => width(label(a, t), valFont.size))) + pad * 0.6 : 0;
  const axisTitle = (n: X | undefined) => { const t = child(n, C, 'title'); return t ? { text: richText(child(t, C, 'tx')) || 'Axis Title', font: d.font(child(t, C, 'txPr') ?? path(t, [C, 'tx'], [C, 'rich']), { ...base, size: base.size, bold: true }), rot: Number(at(walk(t, A, 'bodyPr')[0], 'rot') ?? NaN) } : undefined; };
  const catTitle = axisTitle(catNode), valTitle = axisTitle(primary.value), secTitle = axisTitle(secondaryNode);
  let plotR: Rect = inner ?? { ...box };
  if (!inner) {
    const catLabels = xAxis ? xAxis.ticks.map(t => label(xAxis, t)) : cats;
    const skip = Math.max(1, Math.round(finite(val(catNode, 'tickLblSkip'), Math.ceil(catLabels.length / Math.max(1, Math.floor(box.w / (base.size * 2)))))));
    const longest = Math.max(0, ...catLabels.map(t => width(t, catFont.size)));
    const catDepth = (horizontal ? 0 : catFont.size * 1.6);
    if (horizontal) {
      plotR.x += (catDeleted ? 0 : Math.min(box.w * 0.35, longest + pad)) + (catTitle ? catTitle.font.size * 1.6 : 0);
      plotR.y += 0; plotR.h -= (yPrimary.deleted ? 0 : valFont.size * 1.6) + (valTitle ? valTitle.font.size * 1.6 : 0);
      if (ySecondary) plotR.y += ySecondary.deleted ? 0 : valFont.size * 1.6;
    } else {
      const crowded = !xAxis && cats.length > 1 && longest > (box.w / cats.length) * 0.95 * skip;
      const depth = catDeleted || val(catNode, 'tickLblPos') === 'none' ? 0 : crowded ? Math.min(box.h * 0.35, longest * 0.72 + catFont.size) : catDepth;
      plotR.x += valLabelWidth(yPrimary) + (valTitle ? valTitle.font.size * 1.6 : 0);
      plotR.h -= depth + (catTitle ? catTitle.font.size * 1.6 : 0);
      if (ySecondary) plotR.w -= valLabelWidth(ySecondary) + (secTitle ? secTitle.font.size * 1.6 : 0);
    }
    plotR.w = Math.max(1, box.x + box.w - plotR.x - (ySecondary && !horizontal ? valLabelWidth(ySecondary) + (secTitle ? secTitle.font.size * 1.6 : 0) : 0));
    plotR.h = Math.max(1, plotR.h - (plotR.y - box.y));
  }
  const P = plotR;
  if (plotFill && plotFill !== 'none' || plotLine) d.out.push(`<rect x="${num(P.x)}" y="${num(P.y)}" width="${num(P.w)}" height="${num(P.h)}" fill="${plotFill ?? 'none'}"${d.stroke(plotLine)}/>`);
  // value to position
  const span = (a: Axis, v: number) => a.log ? (Math.log(Math.max(v, 1e-12)) - Math.log(a.min)) / (Math.log(a.max) - Math.log(a.min)) : (v - a.min) / (a.max - a.min || 1);
  const vpos = (a: Axis, v: number) => { const t = clamp(span(a, v), -0.05, 1.05), u = a.reverse ? 1 - t : t; return horizontal ? P.x + u * P.w : P.y + P.h - u * P.h; };
  const catReverse = val(child(catNode, C, 'scaling'), 'orientation') === 'maxMin';
  const between = val(primary.value, 'crossBetween') !== 'midCat' || groups.some(g => BAR.includes(g.name));
  const band = (horizontal ? P.h : P.w) / Math.max(1, between ? count : count - 1 || 1);
  /** The middle of category i along the category axis. */
  const cpos = (i: number) => {
    const k = catReverse !== horizontal ? count - 1 - i : i;
    const off = between ? (k + 0.5) * band : k * band;
    return horizontal ? P.y + off : P.x + off;
  };
  const xpos = (v: number) => { const a = xAxis!; const t = span(a, v), u = a.reverse ? 1 - t : t; return P.x + clamp(u, -0.05, 1.05) * P.w; };

  // gridlines, then axes and their labels
  const grid = (a: Axis | undefined, vertical: boolean) => {
    if (!a) return;
    for (const [name, every] of [['minorGridlines', 5], ['majorGridlines', 1]] as const) {
      const g = child(a.node, C, name);
      if (!g) continue;
      const l = d.line(child(g, C, 'spPr'), { color: GRID, width: 0.75 * 12700 * env.scale });
      if (!l) continue;
      const ticks = every === 1 ? a.ticks : a.log ? a.ticks.flatMap(t => Array.from({ length: 8 }, (_, k) => t * (k + 2) / 1)).filter(t => t < a.max) : a.ticks.flatMap((t, i) => i ? Array.from({ length: 4 }, (_, k) => a.ticks[i - 1] + (t - a.ticks[i - 1]) * (k + 1) / 5) : []);
      for (const t of ticks) {
        const p = vertical ? (xAxis && a === xAxis ? xpos(t) : vpos(a, t)) : vpos(a, t);
        d.out.push(vertical ? `<line x1="${num(p)}" y1="${num(P.y)}" x2="${num(p)}" y2="${num(P.y + P.h)}"${d.stroke(l)}/>` : `<line x1="${num(P.x)}" y1="${num(p)}" x2="${num(P.x + P.w)}" y2="${num(p)}"${d.stroke(l)}/>`);
      }
    }
  };
  grid(yPrimary, horizontal);
  if (xAxis) grid(xAxis, true);
  else if (catNode) for (const name of ['majorGridlines', 'minorGridlines']) {
    const g = child(catNode, C, name); if (!g) continue;
    const l = d.line(child(g, C, 'spPr'), { color: GRID, width: 0.75 * 12700 * env.scale }); if (!l) continue;
    for (let i = 0; i <= count; i++) { const p = (horizontal ? P.y : P.x) + i * band; d.out.push(horizontal ? `<line x1="${num(P.x)}" y1="${num(p)}" x2="${num(P.x + P.w)}" y2="${num(p)}"${d.stroke(l)}/>` : `<line x1="${num(p)}" y1="${num(P.y)}" x2="${num(p)}" y2="${num(P.y + P.h)}"${d.stroke(l)}/>`); }
  }
  // tick marks across an axis line at `at`, pointing out of the plot by `out` (1 or -1)
  const tickLen = base.size * 0.4;
  const tickMarks = (node: X | undefined, positions: number[], acrossY: boolean, at0: number, out: number, l: Line | null | undefined) => {
    const kind = val(node, 'majorTickMark') ?? 'cross';
    if (!l || kind === 'none') return;
    const [a, b] = kind === 'in' ? [-tickLen, 0] : kind === 'out' ? [0, tickLen] : [-tickLen, tickLen];
    d.out.push(`<path d="${positions.map(p => acrossY ? `M${num(p)} ${num(at0 + a * out)}L${num(p)} ${num(at0 + b * out)}` : `M${num(at0 + a * out)} ${num(p)}L${num(at0 + b * out)} ${num(p)}`).join('')}" fill="none"${d.stroke(l)}/>`);
  };
  // value axis labels
  const valueLabels = (a: Axis | undefined, right: boolean, title?: ReturnType<typeof axisTitle>) => {
    if (!a) return;
    const f = textOf(a.node);
    if (!a.deleted && val(a.node, 'tickLblPos') !== 'none') for (const t of a.ticks) {
      const p = vpos(a, t), s = label(a, t);
      if (horizontal) d.text(p, right ? P.y - f.size * 0.6 : P.y + P.h + f.size * 0.9, s, f, 'middle');
      else d.text(right ? P.x + P.w + pad * 0.4 : P.x - pad * 0.4, p, s, f, right ? 'start' : 'end');
    }
    const l = d.line(child(a.node, C, 'spPr'), { color: AXIS, width: 0.75 * 12700 * env.scale });
    if (l && !a.deleted) {
      d.out.push(horizontal ? `<line x1="${num(P.x)}" y1="${num(right ? P.y : P.y + P.h)}" x2="${num(P.x + P.w)}" y2="${num(right ? P.y : P.y + P.h)}"${d.stroke(l)}/>` : `<line x1="${num(right ? P.x + P.w : P.x)}" y1="${num(P.y)}" x2="${num(right ? P.x + P.w : P.x)}" y2="${num(P.y + P.h)}"${d.stroke(l)}/>`);
      tickMarks(a.node, a.ticks.map(t => vpos(a, t)), horizontal, horizontal ? (right ? P.y : P.y + P.h) : right ? P.x + P.w : P.x, right ? (horizontal ? -1 : 1) : horizontal ? 1 : -1, l);
    }
    if (title) {
      if (horizontal) d.text(P.x + P.w / 2, right ? P.y - f.size * 1.6 - title.font.size : P.y + P.h + f.size * 1.6 + title.font.size * 0.8, title.text, title.font);
      else { const x = right ? P.x + P.w + valLabelWidth(a) + title.font.size * 0.9 : P.x - valLabelWidth(a) - title.font.size * 0.9; d.text(x, P.y + P.h / 2, title.text, title.font, 'middle', right ? 90 : -90); }
    }
  };
  valueLabels(yPrimary, false, valTitle);
  valueLabels(ySecondary, true, secTitle);
  // category (or x value) axis
  if (xAxis) {
    const f = catFont;
    if (!xAxis.deleted && val(catNode, 'tickLblPos') !== 'none') for (const t of xAxis.ticks) d.text(xpos(t), P.y + P.h + f.size * 0.9, label(xAxis, t), f);
    const l = d.line(child(catNode, C, 'spPr'), { color: AXIS, width: 0.75 * 12700 * env.scale });
    const y0 = vpos(yPrimary, clamp(0, yPrimary.min, yPrimary.max));
    if (l && !xAxis.deleted) { d.out.push(`<line x1="${num(P.x)}" y1="${num(y0)}" x2="${num(P.x + P.w)}" y2="${num(y0)}"${d.stroke(l)}/>`); tickMarks(catNode, xAxis.ticks.map(xpos), true, y0, 1, l); }
    if (catTitle) d.text(P.x + P.w / 2, P.y + P.h + f.size * 1.6 + catTitle.font.size * 0.8, catTitle.text, catTitle.font);
  } else {
    const f = catFont;
    const skip = Math.max(1, Math.round(finite(val(catNode, 'tickLblSkip'), 1)));
    const longest = Math.max(0, ...cats.map(t => width(t, f.size)));
    const rot = at(walk(child(catNode, C, 'txPr'), A, 'bodyPr')[0], 'rot');
    const crowded = !horizontal && cats.length > 1 && longest > band * 0.95 * skip;
    const angle = rot !== undefined && Number(rot) !== -60000000 ? Number(rot) / 60000 : crowded ? -45 : 0;
    const cross = catNode && val(catNode, 'crosses') === 'max' ? yPrimary.max : catNode && val(catNode, 'crossesAt') !== undefined ? finite(val(catNode, 'crossesAt'), 0) : clamp(0, yPrimary.min, yPrimary.max);
    if (!catDeleted && val(catNode, 'tickLblPos') !== 'none') cats.forEach((t, i) => {
      if (i % skip) return;
      if (horizontal) d.text(P.x - pad * 0.4, cpos(i), t, f, 'end');
      else if (angle) d.text(cpos(i), P.y + P.h + f.size * 0.6, t, f, 'end', angle, 'top');
      else d.text(cpos(i), P.y + P.h + f.size * 0.9, t, f);
    });
    const zero = vpos(yPrimary, clamp(cross, yPrimary.min, yPrimary.max));
    const l = d.line(child(catNode, C, 'spPr'), { color: AXIS, width: 0.75 * 12700 * env.scale });
    if (l && !catDeleted) {
      d.out.push(horizontal ? `<line x1="${num(zero)}" y1="${num(P.y)}" x2="${num(zero)}" y2="${num(P.y + P.h)}"${d.stroke(l)}/>` : `<line x1="${num(P.x)}" y1="${num(zero)}" x2="${num(P.x + P.w)}" y2="${num(zero)}"${d.stroke(l)}/>`);
      const marks = between ? Array.from({ length: count + 1 }, (_, i) => (horizontal ? P.y : P.x) + i * band) : cats.map((_, i) => cpos(i));
      tickMarks(catNode, marks, !horizontal, zero, horizontal ? -1 : 1, l);
    }
    if (catTitle) {
      if (horizontal) d.text(P.x - Math.min(box.w * 0.35, longest + pad) - catTitle.font.size * 0.9, P.y + P.h / 2, catTitle.text, catTitle.font, 'middle', -90);
      else d.text(P.x + P.w / 2, P.y + P.h + (angle ? Math.min(box.h * 0.35, longest * 0.72 + f.size) : f.size * 1.6) + catTitle.font.size * 0.8, catTitle.text, catTitle.font);
    }
  }

  // the series
  const axisOf = (s: Series) => s.secondary && ySecondary ? ySecondary : yPrimary;
  const bars = all.filter(s => BAR.includes(s.type));
  const clusters = [...new Set(bars.map(s => stacked(s.group) ? s.group : s))];
  const gap = finite(val(bars[0]?.group, 'gapWidth'), 150) / 100;
  const overlap = clamp(finite(val(bars[0]?.group, 'overlap'), stacked(bars[0]?.group ?? groups[0]) ? 100 : 0), -100, 100) / 100;
  const slot = band / (clusters.length - (clusters.length - 1) * overlap + gap);
  const labels: (() => void)[] = [];
  for (const s of bars) {
    const k = clusters.indexOf(stacked(s.group) ? s.group : s), a = axisOf(s);
    const invert = flag(s.node, 'invertIfNegative', false);
    for (let i = 0; i < count; i++) {
      const lv = level(s, i); if (!lv) continue;
      const [from, to] = [vpos(a, clamp(lv[0], a.log ? a.min : -Infinity, Infinity)), vpos(a, lv[1])];
      const start = (horizontal ? cpos(i) - band / 2 : cpos(i) - band / 2) + slot * (gap / 2 + k * (1 - overlap));
      let fill = pointColor(s, i, count);
      if (invert && (s.vals[i] ?? 0) < 0 && !kids(s.node, C, 'dPt').some(p => Number(val(p, 'idx')) === i)) fill = '#ffffff';
      const dPt = kids(s.node, C, 'dPt').find(p => Number(val(p, 'idx')) === i);
      const l = d.line(child(dPt, C, 'spPr'), s.line ?? undefined) ?? (invert && (s.vals[i] ?? 0) < 0 ? { color: s.fill, width: 1 } : null);
      d.out.push(horizontal ? `<rect x="${num(Math.min(from, to))}" y="${num(start)}" width="${num(Math.abs(to - from))}" height="${num(slot)}" fill="${fill}"${d.stroke(l)}/>`
        : `<rect x="${num(start)}" y="${num(Math.min(from, to))}" width="${num(slot)}" height="${num(Math.abs(to - from))}" fill="${fill}"${d.stroke(l)}/>`);
      // a 3-D bar seen slightly from above and the right: a lit top and a shaded side
      if (s.type === 'bar3DChart' && Math.abs(to - from) > 0.5) {
        const k3 = slot * 0.3, face = (pts: [number, number][], shade: string) => d.out.push(`<path d="${pts.map(([x, y], j) => `${j ? 'L' : 'M'}${num(x)} ${num(y)}`).join('')}Z" fill="${fill}"${d.stroke(l)}/><path d="${pts.map(([x, y], j) => `${j ? 'L' : 'M'}${num(x)} ${num(y)}`).join('')}Z" fill="${shade}"/>`);
        if (horizontal) {
          const x0 = Math.min(from, to), x1 = Math.max(from, to);
          face([[x0, start], [x0 + k3, start - k3], [x1 + k3, start - k3], [x1, start]], 'rgba(255,255,255,0.25)');
          face([[x1, start], [x1 + k3, start - k3], [x1 + k3, start + slot - k3], [x1, start + slot]], 'rgba(0,0,0,0.25)');
        } else {
          const y0 = Math.min(from, to), y1 = Math.max(from, to);
          face([[start, y0], [start + k3, y0 - k3], [start + slot + k3, y0 - k3], [start + slot, y0]], 'rgba(255,255,255,0.25)');
          face([[start + slot, y0], [start + slot + k3, y0 - k3], [start + slot + k3, y1 - k3], [start + slot, y1]], 'rgba(0,0,0,0.25)');
        }
      }
      const v = s.vals[i];
      if (v !== null) labels.push(() => dataLabel(d, s, i, v, horizontal ? { x: Math.max(from, to), y: start + slot / 2, x0: Math.min(from, to) } : { x: start + slot / 2, y: Math.min(from, to), y0: Math.max(from, to) }, stacked(s.group) ? 'ctr' : 'outEnd', base, date1904, horizontal, v < 0));
    }
  }
  // areas under lines, back to front
  for (const s of all.filter(x => AREA.includes(x.type)).reverse()) {
    const a = axisOf(s);
    const top: [number, number][] = [], bottom: [number, number][] = [];
    for (let i = 0; i < count; i++) { const lv = level(s, i) ?? [0, 0]; top.push([cpos(i), vpos(a, lv[1])]); bottom.push([cpos(i), vpos(a, lv[0])]); }
    const l = d.line(child(s.node, C, 'spPr'));
    d.out.push(`<path d="${top.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x)} ${num(y)}`).join('')}${bottom.reverse().map(([x, y]) => `L${num(x)} ${num(y)}`).join('')}Z" fill="${s.fill}"${d.stroke(l)}/>`);
    s.vals.forEach((v, i) => { if (v !== null) labels.push(() => dataLabel(d, s, i, v, { x: cpos(i), y: vpos(a, (level(s, i) ?? [0, v])[1]) }, 'ctr', base, date1904, false, false)); });
  }
  // stock charts: high-low lines and up-down bars between the first and last series
  for (const g of groups.filter(x => LINE.includes(x.name) && (child(x, C, 'hiLowLines') || child(x, C, 'upDownBars')))) {
    const list = all.filter(s => s.group === g), a = axisOf(list[0]);
    const hl = child(g, C, 'hiLowLines');
    if (hl) { const l = d.line(child(hl, C, 'spPr'), { color: '#000000', width: 0.75 * 12700 * env.scale }); for (let i = 0; i < count; i++) { const vs = list.map(s => s.vals[i]).filter((v): v is number => v !== null); if (vs.length > 1 && l) d.out.push(`<line x1="${num(cpos(i))}" y1="${num(vpos(a, Math.max(...vs)))}" x2="${num(cpos(i))}" y2="${num(vpos(a, Math.min(...vs)))}"${d.stroke(l)}/>`); } }
    const ud = child(g, C, 'upDownBars');
    if (ud && list.length > 1) {
      const bw = band / (1 + finite(val(ud, 'gapWidth'), 150) / 100);
      const up = d.fill(child(child(ud, C, 'upBars'), C, 'spPr')) ?? '#ffffff', down = d.fill(child(child(ud, C, 'downBars'), C, 'spPr')) ?? '#000000';
      const upLine = d.line(child(child(ud, C, 'upBars'), C, 'spPr'), { color: '#000000', width: 0.75 * 12700 * env.scale }), downLine = d.line(child(child(ud, C, 'downBars'), C, 'spPr'), { color: '#000000', width: 0.75 * 12700 * env.scale });
      for (let i = 0; i < count; i++) {
        const o = list[0].vals[i], c = list[list.length - 1].vals[i]; if (o === null || c === null) continue;
        const y1 = vpos(a, Math.max(o, c)), y2 = vpos(a, Math.min(o, c));
        d.out.push(`<rect x="${num(cpos(i) - bw / 2)}" y="${num(y1)}" width="${num(bw)}" height="${num(Math.max(0.5, y2 - y1))}" fill="${c >= o ? up : down}"${d.stroke(c >= o ? upLine : downLine)}/>`);
      }
    }
  }
  for (const g of groups.filter(x => child(x, C, 'dropLines'))) {
    const l = d.line(child(child(g, C, 'dropLines'), C, 'spPr'), { color: '#000000', width: 0.75 * 12700 * env.scale });
    for (const s of all.filter(x => x.group === g)) s.vals.forEach((v, i) => { if (v !== null && l) d.out.push(`<line x1="${num(cpos(i))}" y1="${num(vpos(axisOf(s), v))}" x2="${num(cpos(i))}" y2="${num(P.y + P.h)}"${d.stroke(l)}/>`); });
  }
  // lines, scatter and bubbles over the bars
  const bubbles = all.filter(s => s.type === 'bubbleChart');
  if (bubbles.length) {
    const g = bubbles[0].group, scaleB = finite(val(g, 'bubbleScale'), 100) / 100, byWidth = val(g, 'sizeRepresents') === 'w';
    const biggest = Math.max(1e-12, ...bubbles.flatMap(s => (s.sizes ?? []).map(v => Math.abs(v ?? 0))));
    const rMax = Math.min(P.w, P.h) * 0.125 * scaleB;
    for (const s of bubbles) s.vals.forEach((v, i) => {
      const size = s.sizes?.[i]; if (v === null || size === null || size === undefined || size <= 0 && !flag(g, 'showNegBubbles', false)) return;
      const x = s.xs ? s.xs[i] : i + 1; if (x === null || x === undefined) return;
      const r = byWidth ? rMax * Math.abs(size) / biggest : rMax * Math.sqrt(Math.abs(size) / biggest);
      d.out.push(`<circle cx="${num(xpos(x))}" cy="${num(vpos(axisOf(s), v))}" r="${num(r)}" fill="${pointColor(s, i, s.vals.length)}"${d.stroke(d.line(child(s.node, C, 'spPr')) ?? null)}/>`);
      labels.push(() => dataLabel(d, s, i, v, { x: xpos(x), y: vpos(axisOf(s), v) }, 'ctr', base, date1904, false, false, size));
    });
  }
  for (const s of all.filter(x => LINE.includes(x.type) || x.type === 'scatterChart')) {
    const a = axisOf(s);
    const xOf = (i: number) => s.type === 'scatterChart' ? xpos(s.xs?.[i] ?? i + 1) : cpos(i);
    const pts: ([number, number] | null)[] = Array.from({ length: Math.max(count, s.vals.length) }, (_, i) => {
      if (s.type === 'scatterChart' && s.xs && s.xs[i] === null) return null;
      const lv = level(s, i);
      return lv ? [xOf(i), vpos(a, lv[1])] : null;
    });
    // a line series that does not say is drawn smooth by Office (writers spell out val="0")
    const smooth = flag(s.node, 'smooth', s.type === 'lineChart' || s.type === 'line3DChart') && val(s.group, 'scatterStyle') !== 'line' || /smooth/i.test(val(s.group, 'scatterStyle') ?? '') && !child(s.node, C, 'smooth');
    if (s.line) {
      const runs: [number, number][][] = [[]];
      for (const p of pts) { if (p) runs[runs.length - 1].push(p); else if (blanks === 'gap' && runs[runs.length - 1].length) runs.push([]); }
      for (const r of runs) if (r.length > 1) d.out.push(`<path d="${smooth ? smoothPath(r) : r.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x)} ${num(y)}`).join('')}" fill="none"${d.stroke(s.line)} stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    pts.forEach((p, i) => {
      if (!p) return;
      const dPt = kids(s.node, C, 'dPt').find(x => Number(val(x, 'idx')) === i), m = child(dPt, C, 'marker');
      if (s.marker) marker(d, p[0], p[1], m ? { ...s.marker, symbol: val(m, 'symbol') ?? s.marker.symbol, fill: d.fill(child(m, C, 'spPr')) ?? s.marker.fill } : s.marker);
      const v = s.vals[i]; if (v !== null) labels.push(() => dataLabel(d, s, i, v, { x: p[0], y: p[1] }, 'r', base, date1904, false, false));
    });
  }
  // trendlines and error bars
  for (const s of all) {
    const a = axisOf(s);
    const xs = s.xs ?? s.vals.map((_, i) => i + 1);
    const toX = (x: number) => s.xs ? xpos(x) : cpos(x - 1);
    // a point of the series: categories run down a horizontal bar chart, values across
    const point = (x: number, y: number): [number, number] => horizontal && !s.xs ? [vpos(a, y), cpos(x - 1)] : [toX(x), vpos(a, y)];
    for (const t of kids(s.node, C, 'trendline')) drawTrendline(d, t, s, xs, point, base, env);
    for (const e of kids(s.node, C, 'errBars')) {
      const dir = val(e, 'errDir') ?? (horizontal ? 'x' : 'y');
      const l = d.line(child(e, C, 'spPr'), { color: '#000000', width: 0.75 * 12700 * env.scale }); if (!l) continue;
      const cap = flag(e, 'noEndCap', false) ? 0 : 3 * 12700 * env.scale;
      s.vals.forEach((v, i) => {
        if (v === null) return;
        const x = xs[i]; if (x === null) return;
        const [lo, hi] = errorRange(e, s, i, dir === 'x' ? x : v, dir === 'x' ? 'x' : 'y');
        if (dir === 'x' && s.xs) { const y = vpos(a, v); d.out.push(`<path d="M${num(xpos(lo))} ${num(y)}L${num(xpos(hi))} ${num(y)}${cap ? `M${num(xpos(lo))} ${num(y - cap)}L${num(xpos(lo))} ${num(y + cap)}M${num(xpos(hi))} ${num(y - cap)}L${num(xpos(hi))} ${num(y + cap)}` : ''}" fill="none"${d.stroke(l)}/>`); }
        else if (!horizontal) { const xx = toX(x); d.out.push(`<path d="M${num(xx)} ${num(vpos(a, lo))}L${num(xx)} ${num(vpos(a, hi))}${cap ? `M${num(xx - cap)} ${num(vpos(a, lo))}L${num(xx + cap)} ${num(vpos(a, lo))}M${num(xx - cap)} ${num(vpos(a, hi))}L${num(xx + cap)} ${num(vpos(a, hi))}` : ''}" fill="none"${d.stroke(l)}/>`); }
      });
    }
  }
  for (const l of labels) l();
  env.warn('chart_redrawn');
  return { svg: d.svg(w, h, titleText || all.map(s => s.name).filter(Boolean).join(', ') || 'Chart', css), title: titleText };
}
function errorRange(e: X, s: Series, i: number, v: number, _dir: string): [number, number] {
  const kind = val(e, 'errValType') ?? 'fixedVal', type = val(e, 'errBarType') ?? 'both', amount = finite(val(e, 'val'), 1);
  let plus = 0, minus = 0;
  const vals = s.vals.filter((x): x is number => x !== null), mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length - 1));
  if (kind === 'fixedVal') plus = minus = amount;
  else if (kind === 'percentage') plus = minus = Math.abs(v) * amount / 100;
  else if (kind === 'stdDev') plus = minus = sd * amount;
  else if (kind === 'stdErr') plus = minus = sd / Math.sqrt(Math.max(1, vals.length));
  else if (kind === 'cust') { plus = numbers(cache(child(e, C, 'plus')))[i] ?? 0; minus = numbers(cache(child(e, C, 'minus')))[i] ?? 0; }
  return [type === 'plus' ? v : v - Math.abs(minus), type === 'minus' ? v : v + Math.abs(plus)];
}
/** Text of a `c:tx` holding rich text or a cell reference. */
function richText(tx: X | undefined): string {
  if (!tx) return '';
  const rich = child(tx, C, 'rich');
  if (rich) return kids(rich, A, 'p').map(p => walk(p, A, 't').map(t => t.text).join('')).join('\n').trim();
  return cache(tx).values[0] ?? child(tx, C, 'v')?.text ?? '';
}
/** The label of one point, where `dLbls` (the series', or the group's) and its own `dLbl` say. */
function dataLabel(d: Drawing, s: Series, i: number, v: number, p: { x: number; y: number; x0?: number; y0?: number }, fallbackPos: string, base: Font, date1904: boolean, horizontal: boolean, negative: boolean, size?: number) {
  const group = child(s.group, C, 'dLbls'), own = child(s.node, C, 'dLbls');
  const point = kids(own, C, 'dLbl').find(l => Number(val(l, 'idx')) === i);
  const chain = [group, own, point].filter((x): x is X => !!x);
  if (!chain.length) return;
  const pick = (name: string) => { for (let k = chain.length - 1; k >= 0; k--) { const x = child(chain[k], C, name); if (x) return at(x, 'val') ?? '1'; } return undefined; };
  if (pick('delete') === '1' || pick('delete') === 'true') return;
  const on = (name: string) => pick(name) === '1' || pick(name) === 'true';
  const parts: string[] = [];
  const fmtNode = [...chain].reverse().map(x => child(x, C, 'numFmt')).find(Boolean);
  const format = fmtNode && at(fmtNode, 'sourceLinked') !== '1' ? at(fmtNode, 'formatCode') : s.valFormat;
  if (on('showSerName')) parts.push(s.name);
  if (on('showCatName')) parts.push(s.xs ? formatValue(s.xs[i] ?? 0, s.catFormat ?? 'General', date1904) : s.cats[i] ?? '');
  if (on('showVal')) parts.push(formatValue(v, format ?? 'General', date1904));
  if (on('showBubbleSize') && size !== undefined) parts.push(formatValue(size, 'General'));
  if (!parts.length) return;
  const custom = point && richText(child(point, C, 'tx'));
  const sep = [...chain].reverse().map(x => child(x, C, 'separator')?.text).find(x => x !== undefined) ?? ', ';
  const text = custom || parts.join(sep);
  const f = d.font([...chain].reverse().map(x => child(x, C, 'txPr')).find(Boolean) ?? undefined, base);
  const pos = pick('dLblPos') ?? fallbackPos;
  let { x, y } = p, anchor: 'start' | 'middle' | 'end' = 'middle';
  const gap = f.size * 0.4;
  if (horizontal) {
    if (pos === 'ctr') x = ((p.x0 ?? x) + x) / 2;
    else if (pos === 'inEnd') { x -= gap; anchor = 'end'; } else if (pos === 'inBase') { x = (p.x0 ?? x) + gap; anchor = 'start'; } else { x += negative ? -gap : gap; anchor = negative ? 'end' : 'start'; }
  } else {
    if (pos === 'ctr') y = ((p.y0 ?? y) + y) / 2;
    else if (pos === 'inEnd') y += f.size * 0.9; else if (pos === 'inBase') y = (p.y0 ?? y) - f.size * 0.7;
    else if (pos === 't') y -= f.size * 0.9; else if (pos === 'b') y += f.size * 0.9;
    else if (pos === 'r') { x += gap + (s.marker?.size ?? 0) / 2; anchor = 'start'; } else if (pos === 'l') { x -= gap + (s.marker?.size ?? 0) / 2; anchor = 'end'; }
    else y += negative ? f.size * 0.9 : -f.size * 0.7;
  }
  d.text(x, y, text, f, anchor);
}
function drawTrendline(d: Drawing, t: X, s: Series, xs: (number | null)[], point: (x: number, y: number) => [number, number], base: Font, env: ChartEnv) {
  const pts = s.vals.map((y, i) => [xs[i], y] as const).filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null);
  if (pts.length < 2) return;
  const type = val(t, 'trendlineType') ?? 'linear';
  const l = d.line(child(t, C, 'spPr'), { color: s.fill.startsWith('url(') ? '#595959' : s.fill, width: 1.5 * 12700 * env.scale, dash: `${num(1.5 * 12700 * env.scale)} ${num(1.5 * 12700 * env.scale)}` });
  if (!l) return;
  const lo = Math.min(...pts.map(p => p[0])) - finite(val(t, 'backward'), 0), hi = Math.max(...pts.map(p => p[0])) + finite(val(t, 'forward'), 0);
  if (type === 'movingAvg') {
    const period = Math.max(2, Math.round(finite(val(t, 'period'), 2)));
    const avg: [number, number][] = [];
    for (let i = period - 1; i < pts.length; i++) avg.push(point(pts[i][0], pts.slice(i - period + 1, i + 1).reduce((a, p) => a + p[1], 0) / period));
    if (avg.length > 1) d.out.push(`<path d="${avg.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x)} ${num(y)}`).join('')}" fill="none"${d.stroke(l)}/>`);
    return;
  }
  // least squares on transformed values
  const fx = (x: number) => type === 'log' || type === 'power' ? Math.log(x) : x;
  const fy = (y: number) => type === 'exp' || type === 'power' ? Math.log(y) : y;
  const use = pts.filter(([x, y]) => (type === 'log' || type === 'power' ? x > 0 : true) && (type === 'exp' || type === 'power' ? y > 0 : true));
  if (use.length < 2) return;
  const order = type === 'poly' ? clamp(Math.round(finite(val(t, 'order'), 2)), 2, 6) : 1;
  const coef = fit(use.map(([x]) => fx(x)), use.map(([, y]) => fy(y)), order);
  if (!coef) return;
  const intercept = val(t, 'intercept');
  if (intercept !== undefined && order === 1 && type === 'linear') { const b0 = Number(intercept); const sxx = use.reduce((a, [x]) => a + x * x, 0), sxy = use.reduce((a, [x, y]) => a + x * (y - b0), 0); coef[0] = b0; coef[1] = sxx ? sxy / sxx : 0; }
  const f = (x: number) => { const u = fx(x); const v = coef.reduce((a, c, k) => a + c * u ** k, 0); return type === 'exp' || type === 'power' ? Math.exp(v) : v; };
  const steps = type === 'linear' ? 1 : 48, path: string[] = [];
  for (let k = 0; k <= steps; k++) { const x = lo + (hi - lo) * k / steps; if ((type === 'log' || type === 'power') && x <= 0) continue; const y = f(x); if (Number.isFinite(y)) { const [px, py] = point(x, y); path.push(`${path.length ? 'L' : 'M'}${num(px)} ${num(py)}`); } }
  d.out.push(`<path d="${path.join('')}" fill="none"${d.stroke(l)} clip-path="none"/>`);
  if (flag(t, 'dispEq', false) || flag(t, 'dispRSqr', false)) {
    const r = (x: number) => Number(x.toPrecision(4));
    const eq = type === 'linear' ? `y = ${r(coef[1])}x ${coef[0] < 0 ? '-' : '+'} ${r(Math.abs(coef[0]))}` : type === 'exp' ? `y = ${r(Math.exp(coef[0]))}e^${r(coef[1])}x` : type === 'log' ? `y = ${r(coef[1])}ln(x) ${coef[0] < 0 ? '-' : '+'} ${r(Math.abs(coef[0]))}` : type === 'power' ? `y = ${r(Math.exp(coef[0]))}x^${r(coef[1])}` : 'y = ' + coef.map((c, k) => `${r(c)}${k ? `x${k > 1 ? '^' + k : ''}` : ''}`).reverse().join(' + ');
    const ys = use.map(([, y]) => fy(y)), my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const ssTot = ys.reduce((a, y) => a + (y - my) ** 2, 0), ssRes = use.reduce((a, [x, y]) => a + (fy(y) - coef.reduce((s, c, k) => s + c * fx(x) ** k, 0)) ** 2, 0);
    const text = [flag(t, 'dispEq', false) ? eq : '', flag(t, 'dispRSqr', false) ? `R² = ${r(ssTot ? 1 - ssRes / ssTot : 1)}` : ''].filter(Boolean).join('\n');
    const end = pts[pts.length - 1];
    const [ex, ey] = point(end[0], f(end[0]));
    d.text(ex, ey - base.size * 1.6, text, d.font(child(child(t, C, 'trendlineLbl'), C, 'txPr'), base), 'end');
  }
}
/** Least-squares polynomial coefficients, lowest order first. */
function fit(xs: number[], ys: number[], order: number): number[] | undefined {
  const n = order + 1, m = Array.from({ length: n }, (_, i) => Array.from({ length: n + 1 }, (_, j) => j < n ? xs.reduce((a, x) => a + x ** (i + j), 0) : xs.reduce((a, x, k) => a + ys[k] * x ** i, 0)));
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
    [m[i], m[p]] = [m[p], m[i]];
    if (Math.abs(m[i][i]) < 1e-12) return undefined;
    for (let r = 0; r < n; r++) if (r !== i) { const f = m[r][i] / m[i][i]; for (let c = i; c <= n; c++) m[r][c] -= f * m[i][c]; }
  }
  return m.map((row, i) => row[n] / row[i]);
}
function drawPies(d: Drawing, list: Series[], box: Rect, pointColor: (s: Series, i: number, count: number) => string, base: Font, date1904: boolean, env: ChartEnv) {
  const s = list[0];
  const g = s.group, type = g.name;
  const values = s.vals.map(v => v !== null && v > 0 ? v : 0);
  const of = type === 'ofPieChart';
  // bar or pie of pie: the last points (or those the split names) move to a second plot
  let main = values.map((_, i) => i), second: number[] = [];
  if (of) {
    const splitType = val(g, 'splitType') ?? 'auto', pos = finite(val(g, 'splitPos'), 2);
    if (splitType === 'val') second = main.filter(i => values[i] < pos);
    else if (splitType === 'percent') { const sum = values.reduce((a, b) => a + b, 0) || 1; second = main.filter(i => values[i] / sum * 100 < pos); }
    else if (splitType === 'cust') second = kids(child(g, C, 'custSplit'), C, 'secondPiePt').map(p => Number(val(p, 'val') ?? at(p, 'val'))).filter(i => Number.isInteger(i));
    else second = main.slice(Math.max(0, main.length - Math.round(pos)));
    main = main.filter(i => !second.includes(i));
  }
  const otherIndex = -1;
  const order = of && second.length ? [...main, otherIndex] : main;
  const valueOf = (i: number) => i === otherIndex ? second.reduce((a, k) => a + values[k], 0) : values[i];
  const sum = order.reduce((a, i) => a + valueOf(i), 0) || 1;
  const leftW = of ? box.w * 0.55 : box.w;
  const r = Math.max(1, Math.min(leftW, box.h) / 2 * 0.95), cx = box.x + leftW / 2, cy = box.y + box.h / 2;
  const hole = type === 'doughnutChart' ? r * clamp(finite(val(g, 'holeSize'), 50), 10, 90) / 100 : 0;
  let a = (finite(val(g, 'firstSliceAng'), 0) - 90) * Math.PI / 180;
  if (of && second.length) a = -Math.PI * valueOf(otherIndex) / sum; // the "other" slice faces the second plot
  const explosionOf = (i: number) => { const dPt = kids(s.node, C, 'dPt').find(p => Number(val(p, 'idx')) === i); return finite(val(dPt, 'explosion') ?? val(s.node, 'explosion'), 0) / 100; };
  const pt = (x: number, y: number, ang: number, rad: number) => `${num(x + rad * Math.cos(ang))} ${num(y + rad * Math.sin(ang))}`;
  const line = (i: number) => { const dPt = kids(s.node, C, 'dPt').find(p => Number(val(p, 'idx')) === i); return d.line(child(dPt, C, 'spPr'), d.line(child(s.node, C, 'spPr'), { color: '#ffffff', width: 0.75 * 12700 * env.scale }) ?? undefined) ?? null; };
  // doughnuts draw one ring per series
  const rings = type === 'doughnutChart' ? list : [s];
  const ringW = (r - hole) / rings.length;
  rings.forEach((ser, k) => {
    const vals = ser.vals.map(v => v !== null && v > 0 ? v : 0), total = vals.reduce((x, y) => x + y, 0) || 1;
    let ang = (finite(val(g, 'firstSliceAng'), 0) - 90) * Math.PI / 180;
    if (ser === s && of) ang = a;
    // the first series is the innermost ring
    const inner = type === 'doughnutChart' ? hole + k * ringW : 0, outer = type === 'doughnutChart' ? inner + ringW : r;
    const idxs = ser === s ? order : vals.map((_, i) => i);
    const tot = ser === s ? sum : total;
    for (const i of idxs) {
      const v = ser === s ? valueOf(i) : vals[i]; if (v <= 0) continue;
      const b = ang + v / tot * Math.PI * 2, large = b - ang > Math.PI ? 1 : 0, mid = (ang + b) / 2;
      const off = i === otherIndex ? 0 : explosionOf(i) * r;
      const x = cx + off * Math.cos(mid), y = cy + off * Math.sin(mid);
      const fill = i === otherIndex ? env.color(scheme('bg1', [['lumMod', 85000]])) ?? '#d9d9d9' : pointColor(ser, i, vals.length);
      const dd = v >= tot ? `M${pt(x, y, ang, outer)}A${num(outer)} ${num(outer)} 0 1 1 ${pt(x, y, ang + Math.PI, outer)}A${num(outer)} ${num(outer)} 0 1 1 ${pt(x, y, ang, outer)}Z${inner ? `M${pt(x, y, ang, inner)}A${num(inner)} ${num(inner)} 0 1 0 ${pt(x, y, ang + Math.PI, inner)}A${num(inner)} ${num(inner)} 0 1 0 ${pt(x, y, ang, inner)}Z` : ''}`
        : inner ? `M${pt(x, y, ang, outer)}A${num(outer)} ${num(outer)} 0 ${large} 1 ${pt(x, y, b, outer)}L${pt(x, y, b, inner)}A${num(inner)} ${num(inner)} 0 ${large} 0 ${pt(x, y, ang, inner)}Z` : `M${num(x)} ${num(y)}L${pt(x, y, ang, outer)}A${num(outer)} ${num(outer)} 0 ${large} 1 ${pt(x, y, b, outer)}Z`;
      d.out.push(`<path d="${dd}" fill="${fill}" fill-rule="evenodd"${d.stroke(line(i))}/>`);
      const lr = inner ? (outer + inner) / 2 : outer * 0.65;
      // the slice that opens into the second plot is labelled "Other", as Office does
      if (i !== otherIndex) pieLabel(d, ser, i, ser.vals[i] ?? 0, v / tot, x, y, mid, lr, outer, base, date1904);
      else pieLabel(d, { ...ser, cats: ['Other'], node: { ...ser.node, children: ser.node.children.map(n => n.name === 'dLbls' ? { ...n, children: n.children.filter(k => k.name !== 'dLbl') } : n) } }, 0, v, v / tot, x, y, mid, lr, outer, base, date1904);
      ang = b;
    }
  });
  if (of && second.length) {
    const size = clamp(finite(val(g, 'secondPieSize'), 75), 5, 200) / 100;
    const r2 = r * size, cx2 = box.x + box.w - (box.w - leftW) / 2 - (val(g, 'ofPieType') === 'bar' ? 0 : 0), total = valueOf(otherIndex) || 1;
    const serLines = child(g, C, 'serLines'), sl = serLines ? d.line(child(serLines, C, 'spPr'), { color: '#000000', width: 0.75 * 12700 * env.scale }) : null;
    const halfAng = Math.PI * total / sum;
    if (val(g, 'ofPieType') === 'bar') {
      const bw = r2 * 0.6, bh = r2 * 2, top = cy - r2;
      let y = top;
      for (const i of second) {
        const h = values[i] / total * bh;
        d.out.push(`<rect x="${num(cx2 - bw / 2)}" y="${num(y)}" width="${num(bw)}" height="${num(h)}" fill="${pointColor(s, i, values.length)}"${d.stroke(line(i))}/>`);
        pieLabel(d, s, i, s.vals[i] ?? 0, values[i] / sum, cx2, y + h / 2, 0, 0, 0, base, date1904, true);
        y += h;
      }
      if (sl) d.out.push(`<path d="M${pt(cx, cy, -halfAng, r)}L${num(cx2 - bw / 2)} ${num(top)}M${pt(cx, cy, halfAng, r)}L${num(cx2 - bw / 2)} ${num(top + bh)}" fill="none"${d.stroke(sl)}/>`);
    } else {
      let ang = Math.PI - Math.PI * values[second[0]] / total;
      for (const i of second) {
        const b = ang + values[i] / total * Math.PI * 2, large = b - ang > Math.PI ? 1 : 0;
        d.out.push(`<path d="M${num(cx2)} ${num(cy)}L${pt(cx2, cy, ang, r2)}A${num(r2)} ${num(r2)} 0 ${large} 1 ${pt(cx2, cy, b, r2)}Z" fill="${pointColor(s, i, values.length)}"${d.stroke(line(i))}/>`);
        pieLabel(d, s, i, s.vals[i] ?? 0, values[i] / sum, cx2, cy, (ang + b) / 2, r2 * 0.65, r2, base, date1904);
        ang = b;
      }
      if (sl) d.out.push(`<path d="M${pt(cx, cy, -halfAng, r)}L${num(cx2)} ${num(cy - r2)}M${pt(cx, cy, halfAng, r)}L${num(cx2)} ${num(cy + r2)}" fill="none"${d.stroke(sl)}/>`);
    }
  }
  env.warn('chart_redrawn');
}
function pieLabel(d: Drawing, s: Series, i: number, v: number, pct: number, cx: number, cy: number, mid: number, lr: number, outer: number, base: Font, date1904: boolean, flat = false) {
  const group = child(s.group, C, 'dLbls'), own = child(s.node, C, 'dLbls');
  const point = kids(own, C, 'dLbl').find(l => Number(val(l, 'idx')) === i);
  const chain = [group, own, point].filter((x): x is X => !!x);
  if (!chain.length) return;
  const pick = (name: string) => { for (let k = chain.length - 1; k >= 0; k--) { const x = child(chain[k], C, name); if (x) return at(x, 'val') ?? '1'; } return undefined; };
  if (pick('delete') === '1') return;
  const on = (name: string) => pick(name) === '1' || pick(name) === 'true';
  const fmtNode = [...chain].reverse().map(x => child(x, C, 'numFmt')).find(Boolean);
  const format = fmtNode && at(fmtNode, 'sourceLinked') !== '1' ? at(fmtNode, 'formatCode') : undefined;
  const parts = [on('showSerName') ? s.name : '', on('showCatName') ? s.cats[i] ?? '' : '', on('showVal') ? formatValue(v, format ?? s.valFormat ?? 'General', date1904) : '', on('showPercent') ? formatValue(pct, format && /%/.test(format) ? format : '0%') : ''].filter(Boolean);
  if (!parts.length) return;
  const sep = [...chain].reverse().map(x => child(x, C, 'separator')?.text).find(x => x !== undefined) ?? (parts.length > 2 ? ', ' : '\n');
  const f = d.font([...chain].reverse().map(x => child(x, C, 'txPr')).find(Boolean) ?? undefined, base);
  const pos = pick('dLblPos') ?? 'bestFit';
  if (flat) { d.text(cx, cy, parts.join(sep), f); return; }
  const outside = pos === 'outEnd' || pos === 'bestFit' && pct < 0.06;
  const rr = outside ? outer + f.size * 1.2 : pos === 'inEnd' ? outer * 0.8 : pos === 'ctr' ? outer * 0.5 : lr;
  const x = cx + rr * Math.cos(mid), y = cy + rr * Math.sin(mid);
  d.text(x, y, parts.join(sep), f, outside ? (Math.cos(mid) > 0.2 ? 'start' : Math.cos(mid) < -0.2 ? 'end' : 'middle') : 'middle');
}
function drawRadar(d: Drawing, list: Series[], box: Rect, plot: X, base: Font, date1904: boolean) {
  const g = list[0].group, filled = val(g, 'radarStyle') === 'filled';
  const count = Math.max(1, ...list.map(s => s.vals.length)), cats = list.reduce<string[]>((b, s) => s.cats.length > b.length ? s.cats : b, []);
  const valAx = child(plot, C, 'valAx'), catAx = child(plot, C, 'catAx');
  const values = list.flatMap(s => s.vals.filter((v): v is number => v !== null));
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const scaling = child(valAx, C, 'scaling');
  const auto = autoScale(lo, hi, clamp(Math.floor(Math.min(box.w, box.h) / 2 / (base.size * 2)), 2, 10), finite(val(valAx, 'majorUnit'), 0) > 0 ? Number(val(valAx, 'majorUnit')) : undefined);
  const step = auto.step, min = finite(val(scaling, 'min'), auto.min), max = finite(val(scaling, 'max'), auto.max);
  const f = d.font(child(catAx, C, 'txPr'), base), vf = d.font(child(valAx, C, 'txPr'), base);
  const r = Math.max(1, Math.min(box.w, box.h) / 2 - f.size * 2), cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const angle = (i: number) => -Math.PI / 2 + i * 2 * Math.PI / count;
  const at0 = (i: number, v: number) => { const t = clamp((v - min) / (max - min || 1), 0, 1.05) * r; return [cx + t * Math.cos(angle(i)), cy + t * Math.sin(angle(i))] as const; };
  const gridLine = d.line(child(child(valAx, C, 'majorGridlines'), C, 'spPr'), { color: GRID, width: 0.75 * 12700 * d.env.scale });
  const ticks: number[] = []; for (let t = min; t <= max + step / 1e6 && ticks.length < 40; t += step) ticks.push(t);
  if (child(valAx, C, 'majorGridlines') && gridLine) for (const t of ticks.slice(1)) d.out.push(`<path d="${Array.from({ length: count }, (_, i) => `${i ? 'L' : 'M'}${at0(i, t).map(num).join(' ')}`).join('')}Z" fill="none"${d.stroke(gridLine)}/>`);
  const spoke = d.line(child(catAx, C, 'spPr'), { color: GRID, width: 0.75 * 12700 * d.env.scale });
  for (let i = 0; i < count; i++) {
    const [x, y] = at0(i, max);
    if (spoke) d.out.push(`<line x1="${num(cx)}" y1="${num(cy)}" x2="${num(x)}" y2="${num(y)}"${d.stroke(spoke)}/>`);
    if (!flag(catAx, 'delete', false)) { const lx = cx + (r + f.size * 0.8) * Math.cos(angle(i)), ly = cy + (r + f.size * 0.8) * Math.sin(angle(i)); d.text(lx, ly, cats[i] ?? '', f, Math.abs(Math.cos(angle(i))) < 0.2 ? 'middle' : Math.cos(angle(i)) > 0 ? 'start' : 'end'); }
  }
  if (!flag(valAx, 'delete', false)) for (const t of ticks) { const [x, y] = at0(0, t); d.text(x - vf.size * 0.4, y, formatValue(t, at(child(valAx, C, 'numFmt'), 'formatCode') ?? 'General', date1904), vf, 'end'); }
  for (const s of list) {
    const pts = Array.from({ length: count }, (_, i) => at0(i, s.vals[i] ?? 0));
    const dpath = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${num(x)} ${num(y)}`).join('') + 'Z';
    if (filled) d.out.push(`<path d="${dpath}" fill="${s.fill}" fill-opacity="0.8"${d.stroke(d.line(child(s.node, C, 'spPr')) ?? null)}/>`);
    else if (s.line) d.out.push(`<path d="${dpath}" fill="none"${d.stroke(s.line)} stroke-linejoin="round"/>`);
    if (s.marker) pts.forEach(([x, y]) => marker(d, x, y, s.marker!));
    s.vals.forEach((v, i) => { if (v !== null) dataLabel(d, s, i, v, { x: pts[i][0], y: pts[i][1] }, 't', base, date1904, false, false); });
  }
}
/** A surface chart's value bands: the value axis's scale, each band in its own colour. */
interface Bands { ticks: number[]; fill: (k: number) => string; label: (k: number) => string }
function surfaceBands(d: Drawing, list: Series[], plot: X, color: (i: number, n: number) => string, date1904: boolean): Bands {
  const g = list[0].group, valAx = child(plot, C, 'valAx'), scaling = child(valAx, C, 'scaling');
  const vs = list.flatMap(s => s.vals.filter((v): v is number => v !== null));
  const unit = finite(val(valAx, 'majorUnit'), 0) > 0 ? Number(val(valAx, 'majorUnit')) : undefined;
  const auto = autoScale(Math.min(0, ...vs), Math.max(0, ...vs), 10, unit);
  const min = finite(val(scaling, 'min'), auto.min), max = finite(val(scaling, 'max'), auto.max);
  const step = unit ?? (max - min === auto.max - auto.min ? auto.step : niceStep(max - min, 10));
  const ticks: number[] = []; for (let t = min; t <= max + step / 1e6 && ticks.length <= 40; t += step) ticks.push(Math.round(t / step) * step);
  if (ticks.length < 2) ticks.push(min + step);
  const fmt = at(child(valAx, C, 'numFmt'), 'formatCode') ?? list[0].valFormat ?? 'General';
  return {
    ticks,
    fill: k => { const b = kids(child(g, C, 'bandFmts'), C, 'bandFmt').find(x => Number(val(x, 'idx')) === k); return d.fill(child(b, C, 'spPr')) ?? color(k, ticks.length - 1); },
    label: k => `${formatValue(ticks[k], fmt, date1904)}-${formatValue(ticks[k + 1], fmt, date1904)}`,
  };
}
/** A surface seen from above, as Office draws a contour chart: categories across, series up, each value band in its colour. */
function drawSurface(d: Drawing, list: Series[], box: Rect, plot: X, bands: Bands, base: Font) {
  d.env.warn('style_approximate', { chart: 'surface' });
  const catAx = child(plot, C, 'catAx'), serAx = child(plot, C, 'serAx');
  const cf = d.font(child(catAx, C, 'txPr'), base), sf = d.font(child(serAx, C, 'txPr'), base);
  const count = Math.max(2, ...list.map(s => s.vals.length)), rows = Math.max(2, list.length);
  const cats = list.reduce<string[]>((b, s) => s.cats.length > b.length ? s.cats : b, []);
  const left = flag(serAx, 'delete', false) ? 0 : Math.min(box.w * 0.3, Math.max(0, ...list.map(s => width(s.name, sf.size))) + sf.size);
  const P = { x: box.x + left, y: box.y, w: Math.max(1, box.w - left), h: Math.max(1, box.h - (flag(catAx, 'delete', false) ? 0 : cf.size * 1.8)) };
  const value = (r: number, i: number) => list[Math.min(r, list.length - 1)].vals[Math.min(i, count - 1)] ?? null;
  const band = (v: number) => { const t = bands.ticks; let k = 0; while (k < t.length - 2 && v >= t[k + 1]) k++; return k; };
  const cw = P.w / (count - 1), rh = P.h / (rows - 1);
  // each cell split into small squares coloured by the interpolated value, runs of one colour merged
  const n = clamp(Math.floor(Math.min(cw, rh) / 3), 1, 12);
  for (let r = 0; r < rows - 1; r++) for (let sy = 0; sy < n; sy++) {
    const fy = (sy + 0.5) / n, y = P.y + P.h - (r + (sy + 1) / n) * rh;
    let run: { x: number; k: number } | undefined;
    const flush = (x: number) => { if (run) d.out.push(`<rect x="${num(run.x)}" y="${num(y)}" width="${num(x - run.x + 0.4)}" height="${num(rh / n + 0.4)}" fill="${bands.fill(run.k)}"/>`); run = undefined; };
    for (let i = 0; i < count - 1; i++) {
      const c = [value(r, i), value(r, i + 1), value(r + 1, i), value(r + 1, i + 1)];
      for (let sx = 0; sx < n; sx++) {
        const x = P.x + (i + sx / n) * cw;
        if (c.some(v => v === null)) { flush(x); continue; }
        const fx = (sx + 0.5) / n, [a, b, e, f] = c as number[];
        const k = band(a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + e * (1 - fx) * fy + f * fx * fy);
        if (run && run.k !== k) flush(x);
        if (!run) run = { x, k };
      }
    }
    flush(P.x + P.w);
  }
  const gl = d.line(child(child(child(plot, C, 'valAx'), C, 'majorGridlines'), C, 'spPr'), { color: '#ffffff', width: 0.5 });
  if (gl) {
    for (let i = 0; i < count; i++) d.out.push(`<line x1="${num(P.x + i * cw)}" y1="${num(P.y)}" x2="${num(P.x + i * cw)}" y2="${num(P.y + P.h)}"${d.stroke({ ...gl, width: Math.min(gl.width, 0.75) })} stroke-opacity="0.5"/>`);
    for (let r = 0; r < rows; r++) d.out.push(`<line x1="${num(P.x)}" y1="${num(P.y + r * rh)}" x2="${num(P.x + P.w)}" y2="${num(P.y + r * rh)}"${d.stroke({ ...gl, width: Math.min(gl.width, 0.75) })} stroke-opacity="0.5"/>`);
  }
  if (!flag(catAx, 'delete', false)) for (let i = 0; i < count; i++) d.text(P.x + i * cw, P.y + P.h + cf.size * 0.9, cats[i] ?? '', cf);
  if (left) list.forEach((s, r) => d.text(P.x - sf.size * 0.5, P.y + P.h - r * rh, s.name, sf, 'end'));
}

// ---- Office 2016 charts -----------------------------------------------------------------------
interface Dim { levels: (string | undefined)[][]; nums: (number | null)[]; format?: string; count: number }
function cxDim(data: X | undefined, type: string): Dim | undefined {
  const dim = data?.children.find(n => n.uri === CX && (n.name === 'numDim' || n.name === 'strDim') && at(n, 'type') === type);
  if (!dim) return undefined;
  const lvls = kids(dim, CX, 'lvl');
  const levels = lvls.map(l => { const out: (string | undefined)[] = []; for (const p of kids(l, CX, 'pt')) { const i = Math.round(Number(at(p, 'idx'))); if (i >= 0 && i < CHART_POINTS) out[i] = p.text; } return out; });
  const count = Math.min(CHART_POINTS, Math.max(...lvls.map(l => Math.round(finite(at(l, 'ptCount'), 0))), ...levels.map(l => l.length), 0));
  return { levels, nums: Array.from({ length: count }, (_, i) => { const v = levels[0]?.[i]; const n = v === undefined || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : null; }), format: at(lvls[0], 'formatCode'), count };
}
const cxText = (n: X | undefined) => { const tx = child(n, CX, 'tx'); const data = child(tx, CX, 'txData'); return child(data, CX, 'v')?.text ?? (child(tx, CX, 'rich') ? kids(child(tx, CX, 'rich'), A, 'p').map(p => walk(p, A, 't').map(t => t.text).join('')).join('\n') : ''); };
/** The drawing of an Office 2016 chart part, or undefined when it holds none this draws (a map). */
export function drawChartEx(space: X, w: number, h: number, css: string, env: ChartEnv): { svg: string; title: string } | undefined {
  const chart = child(space, CX, 'chart'), region = path(chart, [CX, 'plotArea'], [CX, 'plotAreaRegion']);
  const series = kids(region, CX, 'series').filter(s => at(s, 'hidden') !== '1');
  if (!series.length) return undefined;
  const layout = at(series[0], 'layoutId') ?? '';
  if (!['waterfall', 'funnel', 'clusteredColumn', 'paretoLine', 'boxWhisker', 'treemap', 'sunburst'].includes(layout)) return undefined;
  const datas = new Map(kids(child(space, CX, 'chartData'), CX, 'data').map(n => [at(n, 'id') ?? '', n]));
  const dataOf = (s: X) => datas.get(at(child(s, CX, 'dataId'), 'val') ?? '0');
  const face = env.face('+mn-lt') ?? 'Arial';
  const d = new Drawing(env, { size: 9 * 12700 * env.scale, color: '#595959', bold: false, italic: false, face });
  const base = d.font(child(space, CX, 'txPr'));
  (d as { base: Font }).base = base;
  const color = palette(env, undefined, undefined);
  const pad = base.size * 0.7;
  let box: Rect = { x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad };
  const bg = d.fill(child(space, CX, 'spPr')), border = d.line(child(space, CX, 'spPr'));
  if (bg && bg !== 'none' || border) d.out.push(`<rect x="0" y="0" width="${num(w)}" height="${num(h)}" fill="${bg ?? 'none'}"${d.stroke(border)}/>`);
  const titleNode = child(chart, CX, 'title');
  const title = titleNode ? cxText(titleNode) : '';
  if (title) { const f = d.font(child(titleNode, CX, 'txPr') ?? child(child(titleNode, CX, 'tx'), CX, 'rich'), { ...base, size: base.size * 1.55 }); d.text(w / 2, box.y + f.size * 0.6, title, f); box = { ...box, y: box.y + f.size * 1.5, h: box.h - f.size * 1.5 }; }
  const s0 = series[0], data = dataOf(s0);
  const cat = cxDim(data, 'cat'), values = cxDim(data, 'val') ?? cxDim(data, 'size');
  if (!values) return undefined;
  const pointFill = (s: X, i: number, fallback: string) => d.fill(child(kids(s, CX, 'dataPt').find(p => Number(at(p, 'idx')) === i), CX, 'spPr')) ?? fallback;
  const seriesFill = (s: X, i: number) => d.fill(child(s, CX, 'spPr')) ?? color(i, series.length);
  const labelsOn = (s: X) => { const l = child(s, CX, 'dataLabels'); const v = child(l, CX, 'visibility'); return l && !(at(l, 'hidden') === '1') ? { value: at(v, 'value') !== '0', cat: at(v, 'categoryName') === '1', series: at(v, 'seriesName') === '1', font: d.font(child(l, CX, 'txPr'), base), format: at(child(l, CX, 'numFmt'), 'formatCode') } : undefined; };
  const axes = kids(path(chart, [CX, 'plotArea']), CX, 'axis');
  const valAxis = axes.find(a => child(a, CX, 'valScaling')), catAxis = axes.find(a => child(a, CX, 'catScaling'));
  const legend = child(chart, CX, 'legend');
  const fmt = (v: number, code?: string) => formatValue(v, code ?? values.format ?? 'General');
  const leafs = (cat?.levels[0] ?? []).map(x => x ?? '');

  /** Value axis and gridlines for column-like layouts; returns the value-to-y mapping. */
  const columns = (lo: number, hi: number, labels: string[], right = 0) => {
    const f = d.font(child(valAxis, CX, 'txPr'), base), cf = d.font(child(catAxis, CX, 'txPr'), base);
    const sc = child(valAxis, CX, 'valScaling');
    const auto = autoScale(lo, hi, clamp(Math.floor(box.h / (base.size * 2.2)), 2, 10), finite(at(sc, 'majorUnit'), 0) > 0 ? Number(at(sc, 'majorUnit')) : undefined);
    const step = auto.step;
    const min = at(sc, 'min') && at(sc, 'min') !== 'auto' ? finite(at(sc, 'min'), 0) : auto.min;
    const max = at(sc, 'max') && at(sc, 'max') !== 'auto' ? finite(at(sc, 'max'), 1) : auto.max;
    const ticks: number[] = []; for (let t = min; t <= max + step / 1e6 && ticks.length < 40; t += step) ticks.push(t);
    const shown = valAxis && at(valAxis, 'hidden') !== '1';
    const lw = shown ? Math.max(...ticks.map(t => width(fmt(t, at(child(valAxis, CX, 'numFmt'), 'formatCode')), f.size))) + pad : 0;
    const longest = Math.max(0, ...labels.map(t => width(t, cf.size))), bandW = (box.w - lw - right) / Math.max(1, labels.length);
    const rotate = longest > bandW * 0.95;
    const P = { x: box.x + lw, y: box.y, w: Math.max(1, box.w - lw - right), h: Math.max(1, box.h - (rotate ? Math.min(box.h * 0.35, longest * 0.72 + cf.size) : cf.size * 1.8)) };
    const y = (v: number) => P.y + P.h - (v - min) / (max - min || 1) * P.h;
    const gl = d.line(child(child(valAxis, CX, 'majorGridlines'), CX, 'spPr'), { color: GRID, width: 0.75 * 12700 * env.scale });
    for (const t of ticks) {
      if (child(valAxis, CX, 'majorGridlines') && gl) d.out.push(`<line x1="${num(P.x)}" y1="${num(y(t))}" x2="${num(P.x + P.w)}" y2="${num(y(t))}"${d.stroke(gl)}/>`);
      if (shown) d.text(P.x - pad * 0.4, y(t), fmt(t, at(child(valAxis, CX, 'numFmt'), 'formatCode')), f, 'end');
    }
    const band = P.w / Math.max(1, labels.length);
    if (catAxis && at(catAxis, 'hidden') !== '1') labels.forEach((t, i) => rotate ? d.text(P.x + (i + 0.5) * band, P.y + P.h + cf.size * 0.6, t, cf, 'end', -45, 'top') : d.text(P.x + (i + 0.5) * band, P.y + P.h + cf.size * 0.9, t, cf));
    d.out.push(`<line x1="${num(P.x)}" y1="${num(y(clamp(0, min, max)))}" x2="${num(P.x + P.w)}" y2="${num(y(clamp(0, min, max)))}" stroke="#bfbfbf" stroke-width="1"/>`);
    const gap = finite(at(child(catAxis, CX, 'catScaling'), 'gapWidth'), layout === 'clusteredColumn' ? 0 : 0.5);
    return { P, y, band, bar: band / (1 + gap), min, max };
  };

  if (layout === 'waterfall') {
    const subtotals = new Set(kids(path(s0, [CX, 'layoutPr'], [CX, 'subtotals']), CX, 'idx').map(n => Number(at(n, 'val'))));
    const legendNames = ['Increase', 'Decrease', 'Total'];
    const fills = [color(0, 6), color(1, 6), color(2, 6)];
    if (legend) { const f = d.font(child(legend, CX, 'txPr'), base); let x = box.x + box.w / 2 - legendNames.reduce((a, t) => a + width(t, f.size) + f.size * 2, 0) / 2; const y = at(legend, 'pos') === 't' ? box.y + f.size : box.y + box.h - f.size * 0.6; legendNames.forEach((t, i) => { d.out.push(`<rect x="${num(x)}" y="${num(y - f.size * 0.35)}" width="${num(f.size * 0.7)}" height="${num(f.size * 0.7)}" fill="${fills[i]}"/>`); d.text(x + f.size, y, t, f, 'start'); x += width(t, f.size) + f.size * 2; }); if (at(legend, 'pos') === 't') box = { ...box, y: box.y + f.size * 2, h: box.h - f.size * 2 }; else box = { ...box, h: box.h - f.size * 2 }; }
    let run = 0; const spans: [number, number, number][] = [];
    // a total stands on the axis at its own value, and the run carries on from it
    values.nums.forEach((v, i) => { const x = v ?? 0; if (subtotals.has(i)) { spans.push([0, x, 2]); run = x; } else { spans.push([run, run + x, x >= 0 ? 0 : 1]); run += x; } });
    const all = spans.flat().filter((_, k) => k % 3 !== 2);
    const { y, band, bar, P } = columns(Math.min(0, ...all), Math.max(0, ...all), leafs);
    const labels = labelsOn(s0);
    const connector = !(at(child(path(s0, [CX, 'layoutPr']), CX, 'visibility'), 'connectorLines') === '0');
    spans.forEach(([a, b, k], i) => {
      const x = P.x + i * band + (band - bar) / 2;
      d.out.push(`<rect x="${num(x)}" y="${num(Math.min(y(a), y(b)))}" width="${num(bar)}" height="${num(Math.max(0.5, Math.abs(y(a) - y(b))))}" fill="${pointFill(s0, i, fills[k])}"/>`);
      if (connector && i < spans.length - 1) d.out.push(`<line x1="${num(x + bar)}" y1="${num(y(b))}" x2="${num(x + band)}" y2="${num(y(b))}" stroke="#a6a6a6" stroke-width="0.75"/>`);
      // labels outside the bar's end: above a rise or total, below a fall
      if (labels?.value) d.text(x + bar / 2, k === 1 ? Math.max(y(a), y(b)) + labels.font.size * 0.7 : Math.min(y(a), y(b)) - labels.font.size * 0.6, fmt(values.nums[i] ?? (b - a), labels.format), labels.font);
    });
  } else if (layout === 'funnel') {
    const nums = values.nums.map(v => Math.max(0, v ?? 0)), most = Math.max(1e-12, ...nums);
    const f = d.font(child(catAxis, CX, 'txPr'), base);
    const lw = catAxis && at(catAxis, 'hidden') !== '1' ? Math.min(box.w * 0.3, Math.max(0, ...leafs.map(t => width(t, f.size))) + pad) : 0;
    const P = { x: box.x + lw, y: box.y, w: box.w - lw, h: box.h };
    const rowH = P.h / Math.max(1, nums.length), bh = rowH / (1 + finite(at(child(catAxis, CX, 'catScaling'), 'gapWidth'), 0.06));
    const labels = labelsOn(s0) ?? { value: true, cat: false, series: false, font: { ...base, color: '#ffffff' }, format: undefined };
    nums.forEach((v, i) => {
      const bw = v / most * P.w, x = P.x + (P.w - bw) / 2, yy = P.y + i * rowH + (rowH - bh) / 2;
      d.out.push(`<rect x="${num(x)}" y="${num(yy)}" width="${num(bw)}" height="${num(bh)}" fill="${pointFill(s0, i, seriesFill(s0, 0))}"/>`);
      if (lw) d.text(P.x - pad * 0.4, yy + bh / 2, leafs[i] ?? '', f, 'end');
      if (labels.value) d.text(P.x + P.w / 2, yy + bh / 2, fmt(v, labels.format), { ...labels.font, color: child(child(s0, CX, 'dataLabels'), CX, 'txPr') ? labels.font.color : '#ffffff' });
    });
  } else if (layout === 'clusteredColumn' || layout === 'paretoLine') {
    // histogram: bins from the layout's binning, or by category when it bins nothing
    const hist = series.find(s => at(s, 'layoutId') === 'clusteredColumn') ?? s0;
    const hd = dataOf(hist), hv = cxDim(hd, 'val'), hc = cxDim(hd, 'cat');
    const nums = (hv?.nums ?? []).filter((v): v is number => v !== null);
    const binning = path(hist, [CX, 'layoutPr'], [CX, 'binning']);
    let bins: { label: string; v: number }[];
    if (binning || !hc) {
      const lo = Math.min(...nums), hi = Math.max(...nums);
      const under = binning && at(binning, 'underflow') && at(binning, 'underflow') !== 'auto' ? Number(at(binning, 'underflow')) : undefined;
      const over = binning && at(binning, 'overflow') && at(binning, 'overflow') !== 'auto' ? Number(at(binning, 'overflow')) : undefined;
      const from = under ?? lo, to = over ?? hi;
      const size = finite(child(binning, CX, 'binSize')?.text || at(child(binning, CX, 'binSize'), 'val'), 0);
      const countB = finite(child(binning, CX, 'binCount')?.text || at(child(binning, CX, 'binCount'), 'val'), 0);
      // Scott's rule, as Excel's automatic bins
      const sd = Math.sqrt(nums.reduce((a, v) => a + (v - nums.reduce((x, y) => x + y, 0) / nums.length) ** 2, 0) / Math.max(1, nums.length - 1));
      const width0 = size > 0 ? size : countB > 0 ? (to - from) / countB : 3.5 * sd / Math.cbrt(Math.max(1, nums.length)) || 1;
      const n = clamp(Math.ceil((to - from) / width0) || 1, 1, 200);
      const closedLeft = at(binning, 'intervalClosed') === 'l';
      // edges rounded to the bin width, as Excel shows them
      const places = clamp(Math.ceil(-Math.log10(width0)) + 1, 0, 6), whole = Number.isInteger(width0) && Number.isInteger(from);
      const edge = (v: number) => whole ? fmt(v) : v.toFixed(places);
      bins = Array.from({ length: n }, (_, k) => { const a = from + k * width0, b = a + width0; return { label: `${closedLeft ? '[' : k ? '(' : '['}${edge(a)}, ${edge(b)}${closedLeft ? ')' : ']'}`, v: nums.filter(x => (k === 0 ? x >= a : closedLeft ? x >= a : x > a) && (closedLeft ? x < b || k === n - 1 && x <= b : x <= b)).length }; });
      if (under !== undefined) bins.unshift({ label: `≤${edge(under)}`, v: nums.filter(x => x < under).length });
      if (over !== undefined) bins.push({ label: `>${edge(over)}`, v: nums.filter(x => x > over).length });
    } else bins = (hc.levels[0] ?? []).map((t, i) => ({ label: t ?? '', v: hv?.nums[i] ?? 0 }));
    const pareto = series.some(s => at(s, 'layoutId') === 'paretoLine');
    if (pareto) bins.sort((a, b) => b.v - a.v);
    const { y, band, bar, P } = columns(0, Math.max(...bins.map(b => b.v), 1), bins.map(b => b.label), pareto ? base.size * 3 : 0);
    const labels = labelsOn(hist);
    bins.forEach((b, i) => {
      const x = P.x + i * band + (band - bar) / 2;
      d.out.push(`<rect x="${num(x)}" y="${num(y(b.v))}" width="${num(bar)}" height="${num(Math.max(0, y(0) - y(b.v)))}" fill="${pointFill(hist, i, seriesFill(hist, 0))}"${bar === band ? ' stroke="#ffffff" stroke-width="0.75"' : ''}/>`);
      if (labels?.value) d.text(x + bar / 2, y(b.v) - labels.font.size * 0.6, fmt(b.v), labels.font);
    });
    if (pareto) {
      const total = bins.reduce((a, b) => a + b.v, 0) || 1; let run = 0;
      const pts = bins.map((b, i) => { run += b.v; return [P.x + (i + 0.5) * band, P.y + P.h - run / total * P.h] as const; });
      const ps = series.find(s => at(s, 'layoutId') === 'paretoLine')!;
      const l = d.line(child(ps, CX, 'spPr'), { color: color(1, 2), width: 2.25 * 12700 * env.scale });
      d.out.push(`<path d="${pts.map(([x, yy], i) => `${i ? 'L' : 'M'}${num(x)} ${num(yy)}`).join('')}" fill="none"${d.stroke(l)}/>`);
      for (let k = 0; k <= 4; k++) d.text(P.x + P.w + pad * 0.4, P.y + P.h - k / 4 * P.h, `${k * 25}%`, base, 'start');
    }
  } else if (layout === 'boxWhisker') {
    const groupsOf = (s: X) => { const dd = dataOf(s), v = cxDim(dd, 'val'), c = cxDim(dd, 'cat'); const by = new Map<string, number[]>(); (v?.nums ?? []).forEach((x, i) => { if (x === null) return; const k = c?.levels[0]?.[i] ?? ''; by.set(k, [...(by.get(k) ?? []), x]); }); return by; };
    const per = series.map(groupsOf);
    const labelsCats = [...new Set(per.flatMap(m => [...m.keys()]))];
    const allNums = per.flatMap(m => [...m.values()].flat());
    const { y, band, P } = columns(Math.min(...allNums), Math.max(...allNums), labelsCats.length === 1 && labelsCats[0] === '' ? [''] : labelsCats);
    const inner = band / (1 + 1), slot = inner / Math.max(1, series.length);
    series.forEach((s, k) => {
      const exclusive = at(path(s, [CX, 'layoutPr'], [CX, 'statistics']), 'quartileMethod') === 'exclusive';
      const vis = path(s, [CX, 'layoutPr'], [CX, 'visibility']);
      const fill = seriesFill(s, k);
      labelsCats.forEach((c, i) => {
        const xs = [...(per[k].get(c) ?? [])].sort((a, b) => a - b); if (!xs.length) return;
        const q = (p: number) => { const n = xs.length; const pos = exclusive ? p * (n + 1) - 1 : p * (n - 1); const lo = clamp(Math.floor(pos), 0, n - 1), hi = clamp(Math.ceil(pos), 0, n - 1); return xs[lo] + (xs[hi] - xs[lo]) * (pos - Math.floor(pos)); };
        const q1 = q(0.25), q2 = q(0.5), q3 = q(0.75), iqr = q3 - q1;
        const inside = xs.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr), lo = Math.min(...inside), hi = Math.max(...inside);
        const cx = P.x + (i + 0.25) * band + (k + 0.5) * slot, bw = slot * 0.8;
        d.out.push(`<line x1="${num(cx)}" y1="${num(y(hi))}" x2="${num(cx)}" y2="${num(y(lo))}" stroke="#595959" stroke-width="0.75"/><line x1="${num(cx - bw / 4)}" y1="${num(y(hi))}" x2="${num(cx + bw / 4)}" y2="${num(y(hi))}" stroke="#595959" stroke-width="0.75"/><line x1="${num(cx - bw / 4)}" y1="${num(y(lo))}" x2="${num(cx + bw / 4)}" y2="${num(y(lo))}" stroke="#595959" stroke-width="0.75"/>`);
        d.out.push(`<rect x="${num(cx - bw / 2)}" y="${num(y(q3))}" width="${num(bw)}" height="${num(Math.max(0.5, y(q1) - y(q3)))}" fill="${fill}" stroke="#595959" stroke-width="0.75"/><line x1="${num(cx - bw / 2)}" y1="${num(y(q2))}" x2="${num(cx + bw / 2)}" y2="${num(y(q2))}" stroke="#ffffff" stroke-width="1"/>`);
        if (at(vis, 'meanMarker') !== '0') { const mean = xs.reduce((a, b) => a + b, 0) / xs.length; marker(d, cx, y(mean), { symbol: 'x', size: bw / 4, fill: '#ffffff', line: { color: '#ffffff', width: 1 } }); }
        if (at(vis, 'outliers') !== '0') for (const v of xs.filter(v => !inside.includes(v))) d.out.push(`<circle cx="${num(cx)}" cy="${num(y(v))}" r="${num(bw / 10)}" fill="none" stroke="${fill}"/>`);
      });
    });
  } else {
    // treemap and sunburst: categories in levels, the first next to the values
    const depth = cat?.levels.length ?? 1;
    const leaves = values.nums.map((v, i) => ({ path: Array.from({ length: depth }, (_, k) => cat?.levels[depth - 1 - k]?.[i]).filter((x): x is string => !!x), v: Math.max(0, v ?? 0), i })).filter(l => l.v > 0);
    interface Node { name: string; v: number; kids: Node[]; i?: number; top: number }
    const root: Node = { name: '', v: 0, kids: [], top: 0 };
    const tops: string[] = [];
    for (const l of leaves) {
      let n = root;
      l.path.forEach((name, k) => {
        if (k === 0 && !tops.includes(name)) tops.push(name);
        let c = n.kids.find(x => x.name === name);
        if (!c) { c = { name, v: 0, kids: [], top: tops.indexOf(l.path[0]) }; n.kids.push(c); }
        c.v += l.v; n = c;
      });
      n.i = l.i; root.v += l.v;
    }
    const fillOf = (n: Node) => n.i !== undefined ? pointFill(s0, n.i, color(n.top, tops.length)) : color(n.top, tops.length);
    const labels = labelsOn(s0) ?? { value: false, cat: true, series: false, font: base, format: undefined };
    const white = { ...labels.font, color: child(child(s0, CX, 'dataLabels'), CX, 'txPr') ? labels.font.color : '#ffffff' };
    if (legend) {
      const f = d.font(child(legend, CX, 'txPr'), base); let x = box.x + box.w / 2 - tops.reduce((a, t) => a + width(t, f.size) + f.size * 2, 0) / 2; const y = box.y + box.h - f.size * 0.6;
      tops.forEach((t, i) => { d.out.push(`<rect x="${num(x)}" y="${num(y - f.size * 0.35)}" width="${num(f.size * 0.7)}" height="${num(f.size * 0.7)}" fill="${color(i, tops.length)}"/>`); d.text(x + f.size, y, t, f, 'start'); x += width(t, f.size) + f.size * 2; });
      box = { ...box, h: box.h - f.size * 2 };
    }
    if (layout === 'treemap') {
      const banner = at(path(s0, [CX, 'layoutPr'], [CX, 'parentLabelLayout']), 'val') ?? 'overlapping';
      const place = (nodes: Node[], r: Rect, level: number) => {
        // squarified: rows of nodes along the shorter side, keeping cells close to square
        const total = nodes.reduce((a, n) => a + n.v, 0) || 1, items = [...nodes].sort((a, b) => b.v - a.v);
        let rect = { ...r };
        let rowItems: Node[] = [];
        const worst = (row: Node[], side: number) => { const s = row.reduce((a, n) => a + n.v, 0) * (r.w * r.h) / total; const mx = Math.max(...row.map(n => n.v * (r.w * r.h) / total)), mn = Math.min(...row.map(n => n.v * (r.w * r.h) / total)); return Math.max(side * side * mx / (s * s), s * s / (side * side * mn)); };
        const layoutRow = (row: Node[]) => {
          const area = row.reduce((a, n) => a + n.v, 0) * (r.w * r.h) / total, vertical = rect.w >= rect.h;
          const thick = vertical ? area / rect.h : area / rect.w;
          let off = 0;
          for (const n of row) {
            const len = (n.v * (r.w * r.h) / total) / thick;
            const cell = vertical ? { x: rect.x, y: rect.y + off, w: thick, h: len } : { x: rect.x + off, y: rect.y, w: len, h: thick };
            off += len;
            draw(n, cell, level);
          }
          rect = vertical ? { x: rect.x + thick, y: rect.y, w: rect.w - thick, h: rect.h } : { x: rect.x, y: rect.y + thick, w: rect.w, h: rect.h - thick };
        };
        for (const n of items) {
          const side = Math.min(rect.w, rect.h);
          if (!rowItems.length || worst([...rowItems, n], side) <= worst(rowItems, side)) rowItems.push(n);
          else { layoutRow(rowItems); rowItems = [n]; }
        }
        if (rowItems.length) layoutRow(rowItems);
      };
      const corners: [number, number][] = [];
      const draw = (n: Node, r: Rect, level: number) => {
        if (!n.kids.length) {
          d.out.push(`<rect x="${num(r.x)}" y="${num(r.y)}" width="${num(Math.max(0, r.w))}" height="${num(Math.max(0, r.h))}" fill="${fillOf(n)}" stroke="#ffffff" stroke-width="1"/>`);
          const t = [labels.cat ? n.name : '', labels.value ? fmt(n.v, labels.format) : ''].filter(Boolean).join('\n');
          const below = corners.some(([x, y]) => Math.abs(x - r.x) < 0.5 && Math.abs(y - r.y) < 0.5) ? white.size * 1.3 : 0;
          if (t && r.w > white.size * 2 && r.h > white.size * 1.4 + below) d.text(r.x + white.size * 0.4, r.y + white.size * 0.4 + below, t, white, 'start', 0, 'top');
          return;
        }
        const head = banner === 'banner' ? white.size * 1.5 : 0;
        if (banner === 'overlapping' && level === 0) corners.push([r.x, r.y]);
        if (head) { d.out.push(`<rect x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(head)}" fill="${color(n.top, tops.length)}" stroke="#ffffff" stroke-width="1"/>`); d.text(r.x + white.size * 0.4, r.y + head / 2, n.name, white, 'start'); }
        place(n.kids, { x: r.x, y: r.y + head, w: r.w, h: r.h - head }, level + 1);
        if (banner === 'overlapping' && level === 0 && r.w > white.size * 3) d.text(r.x + white.size * 0.4, r.y + white.size * 0.4, n.name, { ...white, bold: true }, 'start', 0, 'top');
      };
      place(root.kids, box, 0);
    } else {
      const levels = Math.max(1, depth), cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.min(box.w, box.h) / 2;
      const hole = R * 0.12, ring = (R - hole) / levels;
      const pt = (ang: number, rad: number) => `${num(cx + rad * Math.cos(ang))} ${num(cy + rad * Math.sin(ang))}`;
      const draw = (nodes: Node[], a0: number, a1: number, level: number) => {
        const total = nodes.reduce((s, n) => s + n.v, 0) || 1; let a = a0;
        for (const n of nodes) {
          const b = a + (a1 - a0) * n.v / total, r0 = hole + level * ring, r1 = n.kids.length ? r0 + ring : R, large = b - a > Math.PI ? 1 : 0;
          // a whole ring cannot be one arc (its ends meet): two halves
          const arc = (from: number, to: number, big: number) => `M${pt(from, r0)}L${pt(from, r1)}A${num(r1)} ${num(r1)} 0 ${big} 1 ${pt(to, r1)}L${pt(to, r0)}A${num(r0)} ${num(r0)} 0 ${big} 0 ${pt(from, r0)}Z`;
          d.out.push(`<path d="${b - a >= Math.PI * 2 - 1e-9 ? arc(a, a + Math.PI, 0) + arc(a + Math.PI, b, 0) : arc(a, b, large)}" fill="${fillOf(n)}" stroke="#ffffff" stroke-width="1"/>`);
          const mid = (a + b) / 2, rm = (r0 + Math.min(r1, r0 + ring)) / 2;
          if ((b - a) * rm > white.size * 1.5) { let deg = mid * 180 / Math.PI; if (Math.cos(mid) < 0) deg += 180; d.text(cx + rm * Math.cos(mid), cy + rm * Math.sin(mid), n.name, white, 'middle', deg); }
          if (n.kids.length) draw(n.kids, a, b, level + 1);
          a = b;
        }
      };
      draw(root.kids, -Math.PI / 2, Math.PI * 1.5, 0);
    }
  }
  env.warn('chart_redrawn');
  return { svg: d.svg(w, h, title || 'Chart', css), title };
}
