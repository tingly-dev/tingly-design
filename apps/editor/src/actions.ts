import {
  elementSource,
  getStyle,
  isShape,
  newBoardSource,
  noteBox,
  nextBoardPosition,
  rootElement,
  uniqueBoardName,
  uniqueNoteId,
  attr,
  type BoardEntry,
  type DcElement,
  type HumanOp,
  type NoteEntry,
  type Where,
} from '@dc/core';
import {
  canvasOf,
  deleteBoard,
  display,
  edit,
  editCanvas,
  editElement,
  focusBoard,
  getClip,
  parsed,
  setClip,
  slideIds,
  toCanvas,
  toast,
  useStore,
} from './store';
import { deleteSlide, duplicateSlide, moveSlide } from './slides';
import { slideIdOf } from '@dc/core';
import { currentLanguage, t } from './i18n';
import type { NoteTarget } from './noteTarget';

/**
 * Commands on the current selection, shared by the context menu, the
 * keyboard and the panels. Element commands become ops on the artboard's
 * source; canvas items and artboards are edits of canvas.json.
 */

const get = useStore.getState;
const set = useStore.setState;

export function selectedElement(): { file: string; tid: number; el: DcElement } | null {
  const s = get();
  if (s.selection?.kind !== 'el') return null;
  const src = display(s, s.selection.file);
  const el = src ? parsed(src).elements[s.selection.tid] : undefined;
  return el ? { file: s.selection.file, tid: s.selection.tid, el } : null;
}

