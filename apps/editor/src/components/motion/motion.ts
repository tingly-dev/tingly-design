/**
 * Motion pieces in the editor: motion.json edits that keep what the file has,
 * the piece's formats (sizes), and where the stage stands.
 */
import { attr, seedFormat, DEFAULT_SCENE_MS, newSlideSource, withSlideId, MOTION_FILE, FORMAT_NAME_RE, formatTime, newCoverScene, snapSceneMs, uniqueSlideId, parseTime, sceneTiming, parseDc, parseMotion, primaryFormat, rootElement, sceneFile, sceneIdOf, type MotionJson } from '@dc/core';
import { api } from '../../api';
import { insertHtml } from '../../actions';
import { filesOf, type ImportTarget } from '../ImportHere';
import { boardEmbed } from '../../boards';
import { deleteFile, display, edit, editElement, parsed, toast, useStore } from '../../store';
import { t } from '../../i18n';

const get = useStore.getState;

let cache: { text: string | undefined; motion: MotionJson } = { text: undefined, motion: parseMotion(undefined) };
export function motionOf(s = get()): MotionJson {
  const text = display(s, MOTION_FILE);
  if (text !== cache.text) cache = { text, motion: parseMotion(text) };
  return cache.motion;
}

/** Change motion.json as JSON, keeping keys this editor doesn't know about. */
export function editMotion(mutate: (raw: Record<string, unknown>) => void, summary: string): boolean {
  return edit(
    MOTION_FILE,
    (src) => {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(src || '{}');
      } catch {
        throw new Error(t('motion.toast.badJson'));
      }
      mutate(raw);
      return JSON.stringify(raw, null, 2) + '\n';
    },
    { actor: 'human', summary, undoable: true },
  );
}

const formatsOf = (raw: Record<string, unknown>) => ((raw.formats ??= {}) as Record<string, { size: [number, number] }>);

export function setFormatSize(name: string, size: [number, number]): void {
  const [w, h] = size.map((v) => Math.round(v));
  if (!(w > 0 && h > 0 && w <= 7680 && h <= 7680)) return void toast(t('motion.toast.sizeRange'), 'error');
  editMotion((raw) => {
    const f = formatsOf(raw);
    f[name] = { ...(f[name] ?? {}), size: [w, h] };
  }, t('motion.journal.formatSize', { name, size: `${w}×${h}` }));
}

/** Add a format (a new size of the same piece); it starts with no overrides. */
export function addFormat(name: string, size: [number, number]): boolean {
  const m = motionOf();
  if (!FORMAT_NAME_RE.test(name)) {
    toast(t('motion.toast.badName'), 'error');
    return false;
  }
  if (m.formats[name]) {
    toast(t('motion.toast.nameTaken', { name }), 'error');
    return false;
  }
  const from = m.formats[primaryFormat(m)]?.size;
  const added = editMotion((raw) => void (formatsOf(raw)[name] = { size }), t('motion.journal.formatAdded', { name }));
  // the new format starts from the primary layout rescaled, written as its own overrides (`.design/size-adapt.md`)
  if (added && from) {
    for (const f of sceneFiles()) edit(f, (src) => seedFormat(src, from, size, name), { actor: 'human', summary: t('motion.journal.formatSeeded', { name }), undoable: true });
  }
  return added;
}

/** Attributes in a scene that belong to one format. */
function formatAttrs(name: string): RegExp {
  return new RegExp(`^data-(?:(?:in|out|keys|duration|transition)-)?${name}$`);
}

/** Every scene file in the project, in order and not. */
function sceneFiles(): string[] {
  return Object.keys(get().files).filter((f) => sceneIdOf(f) !== null && display(get(), f) !== undefined);
}

/** How many places in the scenes say something only about this format. */
export function overridesOf(name: string): number {
  const re = formatAttrs(name);
  let n = 0;
  for (const f of sceneFiles()) {
    for (const el of parseDc(display(get(), f) ?? '').elements) {
      n += el.attrs.filter((a) => re.test(a.name)).length;
      if (el.attrs.some((a) => a.name === 'data-only' && a.value.split(/\s+/).includes(name))) n++;
    }
  }
  return n;
}

