import type { ExtractReport, Extracted, XElement, XNode } from '../../model';

/**
 * An SVG document → the page model, as one artboard holding the drawing.
 *
 * An SVG is already a scene graph with its own coordinates, so nothing is
 * laid out or flattened: the drawing goes onto the artboard as inline SVG,
 * sized to its own width and height. Text stays <text> and colours stay
 * attributes, which is what the canvas lets people change. What the editor
 * cannot keep (scripts, <foreignObject>, editor-private namespaces such as
 * Inkscape's) is left out and counted.
 *
 * Needs only a parsed Document (DOMParser in a browser, any DOM in tests).
 */

export interface SvgOptions {
  /** stop after this many elements (default 6000) */
  maxElements?: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
/** elements whose text is content, not formatting whitespace */
const TEXTY = new Set(['text', 'tspan', 'textPath', 'title', 'desc', 'style']);
/** kept out of the canvas: they cannot render there or carry nothing to edit */
const DROP = new Set(['script', 'foreignObject']);
const DEFAULT_W = 800;
const DEFAULT_H = 600;

const UNIT_PX: Record<string, number> = { '': 1, px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };

/** `210mm`, `12in`, `640` → px; null for percentages, em and anything unparseable. */
export function svgLength(v: string | null): number | null {
  const m = /^\s*([0-9.]+(?:e[-+]?\d+)?)\s*([a-z]*)\s*$/i.exec(v ?? '');
  if (!m) return null;
  const f = UNIT_PX[m[2].toLowerCase()];
  const n = parseFloat(m[1]) * (f ?? NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The drawing's size in px: its width/height, else the viewBox, else a default. */
export function svgSize(svg: Element): { w: number; h: number; known: boolean } {
  const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  let w = svgLength(svg.getAttribute('width'));
  let h = svgLength(svg.getAttribute('height'));
  if (w && !h) h = hasVb ? (w * vb[3]) / vb[2] : null;
  if (h && !w) w = hasVb ? (h * vb[2]) / vb[3] : null;
  if (!w || !h) {
    if (hasVb) [w, h] = [vb[2], vb[3]];
  }
  return w && h ? { w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100, known: true } : { w: DEFAULT_W, h: DEFAULT_H, known: false };
}

const box = (height = 0, display = 'inline') => ({ top: 0, height, marginTop: 0, marginBottom: 0, display, whiteSpace: 'normal' });

export function readSvg(doc: Document, opts: SvgOptions = {}): Extracted {
  const svg = doc.documentElement;
  if (!svg || svg.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('这不是一个有效的 SVG 文件');
  const max = opts.maxElements ?? 6000;
  const report: ExtractReport = { elements: 0, stateRules: 0, otherMediaRules: 0, unreadableSheets: [], scripts: 0, hidden: 0, transparent: 0, pseudoElements: 0, dropped: {}, truncated: false };
  const urls: string[] = [];
  const seen = new Set<string>();

  const walk = (el: Element): XElement | null => {
    // Inkscape, Sodipodi, Illustrator and RDF metadata live in their own namespaces
    if (el.namespaceURI !== SVG_NS) return null;
    const tag = el.localName;
    if (tag === 'script') {
      report.scripts++;
      return null;
    }
    if (DROP.has(tag)) {
      report.dropped[tag] = (report.dropped[tag] ?? 0) + 1;
      return null;
    }
    if (tag === 'metadata') return null;
    if (report.elements >= max) {
      report.truncated = true;
      return null;
    }
    report.elements++;
    const attrs: [string, string][] = [];
    let style = '';
    for (const a of Array.from(el.attributes)) {
      const name = a.name;
      if (name === 'style') style = a.value.trim();
      else if (/^on/i.test(name) || name === 'xmlns' || name.startsWith('xmlns:')) continue;
      else if (a.namespaceURI === XLINK_NS && a.localName === 'href') attrs.push(['href', a.value]);
      else if (a.namespaceURI && a.namespaceURI !== XLINK_NS) continue; // inkscape:label, sodipodi:…
      else if (name.includes(':') && !name.startsWith('xml:')) continue;
      else attrs.push([name, a.value]);
    }
    for (const [k, v] of attrs) {
      if (k === 'href' && /^(https?|data):/i.test(v) && !seen.has(v)) {
        seen.add(v);
        urls.push(v);
      }
    }
    const children: XNode[] = [];
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 1) {
        const x = walk(c as Element);
        if (x) children.push(x);
      } else if ((c.nodeType === 3 || c.nodeType === 4) && (TEXTY.has(tag) || c.textContent?.trim())) {
        children.push({ kind: 'text', text: c.textContent ?? '' });
      }
    }
    return { kind: 'el', tag, ns: 'svg', attrs, style, children, box: box() };
  };

  const { w, h, known } = svgSize(svg);
  const drawing = walk(svg)!;
  // the drawing fills the artboard; its own viewBox keeps the coordinates it was drawn in
  const keep = drawing.attrs.filter(([k]) => k !== 'width' && k !== 'height' && k !== 'x' && k !== 'y');
  if (!known || !keep.some(([k]) => k === 'viewBox')) keep.push(['viewBox', `0 0 ${w} ${h}`]);
  drawing.attrs = [['width', String(w)], ['height', String(h)], ...keep];
  drawing.box = box(h, 'block');
  drawing.style = [drawing.style.replace(/;?\s*$/, ''), 'display: block'].filter(Boolean).join('; ') + ';';
  const root: XElement = {
    kind: 'el',
    tag: 'div',
    ns: 'html',
    attrs: [],
    style: `position: relative; width: ${w}px; height: ${h}px; margin: 0px;`,
    children: [drawing],
    box: box(h, 'block'),
  };
  // design tools turn text into outlines on export unless told not to; say so, since it decides what can be edited
  const texts = svg.getElementsByTagNameNS(SVG_NS, 'text').length;
  const paths = svg.getElementsByTagNameNS(SVG_NS, 'path').length;
  if (!texts && paths >= 3)
    report.notes = ['没有可改的文字：文字在导出时多半被转成了路径。Figma 导出 SVG 时取消勾选 "Outline text"，文字就能保留下来'];
  const images = svg.getElementsByTagNameNS(SVG_NS, 'image').length;
  if (images) (report.notes ??= []).push(`${images} 张嵌入的位图（截图、照片）作为图片导入，里面的内容不能编辑`);
  const title = Array.from(svg.children).find((c) => c.localName === 'title')?.textContent?.trim() ?? '';
  return { from: 'svg', title, lang: svg.getAttribute('xml:lang') ?? svg.getAttribute('lang') ?? '', width: w, height: h, root, headCss: '', fontLinks: [], urls, report };
}

/**
 * Parse SVG text as XML, forgiving what copy-paste adds around it: a BOM,
 * text before the <svg> or <?xml …?> start, anything after the closing </svg>.
 */
export function parseSvg(text: string, parser: DOMParser = new DOMParser()): Document {
  let s = text.replace(/^﻿/, '');
  const start = s.search(/<\?xml|<svg[\s>]/i);
  const end = s.lastIndexOf('</svg>');
  if (start < 0) throw new Error('这不是一个有效的 SVG 文件');
  s = end > start ? s.slice(start, end + 6) : s.slice(start).trim(); // <svg …/> has no closing tag
  return parser.parseFromString(s, 'image/svg+xml');
}
