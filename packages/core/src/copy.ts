import {
  parseDc,
  RAW_TEXT_ELEMENTS,
  VOID_ELEMENTS,
  type DcDoc,
  type DcElement,
  type DcNode,
  type Range,
} from './parse';
import { setStyle } from './style';

/**
 * The editable copy of an artboard, and the engine that writes it back.
 *
 * Every editor — the person on the canvas, the fast in-page model writing
 * jQuery, a replayed edit after a conflict — changes the same thing: a live
 * DOM built from the template, where each element knows which source node it
 * came from. `patches()` then compares that DOM with the parsed source and
 * produces the smallest text replacements that make the file say the same:
 * a changed attribute rewrites just that attribute, a changed text node just
 * that text, and only a parent whose children were added, removed or
 * reordered gets its inner HTML rewritten — and even then every surviving
 * child is copied from its original source text, not re-serialized.
 */

export const HANDLE_PREFIX = 'dc';
export const HANDLE_RE = /^dc\d+$/;

export interface Patch extends Range {
  text: string;
}

export function applyPatches(text: string, patches: Patch[], offset = 0): string {
  const sorted = [...patches].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Infinity;
  for (const p of sorted) {
    if (p.end > floor) throw new Error(`overlapping patches at ${p.start}-${p.end}`);
    out = out.slice(0, p.start - offset) + p.text + out.slice(p.end - offset);
    floor = p.start;
  }
  return out;
}

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/ /g, '&nbsp;');
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MATH_NS = 'http://www.w3.org/1998/Math/MathML';

function isElement(n: Node): n is Element {
  return n.nodeType === 1;
}
function isText(n: Node): n is Text {
  return n.nodeType === 3;
}
function isComment(n: Node): n is Comment {
  return n.nodeType === 8;
}

export interface MarkupOptions {
  /** Cut long attribute values (data: URIs) so a model sees the shape, not the bytes. */
  truncate?: number;
}

export class DesignCopy {
  readonly doc: DcDoc;
  readonly document: Document;
  readonly root: Element;
  /** copy node → source node */
  private readonly src = new WeakMap<Node, DcNode>();
  /** elements whose `id` is a handle we added (never saved) */
  private readonly handled = new WeakSet<Element>();
  private readonly byTid = new Map<number, Element>();

  constructor(source: string | DcDoc, document: Document) {
    this.doc = typeof source === 'string' ? parseDc(source) : source;
    this.document = document;
    this.root = document.createElement('dc-root');
    for (const n of this.doc.children) {
      const c = this.build(n);
      if (c) this.root.appendChild(c);
    }
  }

  get source(): string {
    return this.doc.source;
  }

  private build(n: DcNode): Node | null {
    const d = this.document;
    if (n.kind === 'text') {
      const t = d.createTextNode(n.text);
      this.src.set(t, n);
      return t;
    }
    if (n.kind === 'comment') {
      const c = d.createComment(n.text);
      this.src.set(c, n);
      return c;
    }
    const el =
      n.ns === 'svg'
        ? d.createElementNS(SVG_NS, n.tag)
        : n.ns === 'math'
          ? d.createElementNS(MATH_NS, n.tag)
          : d.createElement(n.tag);
    for (const a of n.attrs) {
      try {
        if (a.name.startsWith('xlink:')) el.setAttributeNS('http://www.w3.org/1999/xlink', a.name, a.value);
        else el.setAttribute(a.name, a.value);
      } catch {
        // a name the DOM refuses (rare in templates); it stays in the source untouched
      }
    }
    if (!el.hasAttribute('id')) {
      el.setAttribute('id', HANDLE_PREFIX + n.tid);
      this.handled.add(el);
    }
    this.src.set(el, n);
    this.byTid.set(n.tid, el);
    for (const k of n.children) {
      const c = this.build(k);
      if (c) el.appendChild(c);
    }
    return el;
  }

  /** The copy element for a source tid. */
  element(tid: number): Element | undefined {
    const el = this.byTid.get(tid);
    return el && this.root.contains(el) ? el : undefined;
  }

