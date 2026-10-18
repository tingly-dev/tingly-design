/**
 * What `check --snapshots` looks for in the drawn work, beyond "it drew": text cut off by its box,
 * text outside a fixed-size board or slide, text too faint on a plain background, a frame with
 * nothing on it, and a wide empty band in a canvas board (a board taller than its content). It runs inside each work frame (a board, a slide, a dashboard page, a component
 * preview) as one expression, so it sees the layout the browser actually made; see .design/harness.md.
 *
 * Only warnings: a designer may cut text on purpose or set a quiet caption, and the checker cannot
 * tell. Contrast is only judged against a solid background, since a picture or a gradient under the
 * text has no one colour to compare with.
 */

export type LayoutRule = 'clipped' | 'outside' | 'contrast' | 'blank' | 'gap';

export interface LayoutFinding {
  rule: LayoutRule;
  /** the start of the text concerned */
  text?: string;
  /** contrast: the ratio found, to one decimal */
  ratio?: number;
  /** gap: the height of the empty band in px, where it starts (px from the top) and its share of the frame's height in % */
  size?: number;
  at?: number;
  percent?: number;
}

/**
 * The expression evaluated in a frame; `fixed` when the frame is the work's own size (a board, a slide),
 * so text past its edge is lost. `page` when it is a canvas board, which reads top to bottom, so a wide
 * empty band inside it or below its content is a board taller than its content; a slide keeps its white
 * space on purpose and is not asked about it.
 */
export function layoutProbe(fixed: boolean, page = false): string {
  return `(${PROBE})(${fixed}, ${page})`;
}

// runs in the frame, sent as source: plain JavaScript, self-contained
const PROBE = String.raw`function (fixed, page) {
  const found = [];
  // the vertical spans something is drawn in, to find a wide empty band between them
  const spans = [];
  const vw = innerWidth;
  const vh = innerHeight;
  const rgba = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
  };
  const lum = (c) => {
    const f = (x) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // the first solid background behind an element; none when a picture, a gradient or a see-through layer comes first
  const behind = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none') return null;
      const c = rgba(cs.backgroundColor);
      if (c && c[3] >= 0.99) return c;
      if (c && c[3] > 0.01) return null;
    }
    return [255, 255, 255, 1];
  };
  const start = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const clips = (o) => o === 'hidden' || o === 'clip';
  let drawn = false;
  for (const el of Array.from(document.body ? document.body.querySelectorAll('*') : [])) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    // a picture, or a shape smaller than the frame: a colour filling the whole frame is only the background
    const shape = (rgba(cs.backgroundColor)?.[3] ?? 0) > 0.01 || parseFloat(cs.borderTopWidth) > 0;
    const painted = /^(img|svg|canvas|video|iframe|x-embed)$/i.test(el.tagName) || cs.backgroundImage !== 'none' || (shape && r.width * r.height < 0.9 * vw * vh);
    if (painted) drawn = true;
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim());
    if (painted || own) spans.push([Math.max(0, r.top), Math.min(vh, r.bottom)]);
    if (!own) continue;
    drawn = true;
    const text = start(el);
    const cutX = clips(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis';
    const cutY = clips(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && !Number(cs.getPropertyValue('-webkit-line-clamp'));
    if (cutX || cutY) found.push({ rule: 'clipped', text });
    else if (fixed && (r.right > vw + 2 || r.bottom > vh + 2 || r.left < -2 || r.top < -2)) found.push({ rule: 'outside', text });
    const fg = rgba(cs.color);
    const bg = behind(el);
    if (fg && fg[3] >= 0.99 && bg) {
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      const c = ratio(fg, bg);
      if (c < (large ? 3 : 4.5)) found.push({ rule: 'contrast', text, ratio: Math.floor(c * 10) / 10 });
    }
  }
  if (!drawn) found.push({ rule: 'blank' });
  else if (fixed && page) {
    // between two things drawn, and below the last one: a band this tall in a board that reads top to bottom is
    // a board taller than its content, or content that was meant to fill it
    spans.sort((a, b) => a[0] - b[0]);
    let end = -1;
    let best = null;
    const gap = (from, to) => {
      if (to - from >= Math.max(160, vh * 0.18) && (!best || to - from > best.size)) best = { rule: 'gap', at: Math.round(from), size: Math.round(to - from), percent: Math.round(((to - from) / vh) * 100) };
    };
    for (const [a, b] of spans) {
      if (end >= 0 && a > end) gap(end, a);
      end = Math.max(end, b);
    }
    if (end >= 0) gap(end, vh);
    if (best) found.push(best);
  }
  return found;
}`;
