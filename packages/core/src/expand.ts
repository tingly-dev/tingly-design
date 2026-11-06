import { HIDE_ATTR, LOCK_ATTR } from './layers';
import type { HumanOp } from './ops';
import { RAW_TEXT_ELEMENTS, attr, hasHole, type DcDoc, type DcElement } from './parse';

/**
 * Expanding an element to edit what it holds. A picture, a link, an input or a
 * card with several parts is not text, but a person looking at it knows what
 * they would change. This is the one place that says what that is: an element
 * is read into a list of editable fields (a text run, a picture's source and
 * alt, a link's address, a placeholder), in reading order, each with where it
 * is written back and why it cannot be written when it cannot. The editor
 * shows the list as one form, on the stage and in the Properties panel. Every
 * write is an ordinary op (`attr`, `textRun`) or a tweak default, so nothing
 * new goes into the file. `.design/expand-to-edit.md`.
 */

/** What a field is: the text of a run, or one attribute with a meaning of its own. */
export type FieldKind = 'text' | 'src' | 'alt' | 'href' | 'newTab' | 'placeholder';

/** What the field belongs to, for its label and control. */
export type FieldRole = 'text' | 'picture' | 'link' | 'input' | 'video';

/**
 * Where a value comes from: written in the file, a text tweak (`src="{{logo}}"`,
 * edited by changing the tweak's default), or a template value that cannot be
 * edited here (`data` from the script, `row` from a list row's data).
 */
export type FieldBinding = { kind: 'literal' } | { kind: 'tweak'; prop: string } | { kind: 'readonly'; why: 'data' | 'row' };

export interface EditField {
  /** stable within one element's fields: `<tid>:<kind>[:<run>]` */
  key: string;
  tid: number;
  /** the picture, link or input the field belongs to (a styled word inside a link is the link's), else its own element */
  owner: number;
  kind: FieldKind;
  role: FieldRole;
  /** the value as the file says it; a tweak's default for a tweak-bound field; holes kept for a read-only one */
  value: string;
  binding: FieldBinding;
  /** `kind` text: which of the element's text nodes (not counting elements) */
  run?: number;
  /** drawn once per item of an `<sc-for>`: a change reaches every row */
  repeated: boolean;
}

export class FieldError extends Error {
  constructor(public code: 'readonly') {
    super(`Cannot edit this field: ${code}`);
  }
}

/** Never content: the head of the page, scripts, line breaks. */
const SKIP = new Set(['helmet', 'style', 'script', 'link', 'meta', 'title', 'br', 'wbr', 'template', 'dc-import', 'x-import', 'x-embed', 'x-icon', 'x-shape', 'x-connector']);

/** Input types that hold a typed value and so have a placeholder. */
const TYPED = /^(|text|search|email|url|tel|password|number)$/i;

function textTweak(doc: DcDoc, name: string): string | undefined {
  const spec = doc.props[name];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) || (spec.editor && spec.editor !== 'text')) return undefined;
  return spec.default === undefined ? '' : typeof spec.default === 'string' ? spec.default : undefined;
}

function bind(doc: DcDoc, el: DcElement, value: string): { value: string; binding: FieldBinding } {
  if (!hasHole(value)) return { value, binding: { kind: 'literal' } };
  const only = /^\s*\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}\s*$/.exec(value);
  const shown = only ? textTweak(doc, only[1]) : undefined;
  if (only && shown !== undefined) return { value: shown, binding: { kind: 'tweak', prop: only[1] } };
  const inLoop = (() => {
    for (let a = el.parent; a; a = a.parent) if (a.tag === 'sc-for') return true;
    return false;
  })();
  return { value, binding: { kind: 'readonly', why: inLoop && /\{\{\s*[A-Za-z_$][\w$]*\.[\w$]+\s*\}\}/.test(value) ? 'row' : 'data' } };
}

/**
 * Everything a person can change by hand in `root` and what is inside it, in
 * reading order. Locked and hidden parts are left out. A text node with a
 * hole in it is listed (so the form can say why it is read-only) unless it is
 * exactly one text tweak.
 */
