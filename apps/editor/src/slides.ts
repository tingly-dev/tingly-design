import {
  attr,
  newSlideSource,
  parseDc,
  rootElement,
  slideFile,
  uniqueSectionKey,
  uniqueSlideId,
  withSlideId,
  type DcElement,
} from '@dc/core';
import { api } from './api';
import { insertHtml } from './actions';
import { deleteFile, deckOf, display, edit, editDeck, editElement, parsed, slideIds, toast, useStore } from './store';
import { replaceUrl } from './host';

/**
 * Deck commands: slides are files placed by deck.json `order`, so adding,
 * removing and reordering slides edit the index (and write or delete a slide
 * file); everything inside a slide is an ordinary element edit.
 */

const get = useStore.getState;
const set = useStore.setState;

export function goToSlide(id: string | null): void {
  if (!id) return;
  set({ slide: id, selection: { kind: 'board', file: slideFile(id) }, menu: null });
  const url = new URL(location.href);
  url.searchParams.set('s', id);
  replaceUrl(url);
}

export function stepSlide(dir: 1 | -1): void {
  const s = get();
  const ids = slideIds(s);
  const i = s.slide ? ids.indexOf(s.slide) : -1;
  const next = ids[Math.min(ids.length - 1, Math.max(0, i + dir))];
  if (next && next !== s.slide) goToSlide(next);
}

function sectionStyle(id: string | null): string | undefined {
  if (!id) return undefined;
  const src = display(get(), slideFile(id));
  const root = src ? rootElement(parsed(src)) : undefined;
  return root ? attr(root, 'style') : undefined;
}

/** A new slide after `after` (or at the end), in the look of its neighbour. */
export function addSlide(after: string | null = get().slide): string {
  const s = get();
  const ids = slideIds(s);
  const id = uniqueSlideId(ids, 'slide-' + (ids.length + 1));
  edit(slideFile(id), () => newSlideSource(id, { like: sectionStyle(after ?? ids.at(-1) ?? null) }), {
    actor: 'human',
    summary: 'slide created',
    undoable: false,
  });
  editDeck((d) => {
    const order = d.order.filter((x) => ids.includes(x));
    for (const x of ids) if (!order.includes(x)) order.push(x);
    const at = after ? order.indexOf(after) + 1 : order.length;
    order.splice(at > 0 ? at : order.length, 0, id);
    d.order = order;
  }, `slide ${id} added`);
  goToSlide(id);
  return id;
}

export function duplicateSlide(id: string): string | null {
  const s = get();
  const src = display(s, slideFile(id));
  if (src === undefined) return null;
  const ids = slideIds(s);
  const copy = uniqueSlideId(ids, id + '-copy');
  edit(slideFile(copy), () => withSlideId(src, copy), { actor: 'human', summary: `slide duplicated from ${id}`, undoable: false });
  editDeck((d) => {
    const order = d.order.filter((x) => ids.includes(x));
    for (const x of ids) if (!order.includes(x)) order.push(x);
    order.splice(order.indexOf(id) + 1, 0, copy);
    d.order = order;
  }, `slide ${copy} added`);
  goToSlide(copy);
  return copy;
}

export async function deleteSlide(id: string): Promise<void> {
  const s = get();
  const ids = slideIds(s);
  if (ids.length <= 1) return toast('一套幻灯片至少要有一页。');
  const i = ids.indexOf(id);
  const next = ids[i + 1] ?? ids[i - 1] ?? null;
  editDeck((d) => {
    d.order = d.order.filter((x) => x !== id);
    if (d.cover === id) d.cover = next ?? undefined;
    for (const sec of Object.values(d.sections)) if (sec.start === id && next) sec.start = next;
    // a section that now starts where the next one does goes away
    const seen = new Set<string>();
    for (const [k, sec] of Object.entries(d.sections)) {
      if (seen.has(sec.start) || sec.start === id) delete d.sections[k];
      else seen.add(sec.start);
    }
  }, `slide ${id} removed`, false);
  goToSlide(next);
  await deleteFile(slideFile(id));
}

/** Move a slide to sit before `before` (null: the end). */
export function moveSlide(id: string, before: string | null): void {
  const ids = slideIds(get());
  if (id === before) return;
  editDeck((d) => {
    const order = ids.filter((x) => x !== id);
    const at = before ? order.indexOf(before) : order.length;
    order.splice(at < 0 ? order.length : at, 0, id);
    // a section that started with the moved slide now starts with the slide after its old place
    const old = ids.indexOf(id);
    for (const sec of Object.values(d.sections)) if (sec.start === id && ids[old + 1]) sec.start = ids[old + 1];
    d.order = order;
  }, `slide ${id} moved`);
}

function sectionEl(id: string): DcElement | undefined {
  const src = display(get(), slideFile(id));
  return src ? rootElement(parsed(src)) : undefined;
}

export function isHidden(id: string): boolean {
  const el = sectionEl(id);
  return !!el && attr(el, 'hidden') !== undefined;
}

export function toggleHidden(id: string): void {
  const el = sectionEl(id);
  if (!el) return;
  const hidden = attr(el, 'hidden') !== undefined;
  editElement(slideFile(id), [{ kind: 'attr', tid: el.tid, name: 'hidden', value: hidden ? null : '' }]);
}

export function setSectionAttr(id: string, name: string, value: string | null): void {
  const el = sectionEl(id);
  if (el) editElement(slideFile(id), [{ kind: 'attr', tid: el.tid, name, value }]);
}

