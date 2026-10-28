// The edit engine: every change to a file goes through `edit` (optimistic result, queue, save against the server's version, replay on a
// conflict), with the typed edits (elements, text, canvas) and undo / redo built on it. State lives in `store.ts`.
import { offerUndo, putFiles } from './undoRemove';
import {
  applyHumanOps,
  planRetype,
  RetypeError,
  setListItemField,
  setPropDefault,
  editsForFormat,
  keysForEdits,
  halfFrameMs,
  parseMotion,
  MOTION_FILE,
  sceneIdOf,
  rebaseSwap,
  parseCanvas,
  stringifyCanvas,
  CANVAS_FILE,
  DECK_FILE,
  slideFile,
  type Actor,
  type CanvasJson,
  type HumanOp,
} from '@dc/core';
import { api } from './api';
import { t } from './i18n';
import { canvasOf, display, editDeck, parsed, toast, useStore, type FileEntry, type Pending, type State } from './store';

// the store and this file import each other: nothing here may touch `useStore` while the modules load
const get = () => useStore.getState();
const set = (partial: Partial<State> | ((s: State) => Partial<State>)): void => useStore.setState(partial);

/** What a failed edit says to the person: a rebase conflict in the editor's own words, anything else as thrown. */
function errorText(e: unknown): string {
  if ((e as { code?: unknown } | null)?.code === 'rebase-conflict') return t('errors.rebaseConflict');
  return (e as Error).message;
}

let pendingId = 0;
const pumping = new Set<string>();

function patchEntry(file: string, fn: (e: FileEntry) => FileEntry): void {
  set((s) => ({ files: { ...s.files, [file]: fn(s.files[file] ?? { server: null, pending: [] }) } }));
}

interface EditOptions {
  actor: Actor;
  summary: string;
  prompt?: string;
  undoable?: boolean;
  /** a change spanning files (a PPTX appended to the deck): its undo removes exactly these slides */
  batch?: { ids: string[]; sources: Record<string, string> };
  /** a change spanning artboards (a fast reply that copied a part to another one): one undo steps back all of it */
  group?: number;
}

let groupSeq = 0;
/** A new undo group for edits that must be undone together. */
export const newUndoGroup = (): number => ++groupSeq;

/** Queue an edit already computed against `basis`. `apply` replays it on a newer file after a conflict. */
export function enqueueResult(
  file: string,
  basis: string,
  optimistic: string,
  apply: Pending['apply'],
  opts: EditOptions,
): boolean {
  if (optimistic === basis) return false;
  const item: Pending = { id: ++pendingId, basis, optimistic, apply, actor: opts.actor, summary: opts.summary, prompt: opts.prompt };
  patchEntry(file, (e) => ({ ...e, pending: [...e.pending, item] }));
  if (opts.undoable !== false) set((s) => ({ undo: capUndo([...s.undo, { file, before: basis, after: optimistic, ...(opts.batch ? { batch: opts.batch } : {}), ...(opts.group ? { group: opts.group } : {}) }]), redo: [] }));
  void pump(file);
  return true;
}

/** Queue a synchronous edit of a file's source. */
export function edit(file: string, apply: (src: string) => string, opts: EditOptions): boolean {
  const cur = display(get(), file) ?? '';
  let next: string;
  try {
    next = apply(cur);
  } catch (e) {
    toast(errorText(e), 'error');
    return false;
  }
  return enqueueResult(file, cur, next, apply, opts);
}

async function pump(file: string): Promise<void> {
  if (pumping.has(file)) return;
  pumping.add(file);
  try {
    for (;;) {
      const entry = get().files[file];
      const item = entry?.pending[0];
      const project = get().project;
      if (!item || !project) break;
      let attempts = 0;
      for (;;) {
        const server = get().files[file]?.server ?? null;
        const base = server?.content ?? '';
        let next: string;
        try {
          next = base === item.basis ? item.optimistic : await item.apply(base);
        } catch (e) {
          toast(t('app.save.editFailed', { file, error: errorText(e) }), 'error');
          dropFirst(file);
          break;
        }
        let r: Awaited<ReturnType<typeof api.put>>;
        try {
          r = await api.put(project, file, {
            content: next,
            baseVersion: server?.version ?? null,
            actor: item.actor,
            summary: item.summary,
            prompt: item.prompt,
          });
        } catch (e) {
          toast(t('app.save.failed', { file, error: (e as Error).message }), 'error');
          dropFirst(file);
          break;
        }
        if ('version' in r) {
          patchEntry(file, (e) => ({ server: { content: next, version: r.version }, pending: e.pending.slice(1) }));
          break;
        }
        // someone saved in between: take their version and replay this edit on it
        patchEntry(file, (e) => ({ ...e, server: r.conflict }));
        if (++attempts >= 3) {
          toast(t('app.save.keptChanging', { file }), 'error');
          dropFirst(file);
          break;
        }
      }
    }
  } finally {
    pumping.delete(file);
  }
}

