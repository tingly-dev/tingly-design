import { elementSource, type FromRuntime } from '@dc/core';
import { display, editElement, parsed, useStore } from '../store';
import { leaveField } from '../shortcuts';

/**
 * What the editor answers to a sandboxed runtime frame the same way in every
 * kind: the canvas artboard's frame (canvas/Board.tsx) and the slide stage
 * (slides/SlideFrame.tsx). Each stage's message handler calls these from its
 * own switch; its remaining cases are the ones that differ.
 */

/** After a move the element's tid changes; find it again by its own source text. */
function follow(file: string, slice: string | null, fallback: number): number {
  const src = display(useStore.getState(), file);
  if (!src || !slice) return fallback;
  return parsed(src).elements.find((e) => src.slice(e.range.start, e.range.end) === slice)?.tid ?? fallback;
}

/** Leave any open field and select what the frame pointed at (a board, or an element in it). */
export function stageSelect(file: string, tid: number | null): void {
  leaveField();
  useStore.setState({ selection: tid === null ? { kind: 'board', file } : { kind: 'el', file, tid }, menu: null, editingNote: null });
}

/** What the runtime measured about the selected element. */
export function stageInspect(m: Extract<FromRuntime, { dc: 'inspect' }>, file: string): void {
  const s = useStore.getState();
  if (!m.info || (s.selection?.kind === 'el' && s.selection.file === file)) useStore.setState({ inspect: m.info });
}

/** Rendered instances per tid, per artboard (for "Repeating group · N items"). */
export function stageCounts(counts: Record<number, number>, file: string): void {
  useStore.setState((st) => ({ counts: { ...st.counts, [file]: counts } }));
}

/** A drag move: edit, then select the element again by its own source text. */
export function stageMove(m: Extract<FromRuntime, { dc: 'move' }>, file: string): void {
  const src = display(useStore.getState(), file);
  const slice = src ? elementSource(parsed(src), m.tid) : null;
  if (editElement(file, [{ kind: 'moveTo', tid: m.tid, target: m.target, where: m.where }]))
    useStore.setState({ selection: { kind: 'el', file, tid: follow(file, slice, m.tid) } });
}

/** A drag resize. */
export function stageResize(m: Extract<FromRuntime, { dc: 'resize' }>, file: string): void {
  editElement(file, [{ kind: 'styles', tid: m.tid, set: m.set }]);
}
