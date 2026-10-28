/**
 * What a dashboard page drew, looked at the way a reader would: a number that came out as `NaN`, a chart
 * container with nothing in it, labels that sit on top of each other or are cut off by their chart.
 * Marks that disagree with the data and scripts that threw are caught elsewhere; this is the rest of
 * "it ran but it looks wrong" (.design/drawn-check.md).
 *
 * The check is one self-contained function, kept as source, because two places run it on a real layout: the
 * dashboard's own frame (what an open page writes to `.runs.json` and Sources) and `check --snapshots`
 * (inside every work frame, with the layout probe). Core stays free of wording: a finding is a rule id plus
 * what it concerns.
 */

export type DrawnRule = 'nan' | 'empty' | 'labelOverlap' | 'labelClipped';

export interface DrawnFinding {
  rule: DrawnRule;
  /** the element, as `<div#id.class>` */
  element: string;
  /** the dataset ids of the nearest `data-source` at or around the element */
  source?: string;
  /** nan: the text with the bad value; labelOverlap / labelClipped: the label (and the one it covers) */
  text?: string;
  other?: string;
  /** how many more like it were left out of the list */
  more?: number;
}

/** The expression for a frame: `(function (root) {...})` evaluated, called with the element to look inside. */
export const DRAWN_CHECK = String.raw`function (root) {
  const found = [];
  const per = {};
  const add = (f) => {
    // a chart with a bad scale repeats itself: the first few name it, the rest are a count
    const key = f.rule + '|' + f.element + '|' + (f.source || '');
    if (per[key]) { per[key].more = (per[key].more || 0) + 1; return; }
    if (found.length >= 30) return;
    per[key] = f;
    found.push(f);
  };
  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cn = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '';
    const cls = cn.trim() ? '.' + cn.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return '<' + tag + id + cls + '>';
  };
  const sourceOf = (el) => {
    const s = el.closest && el.closest('[data-source]');
    return s ? (s.getAttribute('data-source') || undefined) : undefined;
  };
  // what a reader can see: not display:none, hidden or fully transparent here or in any ancestor (an inactive tab, a hidden tooltip)
  const seen = (el) => {
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  const shown = (el) => {
    if (!seen(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  const text = (s) => (s || '').trim().replace(/\s+/g, ' ');
  const slice = (s, i) => text(s.slice(Math.max(0, i - 12), i + 20));
  // prose may say "undefined" (a variable, a behaviour): only a whole text of it, or one set against a unit (undefined%, $undefined), is a value that did not work out
  const BAD = /(^|[^A-Za-z0-9_])(NaN|-?Infinity)(?![A-Za-z0-9_])|^\s*(undefined)\s*$|[$€£¥%]\s?(undefined)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(undefined)\s?[%‰]/;

  // a number that came out as NaN, Infinity or undefined: in the text, or in a drawing attribute (a bar's width, a path's d)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || /^(script|style|noscript|title)$/i.test(el.tagName)) continue;
    const m = BAD.exec(n.nodeValue || '');
    if (m && shown(el)) add({ rule: 'nan', element: describe(el), source: sourceOf(el), text: slice(n.nodeValue, m.index + (m[1] || '').length) });
  }
  const ATTRS = ['d', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'transform', 'viewBox'];
  const bad = ATTRS.flatMap((a) => ['NaN', 'Infinity'].map((v) => 'svg [' + a + '*="' + v + '"]')).join(',');
  for (const el of Array.from(root.querySelectorAll(bad))) {
    const a = ATTRS.find((n) => /NaN|Infinity/.test(el.getAttribute(n) || ''));
    if (a && seen(el)) add({ rule: 'nan', element: describe(el), source: sourceOf(el), text: a + '="' + el.getAttribute(a).slice(0, 30) + '"' });
  }

  // an axis tick or its line is not a mark: a chart with only axes drew nothing
  const isMark = (el) => {
    if (!/^(rect|circle|ellipse|path|polygon|polyline|line|image|use|foreignobject)$/i.test(el.tagName)) return false;
    for (let e = el; e && e.tagName.toLowerCase() !== 'svg'; e = e.parentElement) {
      const cn = typeof e.className === 'object' && e.className ? e.className.baseVal : e.className;
      if (/(^|\s)(tick|domain)(\s|$)/.test(cn || '')) return false;
    }
    if (/^(defs|clippath|mask|pattern|lineargradient|radialgradient)$/i.test(el.parentElement ? el.parentElement.tagName : '')) return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 || b.height > 0;
  };
  // a chart or table drawn from datasets: its container names them with data-source and no cell (field, row, where)
  for (const el of Array.from(root.querySelectorAll('[data-source]'))) {
    if (el.hasAttribute('data-field') || el.hasAttribute('data-row') || el.hasAttribute('data-where')) continue;
    if (el.hasAttribute('data-dash-source-state')) continue;
    if (!seen(el)) continue;
    const tag = el.tagName.toLowerCase();
    const svgs = tag === 'svg' ? [el] : Array.from(el.querySelectorAll('svg'));
    const big = svgs.filter((s) => { const b = s.getBoundingClientRect(); return b.width >= 40 || b.height >= 40; });
    // something painted by CSS alone: a bar made of a div with a width and a background
    const painted = (e) => {
      const c = getComputedStyle(e);
      const v = c.backgroundColor.match(/[\d.]+/g) || [];
      return c.backgroundImage !== 'none' || (v.length > 3 ? Number(v[3]) : 1) > 0 || parseFloat(c.borderTopWidth) > 0;
    };
    let empty = false;
    if (tag === 'table') empty = !el.querySelectorAll('tbody tr, :scope > tr').length;
    else if (big.length) empty = !big.some((s) => Array.from(s.querySelectorAll('*')).some(isMark));
    else if (el.querySelector('.dash-skeleton')) empty = true;
    else if (!el.querySelector('canvas, img, video, table, svg') && !text(el.textContent)) empty = ![el, ...Array.from(el.querySelectorAll('*'))].some((e) => shown(e) && painted(e));
    if (empty) add({ rule: 'empty', element: describe(el), source: el.getAttribute('data-source') || undefined });
  }

  // labels: svg text that lies over other text, or is cut by the edge of its svg
  const overlap = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w <= 1 || h <= 1) return false;
    const small = Math.min(a.width * a.height, b.width * b.height);
    return small > 0 && (w * h) / small >= 0.25;
  };
  for (const svg of Array.from(root.querySelectorAll('svg'))) {
    if (!shown(svg)) continue;
    const sr = svg.getBoundingClientRect();
    // a label of another svg nested in this one is judged there; a long list is a heat map and no one reads each
    const own = Array.from(svg.querySelectorAll('text')).filter((t) => t.closest('svg') === svg);
    if (own.length > 400) continue;
    const labels = [];
    for (const t of own) {
      const s = text(t.textContent);
      if (!s || !shown(t)) continue;
      labels.push({ s, r: t.getBoundingClientRect() });
    }
    const cut = getComputedStyle(svg).overflow !== 'visible';
    let clipped = 0;
    let firstClip = null;
    for (const l of labels) {
      if (cut && (l.r.left < sr.left - 1.5 || l.r.right > sr.right + 1.5 || l.r.top < sr.top - 1.5 || l.r.bottom > sr.bottom + 1.5)) {
        clipped++;
        firstClip = firstClip || l;
      }
    }
    if (firstClip) add({ rule: 'labelClipped', element: describe(svg), source: sourceOf(svg), text: firstClip.s.slice(0, 40), more: clipped > 1 ? clipped - 1 : undefined });
    let pairs = 0;
    let first = null;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        if (overlap(labels[i].r, labels[j].r)) {
          pairs++;
          first = first || [labels[i], labels[j]];
        }
      }
    }
    if (first) add({ rule: 'labelOverlap', element: describe(svg), source: sourceOf(svg), text: first[0].s.slice(0, 40), other: first[1].s.slice(0, 40), more: pairs > 1 ? pairs - 1 : undefined });
  }
  return found;
}`;

/** Runs the check in the frame it is called from, over `root` (default: the body). */
export function drawnCheck(root: Element = document.body): DrawnFinding[] {
  return new Function(`return (${DRAWN_CHECK})`)()(root) as DrawnFinding[];
}
