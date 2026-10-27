/**
 * The stage's pointer, click and key events, in edit and play mode: what a
 * click selects, when a drag or a resize starts, hover, the context menu,
 * in-place text, and what is forwarded to the editor as a `key`. The state
 * and the actions live in drag.ts, resize.ts, text.ts and overlay.ts.
 */
import { retypeKind } from '@dc/core';
import { post } from './post';
import { current, inEdit } from './stage';
import { docFor } from './template';
import { instances, isLocked, spotAt, tidOf } from './overlay';
import { CURSORS, endResize, moveResize, resize, startResize } from './resize';
import { drag, draggable, consumeSuppressedClick, endDrag, moveDrag, startDrag } from './drag';
import { beginText, commitText, editableTids } from './text';
import { showTime } from './scene';

document.addEventListener(
  'mousemove',
  (e) => {
    if (!inEdit() || drag || resize) return;
    const at = spotAt(e.clientX, e.clientY);
    document.documentElement.style.cursor = at ? CURSORS[at] : '';
  },
  true,
);

document.addEventListener(
  'pointerdown',
  (e) => {
    if (!inEdit()) return;
    if (current.editing?.contains(e.target as Node)) return;
    e.preventDefault();
    if (current.editing) commitText();
    if (e.button !== 0) return;
    const at = spotAt(e.clientX, e.clientY);
    if (at && current.selected !== null) return startResize(current.selected, at, e);
    // grabbing anything inside the selected element drags the selected element
    const sel = current.selected;
    const selEl = sel === null ? null : instances(sel)[0];
    if (sel !== null && selEl?.contains(e.target as Node) && draggable(sel)) startDrag(sel, e);
  },
  true,
);
document.addEventListener('pointermove', (e) => (resize ? moveResize(e) : drag && moveDrag(e)), true);
document.addEventListener('pointerup', (e) => (resize ? endResize() : drag && endDrag(e)), true);
window.addEventListener('blur', () => (resize ? endResize(true) : drag && endDrag(new PointerEvent('pointerup'), true)));

for (const type of ['mousedown', 'mouseup', 'submit', 'auxclick']) {
  document.addEventListener(
    type,
    (e) => {
      if (inEdit() && !current.editing?.contains(e.target as Node)) e.preventDefault();
    },
    true,
  );
}

document.addEventListener(
  'click',
  (e) => {
    if (current.editing?.contains(e.target as Node)) return;
    if (inEdit()) {
      e.preventDefault();
      e.stopPropagation();
      if (consumeSuppressedClick()) return;
      const tid = tidOf(e.target);
      current.selected = tid;
      showTime();
      post({ dc: 'select', tid, shift: e.shiftKey, x: e.clientX, y: e.clientY });
      return;
    }
    // play mode: links between artboards
    const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a && current.slide) {
      post({ dc: 'key', key: 'ArrowRight', meta: false, shift: false, alt: false });
      return;
    }
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (/\.dc\.html(#.*)?$/.test(href)) {
      e.preventDefault();
      post({ dc: 'navigate', href });
    } else if (href.startsWith('#')) {
      e.preventDefault();
      document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' });
    } else if (/^https?:/.test(href)) {
      e.preventDefault();
      window.open(href, '_blank', 'noopener');
    }
  },
  true,
);

document.addEventListener(
  'contextmenu',
  (e) => {
    if (!inEdit()) return;
    e.preventDefault();
    const tid = tidOf(e.target);
    if (tid !== current.selected) {
      current.selected = tid;
      showTime();
      post({ dc: 'select', tid, shift: false, x: e.clientX, y: e.clientY });
    }
    post({ dc: 'contextmenu', tid, x: e.clientX, y: e.clientY });
  },
  true,
);

document.addEventListener(
  'mousemove',
  (e) => {
    if (!inEdit() || drag?.active || resize?.active) return;
    const tid = tidOf(e.target);
    if (tid !== current.hover) {
      current.hover = tid;
      post({ dc: 'hover', tid });
    }
  },
  true,
);
document.addEventListener('mouseleave', () => {
  current.hover = null;
  post({ dc: 'hover', tid: null });
});

document.addEventListener(
  'dblclick',
  (e) => {
    if (!inEdit()) return;
    e.preventDefault();
    e.stopPropagation();
    const el = (e.target as Element).closest?.('[data-dc-tid]') as HTMLElement | null;
    if (!el) return;
    const tid = Number(el.getAttribute('data-dc-tid'));
    if (!editableTids().has(tid) || isLocked(el)) return;
    // text made only of values from the script: say so instead of doing nothing
    if (retypeKind(docFor(current.source), docFor(current.source).elements[tid]) === 'data') return void post({ dc: 'noedit', tid, why: 'data' });
    beginText(el);
  },
  true,
);

document.addEventListener(
  'keydown',
  (e) => {
    if (current.editing) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitText();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        commitText(true);
      }
      return;
    }
    if (drag && e.key === 'Escape') {
      endDrag(new PointerEvent('pointerup'), true);
      return;
    }
    if (resize && e.key === 'Escape') {
      endResize(true);
      return;
    }
    const nav = /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|PageUp|PageDown|Home|End| |f|F)$/.test(e.key);
    if (!inEdit() && e.key !== 'Escape' && !(current.slide && nav)) return;
    if (!inEdit() && nav) e.preventDefault();
    const t = e.target as HTMLElement;
    if (!inEdit() && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (inEdit() && !(e.metaKey || e.ctrlKey)) e.preventDefault();
    if (inEdit() && (e.metaKey || e.ctrlKey) && /^[cvxzydg=+-]$/i.test(e.key)) e.preventDefault();
    post({ dc: 'key', key: e.key, meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
  },
  true,
);

window.addEventListener(
  'wheel',
  (e) => {
    if (!inEdit() && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    post({ dc: 'wheel', dx: e.deltaX * k, dy: e.deltaY * k, ctrl: e.ctrlKey || e.metaKey, x: e.clientX, y: e.clientY });
  },
  { passive: false },
);