export function editFields(doc: DcDoc, root: DcElement): EditField[] {
  const out: EditField[] = [];
  const walk = (el: DcElement, repeated: boolean, link: DcElement | null) => {
    if (SKIP.has(el.tag) || RAW_TEXT_ELEMENTS.has(el.tag) || el.ns !== 'html') return;
    if (attr(el, LOCK_ATTR) !== undefined || attr(el, HIDE_ATTR) !== undefined) return;
    const rep = repeated || el.tag === 'sc-for';
    const add = (kind: FieldKind, role: FieldRole, raw: string, run?: number) => {
      const b = bind(doc, el, raw);
      out.push({ key: `${el.tid}:${kind}${run === undefined ? '' : `:${run}`}`, tid: el.tid, owner: link?.tid ?? el.tid, kind, role, value: b.value, binding: b.binding, ...(run === undefined ? {} : { run }), repeated: rep });
    };
    const inLink = link ?? (el.tag === 'a' ? el : null);
    const content = () => {
      let run = 0;
      for (const c of el.children) {
        if (c.kind === 'el') walk(c, rep, inLink);
        else if (c.kind === 'text') {
          if (c.text.trim()) add('text', inLink ? 'link' : 'text', c.text.replace(/\s+/g, ' ').trim(), run);
          run++;
        }
      }
    };
    switch (el.tag) {
      case 'img':
        add('src', 'picture', attr(el, 'src') ?? '');
        add('alt', 'picture', attr(el, 'alt') ?? '');
        return;
      case 'video':
        add('src', 'video', attr(el, 'src') ?? '');
        return;
      case 'input':
        if (TYPED.test(attr(el, 'type') ?? '')) add('placeholder', 'input', attr(el, 'placeholder') ?? '');
        return;
      case 'textarea':
        add('placeholder', 'input', attr(el, 'placeholder') ?? '');
        return;
      case 'a':
        content();
        add('href', 'link', attr(el, 'href') ?? '');
        add('newTab', 'link', attr(el, 'target') === '_blank' ? 'on' : '');
        return;
      default:
        content();
    }
  };
  walk(root, false, null);
  return out;
}

/** What writing a field comes to: ops for the element, or a text tweak's new default. */
export type FieldPlan = { ops: HumanOp[] } | { tweak: { prop: string; value: string } };

/** Plan a field's new value. Throws `FieldError` when the field is read-only. */
export function planField(field: EditField, value: string): FieldPlan {
  if (field.binding.kind === 'readonly') throw new FieldError('readonly');
  if (field.binding.kind === 'tweak') return { tweak: { prop: field.binding.prop, value } };
  const { tid } = field;
  switch (field.kind) {
    case 'text':
      return { ops: [{ kind: 'textRun', tid, run: field.run ?? 0, text: value.replace(/\s+/g, ' ').trim() }] };
    case 'newTab':
      return value
        ? { ops: [{ kind: 'attr', tid, name: 'target', value: '_blank' }, { kind: 'attr', tid, name: 'rel', value: 'noopener' }] }
        : { ops: [{ kind: 'attr', tid, name: 'target', value: null }, { kind: 'attr', tid, name: 'rel', value: null }] };
    case 'placeholder':
      return { ops: [{ kind: 'attr', tid, name: 'placeholder', value: value.trim() || null }] };
    case 'alt':
      // an empty alt is a decorative picture, not a missing one: the attribute stays
      return { ops: [{ kind: 'attr', tid, name: 'alt', value }] };
    default:
      return { ops: [{ kind: 'attr', tid, name: field.kind, value: value.trim() }] };
  }
}

/** The field whose text is nearest to what was clicked (a double-click on a run of a mixed paragraph). */
export function fieldNear(fields: EditField[], near: string | undefined): EditField | undefined {
  const n = near?.replace(/\s+/g, ' ').trim();
  if (!n) return undefined;
  return fields.find((f) => f.kind === 'text' && f.value === n) ?? fields.find((f) => f.kind === 'text' && (f.value.includes(n) || n.includes(f.value)));
}