/** Remove a format and everything the scenes say only about it. The first format can't go. */
export function removeFormat(name: string): void {
  const m = motionOf();
  const names = Object.keys(m.formats);
  if (names.length < 2 || !m.formats[name]) return;
  const re = formatAttrs(name);
  for (const f of sceneFiles()) {
    const ops = [];
    for (const el of parseDc(display(get(), f) ?? '').elements) {
      for (const a of el.attrs) if (re.test(a.name)) ops.push({ kind: 'attr' as const, tid: el.tid, name: a.name, value: null });
      const only = el.attrs.find((a) => a.name === 'data-only');
      if (only && only.value.split(/\s+/).includes(name)) {
        const rest = only.value.split(/\s+/).filter((x) => x && x !== name);
        ops.push({ kind: 'attr' as const, tid: el.tid, name: 'data-only', value: rest.length ? rest.join(' ') : null });
      }
    }
    if (ops.length) editElement(f, ops);
  }
  editMotion((raw) => void delete formatsOf(raw)[name], t('motion.journal.formatRemoved', { name }));
  const view = get().motionView;
  if (view?.format === name) useStore.setState({ motionView: { ...view, format: names[0] } });
}

/** A scene's length (`data-duration`, before playback speed), written on its section. */
export function setSceneDuration(id: string, ms: number): boolean {
  const f = sceneFile(id);
  const root = rootElement(parsed(display(get(), f) ?? ''));
  if (!root) return false;
  return editElement(f, [{ kind: 'attr', tid: root.tid, name: 'data-duration', value: formatTime(snapSceneMs(ms, 1)) }]);
}

/**
 * Give the piece a cover: a scene outside `order` that stands for the video
 * (thumbnail, first frame, the page before playing). A cover left behind by
 * "remove" is taken back as it was rather than overwritten.
 */
export function addCover(): string {
  const s = get();
  const m = motionOf(s);
  const files = sceneFiles().map((f) => sceneIdOf(f)!);
  const id = files.includes('poster') && !m.order.includes('poster') ? 'poster' : uniqueSlideId(files, 'poster');
  if (!files.includes(id)) {
    edit(sceneFile(id), () => newCoverScene(id, m.title), { actor: 'human', summary: t('motion.journal.coverCreated'), undoable: false });
  }
  editMotion((raw) => void (raw.cover = id), t('motion.journal.coverSet', { id }));
  return id;
}

/**
 * Make a moment of the video the cover, in authored time (before speed, like every time in the
 * piece), rounded to 10 ms so the file reads `"2.43s"`. A cover scene it replaces keeps its file.
 */
export function setCoverAt(ms: number): void {
  const at = Math.max(0, Math.round(ms / 10) * 10);
  editMotion((raw) => void (raw.cover = formatTime(at)), t('motion.journal.coverAt', { time: +(at / 1000).toFixed(2) }));
}

/** The piece goes back to showing its first frame; the cover's scene file stays, in case it comes back. */
export function removeCover(): void {
  editMotion((raw) => void delete raw.cover, t('motion.journal.coverRemoved'));
}

/**
 * Put a picture on the scene under the playhead: centred in the primary size,
 * entering at the playhead, because people insert at the moment that needs
 * one more thing (on a scene's landed first moment, that is its start). It
 * is always fully in before the scene ends, so a cover still shows it.
 */
async function placeOnScene(file: File, nth: number): Promise<boolean> {
  const s = get();
  const view = s.motionView;
  if (!s.project || !view?.scene) return false;
  const f = sceneFile(view.scene);
  const src = display(s, f) ?? '';
  const root = rootElement(parsed(src));
  if (!root) return false;
  const r = await api.upload(s.project, file, 'uploads');
  const dims = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 800, h: img.naturalHeight || 600 });
    img.onerror = () => resolve({ w: 800, h: 600 });
    img.src = URL.createObjectURL(file);
  });
  const m = motionOf(s);
  const [W, H] = m.formats[primaryFormat(m)]?.size ?? [1920, 1080];
  const k = Math.min(1, (W * 0.5) / dims.w, (H * 0.6) / dims.h);
  const w = Math.round(dims.w * k);
  const h = Math.round(dims.h * k);
  const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/"/g, '');
  const length = parseTime(sceneTiming(src).duration) ?? DEFAULT_SCENE_MS;
  const at = view.landed ? 0 : Math.max(0, Math.min(Math.round(view.at), length - 300));
  const tid = insertHtml(
    f,
    root.tid,
    'last',
    `<img src="${r.path}" alt="${alt}" data-in="fade 300ms @${formatTime(at)}" style="position:absolute;left:${Math.round((W - w) / 2) + nth * 40}px;top:${Math.round((H - h) / 2) + nth * 40}px;width:${w}px;height:${h}px;object-fit:cover">`,
  );
  if (tid !== null) useStore.setState({ selection: { kind: 'el', file: f, tid } });
  return tid !== null;
}

