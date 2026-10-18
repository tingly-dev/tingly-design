import { DesignCopy, setCopyStyle } from './copy';
import { decodeEntities, parseDc, type DcDoc, type PropSpec } from './parse';
import { getStyle, kebab } from './style';

/**
 * Edits a person makes on the canvas. Each one runs on a fresh DesignCopy of
 * the current source, so after a save conflict the same op can simply be
 * replayed on the newer file.
 */
export type Where = 'before' | 'after' | 'first' | 'last';

export type HumanOp =
  | { kind: 'style'; tid: number; prop: string; value: string | null }
  | { kind: 'styles'; tid: number; set: Record<string, string | null> }
  | { kind: 'styleText'; tid: number; text: string }
  | { kind: 'text'; tid: number; text: string }
  | { kind: 'attr'; tid: number; name: string; value: string | null }
  | { kind: 'remove'; tid: number }
  | { kind: 'duplicate'; tid: number }
  | { kind: 'move'; tid: number; dir: -1 | 1 }
  /** move an element next to (before/after) or into (first/last child of) another */
  | { kind: 'moveTo'; tid: number; target: number; where: Where }
  /** move to the start or end of its own parent */
  | { kind: 'order'; tid: number; to: 'first' | 'last' }
  /** wrap the element in a new container */
  | { kind: 'wrap'; tid: number; style: string; tag?: string }
  /** replace a container by its children */
  | { kind: 'unwrap'; tid: number }
  /** insert markup next to or inside an element */
  | { kind: 'insert'; target: number; where: Where; html: string };

export interface OpResult {
  source: string;
  changed: boolean;
  summary: string;
}

function short(s: string, n = 40): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

export function describeOp(op: HumanOp, handle: string, before?: string): string {
  switch (op.kind) {
    case 'style':
      return op.value === null
        ? `${handle} removed ${kebab(op.prop)}`
        : `${handle} ${kebab(op.prop)} ${before ? `${before} → ` : ''}${op.value}`;
    case 'styles':
      return `${handle} ${Object.entries(op.set)
        .map(([k, v]) => (v === null ? `−${kebab(k)}` : `${kebab(k)} ${v}`))
        .join(', ')}`;
    case 'styleText':
      return `${handle} style rewritten`;
    case 'text':
      return `${handle} text → "${short(op.text)}"`;
    case 'attr':
      return op.value === null ? `${handle} removed [${op.name}]` : `${handle} [${op.name}] → "${short(op.value)}"`;
    case 'remove':
      return `${handle} deleted`;
    case 'duplicate':
      return `${handle} duplicated`;
    case 'move':
      return `${handle} moved ${op.dir < 0 ? 'earlier' : 'later'}`;
    case 'moveTo':
      return `${handle} moved ${op.where} #dc${op.target}`;
    case 'order':
      return `${handle} moved to the ${op.to}`;
    case 'wrap':
      return `${handle} wrapped in a ${/display:\s*grid/.test(op.style) ? 'grid' : /display:\s*flex/.test(op.style) ? 'flex' : 'group'}`;
    case 'unwrap':
      return `${handle} ungrouped`;
    case 'insert':
      return `inserted ${op.where} #dc${op.target}: ${short(op.html.replace(/<[^>]+>/g, ' '), 30) || 'element'}`;
  }
}

function place(node: Node, ref: Element, where: Where): void {
  if (where === 'before') ref.before(node);
  else if (where === 'after') ref.after(node);
  else if (where === 'first') ref.prepend(node);
  else ref.append(node);
}