export function addSection(start: string, description = '新的一节'): void {
  editDeck((d) => {
    if (Object.values(d.sections).some((s) => s.start === start)) return;
    // the slides before the first section form one too, so the outline stays whole
    const ids = slideIds(get());
    const starts = new Set(Object.values(d.sections).map((s) => s.start));
    if (!starts.size && ids[0] && ids[0] !== start) d.sections[uniqueSectionKey(d)] = { description: '开场', start: ids[0] };
    d.sections[uniqueSectionKey(d)] = { description, start };
  }, `section added at ${start}`);
}

export function renameSection(key: string, description: string): void {
  editDeck((d) => {
    if (d.sections[key]) d.sections[key].description = description.trim().slice(0, 200);
  }, `section ${key} renamed`);
}

export function removeSection(key: string): void {
  editDeck((d) => void delete d.sections[key], `section ${key} removed`);
}

// ---------------------------------------------------------------- notes

export function notesOf(source: string | undefined): string {
  if (!source) return '';
  const root = rootElement(parsed(source));
  const aside = root?.children.find((c): c is DcElement => c.kind === 'el' && c.tag === 'aside');
  if (!aside?.inner) return '';
  return source
    .slice(aside.inner.start, aside.inner.end)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Speaker notes are one <aside>, the section's last child. */
export function setNotes(id: string, text: string): void {
  const file = slideFile(id);
  const src = display(get(), file);
  if (src === undefined) return;
  const root = rootElement(parsed(src));
  if (!root) return;
  const aside = root.children.find((c): c is DcElement => c.kind === 'el' && c.tag === 'aside');
  const t = text.slice(0, 4000);
  if (aside) {
    if (!t.trim()) editElement(file, [{ kind: 'remove', tid: aside.tid }]);
    else editElement(file, [{ kind: 'text', tid: aside.tid, text: t }]);
  } else if (t.trim()) {
    const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    editElement(file, [{ kind: 'insert', target: root.tid, where: 'last', html: `<aside>${esc}</aside>` }]);
  }
}

// ---------------------------------------------------------------- inserting

/** Insert markup into the current slide: after the selected element, or pinned on the slide. */
export function insertOnSlide(html: string, pinned: boolean): number | null {
  const s = get();
  if (!s.slide) return null;
  const file = slideFile(s.slide);
  const src = display(s, file);
  if (!src) return null;
  const doc = parsed(src);
  const root = rootElement(doc);
  if (!root) return null;
  const sel = s.selection?.kind === 'el' && s.selection.file === file ? doc.elements[s.selection.tid] : undefined;
  const aside = root.children.find((c): c is DcElement => c.kind === 'el' && c.tag === 'aside');
  let tid: number | null;
  if (!pinned && sel && sel !== root && sel.tag !== 'aside') tid = insertHtml(file, sel.tid, 'after', html);
  else if (aside) tid = insertHtml(file, aside.tid, 'before', html);
  else tid = insertHtml(file, root.tid, 'last', html);
  if (tid !== null) set({ selection: { kind: 'el', file, tid } });
  return tid;
}

export const INSERTS = {
  text: '<p style="position:absolute;left:128px;top:840px;width:960px;font-size:40px;line-height:1.3">新的文字</p>',
  table: `<table style="font-size:28px;width:1200px">
<tr><th style="width:40%">项目</th><th style="width:30%">数值</th><th style="width:30%">备注</th></tr>
<tr><td>第一行</td><td>—</td><td>—</td></tr>
<tr><td>第二行</td><td>—</td><td>—</td></tr>
</table>`,
  shape: (kind: string) =>
    kind === 'line'
      ? '<x-shape kind="line" style="position:absolute;left:760px;top:540px;width:400px;border:4px solid #2f6fed"></x-shape>'
      : `<x-shape kind="${kind}" style="position:absolute;left:810px;top:390px;width:${kind.startsWith('arrow-') ? (kind === 'arrow-up' || kind === 'arrow-down' ? 150 : 300) : 300}px;height:${kind === 'arrow-up' || kind === 'arrow-down' ? 300 : kind.startsWith('arrow-') ? 150 : 300}px;background:#2f6fed"></x-shape>`,
  connector: '<x-connector x1="640" y1="540" x2="1280" y2="540" head="end" style="color:#1d1d1b;border-width:4px"></x-connector>',
  icon: (name: string) => `<x-icon name="${name}" style="position:absolute;left:896px;top:476px;width:128px;height:128px;color:#2f6fed"></x-icon>`,
};

export async function uploadImage(file: File): Promise<void> {
  const project = get().project;
  if (!project) return;
  try {
    const r = await api.upload(project, file);
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 800, h: 600 });
      img.src = URL.createObjectURL(file);
    });
    const k = Math.min(1, 960 / dims.w, 720 / dims.h);
    const w = Math.round(dims.w * k);
    const h = Math.round(dims.h * k);
    const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/"/g, '');
    insertOnSlide(
      `<img src="${r.path}" alt="${alt}" style="position:absolute;left:${Math.round((1920 - w) / 2)}px;top:${Math.round((1080 - h) / 2)}px;width:${w}px;height:${h}px;object-fit:cover">`,
      true,
    );
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

/** The slide's title for strips and menus: its first heading's words. */
export function slideTitle(source: string | undefined, id: string): string {
  if (!source) return id;
  const doc = parsed(source);
  const h = doc.elements.find((e) => /^h[1-3]$/.test(e.tag)) ?? doc.elements.find((e) => e.tag === 'p');
  if (!h?.inner) return id;
  const t = source
    .slice(h.inner.start, h.inner.end)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t || id;
}

export { parseDc, deckOf };
