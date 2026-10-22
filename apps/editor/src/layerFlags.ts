import { HIDE_ATTR, LOCK_ATTR, attr } from '@dc/core';
import { canvasOf, display, editCanvas, editElement, parsed, toast, useStore, type Selection, type State } from './store';
import { t } from './i18n';

/**
 * Hide and lock, one place for what the layers tree, the keyboard and the
 * panels share. A layer is addressed by its tree row's key: `note:<id>` for a
 * canvas item, `<file>` for an artboard, `<file>#<tid>` for an element.
 */

export type Flag = 'hide' | 'lock';

/** The layer that holds a lock: the selection itself, or the nearest one around it. */
export type LockHolder = { kind: 'note'; id: string } | { kind: 'board'; file: string } | { kind: 'el'; file: string; tid: number };

export interface LockInfo {
  holder: LockHolder;
  /** the selection is the one that carries the lock (not something around it) */
  own: boolean;
}

export function keyOf(sel: Selection | LockHolder): string | null {
  if (!sel) return null;
  return sel.kind === 'el' ? `${sel.file}#${sel.tid}` : sel.kind === 'board' ? sel.file : `note:${sel.id}`;
}

export function selectionOf(key: string): Selection {
  if (key.startsWith('note:')) return { kind: 'note', id: key.slice(5) };
  const i = key.lastIndexOf('#');
  return i < 0 ? { kind: 'board', file: key } : { kind: 'el', file: key.slice(0, i), tid: Number(key.slice(i + 1)) };
}

/** Whether the selection is locked, by its own switch or by an artboard or element around it. */
export function lockOf(s: State, sel: Selection = s.selection): LockInfo | null {
  if (!sel) return null;
  const canvas = canvasOf(s);
  if (sel.kind === 'note') return canvas.notes[sel.id]?.locked ? { holder: sel, own: true } : null;
  if (sel.kind === 'board') return canvas.boards[sel.file]?.locked ? { holder: sel, own: true } : null;
  const src = display(s, sel.file);
  let el = src ? parsed(src).elements[sel.tid] : undefined;
  const start = el;
  while (el) {
    if (attr(el, LOCK_ATTR) !== undefined) return { holder: { kind: 'el', file: sel.file, tid: el.tid }, own: el === start };
    el = el.parent ?? undefined;
  }
  return canvas.boards[sel.file]?.locked ? { holder: { kind: 'board', file: sel.file }, own: false } : null;
}

/** `lockOf` as a string (own flag, then the holder's key), for a selector that must return the same value while nothing changed. */
export function lockSig(s: State): string {
  const info = lockOf(s);
  return info ? `${info.own ? 1 : 0}${keyOf(info.holder)}` : '';
}

/**
 * The guard for a command that would change the selection: true (and a
 * toast saying how to get past it) when the selection is locked.
 */
export function locked(): boolean {
  if (!lockOf(useStore.getState())) return false;
  toast(t('app.lock.blocked'));
  return true;
}

/** Switch several layers at once; one edit per file, so one undo step each. */
export function setFlags(entries: [key: string, on: boolean][], flag: Flag): void {
  const name = flag === 'hide' ? HIDE_ATTR : LOCK_ATTR;
  const prop = flag === 'hide' ? 'hidden' : 'locked';
  const byFile = new Map<string, [number, boolean][]>();
  const canvas: [string, boolean][] = [];
  for (const [key, on] of entries) {
    const sel = selectionOf(key);
    if (sel?.kind === 'el') byFile.set(sel.file, [...(byFile.get(sel.file) ?? []), [sel.tid, on]]);
    else canvas.push([key, on]);
  }
  for (const [file, list] of byFile) editElement(file, list.map(([tid, on]) => ({ kind: 'attr', tid, name, value: on ? '' : null })));
  if (!canvas.length) return;
  editCanvas((c) => {
    for (const [key, on] of canvas) {
      const sel = selectionOf(key);
      const entry = sel?.kind === 'note' ? c.notes[sel.id] : sel?.kind === 'board' ? c.boards[sel.file] : undefined;
      if (!entry) continue;
      if (on) entry[prop] = true;
      else delete entry[prop];
    }
  }, `${canvas.length === 1 ? canvas[0][0] : `${canvas.length} layers`} ${canvas.every(([, on]) => !on) ? (flag === 'hide' ? 'shown' : 'unlocked') : flag === 'hide' ? 'hidden' : 'locked'}`);
}

/** Take the lock off whatever holds it. */
export function unlock(holder: LockHolder): void {
  setFlags([[keyOf(holder)!, false]], 'lock');
}

/**
 * Alt-click on an eye: only this one stays shown among its siblings. Again
 * (it is already the only one) brings the siblings back.
 */
export function soloPlan(siblings: { key: string; hidden: boolean }[], self: string): [string, boolean][] {
  const others = siblings.filter((s) => s.key !== self);
  const alone = others.every((s) => s.hidden) && !siblings.find((s) => s.key === self)?.hidden;
  return [[self, false], ...others.map((s): [string, boolean] => [s.key, !alone])];
}

/** Whether every one of these layers has its own switch on (what the bar under a ticked set offers next). */
export function allFlagged(s: State, keys: string[], flag: Flag): boolean {
  const canvas = canvasOf(s);
  const name = flag === 'hide' ? HIDE_ATTR : LOCK_ATTR;
  const prop = flag === 'hide' ? 'hidden' : 'locked';
  return keys.length > 0 && keys.every((key) => {
    const sel = selectionOf(key);
    if (sel?.kind === 'note') return !!canvas.notes[sel.id]?.[prop];
    if (sel?.kind === 'board') return !!canvas.boards[sel.file]?.[prop];
    if (sel?.kind !== 'el') return false;
    const src = display(s, sel.file);
    const el = src ? parsed(src).elements[sel.tid] : undefined;
    return !!el && attr(el, name) !== undefined;
  });
}