function samePath(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Insert markup and return the new element's tid: located by its path,
 * which is stable for everything before it in the file.
 */
export function insertHtml(file: string, target: number, where: Where, html: string): number | null {
  const src = display(get(), file);
  if (!src) return null;
  const before = parsed(src);
  const t = before.elements[target];
  if (!t) return null;
  const kids = t.children.filter((c) => c.kind === 'el').length;
  const path =
    where === 'after'
      ? [...t.path.slice(0, -1), (t.path.at(-1) ?? 0) + 1]
      : where === 'before'
        ? t.path
        : where === 'first'
          ? [...t.path, 0]
          : [...t.path, kids];
  if (!editElement(file, [{ kind: 'insert', target, where, html }])) return null;
  const after = parsed(display(get(), file) ?? '');
  return after.elements.find((e) => samePath(e.path, path))?.tid ?? null;
}

function elementOp(op: (tid: number) => HumanOp, keepSelection = true): boolean {
  const s = selectedElement();
  if (!s) return false;
  const ok = editElement(s.file, [op(s.tid)]);
  if (ok && !keepSelection) set({ selection: { kind: 'board', file: s.file } });
  return ok;
}

// ---------------------------------------------------------------- clipboard

export function copySelection(): void {
  const s = get();
  const sel = s.selection;
  if (sel?.kind === 'el') {
    const src = display(s, sel.file);
    const html = src ? elementSource(parsed(src), sel.tid) : null;
    if (html) setClip({ kind: 'el', html });
  } else if (sel?.kind === 'note') {
    const n = canvasOf(s).notes[sel.id];
    if (n) setClip({ kind: 'items', items: [structuredClone(n)] });
  }
}

export function cutSelection(): void {
  copySelection();
  deleteSelection(false);
}

export function paste(): void {
  const clip = getClip();
  const s = get();
  const sel = s.selection;
  if (!clip) return toast(t('app.clipboard.empty'));
  if (clip.kind === 'el') {
    if (sel?.kind === 'el') {
      const tid = insertHtml(sel.file, sel.tid, 'after', clip.html);
      if (tid !== null) set({ selection: { kind: 'el', file: sel.file, tid } });
    } else if (sel?.kind === 'board') {
      const root = rootElement(parsed(display(s, sel.file) ?? ''));
      if (!root) return;
      const tid = insertHtml(sel.file, root.tid, 'last', clip.html);
      if (tid !== null) set({ selection: { kind: 'el', file: sel.file, tid } });
    } else toast(t('app.clipboard.selectFirst'));
    return;
  }
  let first = '';
  editCanvas((c) => {
    for (const item of clip.items) {
      const id = uniqueNoteId(c);
      first ||= id;
      const n: NoteEntry = { ...structuredClone(item), x: item.x + 24, y: item.y + 24, page: s.page || undefined };
      if (n.x2 !== undefined) n.x2 += 24;
      if (n.y2 !== undefined) n.y2 += 24;
      c.notes[id] = n;
    }
  }, 'pasted canvas items');
  if (first) set({ selection: { kind: 'note', id: first } });
}

// ---------------------------------------------------------------- structure

export function duplicateSelection(): void {
  const s = get();
  const sel = s.selection;
  if (sel?.kind === 'el') return void elementOp((tid) => ({ kind: 'duplicate', tid }));
  if (sel?.kind === 'note') {
    copySelection();
    return paste();
  }
  if (sel?.kind === 'board' && s.kind === 'motion') return toast(t('app.scene.notInEditor'));
  if (sel?.kind === 'board') {
    const slide = slideIdOf(sel.file);
    if (s.kind === 'slides' && slide) duplicateSlide(slide);
    else duplicateBoard(sel.file);
  }
}

export function deleteSelection(confirmBoards = true): void {
  const s = get();
  const sel = s.selection;
  if (sel?.kind === 'el') {
    const src = display(s, sel.file);
    const el = src ? parsed(src).elements[sel.tid] : undefined;
    if (el && !el.parent && el.tag !== 'helmet') return toast(t('app.board.rootDelete'));
    elementOp((tid) => ({ kind: 'remove', tid }), false);
  } else if (sel?.kind === 'note') {
    editCanvas((c) => void delete c.notes[sel.id], `note ${sel.id} deleted`);
    set({ selection: null });
  } else if (sel?.kind === 'board' && s.kind === 'motion') {
    toast(t('app.scene.notInEditor'));
  } else if (sel?.kind === 'board') {
    const slide = slideIdOf(sel.file);
    if (s.kind === 'slides' && slide) {
      if (!confirmBoards || confirm(t('app.confirm.deleteSlide', { slide }))) void deleteSlide(slide);
    } else if (!confirmBoards || confirm(t('app.confirm.deleteBoard', { file: sel.file }))) void deleteBoard(sel.file);
  }
}

export function orderSelection(to: 'first' | 'last'): void {
  const s = get();
  const sel = s.selection;
  if (sel?.kind === 'el') return void elementOp((tid) => ({ kind: 'order', tid, to }));
  if (sel?.kind === 'note') {
    // canvas items paint in key order: re-insert the key at the start or end
    editCanvas((c) => {
      const n = c.notes[sel.id];
      if (!n) return;
      const rest = Object.entries(c.notes).filter(([k]) => k !== sel.id);
      c.notes = Object.fromEntries(to === 'last' ? [...rest, [sel.id, n]] : [[sel.id, n], ...rest]);
    }, `note ${sel.id} moved to the ${to === 'last' ? 'front' : 'back'}`);
  } else if (sel?.kind === 'board' && s.kind === 'motion') {
    return;
  } else if (sel?.kind === 'board' && s.kind === 'slides') {
    const slide = slideIdOf(sel.file);
    if (slide) moveSlide(slide, to === 'first' ? (slideIds(s)[0] ?? null) : null);
  } else if (sel?.kind === 'board') {
    editCanvas((c) => {
      c.order = c.order.filter((f) => f !== sel.file);
      if (to === 'last') c.order.push(sel.file);
      else c.order.unshift(sel.file);
    }, `artboard ${sel.file} reordered`);
  }
}

export const WRAP_STYLES = {
  group: '',
  flex: 'display:flex;gap:8px;align-items:center',
  grid: 'display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:8px',
} as const;

export function wrapSelection(kind: keyof typeof WRAP_STYLES): void {
  const s = selectedElement();
  if (!s) return;
  if (!s.el.parent) return toast(t('app.board.rootWrap'));
  if (!editElement(s.file, [{ kind: 'wrap', tid: s.tid, style: WRAP_STYLES[kind] }])) return;
  // the new wrapper takes the element's old place, and so its tid
  set({ selection: { kind: 'el', file: s.file, tid: s.tid } });
}

export function ungroupSelection(): void {
  const s = selectedElement();
  if (!s) return;
  if (!s.el.parent) return toast(t('app.board.rootUnwrap'));
  if (!s.el.children.some((c) => c.kind === 'el')) return toast(t('app.board.noChildren'));
  if (editElement(s.file, [{ kind: 'unwrap', tid: s.tid }])) set({ selection: { kind: 'el', file: s.file, tid: s.tid } });
}

export function flipSelection(axis: 'x' | 'y'): void {
  const s = get();
  const sel = s.selection;
  if (sel?.kind === 'note') {
    const key = axis === 'x' ? 'flipX' : 'flipY';
    editCanvas((c) => {
      const n = c.notes[sel.id];
      if (!n) return;
      if (n.kind === 'line' || n.kind === 'arrow') {
        if (axis === 'x') [n.x, n.x2] = [n.x2 ?? n.x, n.x];
        else [n.y, n.y2] = [n.y2 ?? n.y, n.y];
      } else if (n[key]) delete n[key];
      else n[key] = true;
    }, `note ${sel.id} flipped`);
    return;
  }
  const e = selectedElement();
  if (!e) return;
  const cur = getStyle(attr(e.el, 'style') ?? '', 'transform') ?? '';
  const fn = axis === 'x' ? 'scaleX(-1)' : 'scaleY(-1)';
  const next = cur.includes(fn) ? cur.replace(fn, '').trim() : `${cur} ${fn}`.trim();
  editElement(e.file, [{ kind: 'style', tid: e.tid, prop: 'transform', value: next || null }]);
}

/** Enter: down one level — artboard → its root's first child, element → first child. */
export function selectFirstChild(): void {
  const s = get();
  const sel = s.selection;
  const file = sel?.kind === 'el' || sel?.kind === 'board' ? sel.file : null;
  if (!file) return;
  const doc = parsed(display(s, file) ?? '');
  let el = sel?.kind === 'el' ? doc.elements[sel.tid] : rootElement(doc);
  if (!el) return;
  if (sel?.kind === 'board') return set({ selection: { kind: 'el', file, tid: el.tid } });
  let kid = el.children.find((c) => c.kind === 'el') as DcElement | undefined;
  while (kid && (kid.tag.startsWith('sc-') || kid.tag === 'helmet')) {
    el = kid;
    kid = (kid.children.find((c) => c.kind === 'el') as DcElement | undefined) ?? undefined;
    if (kid?.tag === 'helmet') kid = el.children.filter((c) => c.kind === 'el')[1] as DcElement | undefined;
  }
  if (kid) set({ selection: { kind: 'el', file, tid: kid.tid } });
}

/** Shift+Enter: up one level — element → parent → artboard → nothing. */
export function selectParent(): void {
  const s = get();
  const sel = s.selection;
  if (sel?.kind === 'el') {
    const src = display(s, sel.file);
    let p = src ? parsed(src).elements[sel.tid]?.parent : null;
    while (p && (p.tag.startsWith('sc-') || p.tag === 'x-import')) p = p.parent;
    set({ selection: p ? { kind: 'el', file: sel.file, tid: p.tid } : { kind: 'board', file: sel.file } });
  } else set({ selection: null });
}

// ---------------------------------------------------------------- artboards

export function addBoard(rect?: { x: number; y: number; w: number; h: number }, title = t('app.board.newTitle')): string {
  const c = canvasOf(get());
  const file = uniqueBoardName(c, 'Board');
  const w = Math.round(rect?.w ?? 1200);
  const h = Math.round(rect?.h ?? 760);
  const pos = rect ? { x: Math.round(rect.x), y: Math.round(rect.y) } : nextBoardPosition(c, w);
  const page = get().page || undefined;
  edit(file, () => newBoardSource({ title, w, h, lang: currentLanguage(), hint: t('starter.canvasHint') }), { actor: 'human', summary: 'artboard created', undoable: false });
  editCanvas((cc) => {
    cc.boards[file] = { ...pos, w, h, title, ...(page ? { page } : {}) };
    cc.order.push(file);
  }, `artboard ${file} added`);
  set({ selection: { kind: 'board', file } });
  return file;
}

export function duplicateBoard(file: string): void {
  const s = get();
  const c = canvasOf(s);
  const b = c.boards[file];
  const src = display(s, file);
  if (!b || src === undefined) return;
  const stem = file.replace(/\.dc\.html$/, '').replace(/[^A-Za-z0-9_-]/g, '');
  const copy = uniqueBoardName(c, stem + 'Copy');
  edit(copy, () => src, { actor: 'human', summary: `artboard duplicated from ${file}`, undoable: false });
  editCanvas((cc) => {
    const nb: BoardEntry = { ...structuredClone(b), x: b.x + b.w + 80, title: t('app.board.copyTitle', { title: b.title ?? file }) };
    cc.boards[copy] = nb;
    cc.order.splice(cc.order.indexOf(file) + 1, 0, copy);
  }, `artboard ${copy} added`);
  set({ selection: { kind: 'board', file: copy } });
  setTimeout(() => focusBoard(copy), 30);
}

export function addNote(note: NoteEntry): string {
  let id = '';
  const page = get().page || undefined;
  editCanvas((c) => {
    id = uniqueNoteId(c, isShape(note) ? 's' : 'n');
    c.notes[id] = { ...note, ...(page ? { page } : {}) };
  }, `${note.kind ?? 'note'} added`);
  set({ selection: { kind: 'note', id }, tool: 'select' });
  return id;
}

/** "Keep as note" on a canvas: a new sticky note to the right of what is selected, else at the middle of the view. */
export const canvasNoteTarget: NoteTarget = {
  keep: (text) => {
    const s = get();
    const c = canvasOf(s);
    const sel = s.selection;
    let at: { x: number; y: number } | null = null;
    if (sel && (sel.kind === 'board' || sel.kind === 'el') && c.boards[sel.file]) {
      const b = c.boards[sel.file];
      at = { x: b.x + b.w + 40, y: b.y };
    } else if (sel?.kind === 'note' && c.notes[sel.id]) {
      const b = noteBox(c.notes[sel.id]);
      at = { x: b.x + b.w + 40, y: b.y };
    }
    const where = at ? t('prompt.run.keptCanvasNext') : t('prompt.run.keptCanvas');
    if (!at) {
      const mid = toCanvas(s.viewport.w / 2, s.viewport.h / 2);
      at = { x: mid.x - 120, y: mid.y - 60 };
    }
    addNote({ x: Math.round(at.x), y: Math.round(at.y), w: 240, text: text.trim() });
    return where;
  },
};

export function updateNote(id: string, patch: Partial<NoteEntry> | ((n: NoteEntry) => void), what = 'changed'): void {
  editCanvas((c) => {
    const n = c.notes[id];
    if (!n) return;
    if (typeof patch === 'function') patch(n);
    else
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === '') delete (n as Record<string, unknown>)[k];
        else (n as Record<string, unknown>)[k] = v;
      }
  }, `${id} ${what}`);
}

