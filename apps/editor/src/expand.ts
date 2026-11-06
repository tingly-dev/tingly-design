import { FieldError, editFields, fieldNear, planField, retypeKind, setPropDefault, type EditField } from '@dc/core';
import { frames, post } from './components/canvas/Board';
import { display, edit, editElement, parsed, toast, useStore } from './store';
import { lockOf } from './layerFlags';
import { t } from './i18n';

/**
 * Expanding the selected element to edit what it holds (`.design/expand-to-edit.md`):
 * where the form opens, and how a field's new value is written back. The fields
 * themselves are core's `editFields`; the form is components/ContentForm.tsx.
 */

/** Open the form below an element drawn at `rect` (pixels of its frame) in `frame`, flipped above by the form when there is no room. */
export function openExpand(file: string, tid: number, rect: { x: number; y: number; w: number; h: number }, frame: HTMLIFrameElement, near?: string): void {
  const box = frame.getBoundingClientRect();
  // a frame drawn zoomed (the canvas) or scaled (a slide) is smaller or larger on screen than its own pixels
  const k = frame.offsetWidth ? box.width / frame.offsetWidth : 1;
  useStore.setState({
    menu: null,
    expand: { file, tid, x: box.left + rect.x * k, y: box.top + (rect.y + rect.h) * k, ...(near ? { near } : {}) },
  });
}

/**
 * Enter on a selected element that holds no elements of its own (a container is
 * entered instead): retype it when it is text, open the form for what it holds
 * otherwise, and say so when there is nothing to edit.
 */
export function expandSelection(): boolean {
  const s = useStore.getState();
  if (s.selection?.kind !== 'el') return false;
  const { file, tid } = s.selection;
  const src = display(s, file);
  const doc = src ? parsed(src) : null;
  const el = doc?.elements[tid];
  if (!doc || !el) return false;
  if (lockOf(s)) return void toast(t('canvas.text.noedit.locked')), true;
  const kind = retypeKind(doc, el);
  if (kind && kind !== 'data') {
    post(file, { dc: 'edit', tid });
    return true;
  }
  const frame = frames.get(file);
  if (!editFields(doc, el).length || !frame) return void toast(t('canvas.text.noedit.nothing')), true;
  // the runtime measured the selected element; without it the form opens at the frame's corner
  const rect = s.inspect?.tid === tid ? s.inspect.rect : { x: 0, y: 0, w: 0, h: 0 };
  openExpand(file, tid, rect, frame);
  return true;
}

export const closeExpand = () => useStore.setState({ expand: null });

/** The field of `tid` to put the cursor in when the form opens: the run that was double-clicked, else the first. */
export function firstField(fields: EditField[], near?: string): EditField | undefined {
  return fieldNear(fields, near) ?? fields.find((f) => f.binding.kind !== 'readonly');
}

/** Write one field's new value as the person's own change: an op on the element, or the text tweak it shows. */
export function commitField(file: string, field: EditField, value: string): boolean {
  try {
    const plan = planField(field, value);
    if ('tweak' in plan) return edit(file, (src) => setPropDefault(src, plan.tweak.prop, plan.tweak.value).source, { actor: 'human', summary: `tweak ${plan.tweak.prop} → ${JSON.stringify(plan.tweak.value)}` });
    return editElement(file, plan.ops);
  } catch (e) {
    toast(e instanceof FieldError ? t(`expand.readonly.${field.binding.kind === 'readonly' ? field.binding.why : 'data'}`) : (e as Error).message, 'error');
    return false;
  }
}
