import {
  adaptSize,
  attr,
  deckSize,
  newSlideSource,
  parseDc,
  rootElement,
  slideFile,
  uniqueSectionKey,
  uniqueSlideId,
  withSlideId,
  type DcElement,
} from '@dc/core';
import { api } from '../../api';
import { insertHtml } from '../../actions';
import { deleteFile, deckOf, display, edit, editDeck, editElement, parsed, slideIds, toast, useStore } from '../../store';
import { replaceUrl } from '../../host';
import { filesOf, type ImportTarget } from '../ImportHere';
import { boardEmbed } from '../../boards';
import { t } from '../../i18n';

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
  edit(slideFile(id), () => newSlideSource(id, { size: deckSize(deckOf(s)), like: sectionStyle(after ?? ids.at(-1) ?? null), title: t('starter.slideTitle'), body: t('starter.slideHint') }), {
    actor: 'human',
    summary: t('slides.journal.slideCreated'),
    undoable: false,
  });
  editDeck((d) => {
    const order = d.order.filter((x) => ids.includes(x));
    for (const x of ids) if (!order.includes(x)) order.push(x);
    const at = after ? order.indexOf(after) + 1 : order.length;
    order.splice(at > 0 ? at : order.length, 0, id);
    d.order = order;
  }, t('slides.journal.slideAdded', { id }));
  goToSlide(id);
  return id;
}

export function duplicateSlide(id: string): string | null {
  const s = get();
  const src = display(s, slideFile(id));
  if (src === undefined) return null;
  const ids = slideIds(s);
  const copy = uniqueSlideId(ids, id + '-copy');
  edit(slideFile(copy), () => withSlideId(src, copy), { actor: 'human', summary: t('slides.journal.slideDuplicated', { id }), undoable: false });
  editDeck((d) => {
    const order = d.order.filter((x) => ids.includes(x));
    for (const x of ids) if (!order.includes(x)) order.push(x);
    order.splice(order.indexOf(id) + 1, 0, copy);
    d.order = order;
  }, t('slides.journal.slideAdded', { id: copy }));
  goToSlide(copy);
  return copy;
}

export async function deleteSlide(id: string): Promise<void> {
  const s = get();
  const ids = slideIds(s);
  if (ids.length <= 1) return toast(t('slides.toast.lastSlide'));
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
  }, t('slides.journal.slideRemoved', { id }), false);
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
  }, t('slides.journal.slideMoved', { id }));
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

export function addSection(start: string, description = t('slides.section.defaultName')): void {
  editDeck((d) => {
    if (Object.values(d.sections).some((s) => s.start === start)) return;
    // the slides before the first section form one too, so the outline stays whole
    const ids = slideIds(get());
    const starts = new Set(Object.values(d.sections).map((s) => s.start));
    if (!starts.size && ids[0] && ids[0] !== start) d.sections[uniqueSectionKey(d)] = { description: t('slides.section.opening'), start: ids[0] };
    d.sections[uniqueSectionKey(d)] = { description, start };
  }, t('slides.journal.sectionAdded', { id: start }));
}

export function renameSection(key: string, description: string): void {
  editDeck((d) => {
    if (d.sections[key]) d.sections[key].description = description.trim().slice(0, 200);
  }, t('slides.journal.sectionRenamed', { key }));
}

export function removeSection(key: string): void {
  editDeck((d) => void delete d.sections[key], t('slides.journal.sectionRemoved', { key }));
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
  setNotesIn(slideFile(id), text);
}

