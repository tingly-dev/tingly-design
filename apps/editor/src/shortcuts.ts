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
import { fitAll, goToSlide, redo, slidesOf, undo, useStore, zoomAt, zoomToSelection, type Tool } from './store';
import { presenterKey, startPresenting } from './components/slides/Presenter';

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

/** Keyboard shortcuts, shared by the editor window and the artboard frames (which forward their keys). */
export function handleKey(key: string, meta: boolean, shift: boolean, _alt = false): boolean {
  const s = useStore.getState();
  const k = key.toLowerCase();
  if (s.kind === 'slides') return deckKey(key, meta, shift);
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
    else if (k === '\\') useStore.setState({ panelOpen: !s.panelOpen });
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

/** Keys in a deck: no canvas tools; zoom is the stage's; arrows page through slides. */
function deckKey(key: string, meta: boolean, shift: boolean): boolean {
  const s = useStore.getState();
  const k = key.toLowerCase();
  if (s.presenting) return presenterKey(key);
  const stage = (z: number | null) => useStore.setState({ stageZoom: z === null ? null : Math.min(2, Math.max(0.1, z)) });
  if (meta) {
    if (k === 'z') shift ? redo() : undo();
    else if (k === 'y') redo();
    else if (k === 'c') copySelection();
    else if (k === 'x') cutSelection();
    else if (k === 'v') paste();
    else if (k === 'd') duplicateSelection();
    else if (k === 'g') shift ? ungroupSelection() : wrapSelection('group');
    else if (k === '=' || k === '+') stage((s.stageZoom ?? s.stageFit) * 1.25);
    else if (k === '-') stage((s.stageZoom ?? s.stageFit) * 0.8);
    else if (k === '0') stage(1);
    else if (k === '\\') useStore.setState({ panelOpen: !s.panelOpen });
    else if (k === 'enter') startPresenting(s.slide);
    else return false;
    return true;
  }
  if (key === 'Escape') {
    if (s.menu) useStore.setState({ menu: null });
    else if (s.tool !== 'select') useStore.setState({ tool: 'select' });
    else if (s.selection?.kind === 'el') useStore.setState({ selection: { kind: 'board', file: s.selection.file } });
    else useStore.setState({ selection: null });
    return true;
  }
  if (key === 'Enter' && shift) return selectParent(), true;
  if (key === 'Enter') return selectFirstChild(), true;
  // with no element selected, the arrows and page keys move between slides
  if (s.selection?.kind !== 'el' && /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown)$/.test(key)) {
    const ids = slidesOf(s);
    const i = s.slide ? ids.indexOf(s.slide) : -1;
    const next = /Down|Right/.test(key) ? ids[i + 1] : ids[i - 1];
    if (next) goToSlide(next);
    return true;
  }
  if (key === 'Delete' || key === 'Backspace') deleteSelection();
  else if (key === ']') orderSelection('last');
  else if (key === '[') orderSelection('first');
  else if (shift && k === 'a') wrapSelection('flex');
  else if (shift && k === 'h') flipSelection('x');
  else if (shift && k === 'v') flipSelection('y');
  else if (shift && (k === '1' || k === '!')) stage(null);
  else if (!shift && k === 'v') useStore.setState({ tool: 'select' });
  else if (!shift && k === 't') useStore.setState({ tool: 'text' });
  else return false;
  return true;
}

export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    if (handleKey(e.key, e.metaKey || e.ctrlKey, e.shiftKey, e.altKey)) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
