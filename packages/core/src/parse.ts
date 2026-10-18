import { parseFragment } from 'parse5';

/**
 * A `.dc.html` file parsed with source locations.
 *
 * Everything an editor does is anchored to these offsets: the template
 * between `<x-dc>` and the last `</x-dc>` is parsed with parse5, every
 * element gets a `tid` (depth-first order, starting at 0) and a `path`
 * (child-element indexes from the top level), and every node remembers
 * exactly which characters of the file it came from.
 */

export interface Range {
  start: number;
  end: number;
}

export interface DcAttr {
  name: string;
  value: string;
  /** Range of the whole `name="value"` text, when parse5 reports it. */
  range?: Range;
}

export interface DcElement {
  kind: 'el';
  tid: number;
  path: number[];
  tag: string;
  ns: 'html' | 'svg' | 'math';
  attrs: DcAttr[];
  children: DcNode[];
  parent: DcElement | null;
  /** The whole element, start tag to end tag. */
  range: Range;
  startTag: Range;
  endTag?: Range;
  /** Between the start and end tags (absent for void elements). */
  inner?: Range;
}

export interface DcText {
  kind: 'text';
  text: string;
  range: Range;
  parent: DcElement | null;
}

export interface DcComment {
  kind: 'comment';
  text: string;
  range: Range;
  parent: DcElement | null;
}

export type DcNode = DcElement | DcText | DcComment;

