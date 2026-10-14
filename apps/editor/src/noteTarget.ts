import { create } from 'zustand';

/**
 * Where "Keep as note" puts an agent's answer. Every kind registers its own place (a sticky note,
 * the slide's speaker notes, the scene's note, a comment); the run feed only knows that one exists.
 * A kind with none registered shows no button. `keep` returns what to tell the person (where it went)
 * and throws an Error carrying the reason when there is nowhere to put it right now.
 */
export interface NoteTarget {
  keep: (text: string) => string;
}

export const useNoteTarget = create<{ target: NoteTarget | null }>(() => ({ target: null }));

/** Register the current kind's place; the returned function unregisters it (for an effect cleanup). */
export function registerNoteTarget(target: NoteTarget): () => void {
  useNoteTarget.setState({ target });
  return () => useNoteTarget.setState((s) => (s.target === target ? { target: null } : s));
}

/** Appending to a note someone already wrote: a blank line between, nothing when either side is empty. */
export function appendNote(existing: string, text: string): string {
  return [existing.trim(), text.trim()].filter(Boolean).join('\n\n');
}
