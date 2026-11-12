// Live edit pointers: who is changing what, and where on the page that is (`.design/live-pointers.md`).
// Pure: a participant and its colour, the span a write changed, and the element that span lands in.
import type { Actor } from './canvas';
import type { DcDoc, DcElement } from './parse';
import { rootElement } from './ops';

/**
 * Someone or something that changes a project: Claude Code, the fast AI, a
 * program outside the editor, another window (another person), or any agent
 * that announces itself. One participant is in one place at a time.
 */
export interface Participant {
  /** stable for as long as it works: `claude`, `fast-edit`, `external`, `client:<id>`, or an announcer's own id */
  id: string;
  actor: Actor;
  /** a name to show instead of the actor's word (an announced agent, later a person) */
  name?: string;
  /** `#rrggbb`; unset takes the actor's colour, or one from the palette for a person */
  color?: string;
}

/** Where a participant is working: an element of an artboard, slide or scene, or a top-level block of a doc tab. */
export interface PointerTarget {
  file: string;
  /** the element in a `.dc.html`, slide or scene file */
  tid?: number;
  /** the top-level block of a doc tab, counted from 0 */
  block?: number;
}

/** A pointer is shown at full strength this long after its participant last moved, then fades out over `POINTER_FADE_MS`. */
export const POINTER_IDLE_MS = 4000;
export const POINTER_FADE_MS = 1200;

/**
 * Colours that stay apart from the editor's own marks on a page: selection blue
 * (#2f6fed) and the review remarks' amber (#d97706). An agent keeps one colour;
 * people take the palette in turn by their id.
 */
const ACTOR_COLOR: Partial<Record<Actor, string>> = {
  claude: '#7c3aed',
  'fast-edit': '#0d9488',
  jquery: '#0d9488',
  external: '#db2777',
};
export const PEOPLE_COLORS = ['#16a34a', '#ea580c', '#0891b2', '#c026d3', '#65a30d', '#e11d48'];

export function pointerColor(p: Participant): string {
  if (p.color) return p.color;
  const fixed = p.actor === 'human' || p.actor === 'undo' ? undefined : ACTOR_COLOR[p.actor];
  if (fixed) return fixed;
  let h = 0;
  for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PEOPLE_COLORS[h % PEOPLE_COLORS.length];
}

/**
 * Who a change to a file stands for, from the actor the server stamped and the
 * window (`by`) that saved it. Null when no pointer is worth showing: this
 * window's own change (you know where you are typing), or a person's change
 * whose window is unknown (the server's own writes for the editor).
 */
export function participantOf(actor: Actor, by: string | undefined, me: string): Participant | null {
  if (by === me) return null;
  if (by) return { id: `client:${by}`, actor };
  if (actor === 'claude' || actor === 'external') return { id: actor, actor };
  return null;
}

/** The files whose pointer is an element: artboards, slides and motion scenes. */
export function isElementFile(file: string): boolean {
  return /\.dc\.html$/.test(file) || /^(slides|scenes)\/[^/]+\.html$/.test(file);
}

/**
 * The span of `after` a write changed, by the common start and end of the two
 * texts; empty (start === end) where something was only taken out. An insertion
 * can be read at several places when its text repeats around it (`<p>b</p>` put
 * before `</div>` shares the `<`): the reading that starts at a tag and ends at
 * one is taken, so the span is the new element and not a slice across two.
 */
export function changedSpan(before: string, after: string): { start: number; end: number } | null {
  if (before === after) return null;
  const max = Math.min(before.length, after.length);
  let p = 0;
  while (p < max && before.charCodeAt(p) === after.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && before.charCodeAt(before.length - 1 - s) === after.charCodeAt(after.length - 1 - s)) s++;
  let start = p;
  let end = after.length - s;
  if (before.length - p - s === 0 && end > start) {
    // a pure insertion: slide it to its first reading, then take the first reading that is whole tags
    while (start > 0 && after[start - 1] === after[end - 1]) (start--, end--);
    for (let a = start, b = end; b <= after.length; a++, b++) {
      const text = after.slice(a, b).trim();
      if (text.startsWith('<') && text.endsWith('>')) {
        start = a;
        end = b;
        break;
      }
      if (after[a] !== after[b]) break;
    }
  }
  // the whitespace at the ends does not move the pointer
  while (start < end && /\s/.test(after[start])) start++;
  while (end > start && /\s/.test(after[end - 1])) end--;
  return { start, end };
}

/** Elements the page does not draw as themselves: their pointer goes to the nearest drawn ancestor. */
const UNDRAWN = (el: DcElement) => el.tag === 'helmet' || el.tag === 'script' || el.tag === 'style' || el.tag.startsWith('sc-');

/**
 * The element a changed span lands in: the deepest element holding all of it
 * that the page draws. A change outside every element (the logic script, the
 * `data-props` declaration, the head) stands for the whole artboard or slide.
 */
export function pointerTid(doc: DcDoc, span: { start: number; end: number }): number | null {
  let best: DcElement | null = null;
  for (const el of doc.elements) {
    if (el.range.start <= span.start && el.range.end >= span.end && (!best || el.range.end - el.range.start <= best.range.end - best.range.start)) best = el;
  }
  for (let up = best; up; up = up.parent) if (up.tag === 'helmet') best = null;
  let el = best;
  while (el && UNDRAWN(el)) el = el.parent;
  return (el ?? rootElement(doc))?.tid ?? null;
}

/** Reads an announced participant (`POST …/pointer`); null when it is not one. */
export function cleanParticipant(x: unknown): Participant | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[\w:.@-]{1,64}$/.test(o.id)) return null;
  const actors: Actor[] = ['human', 'jquery', 'fast-edit', 'claude', 'external', 'undo'];
  const actor = actors.includes(o.actor as Actor) ? (o.actor as Actor) : 'external';
  const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : undefined;
  return { id: o.id, actor, ...(name ? { name } : {}), ...(color ? { color } : {}) };
}