function dropFirst(file: string): void {
  patchEntry(file, (e) => ({ ...e, pending: e.pending.slice(1) }));
}

export function isSaving(s: State): boolean {
  return Object.values(s.files).some((f) => f.pending.length > 0);
}

// ----------------------------------------------------------------- edits

let inert: Document | null = null;
export function inertDocument(): Document {
  inert ??= document.implementation.createHTMLDocument('');
  return inert;
}

export function editElement(file: string, ops: HumanOp[], actor: Actor = 'human'): boolean {
  const cur = display(get(), file);
  if (cur === undefined) return false;
  const view = get().motionView;
  if (view && sceneIdOf(file)) {
    // an edit to a property with a keyframe track is the key at the playhead, not the style (`.design/motion-editing.md` §3.4)
    const fps = parseMotion(display(get(), MOTION_FILE) ?? '').fps;
    ops = keysForEdits(ops, parsed(cur), view.landed ? 0 : view.at, halfFrameMs(fps));
    if (view.format !== view.primary) ops = editsForFormat(ops, parsed(cur), view.format);
  }
  let first: ReturnType<typeof applyHumanOps>;
  try {
    first = applyHumanOps(cur, ops, inertDocument());
  } catch (e) {
    toast(errorText(e), 'error');
    return false;
  }
  if (!first.changed) return false;
  return enqueueResult(file, cur, first.source, (src) => applyHumanOps(src, ops, inertDocument()).source, {
    actor,
    summary: first.summary,
  });
}

/**
 * Text with holes in it, retyped on the artboard (`Hello {{name}}!`): the edit
 * lands in the template's literal text or in the tweak the hole shows, and the
 * hole stays. Says why when it cannot (`.design/template-text-editing.md`).
 */
export function retypeText(file: string, tid: number, from: string, to: string, item: number | null): boolean {
  const apply = (src: string) => {
    const doc = parsed(src);
    const el = doc.elements.find((e) => e.tid === tid);
    if (!el) throw new Error(`element ${tid} is no longer in the design`);
    const plan = planRetype(doc, el, from, to, item);
    let out = plan.template === null ? src : applyHumanOps(src, [{ kind: 'text', tid, text: plan.template }], inertDocument()).source;
    for (const s of plan.sets) out = ('index' in s ? setListItemField(out, s.prop, s.index, s.key, s.value) : setPropDefault(out, s.prop, s.value)).source;
    return out;
  };
  const cur = display(get(), file);
  if (cur === undefined) return false;
  try {
    apply(cur);
  } catch (e) {
    if (e instanceof RetypeError) {
      toast(t(`canvas.text.noedit.${e.code}`), 'error');
      return false;
    }
    toast(errorText(e), 'error');
    return false;
  }
  return edit(file, apply, { actor: 'human', summary: `text → ${JSON.stringify(to.length > 40 ? to.slice(0, 39) + '…' : to)}` });
}

export function editCanvas(mutate: (c: CanvasJson) => void, summary: string, undoable = true): boolean {
  return edit(
    CANVAS_FILE,
    (src) => {
      const c = structuredClone(parseCanvas(src));
      mutate(c);
      return stringifyCanvas(c);
    },
    { actor: 'human', summary, undoable },
  );
}

/** The last 100 changes; a group cut by the limit goes whole, so no undo brings back half of a reply. */
function capUndo<T extends { group?: number }>(list: T[]): T[] {
  if (list.length <= 100) return list;
  const cut = list.length - 100;
  const group = list[cut - 1].group;
  let from = cut;
  while (group !== undefined && from < list.length && list[from].group === group) from++;
  return list.slice(from);
}

/** The last undo step: one item, or every item of the group the last one belongs to. */
function lastStep<T extends { group?: number }>(list: T[]): T[] {
  const last = list.at(-1);
  if (!last) return [];
  if (last.group === undefined) return [last];
  let i = list.length;
  while (i > 0 && list[i - 1].group === last.group) i--;
  return list.slice(i);
}

export function undo(): void {
  const items = lastStep(get().undo);
  if (!items.length) return;
  set((s) => ({ undo: s.undo.slice(0, -items.length), redo: [...s.redo, ...items] }));
  for (const item of items.toReversed()) {
    if (item.batch) batchRemove(item.batch);
    else edit(item.file, (src) => rebaseSwap(src, item.after, item.before), { actor: 'undo', summary: 'undo', undoable: false });
  }
}