export function updateBoard(file: string, patch: Partial<BoardEntry>, what = 'changed'): void {
  editCanvas((c) => {
    const b = c.boards[file];
    if (!b) return;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '' || v === false) delete (b as Record<string, unknown>)[k];
      else (b as Record<string, unknown>)[k] = v;
    }
  }, `artboard ${file} ${what}`);
}

// ---------------------------------------------------------------- pages

export function addPage(): void {
  let id = '';
  editCanvas((c) => {
    if (!c.pages.length) c.pages.push({ id: 'p1', name: t('app.page.name', { n: 1 }) });
    let i = c.pages.length + 1;
    while (c.pages.some((p) => p.id === 'p' + i)) i++;
    id = 'p' + i;
    c.pages.push({ id, name: t('app.page.name', { n: c.pages.length + 1 }) });
    // items that had no page lived on the first page; pin them there
    const first = c.pages[0].id;
    for (const b of Object.values(c.boards)) b.page ??= first;
    for (const n of Object.values(c.notes)) n.page ??= first;
  }, 'page added');
  set({ page: id, selection: null });
}

export function renamePage(id: string, name: string): void {
  editCanvas((c) => {
    const p = c.pages.find((x) => x.id === id);
    if (p && name.trim()) p.name = name.trim().slice(0, 80);
  }, `page ${id} renamed`);
}
