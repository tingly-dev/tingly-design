import { RAW_TEXT_ELEMENTS, VOID_ELEMENTS, attr, isTextEditable, templateText, tweakTextBinding, type DcDoc, type DcElement, type PropSpec } from './parse';

/**
 * Retyping text that has holes in it (`Hello {{name}}!`). The element's
 * template text is cut into literal pieces and holes; the edit is found by
 * comparing the text as it was drawn with the text as it was retyped, and
 * lands in the one piece it touches: a hole that shows a text tweak or a row
 * of a list tweak changes that value, a literal piece changes the template,
 * and the holes stay where they are. `.design/template-text-editing.md`.
 */

/** Why a retype cannot be applied: the edit is in data from the script, spans several pieces, or does not line up with the template. */
export class RetypeError extends Error {
  constructor(public code: 'data' | 'span' | 'nomatch') {
    super(`Cannot retype this text: ${code}`);
  }
}

/** What a retype changes: the element's template text (holes kept) and/or tweak values. */
export interface Retype {
  /** the element's new template text, or null when only values change */
  template: string | null;
  sets: PropSet[];
}

export type PropSet = { prop: string; value: string } | { prop: string; index: number; key: string; value: string };

type Binding = { kind: 'prop'; prop: string } | { kind: 'item'; prop: string; key: string } | null;

interface Piece {
  text: string;
  hole: boolean;
  binding: Binding;
}

const HOLE = /\{\{[^}]*\}\}/g;

function textProp(spec: PropSpec | undefined): boolean {
  return !!spec && typeof spec === 'object' && !Array.isArray(spec) && (!spec.editor || spec.editor === 'text') && (spec.default === undefined || typeof spec.default === 'string');
}

function loopOf(el: DcElement): DcElement | null {
  for (let a = el.parent; a; a = a.parent) if (a.tag === 'sc-for') return a;
  return null;
}

function bindingOf(doc: DcDoc, el: DcElement, hole: string): Binding {
  const expr = hole.slice(2, -2).trim();
  if (/^[A-Za-z_$][\w$]*$/.test(expr)) return textProp(doc.props[expr]) ? { kind: 'prop', prop: expr } : null;
  const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(expr);
  const loop = m ? loopOf(el) : null;
  if (!m || !loop || m[1] !== (attr(loop, 'as') ?? 'item')) return null;
  const list = /^\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}$/.exec(attr(loop, 'list') ?? '');
  const spec = list ? doc.props[list[1]] : undefined;
  return list && spec && typeof spec === 'object' && Array.isArray(spec.default) ? { kind: 'item', prop: list[1], key: m[2] } : null;
}

function pieces(doc: DcDoc, el: DcElement): Piece[] {
  const text = templateText(el);
  const out: Piece[] = [];
  let at = 0;
  for (const m of text.matchAll(HOLE)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), hole: false, binding: null });
    out.push({ text: m[0], hole: true, binding: bindingOf(doc, el, m[0]) });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hole: false, binding: null });
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How retyping an element's text works: `literal` text is rewritten, `tweak`
 * is `{{name}}` alone and sets the tweak, `mixed` has literal pieces or holes
 * that show tweak values, `data` is nothing but holes fed by the script, and
 * null is not retypable at all (it holds other elements, or is not text).
 */
export function retypeKind(doc: DcDoc, el: DcElement): 'literal' | 'tweak' | 'mixed' | 'data' | null {
  if (isTextEditable(el)) return 'literal';
  if (tweakTextBinding(doc, el)) return 'tweak';
  if (RAW_TEXT_ELEMENTS.has(el.tag) || VOID_ELEMENTS.has(el.tag) || el.tag.startsWith('sc-') || el.tag === 'dc-import' || el.tag === 'helmet') return null;
  if (el.children.some((c) => c.kind === 'el')) return null;
  const ps = pieces(doc, el);
  if (!ps.some((p) => p.hole)) return null;
  return ps.some((p) => (p.hole ? p.binding : p.text.trim())) ? 'mixed' : 'data';
}

/** The value a bound hole shows right now, when it can be known from the file. */
function known(doc: DcDoc, b: Binding, item: number | null): string | undefined | false {
  if (!b) return undefined;
  const spec = doc.props[b.prop];
  if (b.kind === 'prop') return typeof spec.default === 'string' ? spec.default : undefined;
  if (item === null) return false;
  const row = (spec.default as unknown[])[item];
  if (!row || typeof row !== 'object') return false;
  const v = (row as Record<string, unknown>)[b.key];
  return v === undefined || typeof v === 'string' ? (v as string | undefined) : false;
}

/**
 * Plan the retype of `el`'s text from `from` (as it was drawn) to `to` (as it
 * was typed). `item` is the row of the nearest `<sc-for>` this element was
 * drawn for. Throws a `RetypeError` when the edit cannot be kept in the template.
 */
export function planRetype(doc: DcDoc, el: DcElement, from: string, to: string, item: number | null = null): Retype {
  const O = norm(from);
  const T = norm(to);
  if (O === T) return { template: null, sets: [] };
  const ps = pieces(doc, el);
  // bound holes whose value the file does not give (or has the wrong type) are data
  for (const p of ps) if (p.hole && p.binding && known(doc, p.binding, item) === false) p.binding = null;

  const re = new RegExp(
    '^' +
      ps
        .map((p) => {
          if (!p.hole) return esc(p.text);
          const k = known(doc, p.binding, item);
          return typeof k === 'string' ? `(${esc(k)})` : '(.*?)';
        })
        .join('') +
      '$',
    's',
  );
  const m = re.exec(O);
  if (!m) throw new RetypeError('nomatch');
  let g = 1;
  let pos = 0;
  const spans = ps.map((p) => {
    const len = p.hole ? m[g++].length : p.text.length;
    const span = { start: pos, end: pos + len };
    pos += len;
    return span;
  });

  // the changed region of what was drawn, and what replaces it
  let p = 0;
  while (p < O.length && p < T.length && O[p] === T[p]) p++;
  let s = 0;
  while (s < O.length - p && s < T.length - p && O[O.length - 1 - s] === T[T.length - 1 - s]) s++;
  const a = p;
  const b = O.length - s;
  const r = T.slice(p, T.length - s);

  const inside = spans.map((_, i) => i).filter((i) => (a < b ? spans[i].start < b && a < spans[i].end : spans[i].start <= a && a <= spans[i].end));
  let target: number | undefined;
  if (a < b) {
    if (inside.length > 1) throw new RetypeError('span');
    target = inside[0];
  } else {
    // typing at the seam of two pieces belongs to a value, which is what a person is editing
    target = inside.find((i) => ps[i].hole && ps[i].binding) ?? inside.find((i) => !ps[i].hole) ?? inside[0];
  }
  if (target === undefined) throw new RetypeError('nomatch');

  const piece = ps[target];
  const old = O.slice(spans[target].start, spans[target].end);
  const value = old.slice(0, a - spans[target].start) + r + old.slice(b - spans[target].start);
  if (!piece.hole) {
    return { template: ps.map((q, i) => (i === target ? value : q.text)).join(''), sets: [] };
  }
  const bind = piece.binding;
  if (!bind) throw new RetypeError('data');
  if (bind.kind === 'prop') return { template: null, sets: [{ prop: bind.prop, value }] };
  return { template: null, sets: [{ prop: bind.prop, index: item!, key: bind.key, value }] };
}
