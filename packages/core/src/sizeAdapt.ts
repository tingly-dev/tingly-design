/**
 * Content that follows a size change (`.research/size-adapt.md`).
 *
 * Layouts are written in CSS pixels for one reference size. `adaptSize` rewrites the inline styles of a
 * file written for `from` so they fit `to`: horizontal lengths follow the width ratio, vertical ones the
 * height ratio, and everything with no axis (type, radii, gaps, borders, shadows) the smaller of the two,
 * so text never grows past what the box can hold. Only literal `px` lengths change; holes (`{{x}}`),
 * `calc()`, `%`, `vw` and the rest of the file are kept byte for byte.
 */
import { rootElement } from './ops';
import { parseDc, type DcElement } from './parse';
import { getStyle, parseStyle } from './style';

export type Size = readonly [number, number];

/** How far the aspect ratio may move before a mechanical rescale is not enough on its own. */
export const ADAPT_RATIO_LIMIT = 1.3;

/** A box this small on both sides is an icon, avatar or dot, and keeps its proportions. */
const SMALL_PX = 64;

type Axis = 'x' | 'y' | 'u';

const AXIS: Record<string, Axis> = {
  width: 'x', 'min-width': 'x', 'max-width': 'x', left: 'x', right: 'x', 'margin-left': 'x', 'margin-right': 'x',
  'padding-left': 'x', 'padding-right': 'x', 'column-gap': 'x', 'text-indent': 'x',
  height: 'y', 'min-height': 'y', 'max-height': 'y', top: 'y', bottom: 'y', 'margin-top': 'y', 'margin-bottom': 'y',
  'padding-top': 'y', 'padding-bottom': 'y', 'row-gap': 'y',
  'font-size': 'u', 'letter-spacing': 'u', 'line-height': 'u', 'border-radius': 'u', 'border-width': 'u', border: 'u',
  'border-top': 'u', 'border-right': 'u', 'border-bottom': 'u', 'border-left': 'u', outline: 'u', gap: 'u',
  'box-shadow': 'u', 'text-shadow': 'u', 'stroke-width': 'u', 'flex-basis': 'x',
};

/** Shorthands whose 1 to 4 values run top, right, bottom, left. */
const BOX = new Set(['margin', 'padding', 'inset']);
const PX = /(-?\d*\.?\d+)px\b/g;

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function scaleValue(value: string, k: number): string {
  return value.replace(PX, (_, n: string) => `${fmt(parseFloat(n) * k)}px`);
}

/** Split on spaces outside parentheses. */
function words(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of value) {
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    if (c === ' ' && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function adaptDecl(prop: string, value: string, sx: number, sy: number, small: boolean): string {
  if (/\{\{|calc\(|var\(/.test(value) || !PX.test(value)) return value;
  PX.lastIndex = 0;
  const u = Math.min(sx, sy);
  if (BOX.has(prop)) {
    const w = words(value);
    if (!w.length || w.length > 4) return value;
    // top right bottom left, with the CSS rules for fewer values
    const sides = w.length === 1 ? [0, 0, 0, 0] : w.length === 2 ? [0, 1, 0, 1] : w.length === 3 ? [0, 1, 2, 1] : [0, 1, 2, 3];
    return w.map((v, i) => scaleValue(v, sides.indexOf(i) % 2 === 0 ? sy : sx)).join(' ');
  }
  if (prop === 'gap') {
    const w = words(value);
    return w.length === 2 ? `${scaleValue(w[0], sy)} ${scaleValue(w[1], sx)}` : scaleValue(value, u);
  }
  const axis = small && (prop === 'width' || prop === 'height') ? 'u' : AXIS[prop];
  return axis ? scaleValue(value, axis === 'x' ? sx : axis === 'y' ? sy : u) : value;
}

/** A style attribute's text rescaled; declarations that are not lengths come back as written. */
export function adaptStyle(style: string, sx: number, sy: number): string {
  let out = style;
  const decls = parseStyle(style);
  // an icon or avatar keeps its shape: a box with both sides small is scaled as one
  const px = (prop: string) => Number(/^([\d.]+)px$/.exec(decls.find((d) => d.prop === prop)?.value ?? '')?.[1] ?? Infinity);
  const small = px('width') <= SMALL_PX && px('height') <= SMALL_PX;
  for (const d of decls) {
    const next = adaptDecl(d.prop, d.value, sx, sy, small);
    if (next === d.value) continue;
    const colon = d.raw.indexOf(':');
    const lead = /^\s*/.exec(d.raw.slice(colon + 1))![0];
    const tail = /\s*$/.exec(d.raw)![0];
    out = out.replace(d.raw, d.raw.slice(0, colon + 1) + lead + next + tail);
  }
  return out;
}

/** The width-to-height ratio change from one size to another, always at least 1 (2 means twice as different). */
export function aspectShift(from: Size, to: Size): number {
  const r = from[0] / from[1] / (to[0] / to[1]);
  return r >= 1 ? r : 1 / r;
}

/** True when a mechanical rescale alone is unlikely to give a good layout, so an agent re-layout is worth offering. */
export function needsRelayout(from: Size, to: Size): boolean {
  return aspectShift(from, to) > ADAPT_RATIO_LIMIT;
}

/**
 * `source` (an artboard, slide or scene written for `from`) with its lengths rescaled for `to`. The root element's
 * own width and height become `to` when it states them in pixels (`root: false` leaves the root alone, for a slide
 * or scene whose size comes from elsewhere).
 */
export function adaptSize(source: string, from: Size, to: Size, opts: { root?: boolean } = {}): string {
  const sx = to[0] / from[0];
  const sy = to[1] / from[1];
  if (!(sx > 0 && sy > 0) || (sx === 1 && sy === 1)) return source;
  const doc = parseDc(source);
  const root = opts.root === false ? undefined : rootElement(doc);
  const edits: { start: number; end: number; text: string }[] = [];
  for (const el of doc.elements as DcElement[]) {
    const a = el.attrs.find((x) => x.name === 'style');
    if (!a?.range) continue;
    const q = source[a.range.end - 1];
    const body = source.slice(a.range.start, a.range.end);
    const valueAt = body.indexOf(q) + 1;
    let style = body.slice(valueAt, body.length - 1);
    if (/&[a-z#]/i.test(style)) continue;
    style = adaptStyle(style, sx, sy);
    if (el === root) {
      style = style.replace(/(^|;)(\s*)width\s*:\s*[\d.]+px/i, `$1$2width:${to[0]}px`).replace(/(^|;)(\s*)height\s*:\s*[\d.]+px/i, `$1$2height:${to[1]}px`);
    }
    const text = body.slice(0, valueAt) + style + q;
    if (text !== body) edits.push({ start: a.range.start, end: a.range.end, text });
  }
  let out = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** The size the root element states in pixels, if it states both. */
export function rootSize(source: string): Size | null {
  const root = rootElement(parseDc(source));
  const style = root?.attrs.find((a) => a.name === 'style')?.value;
  if (!style) return null;
  const w = /^([\d.]+)px$/.exec(getStyle(style, 'width') ?? '');
  const h = /^([\d.]+)px$/.exec(getStyle(style, 'height') ?? '');
  return w && h ? [parseFloat(w[1]), parseFloat(h[1])] : null;
}
