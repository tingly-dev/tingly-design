import type { NoteEntry } from '@dc/core';

/** The in-app clipboard: an element's HTML or canvas items, mirrored to the system clipboard as text. */

export type Clip = { kind: 'el'; html: string } | { kind: 'items'; items: NoteEntry[] };
let clip: Clip | null = null;
export function setClip(c: Clip): void {
  clip = c;
  try {
    navigator.clipboard?.writeText(clipText()).catch(() => {});
  } catch {
    // clipboard permission is optional: the in-app clipboard still works
  }
}
export function getClip(): Clip | null {
  return clip;
}
/** The text the in-app clipboard put on the system clipboard: pasting it back is a paste, not an import. */
export function clipText(): string {
  return !clip ? '' : clip.kind === 'el' ? clip.html : JSON.stringify(clip.items, null, 2);
}
