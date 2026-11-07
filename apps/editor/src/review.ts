// A review: remarks written on a page's elements, then sent to Claude Code in one request (.design/review-remarks.md).
// The pane of that name is the mode: while it is open a click on the page leaves a remark instead of selecting.
import { useMemo } from 'react';
import { anchorOf, remarkTarget, remarksRequest, resolveRemark, type Remark, type RemarkItem, type ReviewPin } from '@dc/core';
import { writeRemarks } from './store/review';
import { canvasOf, display, parsed, useStore } from './store';
import { delegateToClaude } from './fastedit';
import { t } from './i18n';
import { offerUndo } from './undoRemove';

const get = useStore.getState;
const set = useStore.setState;

let tick = 0;
const focusOn = (id: string) => ({ id, tick: ++tick });

/** Keep the remarks (and the project's copy of them in this browser). */
function commit(remarks: Remark[], extra: Partial<ReturnType<typeof get>> = {}): void {
  set({ remarks, ...extra });
  const project = get().project;
  if (project) writeRemarks(project, remarks);
}

// entering a review leaves nothing selected (a click remarks, it does not select); leaving it drops the focus
useStore.subscribe((s, prev) => {
  if (s.pane === prev.pane) return;
  if (s.pane === 'review') set({ selection: null, inspect: null });
  else if (prev.pane === 'review') set({ remarkFocus: null });
});

const resolveIn = (file: string, r: Pick<Remark, 'tid' | 'anchor'>) => {
  const src = display(get(), file);
  const doc = src === undefined ? null : parsed(src);
  return { doc, ...resolveRemark(doc, r) };
};

/** A click on the page while reviewing: a new remark on that element, or back to the one it already has. */
export function clickRemark(file: string, tid: number | null): void {
  const s = get();
  const src = display(s, file);
  if (src === undefined) return;
  const doc = parsed(src);
  const target = remarkTarget(doc, tid);
  const hit = s.remarks.find((r) => r.file === file && (target === null ? r.tid === null : r.tid !== null && resolveRemark(doc, r).tid === target));
  if (hit) return set({ remarkFocus: focusOn(hit.id) });
  const remark: Remark = { id: Math.random().toString(36).slice(2, 10), file, tid: target, anchor: anchorOf(doc, target), text: '', at: Date.now() };
  commit([...s.remarks, remark], { remarkFocus: focusOn(remark.id) });
}

export function setRemarkText(id: string, text: string): void {
  commit(get().remarks.map((r) => (r.id === id ? { ...r, text } : r)));
}

export function focusRemark(id: string): void {
  set({ remarkFocus: focusOn(id) });
}

/** Take a remark away; the toast's Undo puts it back where it was. */
export function removeRemark(id: string): void {
  const list = get().remarks;
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return;
  const gone = list[i];
  commit(list.filter((r) => r.id !== id), { remarkFocus: null });
  offerUndo(t('review.removedName', { n: i + 1 }), () => commit([...get().remarks.slice(0, i), gone, ...get().remarks.slice(i)]));
}

export function clearRemarks(): void {
  const gone = get().remarks;
  if (!gone.length) return;
  commit([], { remarkFocus: null });
  offerUndo(t('review.clearedName', { count: gone.length }), () => commit([...gone, ...get().remarks]));
}

/** The remarks that have something written: the ones a send carries. */
export const sendable = (remarks: Remark[]): Remark[] => remarks.filter((r) => r.text.trim());

/** The artboard, slide or scene a file is, by the name the person knows. */
export function placeOf(file: string): string {
  const s = get();
  if (s.kind === 'design') return canvasOf(s).boards[file]?.title || file;
  return /^(?:slides|scenes)\/(.+)\.html$/.exec(file)?.[1] ?? file;
}

/** The same in the words Claude Code is told (never the editor's language). */
const whereOf = (file: string): string => (file.startsWith('slides/') ? `slide ${placeOf(file)}` : file.startsWith('scenes/') ? `scene ${placeOf(file)}` : placeOf(file));

/** Hand the remarks that have words to Claude Code as one request. They leave the page once it is on its way; when it cannot start they stay. */
export async function sendRemarks(): Promise<boolean> {
  const all = get().remarks;
  const sent = sendable(all);
  if (!sent.length) return false;
  const items: RemarkItem[] = sent.map((r) => {
    const { doc, tid, state } = resolveIn(r.file, r);
    // the element as it is now (its handle can change with its place); gone, what the remark kept of it
    const now = doc && tid !== null && state !== 'whole' ? anchorOf(doc, tid) : null;
    const anchor = state === 'whole' ? null : (now ?? r.anchor);
    return { n: all.indexOf(r) + 1, file: r.file, where: whereOf(r.file), anchor, state, snippet: anchor?.snippet ?? '', text: r.text };
  });
  const { prompt, context } = remarksRequest(items);
  if (!(await delegateToClaude(sent[0].file, null, prompt, [], { context }))) return false;
  const ids = new Set(sent.map((r) => r.id));
  commit(get().remarks.filter((r) => !ids.has(r.id)), { remarkFocus: null });
  return true;
}

/** Where a file's remarks hang on its page now, numbered by their place in the review. A remark whose element is gone has no pin. */
export function usePins(file: string): ReviewPin[] {
  const remarks = useStore((s) => s.remarks);
  const focus = useStore((s) => s.remarkFocus?.id);
  const source = useStore((s) => display(s, file));
  return useMemo(() => {
    const doc = source === undefined ? null : parsed(source);
    return remarks.flatMap((r, i) => {
      if (r.file !== file) return [];
      const { tid } = resolveRemark(doc, r);
      return tid === null ? [] : [{ tid, n: i + 1, ...(r.id === focus ? { focus: true } : {}) }];
    });
  }, [remarks, focus, source, file]);
}
