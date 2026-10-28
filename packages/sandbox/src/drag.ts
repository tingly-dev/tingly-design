/**
 * Dragging an element: reorder it among its rendered siblings, or drag it out
 * of the flow to absolute position. The pointer listeners live in input.ts;
 * this holds the drag state and what a move and an end do with it.
 */
import type { DcElement } from '@dc/core';
import { post } from './post';
import { current } from './stage';
import { docFor } from './template';
import { instances, isLocked, setIndicator } from './overlay';

interface Drag {
  tid: number;
  el: HTMLElement;
  parent: HTMLElement;
  start: { x: number; y: number };
  rect: DOMRect;
  abs: boolean;
  axis: 'x' | 'y';
  siblings: HTMLElement[];
  active: boolean;
  mode: 'reorder' | 'out';
  drop: { target: number; where: 'before' | 'after' } | null;
  saved: { opacity: string; transform: string; transition: string };
}
export let drag: Drag | null = null;
let suppressClick = false;
/** A gesture that just wrote something answers for it: the click that ends it must not select. */
export function suppressNextClick(): void {
  suppressClick = true;
}
/** The click a drag ends with: swallowed once, then selection goes back to normal. */
export function consumeSuppressedClick(): boolean {
  const was = suppressClick;
  suppressClick = false;
  return was;
}

export function draggable(tid: number): boolean {
  const doc = docFor(current.source);
  const el = doc.elements[tid];
  if (!el || !el.parent) return false; // top-level: the artboard itself
  for (let a: DcElement | null = el.parent; a; a = a.parent) if (a.tag === 'sc-for') return false;
  return instances(tid).length === 1 && !isLocked(instances(tid)[0]);
}

/** The source-level sibling of `tid` that contains the rendered element `domTid`. */
function sourceSibling(tid: number, domTid: number): number | null {
  const doc = docFor(current.source);
  const parent = doc.elements[tid]?.parent;
  let el = doc.elements[domTid];
  while (el && el.parent !== parent) el = el.parent as typeof el;
  return el && el.tid !== tid ? el.tid : null;
}

export function startDrag(tid: number, e: PointerEvent) {
  const el = instances(tid)[0] as HTMLElement | undefined;
  const parent = el?.parentElement?.closest('[data-dc-tid]') as HTMLElement | null;
  if (!el || !parent) return;
  const cs = getComputedStyle(el);
  const pcs = getComputedStyle(parent);
  const axis: 'x' | 'y' = pcs.display.includes('flex') && !pcs.flexDirection.startsWith('column') ? 'x' : 'y';
  const siblings = (Array.from(parent.querySelectorAll('[data-dc-tid]')) as HTMLElement[]).filter((c) => {
    if (c === el || c.parentElement?.closest('[data-dc-tid]') !== parent) return false;
    const s = getComputedStyle(c);
    return s.position !== 'absolute' && s.position !== 'fixed' && s.display !== 'none';
  });
  drag = {
    tid,
    el,
    parent,
    start: { x: e.clientX, y: e.clientY },
    rect: el.getBoundingClientRect(),
    abs: cs.position === 'absolute',
    axis,
    siblings,
    active: false,
    mode: 'reorder',
    drop: null,
    saved: { opacity: el.style.opacity, transform: el.style.transform, transition: el.style.transition },
  };
}

export function moveDrag(e: PointerEvent) {
  const d = drag;
  if (!d) return;
  const dx = e.clientX - d.start.x;
  const dy = e.clientY - d.start.y;
  if (!d.active && Math.hypot(dx, dy) < 4) return;
  d.active = true;
  const pr = d.parent.getBoundingClientRect();
  const outside = e.clientX < pr.left - 16 || e.clientX > pr.right + 16 || e.clientY < pr.top - 16 || e.clientY > pr.bottom + 16;
  d.mode = d.abs || outside || !d.siblings.length ? 'out' : 'reorder';
  d.el.style.transition = 'none';
  if (d.mode === 'out') {
    setIndicator(null);
    d.drop = null;
    d.el.style.opacity = d.saved.opacity;
    d.el.style.transform = `translate(${dx}px, ${dy}px)`;
    return;
  }
  d.el.style.transform = d.saved.transform;
  d.el.style.opacity = '0.45';
  const p = d.axis === 'x' ? e.clientX : e.clientY;
  let before: HTMLElement | null = null;
  for (const s of d.siblings) {
    const r = s.getBoundingClientRect();
    const mid = d.axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2;
    if (p < mid) {
      before = s;
      break;
    }
  }
  const ref = before ?? d.siblings[d.siblings.length - 1];
  const rr = ref.getBoundingClientRect();
  const edge = before ? (d.axis === 'x' ? rr.left - 2 : rr.top - 2) : d.axis === 'x' ? rr.right + 1 : rr.bottom + 1;
  setIndicator(
    d.axis === 'x'
      ? { x: edge - 1, y: rr.top, w: 3, h: rr.height }
      : { x: Math.min(rr.left, d.rect.left), y: edge - 1, w: Math.max(rr.width, d.rect.width), h: 3 },
  );
  const target = sourceSibling(d.tid, Number(ref.getAttribute('data-dc-tid')));
  d.drop = target === null ? null : { target, where: before ? 'before' : 'after' };
}

export function endDrag(e: PointerEvent, cancel = false) {
  const d = drag;
  drag = null;
  setIndicator(null);
  if (!d) return;
  const restore = () => {
    d.el.style.opacity = d.saved.opacity;
    d.el.style.transform = d.saved.transform;
    d.el.style.transition = d.saved.transition;
  };
  if (!d.active || cancel) return restore();
  suppressClick = true;
  if (d.mode === 'reorder') {
    restore();
    if (d.drop) post({ dc: 'move', tid: d.tid, ...d.drop });
    return;
  }
  const dx = e.clientX - d.start.x;
  const dy = e.clientY - d.start.y;
  const pr = d.parent.getBoundingClientRect();
  const left = Math.round(d.rect.left + dx - pr.left - d.parent.clientLeft + d.parent.scrollLeft);
  const top = Math.round(d.rect.top + dy - pr.top - d.parent.clientTop + d.parent.scrollTop);
  const set: Record<string, string> = { left: `${left}px`, top: `${top}px` };
  const parentSet: Record<string, string> = {};
  if (!d.abs) {
    Object.assign(set, { position: 'absolute', width: `${Math.round(d.rect.width)}px`, margin: '0' });
    if (getComputedStyle(d.parent).position === 'static') parentSet.position = 'relative';
    // keep the parent from collapsing now that the element left the flow
    const doc = docFor(current.source);
    const srcParent = doc.elements[d.tid]?.parent;
    const ps = srcParent?.attrs.find((a) => a.name === 'style')?.value ?? '';
    if (srcParent?.parent && !/(^|;)\s*height\s*:/.test(ps)) parentSet.height = `${Math.round(pr.height)}px`;
  }
  const parentTid = Number(d.parent.getAttribute('data-dc-tid'));
  post({ dc: 'dragout', tid: d.tid, set, parentTid: Number.isFinite(parentTid) ? parentTid : null, parentSet });
}
