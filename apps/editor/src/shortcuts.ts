import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  flipSelection,
  orderSelection,
  paste,
  selectFirstChild,
  selectParent,
  ungroupSelection,
  wrapSelection,
} from './actions';
import { redo, togglePane, undo, useStore, type Tool } from './store';
import { fitAll, zoomAt, zoomToSelection } from './components/canvas/view';
import { addSlide, stepSlide } from './components/slides/slides';
import { presentStep, startPresent, stopPresent } from './components/slides/Present';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  t: 'text',
  a: 'frame',
  n: 'note',
  p: 'draw',
  r: 'rect',
  o: 'oval',
  l: 'line',
};

/** A motion piece's player keys (play, step), set by the motion editor while it is open. */
export const motionKeys: { handle: ((key: string, meta: boolean, shift: boolean) => boolean) | null } = { handle: null };

/** Keyboard shortcuts, shared by the editor window and the artboard frames (which forward their keys). */
export function handleKey(key: string, meta: boolean, shift: boolean, _alt = false): boolean {
  const s = useStore.getState();
  const k = key.toLowerCase();
  if (s.kind === 'slides' && slideKey(key, meta, shift)) return true;
  if (s.kind === 'motion') {
    if (motionKeys.handle?.(key, meta, shift)) return true;
    // canvas tools mean nothing on a scene
    if (!meta && !shift && TOOL_KEYS[k]) return true;
  }
  if (s.focused) {
    if (key === 'Escape') useStore.setState({ focused: null });
    return key === 'Escape';
  }
  if (meta) {
    if (k === 'z') shift ? redo() : undo();
    else if (k === 'y') redo();
    else if (k === 'c') copySelection();
    else if (k === 'x') cutSelection();
    else if (k === 'v') paste();
    else if (k === 'd') duplicateSelection();
    else if (k === 'g') shift ? ungroupSelection() : wrapSelection('group');
    else if (k === '=' || k === '+') zoomAt(1.25, s.viewport.w / 2, s.viewport.h / 2);
    else if (k === '-') zoomAt(0.8, s.viewport.w / 2, s.viewport.h / 2);
    else if (k === '0') useStore.setState({ view: { ...s.view, zoom: 1 } });
    else if (k === '\\') togglePane('inspector');
    else return false;
    return true;
  }
  if (key === 'Escape') {
    if (s.menu) useStore.setState({ menu: null });
    else if (s.mode === 'play') useStore.setState({ mode: 'edit' });
    else if (s.tool !== 'select') useStore.setState({ tool: 'select' });
    else useStore.setState({ selection: null, editingNote: null });
    return true;
  }
  if (key === 'Enter' && shift && s.mode === 'edit') {
    selectParent();
    return true;
  }
  if (key === 'Enter' && !shift && s.mode === 'edit') {
    selectFirstChild();
    return true;
  }
  if (s.mode === 'play') return false;
  if (key === 'Delete' || key === 'Backspace') deleteSelection();
  else if (key === ']') orderSelection('last');
  else if (key === '[') orderSelection('first');
  else if (shift && k === 'a') wrapSelection('flex');
  else if (shift && k === 'h') flipSelection('x');
  else if (shift && k === 'v') flipSelection('y');
  else if (shift && k === 'l') useStore.setState({ tool: 'arrow' });
  else if (shift && (k === '1' || k === '!')) fitAll();
  else if (shift && (k === '2' || k === '@')) zoomToSelection();
  else if (!shift && TOOL_KEYS[k]) useStore.setState({ tool: TOOL_KEYS[k] });
  else return false;
  return true;
}

/** Keys that mean something else in a deck: paging, presenting. */
function slideKey(key: string, meta: boolean, shift: boolean): boolean {
  const s = useStore.getState();
  if (s.present) {
    if (key === 'Escape') stopPresent();
    else if (/^(ArrowRight|ArrowDown|PageDown| |Enter)$/.test(key)) presentStep(1);
    else if (/^(ArrowLeft|ArrowUp|PageUp|Backspace)$/.test(key)) presentStep(-1);
    else if (key === 'f' || key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (key === 'n' || key === 'N') useStore.setState({ present: { ...s.present, notes: !s.present.notes } });
    return true;
  }
  if (key === 'F5' || (meta && key === 'Enter')) {
    startPresent(shift ? null : 0);
    return true;
  }
  if (meta && shift && (key === 'n' || key === 'N')) {
    addSlide();
    return true;
  }
  const onSlide = s.selection === null || s.selection.kind === 'board';
  if (!meta && onSlide && (key === 'PageDown' || key === 'ArrowDown' || key === 'ArrowRight')) {
    stepSlide(1);
    return true;
  }
  if (!meta && onSlide && (key === 'PageUp' || key === 'ArrowUp' || key === 'ArrowLeft')) {
    stepSlide(-1);
    return true;
  }
  // canvas tools and zoom keys do nothing in a deck
  if (!meta && !shift && TOOL_KEYS[key.toLowerCase()]) return true;
  return false;
}

const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');

/**
 * A click inside a sandboxed frame does not move focus out of the editor (the runtime prevents the
 * mousedown so nothing in the work reacts), so a panel field used just before keeps it and swallows
 * the keys meant for the new selection. Frames call this when they report a selection.
 */
export function leaveField(): void {
  const a = document.activeElement;
  if (typingIn(a)) (a as HTMLElement).blur();
}

export function installShortcuts(): () => void {
  // a ⌘V waiting for its paste event; browsers that send none for a page with no text field get the in-app paste anyway
  let waiting = 0;
  const onKey = (e: KeyboardEvent) => {
    if (typingIn(e.target)) return;
    // ⌘V in the editor window goes through the browser's paste event (onPaste), so
    // files and SVG on the system clipboard can reach the import first
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v' && !useStore.getState().present) {
      clearTimeout(waiting);
      waiting = window.setTimeout(() => handleKey('v', true, false), 150);
      return;
    }
    if (handleKey(e.key, e.metaKey || e.ctrlKey, e.shiftKey, e.altKey)) e.preventDefault();
  };
  const onPaste = (e: ClipboardEvent) => {
    clearTimeout(waiting);
    if (typingIn(e.target) || typingIn(document.activeElement)) return;
    const files = !!e.clipboardData?.files.length;
    // after every listener has run: whatever the import did not take is the in-app clipboard's
    setTimeout(() => {
      if (!e.defaultPrevented && !files) handleKey('v', true, false);
    });
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('paste', onPaste);
  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('paste', onPaste);
    clearTimeout(waiting);
  };
}