export function applyHumanOps(source: string, ops: HumanOp[], document: Document): OpResult {
  const copy = new DesignCopy(source, document);
  const notes: string[] = [];
  const need = (tid: number) => {
    const el = copy.element(tid);
    if (!el) throw new Error(`element ${tid} is no longer in the design`);
    return el;
  };
  for (const op of ops) {
    const tid = op.kind === 'insert' ? op.target : op.tid;
    const el = need(tid);
    const handle = copy.handle(tid);
    switch (op.kind) {
      case 'style': {
        const before = getStyle(el.getAttribute('style') ?? '', kebab(op.prop));
        setCopyStyle(el, op.prop, op.value);
        notes.push(describeOp(op, handle, before));
        break;
      }
      case 'styles':
        for (const [k, v] of Object.entries(op.set)) setCopyStyle(el, k, v);
        notes.push(describeOp(op, handle));
        break;
      case 'styleText':
        if (op.text.trim()) el.setAttribute('style', op.text);
        else el.removeAttribute('style');
        notes.push(describeOp(op, handle));
        break;
      case 'text':
        el.textContent = op.text;
        notes.push(describeOp(op, handle));
        break;
      case 'attr':
        if (op.value === null) el.removeAttribute(op.name);
        else el.setAttribute(op.name, op.value);
        notes.push(describeOp(op, handle));
        break;
      case 'remove':
        el.remove();
        notes.push(describeOp(op, handle));
        break;
      case 'duplicate': {
        const clone = el.cloneNode(true) as Element;
        copy.stripHandles(clone);
        el.after(clone);
        notes.push(describeOp(op, handle));
        break;
      }
      case 'move': {
        const sib: Element | null = op.dir < 0 ? el.previousElementSibling : el.nextElementSibling;
        if (!sib) break;
        if (op.dir < 0) sib.before(el);
        else sib.after(el);
        notes.push(describeOp(op, handle));
        break;
      }
      case 'moveTo': {
        const target = need(op.target);
        if (target === el || el.contains(target)) throw new Error('cannot move an element into itself');
        place(el, target, op.where);
        notes.push(describeOp(op, handle));
        break;
      }
      case 'order': {
        const parent = el.parentElement;
        if (!parent) break;
        if (op.to === 'first') parent.prepend(el);
        else parent.append(el);
        notes.push(describeOp(op, handle));
        break;
      }
      case 'wrap': {
        const box = document.createElement(op.tag ?? 'div');
        if (op.style) box.setAttribute('style', op.style);
        el.before(box);
        box.append(el);
        notes.push(describeOp(op, handle));
        break;
      }
      case 'unwrap': {
        if (el.localName.startsWith('sc-') || el.localName === 'helmet') throw new Error('this element cannot be ungrouped');
        el.replaceWith(...Array.from(el.childNodes));
        notes.push(describeOp(op, handle));
        break;
      }
      case 'insert': {
        const holder = document.createElement('div');
        holder.innerHTML = op.html;
        const nodes = Array.from(holder.childNodes);
        if (!nodes.length) break;
        if (op.where === 'after') {
          let ref: Node = el;
          for (const n of nodes) {
            (ref as ChildNode).after(n);
            ref = n;
          }
        } else if (op.where === 'first') el.prepend(...nodes);
        else if (op.where === 'last') el.append(...nodes);
        else el.before(...nodes);
        notes.push(describeOp(op, handle));
        break;
      }
    }
  }
  const out = copy.toSource();
  return { source: out, changed: out !== source, summary: notes.join('; ') };
}

/** The element's source text exactly as written (for copy/paste). */
export function elementSource(doc: DcDoc, tid: number): string | null {
  const el = doc.elements[tid];
  return el ? doc.source.slice(el.range.start, el.range.end) : null;
}

/** The artboard's root element: the first top-level element that isn't <helmet>. */
export function rootElement(doc: DcDoc) {
  return doc.children.find((n) => n.kind === 'el' && n.tag !== 'helmet' && n.tag !== 'script' && n.tag !== 'style') as
    | DcDoc['elements'][number]
    | undefined;
}

function encodeAttr(value: string, quote: string): string {
  let v = value.replace(/&/g, '&amp;');
  v = quote === "'" ? v.replace(/'/g, '&#39;') : v.replace(/"/g, '&quot;');
  return v;
}

/** Rewrite the `data-props` declaration with `change`, leaving the rest of the file as written. */
function editProps(source: string, change: (props: Record<string, PropSpec>) => string): OpResult {
  const doc = parseDc(source);
  if (!doc.propsValue) throw new Error('This artboard declares no data-props.');
  const { range, quote } = doc.propsValue;
  const props = JSON.parse(decodeEntities(source.slice(range.start, range.end))) as Record<string, PropSpec>;
  const summary = change(props);
  const text = encodeAttr(JSON.stringify(props), quote);
  const out = source.slice(0, range.start) + text + source.slice(range.end);
  return { source: out, changed: out !== source, summary };
}

/** Change a tweak's default in the `data-props` declaration, leaving the rest of the file as written. */
export function setPropDefault(source: string, name: string, value: unknown): OpResult {
  return editProps(source, (props) => {
    if (!props[name]) throw new Error(`No tweak named ${name}.`);
    props[name] = { ...props[name], default: value };
    return `tweak ${name} → ${JSON.stringify(value)}`;
  });
}

/** Change one field of one row of a list tweak (`"plans":{"default":[{"name":"Solo"}]}`). */
export function setListItemField(source: string, name: string, index: number, key: string, value: unknown): OpResult {
  return editProps(source, (props) => {
    const list = props[name]?.default;
    if (!Array.isArray(list) || !list[index] || typeof list[index] !== 'object') throw new Error(`No row ${index + 1} in the list tweak ${name}.`);
    list[index] = { ...(list[index] as Record<string, unknown>), [key]: value };
    return `tweak ${name}[${index + 1}].${key} → ${JSON.stringify(value)}`;
  });
}
