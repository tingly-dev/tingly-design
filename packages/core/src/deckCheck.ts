/**
 * What a deck gets wrong across its slides, beyond what each slide's own checker sees
 * (`checkSlide`): placeholders left in the text, read from the files, and headings that
 * move between slides of one kind, from what the layout probe measured in the drawn slides.
 * Both return rule ids and values; the command line and MCP word them (`.design/deck-check.md`).
 */
import { parseDc, type DcNode } from './parse';

/** Where the open deck keeps a picture of each slide it checked, for Claude Code to look at (`<slide id>.png`). */
export const LOOK_DIR = 'renders/look';

export type DeckRule = 'placeholder' | 'headingMoved';

export interface DeckFinding {
  rule: DeckRule;
  /** the slide file */
  file: string;
  /** placeholder: the placeholder found; headingMoved: the heading's first words */
  text: string;
  /** headingMoved: how far it sits from where the others of its kind put it, in px (down and right are positive) */
  dy?: number;
  dx?: number;
  /** headingMoved: how many slides share the usual place */
  others?: number;
}

// a bracketed placeholder the skill asks for (`[€__]`, `[Name]`, `[insert logo]`, `[TBD]`), not a [[wiki link]] or [1] reference
const BRACKETED = /(?<!\[)\[(?!\[)([^\][\n]{1,40})\](?!\])/g;
const FILL_IN = /_{2,}|…|\.{3}|^(?:insert|add|todo|tbd|tbc|xx+|name|date|figure|number|amount|link|logo|image|photo|quote|source)\b/i;
// a fill-in written in capitals: `[COMPANY NAME]`
const CAPITALS = /^[A-Z][A-Z ]{2,}$/;
const LEFTOVER = /\blorem ipsum\b|\bTODO\b|\bTBD\b|\bXXX+\b|\bx{3,}\b/i;

function text(nodes: DcNode[], out: string[]) {
  for (const n of nodes) {
    if (n.kind === 'text') out.push(n.text);
    // what nobody sees on the slide: speaker notes, hidden elements, drawings, embedded pages
    else if (n.kind === 'el' && !['aside', 'svg', 'x-embed', 'script', 'style'].includes(n.tag) && !n.attrs.some((a) => a.name === 'data-hide')) text(n.children, out);
  }
}

/** Placeholders still on a slide: a bracketed fill-in, `lorem ipsum`, `TODO`, `TBD`, `XXX`. One finding per placeholder text. */
export function slidePlaceholders(file: string, source: string | undefined): DeckFinding[] {
  if (source === undefined) return [];
  const parts: string[] = [];
  text(parseDc(source).children, parts);
  const all = parts.join(' ').replace(/\s+/g, ' ');
  const found = new Set<string>();
  for (const m of all.matchAll(BRACKETED)) if (FILL_IN.test(m[1].trim()) || CAPITALS.test(m[1].trim())) found.add(m[0]);
  const left = all.match(LEFTOVER);
  if (left) found.add(left[0]);
  return [...found].map((t) => ({ rule: 'placeholder' as const, file, text: t }));
}

/** A slide's first heading as the layout probe measured it in the drawn slide. */
export interface SlideHeading {
  file: string;
  tag: string;
  size: number;
  top: number;
  left: number;
  /** the slide's height, px */
  height: number;
  text: string;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

/**
 * Headings that move: content slides whose first heading has the same tag and size as at least two
 * others' but sits more than `tolerance` px from where most of them put it. Only headings in the top
 * third count (a statement or closing slide centres its line on purpose), and a group needs three
 * slides so there is a usual place to differ from.
 */
export function slideHeadingDrift(heads: SlideHeading[], tolerance = 6): DeckFinding[] {
  const groups = new Map<string, SlideHeading[]>();
  for (const h of heads) {
    if (h.top > h.height / 3) continue;
    const key = `${h.tag}:${Math.round(h.size)}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  const out: DeckFinding[] = [];
  for (const g of groups.values()) {
    if (g.length < 3) continue;
    const top = median(g.map((h) => h.top));
    const left = median(g.map((h) => h.left));
    const usual = g.filter((h) => Math.abs(h.top - top) <= tolerance && Math.abs(h.left - left) <= tolerance).length;
    for (const h of g) {
      const dy = Math.round(h.top - top);
      const dx = Math.round(h.left - left);
      if (Math.abs(dy) > tolerance || Math.abs(dx) > tolerance) out.push({ rule: 'headingMoved', file: h.file, text: h.text, dy, dx, others: usual });
    }
  }
  return out;
}
