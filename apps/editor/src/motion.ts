/**
 * Motion pieces in the editor: motion.json edits that keep what the file has,
 * the piece's formats (sizes), and where the stage stands.
 */
import { DEFAULT_SCENE_MS, MOTION_SIZES, MOTION_FILE, FORMAT_NAME_RE, formatTime, newCoverScene, snapSceneMs, uniqueSlideId, parseTime, sceneTiming, parseDc, parseMotion, primaryFormat, rootElement, sceneFile, sceneIdOf, type MotionJson } from '@dc/core';
import { api } from './api';
import { insertHtml } from './actions';
import { filesOf, type ImportTarget } from './components/ImportHere';
import { boardEmbed } from './boards';
import { display, edit, editElement, parsed, toast, useStore } from './store';
import { t } from './i18n';

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

/** Common sizes, named the way motion.json names formats; each is labelled by `motion.preset.<name>`. */
export const FORMAT_PRESETS = MOTION_SIZES.map((p) => ({ name: p.name, size: [...p.size] as [number, number] }));

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
  return editMotion((raw) => void (formatsOf(raw)[name] = { size }), t('motion.journal.formatAdded', { name }));
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

/** The piece goes back to showing its first frame; the cover's scene file stays, in case it comes back. */
export function removeCover(): void {
  editMotion((raw) => void delete raw.cover, t('motion.journal.coverRemoved'));
}

/** A scene's own length and the file's id, for the stage when the playhead is on it. */
export function sceneSource(id: string): string | undefined {
  return display(get(), sceneFile(id));
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
