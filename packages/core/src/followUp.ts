/**
 * What a person changed by hand in a project's configuration, and what to offer the AI because of it
 * (`.design/config-awareness.md`). A change is data; one table says whether it is worth an offer and what
 * the offer asks Claude Code to do. No UI wording here: `reason` names the sentence the editor shows.
 */
import { needsRelayout, type Size } from './sizeAdapt';

export type ConfigChange =
  /** An artboard (`file`) or the whole deck (no file) got a new size. */
  | { type: 'size'; file?: string; from: Size; to: Size }
  /** A motion format was added; its scenes were seeded from the primary layout. */
  | { type: 'format'; format: string; from: Size; to: Size }
  /** A motion format was taken out again, with the scene overrides that were only about it. Nothing to re-lay out. */
  | { type: 'formatRemoved'; format: string }
  /** A motion piece's playback speed was set (the whole piece moves with it; nothing to re-lay out). */
  | { type: 'speed'; from: number; to: number }
  /** A design system was installed (or updated) in a canvas or deck: `namespace` is its folder under `ds/`. */
  | { type: 'designSystem'; namespace: string; title: string }
  /** A design system's tokens were edited; `edits` are the editor's own summaries of what, oldest first. */
  | { type: 'tokens'; edits: string[] };

/** An offer: `reason` is a key the editor turns into a sentence, `prompt` the request for Claude Code. */
export interface FollowUp {
  reason: { id: 'size' | 'format' | 'designSystem' | 'tokens' };
  prompt: string;
}

const FOLLOW_UP: { [T in ConfigChange['type']]: (c: Extract<ConfigChange, { type: T }>) => FollowUp | null } = {
  size(c) {
    if (!needsRelayout(c.from, c.to)) return null;
    const [w, h] = c.to;
    return {
      reason: { id: 'size' },
      prompt: c.file
        ? `Re-lay out ${c.file} for a ${w}×${h} artboard: the page was scaled from another shape, so rearrange sections (stack columns, resize or reorder blocks) so everything fits and reads well at this size. Keep the copy, the style and the template values.`
        : `Re-lay out every slide in this deck for a ${w}×${h} page: the slides were scaled from another shape, so rearrange them (stack columns, resize or reorder blocks) so everything fits and reads well. Keep the copy, the style and the order.`,
    };
  },
  format(c) {
    if (!needsRelayout(c.from, c.to)) return null;
    return {
      reason: { id: 'format' },
      prompt: `Re-lay out every scene for the new "${c.format}" format: the primary layout was rescaled into data-${c.format} overrides, so rearrange them (stack columns, resize or reorder blocks) so everything fits and reads well in that format. Keep the primary format, the copy and the timing.`,
    };
  },
  formatRemoved: () => null,
  speed: () => null,
  designSystem(c) {
    return {
      reason: { id: 'designSystem' },
      prompt: `The design system "${c.title}" (ds/${c.namespace}/) was just installed in this project. Restyle the existing content to use its colours, type and components where they fit, so the work looks like it belongs to that system. Keep the copy, the structure and the layout.`,
    };
  },
  tokens() {
    return {
      reason: { id: 'tokens' },
      prompt: "The design tokens were edited by hand (see the changes listed above). Check this design system's components and make them follow the tokens: replace hard-coded colours, sizes and fonts that should use a variable, and fix what the new values break. Keep the components' structure and names.",
    };
  },
};

/** The offer a change deserves, or null when it needs none. */
export function followUpFor(change: ConfigChange): FollowUp | null {
  return (FOLLOW_UP[change.type] as (c: ConfigChange) => FollowUp | null)(change);
}

const sameSize = (a: Size, b: Size) => a[0] === b[0] && a[1] === b[1];

/** What a change is about: changes with the same scope are one change. */
export function changeScope(c: ConfigChange): string {
  switch (c.type) {
    case 'size':
      return `size:${c.file ?? ''}`;
    case 'format':
    case 'formatRemoved':
      return `format:${c.format}`;
    case 'designSystem':
      return `designSystem:${c.namespace}`;
    case 'tokens':
      return 'tokens';
    case 'speed':
      return 'speed';
  }
}

/**
 * `change` after an earlier change to the same thing (`before`): one change, from where it started to where it is now.
 * Null when it is back where it started, so nothing is left to tell. Small steps add up; a change put back is no change.
 */
export function mergeChange(before: ConfigChange | undefined, change: ConfigChange): ConfigChange | null {
  // a format added and removed again is no change; one removed and added again is the new one (it starts over from the primary)
  if (change.type === 'formatRemoved' && before?.type === 'format') return null;
  if (before && before.type === change.type) {
    if ((change.type === 'size' || change.type === 'format') && (before.type === 'size' || before.type === 'format')) {
      const merged = { ...change, from: before.from };
      return sameSize(merged.from, merged.to) ? null : merged;
    }
    // the same edit again (a colour dragged) is one edit, kept at its latest place
    if (change.type === 'tokens' && before.type === 'tokens') return { type: 'tokens', edits: [...before.edits.filter((e) => !change.edits.includes(e)), ...change.edits].slice(-8) };
  }
  if (change.type === 'speed' && before?.type === 'speed') return before.from === change.to ? null : { ...change, from: before.from };
  if (change.type === 'size' || change.type === 'format') return sameSize(change.from, change.to) ? null : change;
  return change;
}

/** Changes that come in streams (a colour dragged): the offer shows for the first since Claude last ran, and dismissing it holds. */
export const isStream = (c: ConfigChange): boolean => c.type === 'tokens';

/** `c` without what a request that carried `sent` already told Claude Code; null when nothing is left. */
export function withoutSent(c: ConfigChange, sent: ConfigChange[]): ConfigChange | null {
  const told = sent.find((s) => changeScope(s) === changeScope(c));
  if (!told) return c;
  if (c.type === 'tokens' && told.type === 'tokens') {
    const left = c.edits.filter((e) => !told.edits.includes(e));
    return left.length ? { type: 'tokens', edits: left } : null;
  }
  if (c === told) return null;
  if (c.type === 'speed' && told.type === 'speed') return told.to === c.to ? null : { ...c, from: told.to };
  // changed again while the request was on its way: what is left runs from where the request left it
  if ((c.type === 'size' || c.type === 'format') && (told.type === 'size' || told.type === 'format')) return sameSize(told.to, c.to) ? null : { ...c, from: told.to };
  return c;
}

/** One line for Claude Code: what the person changed since its last run. */
export function describeChange(c: ConfigChange): string {
  const px = (s: Size) => `${s[0]}×${s[1]}`;
  // names come from the project's files: quoted, so an odd one stays a name
  if (c.type === 'designSystem') return `The design system ${JSON.stringify(c.title)} was installed (ds/${c.namespace}/).`;
  if (c.type === 'tokens') return `Design tokens were edited: ${c.edits.map((e) => JSON.stringify(e)).join(', ')}.`;
  if (c.type === 'size') return `${c.file ? `Artboard ${JSON.stringify(c.file)}` : 'The deck page'} was resized from ${px(c.from)} to ${px(c.to)}.`;
  if (c.type === 'speed') return `The motion piece's playback speed was changed from ${c.from}× to ${c.to}×; every scene, entrance and pause plays at that rate, so the video is ${c.to > c.from ? 'shorter' : 'longer'} (the timing in the scene files is unchanged).`;
  if (c.type === 'formatRemoved') return `The motion format ${JSON.stringify(c.format)} was removed, with the scene overrides that were only about it.`;
  return `A motion format ${JSON.stringify(c.format)} (${px(c.to)}) was added; the primary format is ${px(c.from)}.`;
}