  /** The selector a model uses for a tid: the element's own id or its handle. */
  handle(tid: number): string {
    const el = this.byTid.get(tid);
    return el ? '#' + el.getAttribute('id') : '#' + HANDLE_PREFIX + tid;
  }

  sourceOf(node: Node): DcNode | undefined {
    return this.src.get(node);
  }

  isHandled(el: Element): boolean {
    return this.handled.has(el);
  }

  /** Remove handle ids from a subtree (used on clones, which are new elements). */
  stripHandles(node: Node): void {
    const visit = (n: Node) => {
      if (isElement(n)) {
        const id = n.getAttribute('id');
        if (id && HANDLE_RE.test(id) && !this.src.has(n)) n.removeAttribute('id');
        n.childNodes.forEach(visit);
      }
    };
    visit(node);
  }

  // ---------------------------------------------------------------- write back

  patches(): Patch[] {
    const out: Patch[] = [];
    this.diffChildren(this.doc.children, this.doc.inner, this.root, null, out);
    return out;
  }

  toSource(): string {
    return applyPatches(this.doc.source, this.patches());
  }

  private attrsOf(el: Element): Map<string, string> {
    const m = new Map<string, string>();
    for (const a of Array.from(el.attributes)) {
      if (a.name === 'id' && this.handled.has(el) && HANDLE_RE.test(a.value)) continue;
      m.set(a.name, a.value);
    }
    return m;
  }

  private diffAttrs(o: DcElement, c: Element, out: Patch[]): void {
    const now = this.attrsOf(c);
    const before = new Map(o.attrs.map((a) => [a.name, a]));
    const s = this.doc.source;
    const local: Patch[] = [];
    let fallback = false;
    const added: string[] = [];

    for (const [name, value] of now) {
      const b = before.get(name);
      if (!b) {
        added.push(` ${name}="${escapeAttr(value)}"`);
      } else if (b.value !== value) {
        if (!b.range) fallback = true;
        else local.push({ ...b.range, text: `${name}="${escapeAttr(value)}"` });
      }
    }
    for (const [name, b] of before) {
      if (now.has(name)) continue;
      if (!b.range) {
        fallback = true;
        continue;
      }
      // take the whitespace before the attribute with it
      let start = b.range.start;
      while (start > o.startTag.start && /\s/.test(s[start - 1])) start--;
      local.push({ start, end: b.range.end, text: '' });
    }
    if (!local.length && !added.length && !fallback) return;
    if (fallback) {
      const selfClose = /\/\s*>$/.test(s.slice(o.startTag.start, o.startTag.end));
      const attrs = Array.from(now, ([n, v]) => ` ${n}="${escapeAttr(v)}"`).join('');
      out.push({ ...o.startTag, text: `<${c.localName}${attrs}${selfClose ? ' />' : '>'}` });
      return;
    }
    if (added.length) {
      const tag = s.slice(o.startTag.start, o.startTag.end);
      const close = /\s*\/?>$/.exec(tag)!;
      const at = o.startTag.start + close.index;
      local.push({ start: at, end: at, text: added.join('') });
    }
    out.push(...local);
  }

  private diffElement(o: DcElement, c: Element, out: Patch[]): void {
    this.diffAttrs(o, c, out);
    if (o.inner) this.diffChildren(o.children, o.inner, c, o, out);
  }

