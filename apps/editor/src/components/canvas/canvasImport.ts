import { addToCanvas } from '@dc/import';
import { CANVAS_FILE, uniqueNoteId, type NoteEntry } from '@dc/core';
import { api } from '../../api';
import { t } from '../../i18n';
import { display, edit, editCanvas, useStore } from '../../store';
import { fitTo, toCanvas } from './view';
import { readPage, writePage, type Picked } from '../../importer';
import { filesOf, type ImportTarget } from '../ImportHere';

const get = () => useStore.getState();

/** Images dropped on a canvas are drawn no larger than this. */
const IMAGE_MAX = 800;

/**
 * What a canvas takes: a page or an SVG becomes artboards beside what is
 * already there (the view moves to them), pictures land where they were
 * dropped as image items. Originals are kept in uploads/.
 */
export const canvasImport: ImportTarget = {
  accepts: ['page', 'drawing', 'image'],
  get what() {
    return t('importer.canvas.what');
  },
  run: async (picked, at) => (picked.entry ? addPage(picked) : addImages(picked, at)),
};

async function addPage(picked: Picked): Promise<string> {
  const project = get().project!;
  const page = await readPage(picked);
  const out = await writePage(project, picked, page, '');
  const s = get();
  const added = addToCanvas(display(s, CANVAS_FILE), out, { taken: Object.keys(s.files), page: s.page });
  const summary = `imported ${picked.entry}`;
  // artboards first, the index last, so the canvas never lists a file that is not there yet
  for (const f of added.boards) edit(f, () => added.files[f], { actor: 'human', summary, undoable: false });
  edit(CANVAS_FILE, (src) => added.merge(src), { actor: 'human', summary });
  fitTo(added.area);
  const name = picked.entry.split('/').pop();
  const count = added.boards.length;
  return page.extracted.report.notes?.length || out.report.missing.length ? t('importer.canvas.importedWithNote', { name, count }) : t('importer.canvas.imported', { name, count });
}

async function addImages(picked: Picked, at?: { x: number; y: number }): Promise<string> {
  const project = get().project!;
  const files = filesOf(picked, 'image');
  // where it was dropped, else the middle of what is on screen
  const el = document.querySelector<HTMLElement>(`[aria-label="${t('canvas.surface.label')}"]`);
  const r = el?.getBoundingClientRect();
  const { viewport } = get();
  const origin = at && r ? toCanvas(at.x - r.left, at.y - r.top) : toCanvas(viewport.w / 2, viewport.h / 2);
  const items: NoteEntry[] = [];
  for (const [i, f] of files.entries()) {
    const file = new File([f.bytes as Uint8Array<ArrayBuffer>], f.path.split('/').pop()!, { type: f.type });
    const up = await api.upload(project, file, 'uploads');
    const { w, h } = await sizeOf(file);
    const k = Math.min(1, IMAGE_MAX / w, IMAGE_MAX / h);
    const iw = Math.round(w * k);
    const ih = Math.round(h * k);
    items.push({ kind: 'image', x: Math.round(origin.x - iw / 2 + i * 32), y: Math.round(origin.y - ih / 2 + i * 32), w: iw, h: ih, src: up.path, alt: file.name.replace(/\.[^.]+$/, ''), ...(get().page ? { page: get().page } : {}) });
  }
  const ids: string[] = [];
  editCanvas((c) => {
    for (const n of items) {
      const id = uniqueNoteId(c, 'img');
      c.notes[id] = n;
      ids.push(id);
    }
  }, `imported ${items.length} image${items.length > 1 ? 's' : ''}`);
  if (ids.length === 1) useStore.setState({ selection: { kind: 'note', id: ids[0] } });
  return files.length === 1 ? t('importer.canvas.placedOne', { name: files[0].path.split('/').pop() }) : t('importer.canvas.placedImages', { count: files.length });
}

function sizeOf(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => resolve({ w: 400, h: 300 });
    img.src = url;
  });
}