/** The same <aside> in any scene or slide file: a motion scene keeps its note there too. */
export function setNotesIn(file: string, text: string): void {
  const src = display(get(), file);
  if (src === undefined) return;
  const root = rootElement(parsed(src));
  if (!root) return;
  const aside = root.children.find((c): c is DcElement => c.kind === 'el' && c.tag === 'aside');
  const body = text.slice(0, 4000);
  if (aside) {
    if (!body.trim()) editElement(file, [{ kind: 'remove', tid: aside.tid }]);
    else editElement(file, [{ kind: 'text', tid: aside.tid, text: body }]);
  } else if (body.trim()) {
    const esc = body.replace(/&/g, '&amp;').replace(/</g, '&lt;');
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

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Markup the insert buttons put on a slide; its words are in the language the editor shows. */
export const INSERTS = {
  get text() {
    const [w, h] = deckSize(deckOf(get()));
    const k = Math.min(w / 1920, h / 1080);
    return `<p style="position:absolute;left:${Math.round(128 * k)}px;top:${Math.round(840 * k)}px;width:${Math.round(960 * k)}px;font-size:${Math.round(40 * k)}px;line-height:1.3">${escText(t('slides.insert.text'))}</p>`;
  },
  get table() {
    const [w] = deckSize(deckOf(get()));
    return `<table style="font-size:28px;width:${Math.min(1200, Math.round(w * 0.625))}px">
<tr><th style="width:40%">${escText(t('slides.insert.tableItem'))}</th><th style="width:30%">${escText(t('slides.insert.tableValue'))}</th><th style="width:30%">${escText(t('slides.insert.tableNote'))}</th></tr>
<tr><td>${escText(t('slides.insert.tableRow1'))}</td><td>—</td><td>—</td></tr>
<tr><td>${escText(t('slides.insert.tableRow2'))}</td><td>—</td><td>—</td></tr>
</table>`;
  },
  shape: (kind: string) => {
    const [w, h] = deckSize(deckOf(get()));
    return kind === 'line'
      ? `<x-shape kind="line" style="position:absolute;left:${w / 2 - 200}px;top:${h / 2}px;width:400px;border:4px solid #2f6fed"></x-shape>`
      : `<x-shape kind="${kind}" style="position:absolute;left:${w / 2 - 150}px;top:${h / 2 - 150}px;width:${kind.startsWith('arrow-') ? (kind === 'arrow-up' || kind === 'arrow-down' ? 150 : 300) : 300}px;height:${kind === 'arrow-up' || kind === 'arrow-down' ? 300 : kind.startsWith('arrow-') ? 150 : 300}px;background:#2f6fed"></x-shape>`;
  },
  get connector() {
    const [w, h] = deckSize(deckOf(get()));
    return `<x-connector x1="${w / 3}" y1="${h / 2}" x2="${w * 2 / 3}" y2="${h / 2}" head="end" style="color:#1d1d1b;border-width:4px"></x-connector>`;
  },
  icon: (name: string) => {
    const [w, h] = deckSize(deckOf(get()));
    return `<x-icon name="${name}" style="position:absolute;left:${w / 2 - 64}px;top:${h / 2 - 64}px;width:128px;height:128px;color:#2f6fed"></x-icon>`;
  },
};

export async function uploadImage(file: File): Promise<void> {
  try {
    await placeImage(file);
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

/** A picture onto the current slide, centred, the nth one stepped down and right; kept in uploads/ like anything brought in. */
async function placeImage(file: File, nth = 0): Promise<void> {
  const project = get().project;
  if (!project) return;
  const r = await api.upload(project, file, 'uploads');
  const dims = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 });
    img.onerror = () => resolve({ w: 800, h: 600 });
    img.src = URL.createObjectURL(file);
  });
  const [W, H] = deckSize(deckOf(get()));
  const k = Math.min(1, W / 2 / dims.w, H * 2 / 3 / dims.h);
  const w = Math.round(dims.w * k);
  const h = Math.round(dims.h * k);
  const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/"/g, '');
  insertOnSlide(
    `<img src="${r.path}" alt="${alt}" style="position:absolute;left:${Math.round((W - w) / 2) + nth * 40}px;top:${Math.round((H - h) / 2) + nth * 40}px;width:${w}px;height:${h}px;object-fit:cover">`,
    true,
  );
}

/**
 * What a deck takes: pictures and SVGs go onto the slide that is open. A web
 * page does not: a slide is a closed subset of HTML that an arbitrary page
 * would not fit (PowerPoint import is the way decks will come in).
 */
export const slidesImport: ImportTarget = {
  accepts: ['image', 'drawing'],
  get what() {
    return t('slides.import.what');
  },
  run: async (picked) => {
    const files = filesOf(picked, 'image', 'drawing');
    for (const [i, f] of files.entries()) await placeImage(new File([f.bytes as Uint8Array<ArrayBuffer>], f.path.split('/').pop()!, { type: f.type }), i);
    return files.length === 1 ? t('slides.import.placedOne', { name: files[0].path.split('/').pop() }) : t('slides.import.placedMany', { count: files.length });
  },
  board: {
    get what() {
      return t('slides.import.boardWhat');
    },
    place: (path, { size, moving, title }) => {
      const { html, back } = boardEmbed(path, deckSize(deckOf(get())), size, moving);
      const tid = back ? insertBehind(html) : insertOnSlide(html, true);
      return tid === null ? t('slides.import.noSlide') : t('slides.import.boardPlaced', { title });
    },
  },
};

/** Put markup first on the open slide, behind everything else on it (an effect is a backdrop). */
function insertBehind(html: string): number | null {
  const s = get();
  if (!s.slide) return null;
  const file = slideFile(s.slide);
  const src = display(s, file);
  const root = src ? rootElement(parsed(src)) : null;
  if (!root) return null;
  const tid = insertHtml(file, root.tid, 'first', html);
  if (tid !== null) set({ selection: { kind: 'el', file, tid } });
  return tid;
}

/** The slide's title for strips and menus: its first heading's words. */
export function slideTitle(source: string | undefined, id: string): string {
  if (!source) return id;
  const doc = parsed(source);
  const h = doc.elements.find((e) => /^h[1-3]$/.test(e.tag)) ?? doc.elements.find((e) => e.tag === 'p');
  if (!h?.inner) return id;
  const words = source
    .slice(h.inner.start, h.inner.end)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return words || id;
}

export { parseDc, deckOf };

/** Give the deck a new size; with `scale` every slide's layout follows (`adaptSize`, `.design/size-adapt.md`). */
export function resizeDeck(w: number, h: number, scale: boolean): void {
  const s = get();
  const from = deckSize(deckOf(s));
  if (scale) {
    for (const id of slideIds(s)) {
      edit(slideFile(id), (src) => adaptSize(src, from, [w, h], { root: false }), { actor: 'human', summary: t('slides.journal.slideScaled', { id, size: `${w}×${h}` }), undoable: true });
    }
  }
  editDeck((d) => void (d.size = [w, h]), t('slides.journal.deckSize', { size: `${w}×${h}` }));
}