  private diffChildren(
    orig: DcNode[],
    inner: Range,
    parent: Element,
    parentSrc: DcElement | null,
    out: Patch[],
  ): void {
    const kids = Array.from(parent.childNodes);
    const sameShape =
      kids.length === orig.length &&
      kids.every((k, i) => {
        const o = orig[i];
        if (o.kind === 'el') return isElement(k) && this.src.get(k) === o;
        if (o.kind === 'text') return isText(k);
        return isComment(k);
      });
    if (!sameShape) {
      // the indentation this parent already uses between its children, if any
      const ws = orig.find((o): o is Extract<DcNode, { kind: 'text' }> => o.kind === 'text' && /^\s*\n\s*$/.test(o.text))?.text.replace(/^[^\n]*\n/, '\n');
      const tag = parentSrc?.tag ?? parent.localName;
      let text = '';
      kids.forEach((k, i) => {
        const prev = kids[i - 1];
        const fresh = (n: Node | undefined) => !!n && isElement(n) && !this.src.has(n);
        if (ws && prev && isElement(prev) && isElement(k) && (fresh(prev) || fresh(k))) text += ws;
        text += this.render(k, tag);
      });
      out.push({ ...inner, text });
      return;
    }
    const raw = parentSrc ? RAW_TEXT_ELEMENTS.has(parentSrc.tag) : false;
    kids.forEach((k, i) => {
      const o = orig[i];
      if (o.kind === 'el') this.diffElement(o, k as Element, out);
      else if (o.kind === 'text') {
        const t = (k as Text).data;
        if (t !== o.text) out.push({ ...o.range, text: raw ? t : escapeText(t) });
      } else if ((k as Comment).data !== o.text) out.push({ ...o.range, text: `<!--${(k as Comment).data}-->` });
    });
  }

  /** Markup for a copy node: original source text where it can be kept, fresh markup otherwise. */
  private render(n: Node, parentTag: string): string {
    const o = this.src.get(n);
    const s = this.doc.source;
    if (o && o.kind === 'el' && isElement(n)) {
      const sub: Patch[] = [];
      this.diffElement(o, n, sub);
      return applyPatches(s.slice(o.range.start, o.range.end), sub, o.range.start);
    }
    if (isText(n)) {
      if (o && o.kind === 'text' && o.text === n.data) return s.slice(o.range.start, o.range.end);
      return RAW_TEXT_ELEMENTS.has(parentTag) ? n.data : escapeText(n.data);
    }
    if (isComment(n)) return `<!--${n.data}-->`;
    if (isElement(n)) return this.fresh(n, false);
    return '';
  }

  private fresh(el: Element, keepHandles: boolean, opts: MarkupOptions = {}): string {
    const tag = el.localName;
    let attrs = '';
    for (const a of Array.from(el.attributes)) {
      if (!keepHandles && a.name === 'id' && HANDLE_RE.test(a.value)) continue;
      let v = a.value;
      if (opts.truncate && v.length > opts.truncate && /^data:/.test(v)) {
        const head = v.slice(0, v.indexOf(',') + 1);
        v = `${head}(${v.length - head.length} characters left out)`;
      }
      attrs += ` ${a.name}="${escapeAttr(v)}"`;
    }
    if (VOID_ELEMENTS.has(tag) && el.namespaceURI !== SVG_NS) return `<${tag}${attrs}>`;
    const inner = Array.from(el.childNodes)
      .map((k) => (keepHandles ? this.markupNode(k, tag, opts) : this.render(k, tag)))
      .join('');
    return `<${tag}${attrs}>${inner}</${tag}>`;
  }

  private markupNode(n: Node, parentTag: string, opts: MarkupOptions): string {
    if (isText(n)) return RAW_TEXT_ELEMENTS.has(parentTag) ? n.data : escapeText(n.data);
    if (isComment(n)) return '';
    if (isElement(n)) return this.fresh(n, true, opts);
    return '';
  }

  /** What a model sees: current markup with handles, data: URIs cut short. */
  markup(node: Node = this.root): string {
    if (node === this.root) {
      return Array.from(this.root.childNodes)
        .map((k) => this.markupNode(k, 'dc-root', { truncate: 200 }))
        .join('')
        .replace(/\n{3,}/g, '\n\n');
    }
    return this.markupNode(node, (node.parentNode as Element | null)?.localName ?? '', { truncate: 200 });
  }
}

/** Set one style declaration on a copy element, keeping hole declarations as written. */
export function setCopyStyle(el: Element, prop: string, value: string | null): void {
  const next = setStyle(el.getAttribute('style') ?? '', prop, value);
  if (next.trim()) el.setAttribute('style', next);
  else el.removeAttribute('style');
}
