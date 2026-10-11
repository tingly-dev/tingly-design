import { SLIDE_H, SLIDE_W } from './deck';
import { parseStyle } from './style';

/**
 * Drawings for the slide subset's own elements, as SVG markup: the slide
 * frames render them and the export writes them into the page, so both show
 * the same thing. `<x-shape>`, `<x-icon>` and `<x-connector>` hold no content
 * of their own; this is what goes inside them.
 */

const SHAPE_PATHS: Record<string, string> = {
  diamond: 'M50 0L100 50L50 100L0 50Z',
  'arrow-right': 'M0 30H60V0L100 50L60 100V70H0Z',
  'arrow-left': 'M100 30H40V0L0 50L40 100V70H100Z',
  'arrow-up': 'M30 100V40H0L50 0L100 40H70V100Z',
  'arrow-down': 'M30 0V60H0L50 100L100 60H70V0Z',
};

/** Our own line drawings for the subset's icon names, on a 24-unit grid. */
export const ICON_PATHS: Record<string, string> = {
  Activity: 'M3 12h4l3-8 4 16 3-8h4',
  Book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 5v16M8 7h7',
  Chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8M20 16v-3',
  Chat: 'M4 5h16v11H9l-5 4z',
  Check: 'M4 12.5l5 5L20 6.5',
  CheckCircle: 'M12 3a9 9 0 110 18 9 9 0 010-18zM8 12.2l3 3 5-6',
  Clock: 'M12 3a9 9 0 110 18 9 9 0 010-18zM12 7v5l3.5 2',
  Cloud: 'M7 18h10.5a4 4 0 00.5-8 6 6 0 00-11.5 1.5A3.3 3.3 0 007 18z',
  Code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  Database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  Globe: 'M12 3a9 9 0 110 18 9 9 0 010-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
  GraduationCap: 'M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6',
  Home: 'M3 11l9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5',
  Key: 'M8 11a4 4 0 110 .01M11.5 12.5L21 12v3.5M17 12v3',
  Lightbulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.7.5 1 1.2 1 2.1h5c0-.9.3-1.6 1-2.1A6 6 0 0012 3z',
  Lightning: 'M13 2L4 14h7l-1 8 9-12h-7z',
  Link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  Lock: 'M5 11h14v10H5zM8 11V8a4 4 0 018 0v3',
  PaperPlane: 'M21 3L3 10.5l7 2.5 2.5 7zM21 3L10 13',
  Play: 'M7 4.5v15l12-7.5z',
  Search: 'M10.5 4a6.5 6.5 0 110 13 6.5 6.5 0 010-13zM15.5 15.5L21 21',
  Settings: 'M12 9a3 3 0 110 6 3 3 0 010-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  Star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4l-5.6 2.9 1.1-6.2L3 9.7l6.2-.9z',
  ThumbsUp: 'M7 10v10H3V10zM7 10l4-7c1.7 0 2.5 1 2.2 2.6L12.5 9H19a2 2 0 012 2.3l-1.2 6.8A2.3 2.3 0 0117.5 20H7',
  Tool: 'M14.5 6.5a4 4 0 015 5L11 20a2.1 2.1 0 01-3-3l8.5-8.5M14.5 6.5L17 4l3 3-2.5 2.5',
  Trust: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  Users: 'M9 11a3.5 3.5 0 110-7 3.5 3.5 0 010 7zM2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.3a3.5 3.5 0 010 6.4M18 14.4c2 .8 3.5 2.8 3.5 5.6',
  Verified: 'M12 2.5l2.4 1.8 3-.1.9 2.8 2.4 1.8-1 2.9 1 2.8-2.4 1.8-.9 2.9-3-.1L12 21.5l-2.4-1.7-3 .1-.9-2.9-2.4-1.8 1-2.8-1-2.9 2.4-1.8.9-2.8 3 .1zM8.5 12l2.5 2.5 4.5-5',
  Warning: 'M12 3.5L22 20H2zM12 10v4.5M12 17.5v.5',
  Wrench: 'M15 4a5 5 0 00-4.6 7L3.5 17.9a2.1 2.1 0 003 3l6.9-6.9A5 5 0 0019.9 9L17 12l-3-1-1-3 3-2.9A5 5 0 0015 4z',
};

const attrEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function styleMap(style: string): Record<string, string> {
  const m: Record<string, string> = {};
  for (const d of parseStyle(style)) if (d.prop) m[d.prop] = d.value;
  return m;
}

/** A border declaration's width, style and colour: a shape's stroke. */
function stroke(border: string | undefined): { width: number; color: string; style: string } | null {
  if (!border || /\bnone\b/.test(border)) return null;
  const width = Number(/(\d+(?:\.\d+)?)px/.exec(border)?.[1] ?? 1);
  const style = /\b(dashed|dotted|double)\b/.exec(border)?.[1] ?? 'solid';
  const color = border.replace(/\d+(\.\d+)?px/, '').replace(/\b(solid|dashed|dotted|double)\b/, '').trim() || '#000';
  return { width, color, style };
}

export interface ArtResult {
  /** declarations to add to (or override on) the element's own style */
  style: Record<string, string>;
  /** markup to put inside the element */
  inner: string;
}

export function shapeArt(kind: string, style: string): ArtResult {
  const s = styleMap(style);
  if (kind === 'ellipse') return { style: { 'border-radius': '50%' }, inner: '' };
  if (kind === 'rounded') return { style: s['border-radius'] ? {} : { 'border-radius': '24px' }, inner: '' };
  if (kind === 'line') {
    const st = stroke(s.border);
    return {
      style: {
        height: '0px',
        background: 'none',
        border: 'none',
        'border-top': st ? `${st.width}px ${st.style} ${st.color}` : `2px solid ${s.background ?? 'currentColor'}`,
      },
      inner: '',
    };
  }
  const path = SHAPE_PATHS[kind];
  if (!path) return { style: {}, inner: '' };
  const fill = s.background ?? s['background-color'] ?? 'currentColor';
  const st = stroke(s.border);
  const dash = st?.style === 'dashed' ? ` stroke-dasharray="${st.width * 3} ${st.width * 2}"` : st?.style === 'dotted' ? ` stroke-dasharray="${st.width} ${st.width * 1.5}"` : '';
  return {
    style: { background: 'none', border: 'none' },
    inner:
      `<svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style="display:block;overflow:visible" aria-hidden="true">` +
      `<path d="${path}" fill="${attrEsc(fill)}" stroke="${attrEsc(st?.color ?? 'none')}" stroke-width="${st?.width ?? 0}"${dash} stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`,
  };
}

export function iconArt(name: string, style: string): ArtResult {
  const s = styleMap(style);
  const d = ICON_PATHS[name] ?? 'M12 3a9 9 0 110 18 9 9 0 010-18zM12 8v5M12 16v.5';
  return {
    style: { ...(s.width ? {} : { width: '48px' }), ...(s.height ? {} : { height: '48px' }) },
    inner: `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:block" aria-hidden="true"><path d="${d}"/></svg>`,
  };
}

