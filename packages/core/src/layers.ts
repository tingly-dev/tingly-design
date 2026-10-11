import { attr, elementLabel, isTextEditable, RAW_TEXT_ELEMENTS, type DcDoc, type DcElement } from './parse';
import { getStyle } from './style';

/**
 * The layer tree the editor shows: elements named by the role they play
 * (Column, Row, Grid, Text, Image, Repeating group…) plus their first words,
 * holes kept as written — the way a designer reads a structure, not as tags.
 */

export type Role =
  | 'Column'
  | 'Row'
  | 'Grid'
  | 'Text'
  | 'Image'
  | 'Vector'
  | 'Button'
  | 'Input'
  | 'Link'
  | 'Repeating group'
  | 'Condition'
  | 'Component'
  | 'Group';

export interface Layer {
  tid: number;
  role: Role;
  label: string;
  tag: string;
  /** inside an <sc-for>: rendered once per item, not editable one by one */
  repeated: boolean;
  children: Layer[];
}

const HIDDEN = new Set(['helmet', 'style', 'script', 'link', 'meta', 'title', 'br', 'wbr']);

export function roleOf(el: DcElement): Role {
  const tag = el.tag;
  if (tag === 'sc-for') return 'Repeating group';
  if (tag === 'sc-if') return 'Condition';
  if (tag === 'dc-import' || tag === 'x-import') return 'Component';
  if (tag === 'img' || tag === 'picture' || tag === 'video') return 'Image';
  if (tag === 'svg' || el.ns === 'svg') return 'Vector';
  if (tag === 'button') return 'Button';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'Input';
  if (tag === 'a') return 'Link';
  const style = attr(el, 'style') ?? '';
  const display = getStyle(style, 'display') ?? '';
  if (/grid/.test(display)) return 'Grid';
  if (/flex/.test(display)) return /column/.test(getStyle(style, 'flex-direction') ?? '') ? 'Column' : 'Row';
  if (isTextEditable(el) || (el.children.some((c) => c.kind === 'text' && c.text.trim()) && !el.children.some((c) => c.kind === 'el' && !/^(b|i|em|strong|span|code|br|a|small|sup|sub|mark|u|s)$/.test(c.tag)))) {
    return 'Text';
  }
  if (/^(h[1-6]|p|span|label|li|strong|em|b|i|small|code|blockquote)$/.test(tag)) return 'Text';
  return 'Group';
}

export function layerTree(doc: DcDoc): Layer[] {
  const build = (el: DcElement, repeated: boolean): Layer | null => {
    if (HIDDEN.has(el.tag) || RAW_TEXT_ELEMENTS.has(el.tag)) return null;
    const role = roleOf(el);
    const inner = repeated || el.tag === 'sc-for';
    const kids: Layer[] = [];
    if (role !== 'Text' && role !== 'Vector' && role !== 'Image' && role !== 'Input') {
      for (const c of el.children) {
        if (c.kind !== 'el') continue;
        const l = build(c, inner);
        if (l) kids.push(l);
      }
    }
    return { tid: el.tid, role, label: elementLabel(el), tag: el.tag, repeated, children: kids };
  };
  const out: Layer[] = [];
  for (const n of doc.children) {
    if (n.kind !== 'el') continue;
    const l = build(n, false);
    if (l) out.push(l);
  }
  return out;
}

/** tids from the top of the tree down to `tid` (for expanding the tree to a selection). */
export function pathTo(doc: DcDoc, tid: number): number[] {
  const out: number[] = [];
  let el: DcElement | null | undefined = doc.elements[tid];
  while (el) {
    out.unshift(el.tid);
    el = el.parent;
  }
  return out;
}

/** Is this element inside an <sc-for> (rendered once per item)? */
export function isRepeated(doc: DcDoc, tid: number): boolean {
  let el = doc.elements[tid]?.parent ?? null;
  while (el) {
    if (el.tag === 'sc-for') return true;
    el = el.parent;
  }
  return false;
}