/** What a motion piece takes: pictures and SVGs onto the scene under the playhead, like a slide. */
export const motionImport: ImportTarget = {
  accepts: ['image', 'drawing'],
  get what() {
    return t('motion.import.what');
  },
  run: async (picked) => {
    const files = filesOf(picked, 'image', 'drawing');
    let n = 0;
    for (const [i, f] of files.entries()) if (await placeOnScene(new File([f.bytes as Uint8Array<ArrayBuffer>], f.path.split('/').pop()!, { type: f.type }), i)) n++;
    if (!n) return t('motion.import.noScene');
    return n === 1 ? t('motion.import.placedOne', { name: files[0].path.split('/').pop() }) : t('motion.import.placedMany', { count: n });
  },
  board: {
    get what() {
      return t('motion.import.boardWhat');
    },
    place: (path, { size, moving, title }) => {
      const s = get();
      const view = s.motionView;
      if (!view?.scene) return t('motion.import.noScene');
      const f = sceneFile(view.scene);
      const src = display(s, f) ?? '';
      const root = rootElement(parsed(src));
      if (!root) return t('motion.import.noScene');
      const m = motionOf(s);
      const frame = m.formats[primaryFormat(m)]?.size ?? [1920, 1080];
      // an effect runs with the scene from its start, behind everything; a still artboard enters at the playhead like a picture
      const length = parseTime(sceneTiming(src).duration) ?? DEFAULT_SCENE_MS;
      const at = view.landed ? 0 : Math.max(0, Math.min(Math.round(view.at), length - 300));
      const { html, back } = boardEmbed(path, frame, size, moving, moving ? 'data-seek' : `data-seek data-in="fade 300ms @${formatTime(at)}"`);
      const tid = insertHtml(f, root.tid, back ? 'first' : 'last', html);
      if (tid === null) return t('motion.import.noScene');
      useStore.setState({ selection: { kind: 'el', file: f, tid } });
      return t('motion.import.boardPlaced', { title, scene: view.scene });
    },
  },
};

/** The note on the whole piece (motion.json `note`); empty removes it. */
export function setPieceNote(text: string): void {
  const body = text.slice(0, 4000);
  editMotion(
    (raw) => {
      if (body.trim()) raw.note = body;
      else delete raw.note;
    },
    t('motion.journal.pieceNote'),
  );
}

/** Scene ids in play order: `order` first (those with a file), the cover's scene is never among them. */
const orderIds = () => motionOf().order.slice();

/** A new scene after `after` (or at the end), in the look of its neighbour and laid out to the primary size. */
export function addScene(after: string | null = null): string {
  const m = motionOf();
  const ids = orderIds();
  const taken = sceneFiles().map((f) => sceneIdOf(f)!);
  const id = uniqueSlideId(taken, 'scene-' + (ids.length + 1));
  const neighbour = after ?? ids.at(-1) ?? null;
  const root = neighbour ? rootElement(parsed(display(get(), sceneFile(neighbour)) ?? '')) : undefined;
  const src = newSlideSource(id, { size: m.formats[primaryFormat(m)]?.size, like: root ? attr(root, 'style') : undefined, title: t('starter.sceneTitle'), body: t('starter.sceneHint') });
  edit(sceneFile(id), () => src.replace('<section ', `<section data-duration="${formatTime(DEFAULT_SCENE_MS)}" `), { actor: 'human', summary: t('motion.journal.sceneCreated'), undoable: false });
  editMotion((raw) => {
    const order = ids.slice();
    const at = after ? order.indexOf(after) + 1 : order.length;
    order.splice(at > 0 ? at : order.length, 0, id);
    raw.order = order;
  }, t('motion.journal.sceneAdded', { id }));
  return id;
}

export function duplicateScene(id: string): string | null {
  const src = display(get(), sceneFile(id));
  if (src === undefined) return null;
  const ids = orderIds();
  const copy = uniqueSlideId(sceneFiles().map((f) => sceneIdOf(f)!), id + '-copy');
  edit(sceneFile(copy), () => withSlideId(src, copy), { actor: 'human', summary: t('motion.journal.sceneDuplicated', { id }), undoable: false });
  editMotion((raw) => {
    const order = ids.slice();
    order.splice(order.indexOf(id) + 1, 0, copy);
    raw.order = order;
  }, t('motion.journal.sceneAdded', { id: copy }));
  return copy;
}

/** Take a scene out of the piece and delete its file. The last one stays. */
export async function deleteScene(id: string): Promise<void> {
  const ids = orderIds();
  if (ids.length <= 1) return void toast(t('motion.toast.lastScene'));
  editMotion((raw) => {
    raw.order = ids.filter((x) => x !== id);
    if (raw.cover === id) delete raw.cover;
  }, t('motion.journal.sceneRemoved', { id }));
  await deleteFile(sceneFile(id));
}

/** Move a scene one place earlier (-1) or later (1). */
export function moveScene(id: string, dir: -1 | 1): void {
  const order = orderIds();
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  editMotion((raw) => void (raw.order = order), t('motion.journal.sceneMoved', { id }));
}
