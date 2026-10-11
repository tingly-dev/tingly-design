import { DesignCopy, setCopyStyle } from './copy';
import { decodeEntities, parseDc, type PropSpec } from './parse';
import { getStyle, kebab } from './style';

/**
 * Edits a person makes on the canvas. Each one runs on a fresh DesignCopy of
 * the current source, so after a save conflict the same op can simply be
 * replayed on the newer file.
 */
export type HumanOp =
  | { kind: 'style'; tid: number; prop: string; value: string | null }
  | { kind: 'styleText'; tid: number; text: string }
  | { kind: 'text'; tid: number; text: string }
  | { kind: 'attr'; tid: number; name: string; value: string | null }
  | { kind: 'remove'; tid: number }
  | { kind: 'duplicate'; tid: number }
  | { kind: 'move'; tid: number; dir: -1 | 1 };

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
  }
}

export function applyHumanOps(source: string, ops: HumanOp[], document: Document): OpResult {
  const copy = new DesignCopy(source, document);
  const notes: string[] = [];
  for (const op of ops) {
    const el = copy.element(op.tid);
    if (!el) throw new Error(`element ${op.tid} is no longer in the design`);
    const handle = copy.handle(op.tid);
    switch (op.kind) {
      case 'style': {
        const before = getStyle(el.getAttribute('style') ?? '', kebab(op.prop));
        setCopyStyle(el, op.prop, op.value);
        notes.push(describeOp(op, handle, before));
        break;
      }
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
        let sib: Element | null = op.dir < 0 ? el.previousElementSibling : el.nextElementSibling;
        if (!sib) break;
        if (op.dir < 0) sib.before(el);
        else sib.after(el);
        notes.push(describeOp(op, handle));
        break;
      }
    }
  }
  const out = copy.toSource();
  return { source: out, changed: out !== source, summary: notes.join('; ') };
}

function encodeAttr(value: string, quote: string): string {
  let v = value.replace(/&/g, '&amp;');
  v = quote === "'" ? v.replace(/'/g, '&#39;') : v.replace(/"/g, '&quot;');
  return v;
}

/** Change a tweak's default in the `data-props` declaration, leaving the rest of the file as written. */
export function setPropDefault(source: string, name: string, value: unknown): OpResult {
  const doc = parseDc(source);
  if (!doc.propsValue) throw new Error('This artboard declares no data-props.');
  const { range, quote } = doc.propsValue;
  const props = JSON.parse(decodeEntities(source.slice(range.start, range.end))) as Record<string, PropSpec>;
  if (!props[name]) throw new Error(`No tweak named ${name}.`);
  props[name] = { ...props[name], default: value };
  const text = encodeAttr(JSON.stringify(props), quote);
  const out = source.slice(0, range.start) + text + source.slice(range.end);
  return { source: out, changed: out !== source, summary: `tweak ${name} → ${JSON.stringify(value)}` };
}