export function redo(): void {
  const items = lastStep(get().redo);
  if (!items.length) return;
  set((s) => ({ redo: s.redo.slice(0, -items.length), undo: [...s.undo, ...items] }));
  for (const item of items.toReversed()) {
    if (item.batch) batchRestore(item.batch);
    else edit(item.file, (src) => rebaseSwap(src, item.before, item.after), { actor: 'undo', summary: 'redo', undoable: false });
  }
}

/** True while the last step of undo is this group's, so undoing it is undoing exactly that action. */
export function isLastGroup(group: number): boolean {
  return get().undo.at(-1)?.group === group;
}

/** Forget a group's steps (its action was taken back another way). */
export function dropGroup(group: number): void {
  set((s) => ({ undo: s.undo.filter((u) => u.group !== group), redo: s.redo.filter((u) => u.group !== group) }));
}

/** Undo of a whole appended batch: the deck drops exactly these ids (a targeted edit, so later
 * slides anyone else added stay), and the batch's files go away once their queued edits saved. */
function batchRemove(batch: { ids: string[]; sources: Record<string, string> }): void {
  void (async () => {
    try {
      for (const id of batch.ids) await removeFileNow(id);
    } catch {
      return toast(t('app.save.deleteConflict', { file: slideFile(batch.ids[0]) }), 'error');
    }
    editDeck((d) => {
      d.order = d.order.filter((id) => !batch.ids.includes(id));
    }, t('slides.append.undone'), false);
  })();
}

/** Redo of a batch: the slides rejoin the end of the deck and their files are written back. */
function batchRestore(batch: { ids: string[]; sources: Record<string, string> }): void {
  editDeck((d) => {
    d.order = [...d.order, ...batch.ids.filter((id) => !d.order.includes(id))];
  }, t('slides.append.redone'), false);
  void (async () => {
    const project = get().project;
    if (!project) return;
    await savedUpTo(DECK_FILE);
    for (const id of batch.ids) {
      await api.put(project, slideFile(id), { content: batch.sources[id], baseVersion: null, actor: 'undo', summary: 'redo' });
    }
  })();
}

/** Delete a slide's file once its queued edits saved; throws when someone saved it in between. */
export async function removeFileNow(id: string): Promise<void> {
  const project = get().project, file = slideFile(id);
  await savedUpTo(file);
  const version = get().files[file]?.server?.version;
  if (project && version) {
    const r = await api.remove(project, file, version);
    if ('conflict' in r) throw new Error('conflict');
  }
  set((s) => {
    const files = { ...s.files };
    delete files[file];
    return { files };
  });
}

/** Delete a file once its queued edits are saved (a deck's slides, an artboard). */
/** Wait (up to five seconds) for the queued edits of a file to be saved, so a delete goes against its newest version. */
export async function savedUpTo(file: string): Promise<void> {
  for (let i = 0; i < 50 && (get().files[file]?.pending.length ?? 0) > 0; i++) await new Promise((r) => setTimeout(r, 100));
}

/** True when the file is gone (or was never saved); false when it stayed because someone saved it in between. */
export async function deleteFile(file: string): Promise<boolean> {
  const project = get().project;
  if (!project) return false;
  await savedUpTo(file);
  const v = get().files[file]?.server?.version;
  if (v) {
    const r = await api.remove(project, file, v);
    if ('conflict' in r) {
      toast(t('app.save.deleteConflict', { file }), 'error');
      return false;
    }
  }
  set((s) => {
    const files = { ...s.files };
    delete files[file];
    return { files };
  });
  return true;
}

export async function deleteBoard(file: string, offerBack = true): Promise<void> {
  const project = get().project;
  if (!project) return;
  const c0 = canvasOf(get());
  const entry = c0.boards[file] && structuredClone(c0.boards[file]);
  const at = c0.order.indexOf(file);
  const source = display(get(), file);
  editCanvas((c) => {
    delete c.boards[file];
    c.order = c.order.filter((f) => f !== file);
  }, `artboard ${file} removed`, false);
  set({ selection: null });
  // wait for any queued edits of the file itself, then delete it
  if (!(await deleteFile(file))) {
    // the file stayed (someone saved it meanwhile): the artboard goes back on the canvas rather than being left unlisted
    if (entry)
      editCanvas((c) => {
        c.boards[file] = entry;
        if (!c.order.includes(file)) c.order.splice(at < 0 ? c.order.length : Math.min(at, c.order.length), 0, file);
      }, `artboard ${file} kept`, false);
    return;
  }
  if (!entry || source === undefined || !offerBack) return;
  offerUndo(entry.title || file.replace(/\.dc\.html$/, ''), async () => {
    await putFiles({ [file]: source });
    editCanvas((c) => {
      c.boards[file] = entry;
      if (!c.order.includes(file)) c.order.splice(at < 0 ? c.order.length : Math.min(at, c.order.length), 0, file);
    }, `artboard ${file} restored`, false);
  });
}
