import { deleteBoard, editCanvas, editElement, fitAll, redo, undo, useStore, zoomAt } from './store';

/** Keyboard shortcuts, shared by the editor window and the artboard frames (which forward their keys). */
export function handleKey(key: string, meta: boolean, shift: boolean, _alt = false): boolean {
  const s = useStore.getState();
  const sel = s.selection;
  const k = key.toLowerCase();
  if (meta && k === 'z') {
    if (shift) redo();
    else undo();
    return true;
  }
  if (meta && k === 'y') {
    redo();
    return true;
  }
  if (meta && k === 'd' && sel?.kind === 'el') {
    editElement(sel.file, [{ kind: 'duplicate', tid: sel.tid }]);
    return true;
  }
  if (meta && (k === '=' || k === '+')) {
    zoomAt(1.25, s.viewport.w / 2, s.viewport.h / 2);
    return true;
  }
  if (meta && k === '-') {
    zoomAt(0.8, s.viewport.w / 2, s.viewport.h / 2);
    return true;
  }
  if (meta) return false;
  if (key === 'Escape') {
    if (s.mode === 'play') useStore.setState({ mode: 'edit' });
    else useStore.setState({ selection: null });
    return true;
  }
  if (s.mode === 'play') return false;
  if (key === 'Delete' || key === 'Backspace') {
    if (sel?.kind === 'el') {
      editElement(sel.file, [{ kind: 'remove', tid: sel.tid }]);
      useStore.setState({ selection: { kind: 'board', file: sel.file } });
    } else if (sel?.kind === 'note') {
      editCanvas((c) => void delete c.notes[sel.id], `note ${sel.id} deleted`);
      useStore.setState({ selection: null });
    } else if (sel?.kind === 'board') {
      if (confirm(`删除画板 ${sel.file}？文件也会被删除（可以用 git 找回）。`)) void deleteBoard(sel.file);
    }
    return true;
  }
  if (k === 'v') useStore.setState({ tool: 'select' });
  else if (k === 'h') useStore.setState({ tool: 'hand' });
  else if (k === 'p') useStore.setState({ mode: 'play', selection: null });
  else if (k === '0' || (shift && k === '!')) fitAll();
  else return false;
  return true;
}

export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (handleKey(e.key, e.metaKey || e.ctrlKey, e.shiftKey, e.altKey)) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
