/**
 * Motion pieces in the editor: motion.json edits that keep what the file has,
 * the piece's formats (sizes), and where the stage stands.
 */
import { MOTION_FILE, FORMAT_NAME_RE, parseDc, parseMotion, sceneFile, sceneIdOf, type MotionJson } from '@dc/core';
import { display, edit, editElement, toast, useStore } from './store';

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
        throw new Error('motion.json 不是合法的 JSON，先修好它再改');
      }
      mutate(raw);
      return JSON.stringify(raw, null, 2) + '\n';
    },
    { actor: 'human', summary, undoable: true },
  );
}

/** Common sizes, named the way motion.json names formats. */
export const FORMAT_PRESETS: { name: string; label: string; size: [number, number] }[] = [
  { name: 'wide', label: '横版 16:9', size: [1920, 1080] },
  { name: 'tall', label: '竖版 9:16', size: [1080, 1920] },
  { name: 'square', label: '方形 1:1', size: [1080, 1080] },
  { name: 'portrait', label: '竖图 4:5', size: [1080, 1350] },
];

const formatsOf = (raw: Record<string, unknown>) => ((raw.formats ??= {}) as Record<string, { size: [number, number] }>);

export function setFormatSize(name: string, size: [number, number]): void {
  const [w, h] = size.map((v) => Math.round(v));
  if (!(w > 0 && h > 0 && w <= 7680 && h <= 7680)) return void toast('尺寸要在 1 到 7680 像素之间。', 'error');
  editMotion((raw) => {
    const f = formatsOf(raw);
    f[name] = { ...(f[name] ?? {}), size: [w, h] };
  }, `format ${name} → ${w}×${h}`);
}

/** Add a format (a new size of the same piece); it starts with no overrides. */
export function addFormat(name: string, size: [number, number]): boolean {
  const m = motionOf();
  if (!FORMAT_NAME_RE.test(name)) {
    toast('尺寸的名字用小写字母开头，只含小写字母和数字，最多 16 个字符。', 'error');
    return false;
  }
  if (m.formats[name]) {
    toast(`已经有叫 ${name} 的尺寸了。`, 'error');
    return false;
  }
  return editMotion((raw) => void (formatsOf(raw)[name] = { size }), `format ${name} added`);
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
  editMotion((raw) => void delete formatsOf(raw)[name], `format ${name} removed`);
  const view = get().motionView;
  if (view?.format === name) useStore.setState({ motionView: { ...view, format: names[0] } });
}

/** A scene's own length and the file's id, for the stage when the playhead is on it. */
export function sceneSource(id: string): string | undefined {
  return display(get(), sceneFile(id));
}
