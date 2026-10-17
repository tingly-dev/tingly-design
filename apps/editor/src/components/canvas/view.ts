import { noteBox, type CanvasJson } from '@dc/core';
import { canvasOf, useStore, type State } from '../../store';

/** Where the canvas is looking: pan and zoom, fitting things in view, screen to canvas points. */

export function setView(v: Partial<State['view']>): void {
  useStore.setState((s) => ({ view: { ...s.view, ...v } }));
}

export function zoomAt(factor: number, sx: number, sy: number): void {
  const { view } = useStore.getState();
  const zoom = Math.min(4, Math.max(0.05, view.zoom * factor));
  const k = zoom / view.zoom;
  setView({ zoom, x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k });
}

export function fitTo(rect: { x: number; y: number; w: number; h: number }, pad = 64): void {
  const { viewport } = useStore.getState();
  const zoom = Math.min(2, Math.max(0.05, Math.min((viewport.w - pad * 2) / rect.w, (viewport.h - pad * 2) / rect.h)));
  setView({ zoom, x: (viewport.w - rect.w * zoom) / 2 - rect.x * zoom, y: (viewport.h - rect.h * zoom) / 2 - rect.y * zoom });
}

/** Is a board or note on the current page? Items without a page sit on the first page. */
export function onPage(c: CanvasJson, page: string | undefined, current: string): boolean {
  const first = c.pages[0]?.id ?? '';
  const p = page ?? first;
  return (current || first) === p || (!page && !current);
}

export function contentBounds(c: CanvasJson, page = useStore.getState().page): { x: number; y: number; w: number; h: number } | null {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  for (const b of Object.values(c.boards)) if (onPage(c, b.page, page)) rects.push({ x: b.x, y: b.y - 40, w: b.w, h: b.h + 40 });
  for (const n of Object.values(c.notes)) if (typeof n.x === 'number' && onPage(c, n.page, page)) rects.push(noteBox(n));
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

export function fitAll(): void {
  const b = contentBounds(canvasOf(useStore.getState()));
  if (b) fitTo(b);
}

export function focusBoard(file: string): void {
  const c = canvasOf(useStore.getState());
  const b = c.boards[file];
  if (!b) return;
  if (b.page && b.page !== useStore.getState().page) useStore.setState({ page: b.page });
  fitTo({ x: b.x, y: b.y - 40, w: b.w, h: b.h + 40 }, 80);
}

/** Zoom to whatever is selected (Shift+2). */
export function zoomToSelection(): void {
  const s = useStore.getState();
  const c = canvasOf(s);
  const sel = s.selection;
  if (sel?.kind === 'board' || sel?.kind === 'el') focusBoard(sel.file);
  else if (sel?.kind === 'note' && c.notes[sel.id]) {
    const b = noteBox(c.notes[sel.id]);
    fitTo({ x: b.x, y: b.y, w: Math.max(b.w, 200), h: Math.max(b.h, 120) }, 120);
  } else fitAll();
}

export function visibleBoards(): string[] {
  const s = useStore.getState();
  const c = canvasOf(s);
  const { view, viewport } = s;
  const x0 = -view.x / view.zoom;
  const y0 = -view.y / view.zoom;
  const x1 = x0 + viewport.w / view.zoom;
  const y1 = y0 + viewport.h / view.zoom;
  return c.order.filter((f) => {
    const b = c.boards[f];
    return b && onPage(c, b.page, s.page) && b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0;
  });
}

/** Screen point → canvas point. */
export function toCanvas(sx: number, sy: number): { x: number; y: number } {
  const { view } = useStore.getState();
  return { x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom };
}
