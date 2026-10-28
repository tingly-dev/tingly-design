/**
 * Retyping text in place: a double click makes a text element editable, Enter
 * or a blur commits it as a `text` message, Escape puts it back. Mixed literal
 * and tweak text is checked first, so a retype the source cannot hold is
 * refused with a reason instead of silently written.
 */
import { retypeKind, planRetype, RetypeError } from '@dc/core';
import { post } from './post';
import { current } from './stage';
import { docFor } from './template';
import { BLUE } from './overlay';
import { rerender } from './render';
import { onMessage } from './messages';

export function editableTids(): Set<number> {
  const doc = docFor(current.source);
  return new Set(doc.elements.filter((e) => retypeKind(doc, e) !== null).map((e) => e.tid));
}

let editingOriginal = '';
export function beginText(el: HTMLElement) {
  current.editing = el;
  editingOriginal = el.innerText;
  try {
    el.contentEditable = 'plaintext-only';
  } catch {
    el.contentEditable = 'true';
  }
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.style.outline = `1.5px solid ${BLUE}`;
  el.style.outlineOffset = '1px';
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  el.addEventListener('blur', () => commitText(), { once: true });
}

export function commitText(cancel = false) {
  const el = current.editing;
  if (!el) return;
  current.editing = null;
  el.contentEditable = 'inherit';
  el.style.outline = '';
  el.style.outlineOffset = '';
  const text = el.innerText.replace(/\n$/, '');
  const tid = Number(el.getAttribute('data-dc-tid'));
  const item = el.hasAttribute('data-dc-item') ? Number(el.getAttribute('data-dc-item')) : null;
  const doc = docFor(current.source);
  const mixed = !!doc.elements[tid] && retypeKind(doc, doc.elements[tid]) === 'mixed';
  let refused: RetypeError | null = null;
  if (!cancel && mixed && text !== editingOriginal) {
    try {
      planRetype(doc, doc.elements[tid], editingOriginal, text, item);
    } catch (e) {
      if (!(e instanceof RetypeError)) throw e;
      refused = e;
    }
  }
  if (refused) {
    post({ dc: 'noedit', tid, why: refused.code });
    rerender();
  } else if (!cancel && text !== editingOriginal) post({ dc: 'text', tid, text, from: editingOriginal, item });
  else {
    rerender();
  }
  if (current.pending) {
    const p = current.pending;
    current.pending = null;
    onMessage(p);
  }
}
