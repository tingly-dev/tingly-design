/**
 * What `check --snapshots` looks for in the drawn work, beyond "it drew": text cut off by its box,
 * text outside a fixed-size board or slide, text too faint on a plain background, a frame with
 * nothing on it, a wide empty band in a canvas board (a board taller than its content), and the boxes themselves:
 * a painted box past a fixed frame's edge, a flex or grid child wider than the box that holds it, and text squeezed
 * into a column a few characters wide. It runs inside each work frame (a board, a slide, a dashboard page, a component
 * preview) as one expression, so it sees the layout the browser actually made; see .design/harness.md.
 *
 * Only warnings: a designer may cut text on purpose or set a quiet caption, and the checker cannot
 * tell. Contrast is only judged against a solid background, since a picture or a gradient under the
 * text has no one colour to compare with.
 */

export type LayoutRule = 'clipped' | 'outside' | 'contrast' | 'blank' | 'gap' | 'boxOutside' | 'boxOverflow' | 'squeezed';

export interface LayoutFinding {
  rule: LayoutRule;
  /** the start of the text concerned */
  text?: string;
  /** contrast: the ratio found, to one decimal */
  ratio?: number;
  /** squeezed: how many lines the text was broken into */
  lines?: number;
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
  // one finding per rule for the boxes: the first one found names it, the rest would only repeat
  const seen = {};
  const once = (rule, text, extra) => { if (!seen[rule]) { seen[rule] = true; found.push({ rule, text, ...extra }); } };
  // an ancestor that crops what is inside it: a box past the edge there is on purpose (a backdrop, a scrolling list)
  const cropped = (el) => {
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const c = getComputedStyle(e);
      if (clips(c.overflowX) || clips(c.overflowY) || c.overflowX === 'auto' || c.overflowX === 'scroll') return true;
    }
    return false;
  };
  const name = (el) => {
    const t = start(el) || el.id;
    if (t) return t;
    const b = el.getBoundingClientRect();
    return el.tagName.toLowerCase() + ' ' + Math.round(b.width) + '×' + Math.round(b.height) + ' at ' + Math.round(b.left) + ',' + Math.round(b.top);
  };
  for (const el of Array.from(document.body ? document.body.querySelectorAll('*') : [])) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    // a picture, or a shape smaller than the frame: a colour filling the whole frame is only the background
    const shape = (rgba(cs.backgroundColor)?.[3] ?? 0) > 0.01 || parseFloat(cs.borderTopWidth) > 0;
    const painted = /^(img|svg|canvas|video|iframe|x-embed)$/i.test(el.tagName) || cs.backgroundImage !== 'none' || (shape && r.width * r.height < 0.9 * vw * vh);
    if (painted) drawn = true;
    // a card, table, picture or embed whose box goes past the edge of a fixed frame
    if (fixed && painted && !cropped(el) && (r.right > vw + 8 || r.bottom > vh + 8 || r.left < -8 || r.top < -8)) once('boxOutside', name(el));
    // a flex or grid child wider than the box that holds it: its parent lays children out in a row or grid and does not scroll
    const par = el.parentElement;
    if (par && par !== document.body && par !== document.documentElement && cs.position !== 'absolute' && cs.position !== 'fixed') {
      const ps = getComputedStyle(par);
      if (/flex|grid/.test(ps.display) && !clips(ps.overflowX) && ps.overflowX !== 'auto' && ps.overflowX !== 'scroll') {
        const pr = par.getBoundingClientRect();
        if (pr.width > 1 && r.right > pr.right + 8 && r.width > pr.width * 0.5) once('boxOverflow', name(el));
      }
    }
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim());
    if (painted || own) spans.push([Math.max(0, r.top), Math.min(vh, r.bottom)]);
    if (!own) continue;
    drawn = true;
    const text = start(el);
    const cutX = clips(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis';
    const cutY = clips(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && !Number(cs.getPropertyValue('-webkit-line-clamp'));
    if (cutX || cutY) found.push({ rule: 'clipped', text });
    else if (fixed && (r.right > vw + 2 || r.bottom > vh + 2 || r.left < -2 || r.top < -2)) found.push({ rule: 'outside', text });
    // text broken into a column a character or two wide: many lines, few characters on each
    if (!el.children.length && text.length >= 6) {
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
      const range = document.createRange();
      range.selectNodeContents(el);
      // the lines the text takes, not the height of the box it sits in
      const lines = Math.round(range.getBoundingClientRect().height / lh);
      const chars = (el.textContent || '').trim().replace(/\s+/g, ' ').length;
      if (lines >= 4 && chars / lines <= 2.5) once('squeezed', text, { lines });
    }
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