function coord(v: string | undefined, full: number): number {
  const s = (v ?? '').trim();
  const pct = /^(-?\d+(?:\.\d+)?)%$/.exec(s);
  if (pct) return (Number(pct[1]) / 100) * full;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function route(kind: string, x1: number, y1: number, x2: number, y2: number): string {
  if (kind === 'hv') return `M${x1} ${y1}H${x2}V${y2}`;
  if (kind === 'vh') return `M${x1} ${y1}V${y2}H${x2}`;
  if (kind === 'elbow') return `M${x1} ${y1}H${(x1 + x2) / 2}V${y2}H${x2}`;
  return `M${x1} ${y1}L${x2} ${y2}`;
}

let seq = 0;

/** `<x-connector x1 y1 x2 y2 head route>`: pinned in slide coordinates, or a sized flow child drawn corner to corner. */
export function connectorArt(attrs: Record<string, string>, style: string): ArtResult {
  const s = styleMap(style);
  const color = s.color ?? '#1f2430';
  const width = parseFloat(s['border-width'] ?? '') || 2;
  const dash = s['border-style'] === 'dashed' ? ` stroke-dasharray="${width * 3} ${width * 2}"` : s['border-style'] === 'dotted' ? ` stroke-dasharray="${width} ${width * 1.6}"` : '';
  const head = attrs.head ?? 'end';
  const start = attrs['head-start'] ?? (head === 'both' ? 'filled' : 'none');
  const end = attrs['head-end'] ?? (head === 'none' ? 'none' : 'filled');
  const id = `dcx${++seq}`;
  const size = Math.max(4, 12 / Math.sqrt(width));
  const marker = (kind: string, which: string) =>
    kind === 'none'
      ? ''
      : `<marker id="${id}${which}" viewBox="0 0 10 10" refX="${kind === 'open' ? 8 : 9}" refY="5" markerWidth="${size}" markerHeight="${size}" orient="auto-start-reverse" markerUnits="strokeWidth">` +
        (kind === 'open'
          ? `<path d="M1 1L9 5L1 9" fill="none" stroke="${attrEsc(color)}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`
          : `<path d="M0 0L10 5L0 10z" fill="${attrEsc(color)}"/>`) +
        `</marker>`;
  const pinned = ['x1', 'y1', 'x2', 'y2'].every((k) => attrs[k] !== undefined);
  let d: string;
  let box: Record<string, string>;
  if (pinned) {
    d = route(attrs.route ?? 'straight', coord(attrs.x1, SLIDE_W), coord(attrs.y1, SLIDE_H), coord(attrs.x2, SLIDE_W), coord(attrs.y2, SLIDE_H));
    box = { position: 'absolute', left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible' };
  } else {
    const w = parseFloat(s.width ?? '') || 96;
    const h = parseFloat(s.height ?? '') || 0;
    const from = attrs.from ?? 'tl';
    const x1 = from.includes('r') ? w : 0;
    const y1 = h && from.includes('b') ? h : 0;
    d = route('straight', x1, y1, w - x1, h ? h - y1 : 0);
    box = { display: 'block', position: 'relative', width: `${w}px`, height: `${h}px`, flex: 'none', 'align-self': 'center', overflow: 'visible' };
  }
  return {
    style: box,
    inner:
      `<svg width="1" height="1" style="position:absolute;left:0;top:0;overflow:visible" aria-hidden="true"><defs>${marker(start, 's')}${marker(end, 'e')}</defs>` +
      `<path d="${d}" fill="none" stroke="transparent" stroke-width="${Math.max(16, width + 12)}" style="pointer-events:stroke"/>` +
      `<path d="${d}" fill="none" stroke="${attrEsc(color)}" stroke-width="${width}"${dash} stroke-linejoin="round"${start !== 'none' ? ` marker-start="url(#${id}s)"` : ''}${end !== 'none' ? ` marker-end="url(#${id}e)"` : ''}/></svg>`,
  };
}

/** Merge extra declarations into a style attribute's text (later ones win). */
export function withStyle(style: string, extra: Record<string, string>): string {
  const keys = new Set(Object.keys(extra));
  const kept = parseStyle(style)
    .filter((d) => d.prop && !keys.has(d.prop))
    .map((d) => `${d.prop}:${d.value}`);
  return [...kept, ...Object.entries(extra).map(([k, v]) => `${k}:${v}`)].join(';');
}

/** A slide's source with every shape, icon and connector drawn in (for standalone pages). */
export function drawSlideArt(source: string): string {
  return source.replace(/<(x-shape|x-icon|x-connector)\b([^>]*)>\s*<\/\1>/g, (_m, tag: string, attrText: string) => {
    const attrs: Record<string, string> = {};
    for (const a of attrText.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? '';
    const style = attrs.style ?? '';
    const art = tag === 'x-shape' ? shapeArt(attrs.kind ?? 'rect', style) : tag === 'x-icon' ? iconArt(attrs.name ?? '', style) : connectorArt(attrs, style);
    const rest = Object.entries(attrs)
      .filter(([k]) => k !== 'style')
      .map(([k, v]) => ` ${k}="${attrEsc(v)}"`)
      .join('');
    return `<${tag}${rest} style="${attrEsc(withStyle(style, art.style))}">${art.inner}</${tag}>`;
  });
}