export interface PropSpec {
  editor?: 'text' | 'color' | 'int' | 'float' | 'range' | 'boolean' | 'enum' | null;
  default?: unknown;
  options?: unknown[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  section?: string;
  tsType?: string;
  width?: number;
  height?: number;
}

export interface DcDoc {
  source: string;
  /** Top-level template nodes (the children of `<x-dc>`). */
  children: DcNode[];
  /** Range inside `<x-dc>` … `</x-dc>`. */
  inner: Range;
  /** All elements indexed by tid. */
  elements: DcElement[];
  title: string;
  lang: string;
  script: { code: string; range: Range; openTag: Range } | null;
  props: Record<string, PropSpec>;
  /** Range of the `data-props` attribute value (without quotes), if any. */
  propsValue: { range: Range; quote: string } | null;
  errors: string[];
  /** A slide file: the whole file is one `<section>`, with no `<x-dc>` wrapper. */
  slide?: boolean;
}

/** Is this a slide file (a bare `<section>`, comments and whitespace allowed before it)? */
export function isSlideSource(source: string): boolean {
  return /^(?:\s|<!--[\s\S]*?-->)*<section[\s>]/i.test(source);
}

export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);
export const RAW_TEXT_ELEMENTS = new Set(['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
export const ESCAPABLE_RAW_TEXT = new Set(['textarea', 'title']);

const NS_SVG = 'http://www.w3.org/2000/svg';
const NS_MATH = 'http://www.w3.org/1998/Math/MathML';

/** Decodes the few entities an attribute value written by hand or by a model will contain. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    if (k === 'nbsp') return ' ';
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return m;
  });
}

function findXdc(source: string): { open: Range; close: Range } | null {
  const open = /<x-dc(\s[^>]*)?>/i.exec(source);
  if (!open) return null;
  const closeIdx = source.toLowerCase().lastIndexOf('</x-dc>');
  if (closeIdx < open.index + open[0].length) return null;
  return {
    open: { start: open.index, end: open.index + open[0].length },
    close: { start: closeIdx, end: closeIdx + '</x-dc>'.length },
  };
}

function findScript(source: string): DcDoc['script'] {
  const re = /<script\b[^>]*\bdata-dc-script\b[^>]*>([\s\S]*?)<\/script>/i;
  const m = re.exec(source);
  if (!m) return null;
  const openLen = m[0].indexOf('>') + 1;
  // the open tag may contain '>' inside data-props JSON; find the real end by scanning quotes
  let i = m.index + 1;
  let quote = '';
  for (; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') break;
  }
  const openEnd = i + 1;
  const closeIdx = source.indexOf('</script>', openEnd);
  if (closeIdx < 0) return null;
  void openLen;
  return {
    code: source.slice(openEnd, closeIdx),
    range: { start: openEnd, end: closeIdx },
    openTag: { start: m.index, end: openEnd },
  };
}

function findProps(source: string, openTag: Range | undefined): DcDoc['propsValue'] {
  if (!openTag) return null;
  const tag = source.slice(openTag.start, openTag.end);
  const m = /\bdata-props\s*=\s*(['"])/.exec(tag);
  if (!m) return null;
  const quote = m[1];
  const valStart = openTag.start + m.index + m[0].length;
  const valEnd = source.indexOf(quote, valStart);
  if (valEnd < 0) return null;
  return { range: { start: valStart, end: valEnd }, quote };
}

interface P5Loc {
  startOffset: number;
  endOffset: number;
  startTag?: { startOffset: number; endOffset: number };
  endTag?: { startOffset: number; endOffset: number };
  attrs?: Record<string, { startOffset: number; endOffset: number }>;
}
interface P5Node {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  attrs?: { name: string; value: string; prefix?: string }[];
  childNodes?: P5Node[];
  value?: string;
  data?: string;
  content?: P5Node;
  sourceCodeLocation?: P5Loc | null;
}

export function parseDc(source: string): DcDoc {
  const errors: string[] = [];
  const xdc = findXdc(source);
  const script = findScript(source);
  const propsValue = findProps(source, script?.openTag);
  let props: Record<string, PropSpec> = {};
  if (propsValue) {
    try {
      props = JSON.parse(decodeEntities(source.slice(propsValue.range.start, propsValue.range.end)));
    } catch (e) {
      errors.push('data-props is not valid JSON: ' + (e as Error).message);
    }
  }
  const title = decodeEntities(/<title>([\s\S]*?)<\/title>/i.exec(source)?.[1]?.trim() ?? '');
  const lang = /<html[^>]*\blang=["']?([\w-]+)/i.exec(source)?.[1] ?? 'en';

  const elements: DcElement[] = [];
  const slide = !xdc && isSlideSource(source);
  if (!xdc && !slide) {
    errors.push('No <x-dc> … </x-dc> block found.');
    return {
      source, children: [], inner: { start: 0, end: 0 }, elements, title, lang, script, props, propsValue, errors,
    };
  }
  const base = xdc ? xdc.open.end : 0;
  const end = xdc ? xdc.close.start : source.length;
  const fragment = source.slice(base, end);
  const frag = parseFragment(fragment, { sourceCodeLocationInfo: true }) as unknown as P5Node;

  const conv = (n: P5Node, parent: DcElement | null, path: number[]): DcNode | null => {
    const loc = n.sourceCodeLocation;
    if (n.nodeName === '#text') {
      if (!loc) return null;
      return { kind: 'text', text: n.value ?? '', range: { start: base + loc.startOffset, end: base + loc.endOffset }, parent };
    }
    if (n.nodeName === '#comment') {
      if (!loc) return null;
      return { kind: 'comment', text: n.data ?? '', range: { start: base + loc.startOffset, end: base + loc.endOffset }, parent };
    }
    if (!n.tagName) return null;
    if (!loc || !loc.startTag) {
      // implied element (e.g. tbody inserted by the parser): flatten its children into the parent
      return null;
    }
    const ns = n.namespaceURI === NS_SVG ? 'svg' : n.namespaceURI === NS_MATH ? 'math' : 'html';
    const el: DcElement = {
      kind: 'el',
      tid: elements.length,
      path,
      tag: n.tagName,
      ns,
      attrs: (n.attrs ?? []).map((a) => {
        const name = a.prefix ? `${a.prefix}:${a.name}` : a.name;
        const al = loc.attrs?.[name] ?? loc.attrs?.[a.name] ?? loc.attrs?.[name.toLowerCase()];
        return { name, value: a.value, range: al ? { start: base + al.startOffset, end: base + al.endOffset } : undefined };
      }),
      children: [],
      parent,
      range: { start: base + loc.startOffset, end: base + loc.endOffset },
      startTag: { start: base + loc.startTag.startOffset, end: base + loc.startTag.endOffset },
      endTag: loc.endTag ? { start: base + loc.endTag.startOffset, end: base + loc.endTag.endOffset } : undefined,
    };
    if (!VOID_ELEMENTS.has(el.tag)) {
      el.inner = {
        start: el.startTag.end,
        end: el.endTag ? el.endTag.start : el.range.end,
      };
      if (el.inner.end < el.inner.start) el.inner.end = el.inner.start;
    }
    elements.push(el);
    const kids = n.tagName === 'template' && n.content ? n.content.childNodes ?? [] : n.childNodes ?? [];
    el.children = convChildren(kids, el, path);
    return el;
  };

  const convChildren = (kids: P5Node[], parent: DcElement | null, parentPath: number[], count = { i: 0 }): DcNode[] => {
    const out: DcNode[] = [];
    for (const k of kids) {
      if (k.tagName && (!k.sourceCodeLocation || !k.sourceCodeLocation.startTag)) {
        // an element the parser implied (a <tbody> around rows written straight
        // into <table>): it is not in the source, so its children belong to the parent
        if (!slide) errors.push(`The parser implied a <${k.tagName}> here; write it out explicitly.`);
        out.push(...convChildren(k.childNodes ?? [], parent, parentPath, count));
        continue;
      }
      const node = conv(k, parent, k.tagName ? [...parentPath, count.i] : parentPath);
      if (!node) continue;
      if (node.kind === 'el') count.i++;
      out.push(node);
    }
    return out;
  };

  const children = convChildren(frag.childNodes ?? [], null, []);
  return {
    source,
    children,
    inner: { start: base, end },
    elements,
    title,
    lang,
    script: slide ? null : script,
    props,
    propsValue,
    errors,
    ...(slide ? { slide } : {}),
  };
}

export function attr(el: DcElement, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

export const HOLE_RE = /\{\{\s*([^}]*?)\s*\}\}/g;

export function hasHole(s: string): boolean {
  return /\{\{[^}]*\}\}/.test(s);
}

/** Is this element's content plain literal text a person can retype in place? */
export function isTextEditable(el: DcElement): boolean {
  if (RAW_TEXT_ELEMENTS.has(el.tag) || VOID_ELEMENTS.has(el.tag)) return false;
  if (el.tag.startsWith('sc-') || el.tag === 'dc-import' || el.tag === 'helmet') return false;
  if (el.ns === 'svg' && el.tag !== 'text' && el.tag !== 'tspan') return false;
  let hasText = false;
  for (const c of el.children) {
    if (c.kind === 'el') {
      // inline formatting inside text is fine to keep, but then we can't retype it as plain text
      return false;
    }
    if (c.kind === 'text') {
      if (hasHole(c.text)) return false;
      if (c.text.trim()) hasText = true;
    }
  }
  return hasText || el.children.length === 0;
}

/**
 * The `data-props` prop a text element shows on its own: `<h2>{{heading}}</h2>`
 * with `heading` declared as a text tweak (no editor or `"text"`, a string
 * default). Retyping such an element sets the tweak's default; any other hole
 * stays read-only.
 */
export function tweakTextBinding(doc: DcDoc, el: DcElement): string | null {
  if (RAW_TEXT_ELEMENTS.has(el.tag) || VOID_ELEMENTS.has(el.tag) || el.tag.startsWith('sc-') || el.tag === 'dc-import' || el.tag === 'helmet') return null;
  if (el.children.some((c) => c.kind === 'el')) return null;
  const m = /^\s*\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}\s*$/.exec(templateText(el));
  if (!m) return null;
  const spec = doc.props[m[1]] as PropSpec | undefined;
  if (!spec || typeof spec !== 'object' || (spec.editor && spec.editor !== 'text')) return null;
  return spec.default === undefined || typeof spec.default === 'string' ? m[1] : null;
}

/** Plain text of an element as written in the template (holes kept as written). */
export function templateText(el: DcElement): string {
  let s = '';
  const walk = (n: DcNode) => {
    if (n.kind === 'text') s += n.text;
    else if (n.kind === 'el' && !RAW_TEXT_ELEMENTS.has(n.tag)) n.children.forEach(walk);
  };
  el.children.forEach(walk);
  return s.replace(/\s+/g, ' ').trim();
}

export function elementLabel(el: DcElement): string {
  const t = templateText(el);
  if (t) return t.length > 60 ? t.slice(0, 59) + '…' : t;
  const alt = attr(el, 'alt') ?? attr(el, 'aria-label') ?? attr(el, 'title');
  return alt ?? '';
}
