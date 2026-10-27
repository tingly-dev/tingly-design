/**
 * What the editor's Properties panel needs to know about the selection: the
 * computed styles, where the element is, what is behind it — posted when it
 * changes, and the rendered instance counts per element.
 */
import type { Inspect } from '@dc/core';
import { post } from './post';
import { current } from './stage';
import { docFor } from './template';
import { instances, rectOf } from './overlay';
import { drag } from './drag';
import { resize } from './resize';

const COMPUTED = [
  'display', 'position', 'flex-direction', 'flex-wrap', 'flex-grow', 'align-items', 'justify-content', 'gap',
  'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'text-align',
  'background-color', 'background-image', 'opacity', 'border-radius', 'border-top-width', 'border-top-style', 'border-top-color',
  'box-shadow', 'left', 'top', 'transform', 'overflow',
];

function opaque(c: string): boolean {
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return c !== 'transparent' && c !== '';
  const parts = m[1].split(/[,\s/]+/).filter(Boolean);
  return parts.length < 4 || parseFloat(parts[3]) > 0.5;
}

let lastInspect = '';
export function inspect() {
  const tid = current.selected;
  const el = tid === null ? null : (instances(tid)[0] as HTMLElement | undefined);
  let info: Inspect | null = null;
  if (el && tid !== null) {
    const r = rectOf(el) ?? new DOMRect();
    const cs = getComputedStyle(el.style.display === 'contents' && el.firstElementChild ? el.firstElementChild : el);
    const computed: Record<string, string> = {};
    for (const k of COMPUTED) computed[k] = cs.getPropertyValue(k);
    computed['offset-left'] = String(el.offsetLeft);
    computed['offset-top'] = String(el.offsetTop);
    let backdrop = '#ffffff';
    for (let a: Element | null = el; a; a = a.parentElement) {
      const acs = getComputedStyle(a);
      const bg = acs.backgroundColor;
      if (opaque(bg)) {
        backdrop = bg;
        break;
      }
      // a gradient backdrop (slides often have one): its last stop covers the most area
      const stops = /gradient\(/.test(acs.backgroundImage) && acs.backgroundClip !== 'text' ? acs.backgroundImage.match(/rgba?\([^)]*\)/g) : null;
      const last = stops?.filter(opaque).at(-1);
      if (last) {
        backdrop = last;
        break;
      }
    }
    const p = el.parentElement?.closest('[data-dc-tid]') as HTMLElement | null;
    const pcs = p ? getComputedStyle(p) : null;
    const doc = docFor(current.source);
    const srcParent = doc.elements[tid]?.parent ?? null;
    info = {
      tid,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      count: instances(tid).length,
      computed,
      backdrop,
      parent: {
        tid: p ? Number(p.getAttribute('data-dc-tid')) : null,
        display: pcs?.display ?? 'block',
        flexDirection: pcs?.flexDirection ?? 'row',
        position: pcs?.position ?? 'static',
        hasHeight: !!(srcParent && /(^|;)\s*height\s*:/.test(srcParent.attrs.find((a) => a.name === 'style')?.value ?? '')),
      },
    };
  }
  const sig = JSON.stringify(info);
  if (sig !== lastInspect) {
    lastInspect = sig;
    post({ dc: 'inspect', info });
  }
}

let lastCounts = '';
function postCounts() {
  const counts: Record<number, number> = {};
  for (const el of Array.from(document.querySelectorAll('[data-dc-tid]'))) {
    const t = Number(el.getAttribute('data-dc-tid'));
    counts[t] = (counts[t] ?? 0) + 1;
  }
  const sig = JSON.stringify(counts);
  if (sig !== lastCounts) {
    lastCounts = sig;
    post({ dc: 'counts', counts });
  }
}

// layout settles over a few frames (fonts, images): keep the inspection fresh
setInterval(() => {
  if (current.mode === 'edit' && !drag?.active && !resize?.active) {
    inspect();
    postCounts();
  }
}, 250);
