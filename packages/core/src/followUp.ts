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
  | { type: 'format'; format: string; from: Size; to: Size };

/** An offer: `reason` is a key the editor turns into a sentence, `prompt` the request for Claude Code. */
export interface FollowUp {
  reason: { id: 'size' | 'format' };
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
};

/** The offer a change deserves, or null when it needs none. */
export function followUpFor(change: ConfigChange): FollowUp | null {
  return (FOLLOW_UP[change.type] as (c: ConfigChange) => FollowUp | null)(change);
}

/** One line for Claude Code: what the person changed since its last run. */
export function describeChange(c: ConfigChange): string {
  const px = (s: Size) => `${s[0]}×${s[1]}`;
  if (c.type === 'size') return `${c.file ? `Artboard ${c.file}` : 'The deck page'} was resized from ${px(c.from)} to ${px(c.to)}.`;
  return `A motion format "${c.format}" (${px(c.to)}) was added; the primary format is ${px(c.from)}.`;
}
