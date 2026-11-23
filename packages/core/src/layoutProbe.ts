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

import { DRAWN_CHECK, type DrawnFinding, type DrawnRule } from './drawnCheck';

export type LayoutRule = 'clipped' | 'outside' | 'contrast' | 'blank' | 'gap' | 'boxOutside' | 'boxOverflow' | 'squeezed' | 'small' | 'broken' | 'unitSplit' | 'short' | 'heading' | DrawnRule;

export interface LayoutFinding extends Partial<Omit<DrawnFinding, 'rule'>> {
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
  /** small: the deck's size floor in px (`size` is the font size found); `short` gives where the content ends as `percent` of the height */
  floor?: number;
  /** heading (a slide's first heading, a record for the deck-level comparison, not a warning): its tag, size and box in px, and the frame's height */
  tag?: string;
  top?: number;
  left?: number;
  height?: number;
}

/**
 * The expression evaluated in a frame; `fixed` when the frame is the work's own size (a board, a slide),
 * so text past its edge is lost. `page` when it is a canvas board, which reads top to bottom, so a wide
 * empty band inside it or below its content is a board taller than its content; a slide keeps its white
 * space on purpose and is not asked about it. `slide` when it is a slide of a deck: text under the deck's
 * size floor, a word or a figure broken across lines, a content slide that stops in its top part, and a
 * `heading` record of its first heading, which `slideHeadingDrift` compares across the deck.
 */
export function layoutProbe(fixed: boolean, page = false, slide = false): string {
  return `(${PROBE})(${fixed}, ${page}, ${slide})`;
}

// runs in the frame, sent as source: plain JavaScript, self-contained
const PROBE = String.raw`function (fixed, page, slide) {
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
  // a slide of a deck; a mistake here must not lose what the rules above found
  if (slide && document.body) try {
    // the size floor of the slide skill: 24px at 1080 on the short side, the same share of any other size;
    // a small-caps eyebrow a pixel or two under it is a choice, clearly under it is not
    const floor = (24 * Math.min(vw, vh)) / 1080;
    // a unit or currency that belongs to the figure before it, and the scripts that put spaces between words
    const units = new Set(['%', '‰', '°', 'k', 'K', 'M', 'B', 'T', 'bn', 'm', 'ms', 's', 'h', 'min', 'kg', 'g', 'km', 'cm', 'mm', 'px', 'pt', 'pp', 'KB', 'MB', 'GB', 'TB', 'x', '×', '€', '$', '£', '¥', 'USD', 'EUR', 'GBP']);
    const spaced = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Nd}]/u;
    let smallest = null;
    let bottom = 0;
    let lead = null;
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (el.closest('svg, aside')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && (n.textContent || '').trim());
      // where the slide's content ends: text and pictures, not the footer band or a backdrop filling the slide
      const backdrop = r.width * r.height > 0.8 * vw * vh;
      if (!backdrop && r.top < vh * 0.85 && (own.length || /^(img|svg|table|x-shape|x-icon|x-embed|x-connector)$/i.test(el.tagName))) bottom = Math.max(bottom, Math.min(vh, r.bottom));
      if (!lead && /^h[12]$/i.test(el.tagName)) lead = { el, r, cs };
      if (!own.length) continue;
      const size = parseFloat(cs.fontSize);
      if (size < floor * 0.9 && (!smallest || size < smallest.size)) smallest = { size, text: start(el) };
      // a word broken inside, or a figure on one line and its unit on the next: look where each line starts
      for (const node of own) {
        const value = node.textContent || '';
        const range = document.createRange();
        let prevTop = null, prevChar = '', spaceSince = false, word = '', lastWord = '';
        for (let i = 0; i < value.length; i++) {
          const ch = value[i];
          if (/\s/.test(ch)) { spaceSince = true; if (word) { lastWord = word; word = ''; } continue; }
          range.setStart(node, i); range.setEnd(node, i + 1);
          const b = range.getClientRects()[0];
          if (!b) continue;
          if (prevTop !== null && b.top > prevTop + size * 0.5) {
            if (!spaceSince && spaced.test(prevChar) && spaced.test(ch) && prevChar !== '-' && prevChar !== '\u00AD') once('broken', start(el));
            if (spaceSince) {
              let next = ch;
              for (let j = i + 1; j < value.length && !/\s/.test(value[j]); j++) next += value[j];
              next = next.replace(/[.,;:!?)]+$/, '');
              if ((/\d$/.test(lastWord) && units.has(next)) || (/^[€$£¥]$/.test(lastWord) && /^\d/.test(next))) once('unitSplit', start(el));
            }
          }
          prevTop = b.top; prevChar = ch; spaceSince = false; word += ch;
        }
        range.detach();
      }
    }
    if (smallest) found.push({ rule: 'small', text: smallest.text, size: Math.round(smallest.size), floor: Math.round(floor) });
    if (lead) {
      found.push({ rule: 'heading', tag: lead.el.tagName.toLowerCase(), size: Math.round(parseFloat(lead.cs.fontSize)), top: Math.round(lead.r.top), left: Math.round(lead.r.left), height: Math.round(vh), text: start(lead.el) });
      // a content slide (its heading at the top, something under it) whose content stops at about 60% of the height
      // reads as unfinished (the slides skill's craft page); a little more is a quiet layout, not a mistake
      const below = bottom - lead.r.bottom;
      if (lead.r.top < vh * 0.3 && below > 8 && bottom < vh * 0.62) found.push({ rule: 'short', text: start(lead.el), percent: Math.round((bottom / vh) * 100) });
    }
  } catch (e) {}
  // what the page drew wrong: NaN, an empty chart, labels over each other or cut off (core's drawnCheck.ts)
  try { found.push(...(${DRAWN_CHECK})(document.body)); } catch (e) {}
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
