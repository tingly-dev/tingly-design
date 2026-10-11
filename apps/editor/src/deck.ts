import {
  newSlideSource,
  renameSlideSource,
  rootElement,
  setSlideNotes,
  slideFile,
  uniqueSectionKey,
  uniqueSlideId,
  type DeckJson,
} from '@dc/core';
import { api } from './api';
import { insertHtml } from './actions';
import { deckOf, display, edit, editDeck, editElement, goToSlide, parsed, slidesOf, toast, useStore } from './store';

/**
 * Commands on a deck: slides are files, their order, sections and cover
 * live in deck.json. Each command is an ordinary queued edit, so it saves,
 * syncs and replays after a conflict like any other.
 */

const get = useStore.getState;
const set = useStore.setState;

/** Make `order` list every slide that is shown, in show order, before changing it. */
function withOrder(d: DeckJson): void {
  d.order = slidesOf(get()).slice();
}

export function addSlide(after: string | null = get().slide): string {
  const s = get();
  const ids = slidesOf(s);
  const id = uniqueSlideId(ids, 'slide');
  const like = after ? display(s, slideFile(after)) : undefined;
  edit(slideFile(id), () => newSlideSource(id, { like }), { actor: 'human', summary: 'slide created', undoable: false });
  editDeck((d) => {
    withOrder(d);
    const i = after ? d.order.indexOf(after) : -1;
    d.order.splice(i < 0 ? d.order.length : i + 1, 0, id);
    d.cover ??= d.order[0];
  }, `slide ${id} added`);
  goToSlide(id);
  set({ deckView: 'edit' });
  return id;
}

export function duplicateSlide(id: string): string | null {
  const s = get();
  const src = display(s, slideFile(id));
  if (src === undefined) return null;
  const copy = uniqueSlideId(slidesOf(s), id + '-copy');
  edit(slideFile(copy), () => renameSlideSource(src, copy), { actor: 'human', summary: `slide duplicated from ${id}`, undoable: false });
  editDeck((d) => {
    withOrder(d);
    d.order.splice(d.order.indexOf(id) + 1, 0, copy);
  }, `slide ${copy} added`);
  goToSlide(copy);
  return copy;
}

export async function deleteSlide(id: string): Promise<void> {
  const s = get();
  const project = s.project;
  if (!project) return;
  const ids = slidesOf(s);
  if (ids.length <= 1) return toast('至少要留一张幻灯片。');
  const i = ids.indexOf(id);
  const next = ids[i + 1] ?? ids[i - 1] ?? null;
  editDeck((d) => {
    withOrder(d);
    d.order = d.order.filter((x) => x !== id);
    if (d.cover === id) d.cover = next ?? undefined;
    for (const sec of Object.values(d.sections)) {
      if (sec.start === id) {
        // the section keeps its place: it now starts at the next slide of its run, or sits empty before it
        if (next && d.order.indexOf(next) === i && !Object.values(d.sections).some((o) => o.start === next)) sec.start = next;
        else {
          delete sec.start;
          sec.before = next ?? undefined;
        }
      }
      if (sec.before === id) sec.before = next ?? undefined;
    }
  }, `slide ${id} removed`, false);
  if (s.slide === id) goToSlide(next);
  const file = slideFile(id);
  for (let k = 0; k < 50 && (get().files[file]?.pending.length ?? 0) > 0; k++) await new Promise((r) => setTimeout(r, 100));
  const v = get().files[file]?.server?.version;
  if (v) await api.remove(project, file, v);
}

/** Move a slide to sit before `beforeId` (null = the end). Sections keep their first slides. */
export function moveSlide(id: string, beforeId: string | null): void {
  if (id === beforeId) return;
  editDeck((d) => {
    withOrder(d);
    const from = d.order.indexOf(id);
    if (from < 0) return;
    // a section that started at the moved slide now starts at the slide after it
    const after = d.order[from + 1];
    for (const sec of Object.values(d.sections)) if (sec.start === id && after && !Object.values(d.sections).some((o) => o.start === after)) sec.start = after;
    d.order.splice(from, 1);
    const to = beforeId ? d.order.indexOf(beforeId) : d.order.length;
    d.order.splice(to < 0 ? d.order.length : to, 0, id);
  }, `slide ${id} moved`);
}

export function isSkipped(source: string | undefined): boolean {
  if (!source) return false;
  return /^\s*<section\b[^>]*\shidden(\s|=|>)/i.test(source);
}

