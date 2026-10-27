/**
 * The selection overlay: hover and selection outlines, resize handles and the
 * snap guides, drawn inside the frame on a fixed layer so they line up at any
 * canvas zoom. A requestAnimationFrame loop redraws it; the gestures and the
 * resize write the state it shows through the setters below.
 */
import { LOCK_ATTR } from '@dc/core';
import { current } from './stage';
import { drag } from './drag';
import { resizable, resize } from './resize';

export const BLUE = '#2f6fed';
export const overlay = document.createElement('div');
overlay.setAttribute('aria-hidden', 'true');
overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
document.documentElement.appendChild(overlay);

let externalHover: number | null = null;
let indicator: { x: number; y: number; w: number; h: number } | null = null;

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
let spots: { at: Handle; x: number; y: number }[] = [];

/** The layer tree's hover, sent in from the editor, in case the frame's own pointer is elsewhere. */
export function setExternalHover(tid: number | null): void {
  externalHover = tid;
}

/** The drop indicator a drag shows between siblings. */
export function setIndicator(at: { x: number; y: number; w: number; h: number } | null): void {
  indicator = at;
}

export function rectOf(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width || r.height) return r;
  // display: contents wrappers (dc-import): union of the children
  let u: DOMRect | null = null;
  for (const c of Array.from(el.children)) {
    const cr = rectOf(c);
    if (!cr) continue;
    if (!u) u = DOMRect.fromRect(cr);
    else {
      const x = Math.min(u.x, cr.x);
      const y = Math.min(u.y, cr.y);
      u = new DOMRect(x, y, Math.max(u.right, cr.right) - x, Math.max(u.bottom, cr.bottom) - y);
    }
  }
  return u;
}

export const instances = (tid: number) => Array.from(document.querySelectorAll(`[data-dc-tid="${tid}"]`));

function box(r: { left: number; top: number; width: number; height: number }, css: string): string {
  return `<div style="position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;${css}"></div>`;
}

/** What a click lands on: the element under the pointer (a slide's text box as a whole), or the nearest one outside a locked branch. */
export function tidOf(target: EventTarget | null): number | null {
  let el = (target as Element | null)?.closest?.('[data-dc-tid]') ?? null;
  // a slide's text box is one box: a click on one of its paragraphs picks the box (a double click still types in the paragraph)
  const box = current.slide ? el?.closest('[data-text][data-dc-tid]') : null;
  if (box) el = box;
  const locked = el?.closest(`[${LOCK_ATTR}]`);
  if (locked) el = locked.parentElement?.closest('[data-dc-tid]') ?? null;
  if (!el) return null;
  return Number(el.getAttribute('data-dc-tid'));
}

/** Locked elements (and what's inside them) are not moved, resized or retyped on the stage. */
export const isLocked = (el: Element | undefined | null) => !!el?.closest(`[${LOCK_ATTR}]`);

function handleSpots(r: DOMRect): { at: Handle; x: number; y: number }[] {
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return [
    { at: 'nw', x: r.left, y: r.top },
    { at: 'n', x: cx, y: r.top },
    { at: 'ne', x: r.right, y: r.top },
    { at: 'e', x: r.right, y: cy },
    { at: 'se', x: r.right, y: r.bottom },
    { at: 's', x: cx, y: r.bottom },
    { at: 'sw', x: r.left, y: r.bottom },
    { at: 'w', x: r.left, y: cy },
  ];
}

export function spotAt(x: number, y: number): Handle | null {
  for (const h of spots) if (Math.abs(x - h.x) <= 6 && Math.abs(y - h.y) <= 6) return h.at;
  return null;
}

function drawBoxes() {
  const out: string[] = [];
  if (!resize) spots = [];
  if (current.mode === 'edit' && !current.editing) {
    const hover = externalHover ?? current.hover;
    if (hover !== null && hover !== current.selected) {
      for (const el of instances(hover)) {
        const r = rectOf(el);
        if (r) out.push(box(r, `border:1px solid ${BLUE}`));
      }
    }
    if (current.selected !== null) {
      const els = instances(current.selected);
      for (const el of els) {
        const r = rectOf(el);
        if (!r) continue;
        out.push(box(r, `border:1.5px solid ${BLUE}`));
        if (els.length === 1 && !drag?.active) {
          const can = resizable(current.selected);
          if (can && !resize) spots = handleSpots(r);
          const corners = can ? handleSpots(r) : isLocked(els[0]) ? [] : handleSpots(r).filter((h) => h.at.length === 2);
          for (const { x, y } of corners) {
            out.push(box({ left: x - 3.5, top: y - 3.5, width: 7, height: 7 }, `background:#fff;border:1.5px solid ${BLUE}`));
          }
        }
      }
    }
    if (indicator) out.push(box({ left: indicator.x, top: indicator.y, width: indicator.w, height: indicator.h }, `background:${BLUE};border-radius:1px`));
    if (resize?.active) {
      const r = resize.el.getBoundingClientRect();
      for (const g of resize.guides) out.push(box(g.axis === 'x' ? { left: g.at, top: 0, width: 1, height: innerHeight } : { left: 0, top: g.at, width: innerWidth, height: 1 }, `background:#e5484d`));
      out.push(
        `<div style="position:fixed;left:${r.left + r.width / 2}px;top:${r.bottom + 8}px;transform:translateX(-50%);padding:2px 6px;border-radius:4px;background:${BLUE};color:#fff;font:600 12px/1.4 system-ui;white-space:nowrap">${resize.w} × ${resize.h}</div>`,
      );
    }
  }
  const html = out.join('');
  if (overlay.innerHTML !== html) overlay.innerHTML = html;
}
(function loop() {
  drawBoxes();
  requestAnimationFrame(loop);
})();
