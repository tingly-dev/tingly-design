/**
 * Resizing an element from its overlay handles, with snapping: a moving edge
 * snaps to the edges and centre lines of everything else, Shift keeps the
 * ratio, Alt grows from the centre. The pointer listeners live in input.ts.
 */
import { post } from './post';
import { current, mount } from './stage';
import { docFor } from './template';
import { instances } from './overlay';
import { draggable, suppressNextClick } from './drag';
import type { Handle } from './overlay';

interface Resize {
  tid: number;
  el: HTMLElement;
  at: Handle;
  start: { x: number; y: number };
  rect: DOMRect;
  /** border + padding, when the element's width is its content box */
  extra: { w: number; h: number };
  abs: boolean;
  left: number;
  top: number;
  saved: { width: string; height: string; left: string; top: string; transition: string };
  active: boolean;
  w: number;
  h: number;
  guides: { axis: 'x' | 'y'; at: number }[];
}
export let resize: Resize | null = null;

export const CURSORS: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

/** Elements with a size of their own: not the board or slide itself, not repeated, not drawn by a component. */
export function resizable(tid: number | null): boolean {
  if (tid === null || !draggable(tid)) return false;
  const el = docFor(current.source).elements[tid];
  return !!el && !/^(sc-|dc-import$|helmet$|x-import$|br$|tr$|td$|th$|li$|option$)/.test(el.tag);
}

export function startResize(tid: number, at: Handle, e: PointerEvent) {
  const el = instances(tid)[0] as HTMLElement | undefined;
  if (!el) return;
  const cs = getComputedStyle(el);
  const content = cs.boxSizing === 'content-box';
  const sum = (...ps: string[]) => ps.reduce((n, p) => n + (parseFloat(cs.getPropertyValue(p)) || 0), 0);
  const r = el.getBoundingClientRect();
  resize = {
    tid,
    el,
    at,
    start: { x: e.clientX, y: e.clientY },
    rect: r,
    extra: content
      ? { w: sum('padding-left', 'padding-right', 'border-left-width', 'border-right-width'), h: sum('padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width') }
      : { w: 0, h: 0 },
    abs: cs.position === 'absolute',
    left: parseFloat(cs.left) || 0,
    top: parseFloat(cs.top) || 0,
    saved: { width: el.style.width, height: el.style.height, left: el.style.left, top: el.style.top, transition: el.style.transition },
    active: false,
    w: Math.round(r.width),
    h: Math.round(r.height),
    guides: [],
  };
}

/** Edges and centre lines of everything else on the page, to snap a moving edge to. */
function snapLines(self: Element): { x: number[]; y: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const o of Array.from(mount.querySelectorAll('[data-dc-tid]'))) {
    if (o === self || self.contains(o) || o.hasAttribute('data-dc-off')) continue;
    const r = o.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    xs.push(r.left, r.right, r.left + r.width / 2);
    ys.push(r.top, r.bottom, r.top + r.height / 2);
  }
  return { x: xs, y: ys };
}

export function moveResize(e: PointerEvent) {
  const d = resize;
  if (!d) return;
  let dx = e.clientX - d.start.x;
  let dy = e.clientY - d.start.y;
  if (!d.active && Math.hypot(dx, dy) < 2) return;
  d.active = true;
  d.guides = [];
  const east = d.at.includes('e');
  const west = d.at.includes('w');
  const south = d.at.includes('s');
  const north = d.at.includes('n');
  const k = e.altKey ? 2 : 1;
  // snap the moving edge to another element's edge or centre (not with Shift: the ratio wins)
  if (!e.shiftKey) {
    const lines = snapLines(d.el);
    const snap = (edge: number, list: number[]) => {
      let best: number | null = null;
      for (const v of list) if (Math.abs(v - edge) <= 8 && (best === null || Math.abs(v - edge) < Math.abs(best - edge))) best = v;
      return best;
    };
    if (east || west) {
      const edge = east ? d.rect.right + dx : d.rect.left + dx;
      const v = snap(edge, lines.x);
      if (v !== null) {
        dx += v - edge;
        d.guides.push({ axis: 'x', at: v });
      }
    }
    if (north || south) {
      const edge = south ? d.rect.bottom + dy : d.rect.top + dy;
      const v = snap(edge, lines.y);
      if (v !== null) {
        dy += v - edge;
        d.guides.push({ axis: 'y', at: v });
      }
    }
  }
  let w = d.rect.width + (east ? dx : west ? -dx : 0) * k;
  let h = d.rect.height + (south ? dy : north ? -dy : 0) * k;
  if (e.shiftKey && d.rect.width && d.rect.height) {
    const ratio = d.rect.width / d.rect.height;
    if (d.at.length === 2) {
      if (Math.abs(w / d.rect.width) > Math.abs(h / d.rect.height)) h = w / ratio;
      else w = h * ratio;
    } else if (east || west) h = w / ratio;
    else w = h * ratio;
  }
  w = Math.max(8, Math.round(w));
  h = Math.max(8, Math.round(h));
  d.w = w;
  d.h = h;
  const el = d.el;
  el.style.transition = 'none';
  if (east || west || e.shiftKey) el.style.width = `${w - d.extra.w}px`;
  if (north || south || e.shiftKey) el.style.height = `${h - d.extra.h}px`;
  if (d.abs) {
    const gw = w - d.rect.width;
    const gh = h - d.rect.height;
    // the edge that moves is the one dragged (both, from the centre with Alt); the other stays
    if (west || (e.altKey && east)) el.style.left = `${Math.round(d.left - (e.altKey ? gw / 2 : gw))}px`;
    if (north || (e.altKey && south)) el.style.top = `${Math.round(d.top - (e.altKey ? gh / 2 : gh))}px`;
  }
}

export function endResize(cancel = false) {
  const d = resize;
  resize = null;
  if (!d) return;
  const restore = () => {
    if (!d.el.isConnected) return;
    Object.assign(d.el.style, d.saved);
  };
  if (!d.active || cancel) return restore();
  suppressNextClick();
  const set: Record<string, string | null> = {};
  const sized = { w: d.el.style.width !== d.saved.width, h: d.el.style.height !== d.saved.height };
  if (sized.w) set.width = d.el.style.width;
  if (sized.h) set.height = d.el.style.height;
  if (d.abs) {
    if (d.el.style.left !== d.saved.left) set.left = d.el.style.left;
    if (d.el.style.top !== d.saved.top) set.top = d.el.style.top;
  }
  // a size that grows with its parent ("fill") would ignore the new value: it becomes fixed
  const parent = d.el.parentElement?.closest('[data-dc-tid]') as HTMLElement | null;
  const pcs = parent ? getComputedStyle(parent) : null;
  if (pcs?.display.includes('flex')) {
    const row = !pcs.flexDirection.startsWith('column');
    const style = docFor(current.source).elements[d.tid]?.attrs.find((a) => a.name === 'style')?.value ?? '';
    const has = (p: string) => new RegExp(`(^|;)\\s*${p}\\s*:`).test(style);
    if ((row ? sized.w : sized.h) && (has('flex') || has('flex-grow'))) Object.assign(set, { flex: null, 'flex-grow': null });
    if ((row ? sized.h : sized.w) && has('align-self')) set['align-self'] = null;
  }
  post({ dc: 'resize', tid: d.tid, set });
  // a change re-renders the page; if nothing was written, put the element back as it was
  setTimeout(restore, 1500);
}