export function toggleSkip(id: string): void {
  const file = slideFile(id);
  const src = display(get(), file);
  const root = src ? rootElement(parsed(src)) : undefined;
  if (!root) return;
  editElement(file, [{ kind: 'attr', tid: root.tid, name: 'hidden', value: isSkipped(src) ? null : '' }]);
}

export function setCover(id: string): void {
  editDeck((d) => (d.cover = id), `cover → ${id}`);
}

export function startSection(id: string): void {
  editDeck((d) => {
    if (Object.values(d.sections).some((s) => s.start === id)) return;
    d.sections[uniqueSectionKey(d)] = { description: '', start: id };
  }, `section added at ${id}`);
}

export function describeSection(key: string, description: string): void {
  editDeck((d) => {
    if (d.sections[key]) d.sections[key].description = description;
  }, `section ${key} described`);
}

export function removeSection(key: string): void {
  editDeck((d) => {
    delete d.sections[key];
  }, `section ${key} removed`);
}

export function renameDeck(title: string): void {
  const t = title.trim();
  if (t && t !== deckOf(get()).title) editDeck((d) => (d.title = t), `title → ${t}`);
}

export function setNotes(id: string, text: string): void {
  edit(slideFile(id), (src) => setSlideNotes(src, text), { actor: 'human', summary: 'speaker notes edited' });
}

// ------------------------------------------------------------- insert

/** Add a pinned element to the slide on stage, select it, and (for text) start retyping. */
export function insertOnSlide(html: string, retype = false): void {
  const s = get();
  const id = s.slide;
  if (!id) return;
  const file = slideFile(id);
  const src = display(s, file);
  const root = src ? rootElement(parsed(src)) : undefined;
  if (!root) return;
  // before the speaker notes, which stay the section's last child
  const kids = root.children.filter((c) => c.kind === 'el');
  const aside = kids.at(-1)?.kind === 'el' && kids.at(-1)!.tag === 'aside' ? kids.at(-1)! : null;
  const tid = aside && aside.kind === 'el' ? insertHtml(file, aside.tid, 'before', html) : insertHtml(file, root.tid, 'last', html);
  if (tid === null) return;
  set({ selection: { kind: 'el', file, tid }, deckView: 'edit', ...(retype ? { pendingSlideEdit: { file, tid } } : {}) });
}

const CENTER = (w: number, h: number) => `position:absolute;left:${Math.round((1920 - w) / 2)}px;top:${Math.round((1080 - h) / 2)}px;width:${w}px`;

export const INSERT = {
  text: () => insertOnSlide(`<p style="${CENTER(640, 60)};font-size:40px;line-height:1.3">文字</p>`, true),
  table: () =>
    insertOnSlide(
      `<table style="${CENTER(1200, 300)};font-size:28px"><tr><th style="width:40%">项目</th><th style="width:30%">数值</th><th style="width:30%">备注</th></tr><tr><td>第一行</td><td>—</td><td>—</td></tr><tr><td>第二行</td><td>—</td><td>—</td></tr></table>`,
    ),
  shape: (kind: string) => {
    const [w, h] = kind === 'line' ? [480, 24] : kind.startsWith('arrow-up') || kind.startsWith('arrow-down') ? [160, 320] : kind.startsWith('arrow') ? [320, 160] : [320, 320];
    const fill = kind === 'line' ? 'border:4px solid #1a1a1a' : 'background:#e07a3f';
    insertOnSlide(`<x-shape kind="${kind}" style="${CENTER(w, h)};height:${h}px;${fill}"></x-shape>`);
  },
  icon: (name: string) => insertOnSlide(`<x-icon name="${name}" style="${CENTER(96, 96)};height:96px;color:#1a1a1a"></x-icon>`),
  image: (path: string, alt: string) =>
    insertOnSlide(`<img src="${path.replace(/"/g, '&quot;')}" alt="${alt.replace(/"/g, '&quot;')}" style="${CENTER(960, 540)};height:540px;object-fit:cover">`),
};

/** Upload an image into the deck folder and put it on the slide. */
export async function insertImageFile(f: File): Promise<void> {
  const project = get().project;
  if (!project) return;
  try {
    const { path } = await api.upload(project, f);
    INSERT.image(path, f.name.replace(/\.[^.]+$/, ''));
  } catch (e) {
    toast(`上传失败：${(e as Error).message}`, 'error');
  }
}
