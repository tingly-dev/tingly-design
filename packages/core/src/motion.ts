/**
 * Motion projects (phase 0 spike, see .design/motion.md): `motion.json` plus
 * one `scenes/<id>.html` per scene, each a slide-subset `<section>` whose
 * timing lives in attributes:
 *
 *   data-duration="6s"                         on the section: the scene's length
 *   data-transition="fade 500ms"               on the section: how it leaves
 *   data-in="rise 500ms @0.2s ease-out"        on an element: how and when it enters
 *   data-out="fade 300ms @5.4s"                on an element: how and when it leaves
 *   data-keys="x: 0@0 120@2s ease-in-out; scale: 1@2s 1.2@3s"
 *   data-<format>="flex-direction:column"      declarations that differ in one format
 *   data-only="wide square"                    formats the element appears in
 *
 * Everything here is pure: it turns attributes into Web Animations plans the
 * sandbox runtime applies, so the editor, the HTML player and the renderer
 * share one interpretation of the source.
 */
import type { DeckFace } from './deck';
import type { HumanOp } from './ops';
import { attr, type DcDoc, type DcElement } from './parse';
import { checkSlide, type SlideIssue } from './slides';
import { parseStyle } from './style';

export const MOTION_FILE = 'motion.json';

export interface MotionFormat {
  size: [number, number];
}

export interface MotionAudio {
  src: string;
  /** Seconds into the video where the file starts. */
  start?: number;
  /** Decibels. */
  gain?: number;
}

export interface MotionJson {
  v: 1;
  title: string;
  /** The first entry is the primary format. */
  formats: Record<string, MotionFormat>;
  fps: number;
  order: string[];
  audio: MotionAudio[];
  faces: Record<string, DeckFace>;
  loop?: boolean;
  background?: string;
  /**
   * Playback rate over the authored timing: 1.5 plays every scene, entrance and
   * pause 1.5× faster. Timing attributes stay at reading pace; this is the one knob.
   */
  speed?: number;
  /** The still that stands for the video: a frame of it, or a scene file outside `order` drawn with no timing. */
  cover?: MotionCover;
  /** Put the cover in the video's first frame too, so players and chat apps that thumbnail frame 0 show it. Default true. */
  coverFirstFrame?: boolean;
}

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

/** A usable speed, or 1. */
export function speedOf(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, n)) : 1;
}

export type MotionCover = { at: number } | { scene: string };

const SCENE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `"2.2s"` → a frame of the video; `"poster"` → `scenes/poster.html`. */
export function parseCover(v: unknown): MotionCover | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const t = parseTime(v);
  if (t != null) return t >= 0 ? { at: t } : undefined;
  return SCENE_ID_RE.test(v.trim()) ? { scene: v.trim() } : undefined;
}

export const FORMAT_NAME_RE = /^[a-z][a-z0-9]{0,15}$/;

/** motion.json and scenes/<id>.html: the files a motion project is made of. */
export function isMotionFile(path: string): boolean {
  return path === MOTION_FILE || /^scenes\/[a-z0-9][a-z0-9-]{0,63}\.html$/.test(path);
}

/** A new motion project: one 16:9 title scene. */
export function newMotion(title: string, hint = 'Edit scenes/*.html with Claude Code; timing goes on data-in, data-out and data-keys.'): { motion: MotionJson; scenes: Record<string, string> } {
  const safe = title.replace(/[<&>]/g, '');
  return {
    motion: { v: 1, title, formats: { wide: { size: [1920, 1080] } }, fps: 30, order: ['title'], audio: [], faces: {} },
    scenes: {
      title:
        `<section id="title" data-duration="4s" style="background:#14161c;color:#f4f1ea;font-family:'Noto Sans SC', Arial, sans-serif;padding:128px;display:flex;flex-direction:column;justify-content:center;gap:32px">\n` +
        `<h1 data-in="rise 700ms" style="font-size:112px;font-weight:800;line-height:1.05">${safe}</h1>\n` +
        `<p data-in="fade 600ms" style="font-size:40px;color:#a9a59c">${hint.replace(/[<&>]/g, '')}</p>\n` +
        `</section>\n`,
    },
  };
}

export function sceneFile(id: string): string {
  return `scenes/${id}.html`;
}

export function sceneIdOf(path: string): string | null {
  const m = /^scenes\/([A-Za-z0-9_-]{1,64})\.html$/.exec(path);
  return m ? m[1] : null;
}

export function parseMotion(text: string | undefined): MotionJson {
  let raw: Partial<MotionJson> = {};
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    raw = {};
  }
  const formats: Record<string, MotionFormat> = {};
  for (const [name, f] of Object.entries(raw.formats ?? {})) {
    const size = (f as MotionFormat)?.size;
    if (!FORMAT_NAME_RE.test(name) || !Array.isArray(size)) continue;
    const [w, h] = size.map(Number);
    if (w > 0 && h > 0 && w <= 7680 && h <= 7680) formats[name] = { size: [Math.round(w), Math.round(h)] };
  }
  if (!Object.keys(formats).length) formats.wide = { size: [1920, 1080] };
  const fps = Number(raw.fps);
  return {
    v: 1,
    title: typeof raw.title === 'string' ? raw.title : 'Untitled',
    formats,
    fps: fps >= 1 && fps <= 120 ? fps : 30,
    order: Array.isArray(raw.order) ? raw.order.filter((s): s is string => typeof s === 'string') : [],
    audio: Array.isArray(raw.audio) ? raw.audio.filter((a) => a && typeof a.src === 'string') : [],
    faces: raw.faces && typeof raw.faces === 'object' ? raw.faces : {},
    loop: raw.loop === true || undefined,
    background: typeof raw.background === 'string' ? raw.background : undefined,
    speed: raw.speed == null || speedOf(raw.speed) === 1 ? undefined : speedOf(raw.speed),
    cover: parseCover(raw.cover),
    coverFirstFrame: raw.coverFirstFrame === false ? false : undefined,
  };
}

export function primaryFormat(m: MotionJson): string {
  return Object.keys(m.formats)[0];
}

// ------------------------------------------------------------------ time

/** "500ms", "0.5s", "1.2" (seconds) → milliseconds; null when it isn't a time. */
export function parseTime(v: string | undefined): number | null {
  if (v == null) return null;
  const m = /^(-?\d+(?:\.\d+)?|-?\.\d+)(ms|s)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Math.round(m[2] === 'ms' ? n : n * 1000);
}

export function formatTime(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : ms < 1000 ? `${ms}ms` : `${+(ms / 1000).toFixed(3)}s`;
}

const EASINGS: Record<string, string> = {
  linear: 'linear',
  ease: 'ease',
  'ease-in': 'ease-in',
  'ease-out': 'ease-out',
  'ease-in-out': 'ease-in-out',
  // named curves that read better than numbers
  smooth: 'cubic-bezier(.2,.8,.2,1)',
  snap: 'cubic-bezier(.7,0,.2,1)',
  spring: 'cubic-bezier(.3,1.6,.5,1)',
};

/** A CSS easing for a token, or null. Accepts the names above, cubic-bezier(…) and steps(…), written without spaces. */
export function easingOf(token: string): string | null {
  if (EASINGS[token]) return EASINGS[token];
  if (/^cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/.test(token)) return token;
  if (/^steps\(\s*\d+\s*(,\s*(start|end|jump-none|jump-both|jump-start|jump-end)\s*)?\)$/.test(token)) return token;
  return null;
}

// ------------------------------------------------------------------ presets

export const MOTION_PRESETS = ['fade', 'rise', 'drop', 'left', 'right', 'scale', 'pop', 'zoom', 'slam', 'spin', 'blur', 'wipe', 'type', 'count'] as const;
export type MotionPreset = (typeof MOTION_PRESETS)[number];

export const DEFAULT_ANIM_MS = 500;
/** Elements entering with no `@start` are staggered in source order from here. */
export const AUTO_START_MS = 200;
export const AUTO_STAGGER_MS = 150;

export interface AnimSpec {
  preset: MotionPreset;
  duration: number;
  /** Relative to the scene; null = automatic. */
  start: number | null;
  easing: string;
}

/** `<preset> [duration] [@start] [easing]`, in any order after the preset. */
export function parseAnim(v: string | undefined, dir: 'in' | 'out'): AnimSpec | { error: string } | null {
  if (v == null || !v.trim()) return null;
  const [preset, ...rest] = v.trim().split(/\s+/);
  if (!(MOTION_PRESETS as readonly string[]).includes(preset)) return { error: `unknown preset "${preset}"` };
  const spec: AnimSpec = {
    preset: preset as MotionPreset,
    duration: DEFAULT_ANIM_MS,
    start: null,
    easing: preset === 'pop' || preset === 'slam' || preset === 'spin' ? EASINGS.spring : dir === 'in' ? 'ease-out' : 'ease-in',
  };
  // a slam lands on the beat, so it is short by default
  if (preset === 'slam') spec.duration = 350;
  if (preset === 'type' || preset === 'count') spec.duration = 1000;
  for (const tok of rest) {
    if (tok.startsWith('@')) {
      const t = parseTime(tok.slice(1));
      if (t == null || t < 0) return { error: `bad start "${tok}"` };
      spec.start = t;
      continue;
    }
    const t = parseTime(tok);
    if (t != null) {
      if (t <= 0) return { error: `bad duration "${tok}"` };
      spec.duration = t;
      continue;
    }
    const e = easingOf(tok);
    if (e) spec.easing = e;
    else return { error: `unknown word "${tok}"` };
  }
  return spec;
}

/** The hidden state a preset animates from (in) or to (out). */
function presetHidden(preset: MotionPreset): Record<string, string> {
  switch (preset) {
    case 'rise':
      return { opacity: '0', translate: '0px 48px' };
    case 'drop':
      return { opacity: '0', translate: '0px -48px' };
    case 'left':
      return { opacity: '0', translate: '-96px 0px' };
    case 'right':
      return { opacity: '0', translate: '96px 0px' };
    case 'scale':
      return { opacity: '0', scale: '0.85' };
    case 'pop':
      return { opacity: '0', scale: '0.4' };
    case 'zoom':
      return { opacity: '0', scale: '1.3' };
    case 'slam':
      return { opacity: '0', scale: '2.4' };
    case 'spin':
      return { opacity: '0', scale: '0.5', rotate: '-20deg' };
    case 'blur':
      return { opacity: '0', filter: 'blur(24px)' };
    case 'wipe':
    case 'type':
      return { clipPath: 'inset(0px 100% 0px 0px)' };
    default:
      return { opacity: '0' };
  }
}

function presetShown(preset: MotionPreset): Record<string, string> {
  const hidden = presetHidden(preset);
  const shown: Record<string, string> = {};
  for (const k of Object.keys(hidden)) {
    shown[k] = k === 'opacity' ? '1' : k === 'translate' ? '0px 0px' : k === 'scale' ? '1' : k === 'rotate' ? '0deg' : k === 'filter' ? 'blur(0px)' : 'inset(0px 0% 0px 0px)';
  }
  return shown;
}

// ------------------------------------------------------------------ keyframes

export const KEY_PROPS = ['x', 'y', 'scale', 'rotate', 'opacity'] as const;
export type KeyProp = (typeof KEY_PROPS)[number];

export interface Key {
  t: number;
  v: number;
  /** Easing of the segment that arrives at this key. */
  easing?: string;
}

export interface KeyTrack {
  prop: KeyProp;
  keys: Key[];
}

/** `x: 0@0 120@2s ease-in-out; scale: 1@2s 1.2@3s` */
export function parseKeys(v: string | undefined): KeyTrack[] | { error: string } {
  const out: KeyTrack[] = [];
  if (!v?.trim()) return out;
  for (const part of v.split(';')) {
    if (!part.trim()) continue;
    const m = /^\s*([a-z]+)\s*:(.*)$/.exec(part);
    if (!m) return { error: `bad track "${part.trim()}"` };
    const prop = m[1] as KeyProp;
    if (!(KEY_PROPS as readonly string[]).includes(prop)) return { error: `unknown property "${m[1]}"` };
    const keys: Key[] = [];
    for (const tok of m[2].trim().split(/\s+/)) {
      const km = /^(-?[\d.]+)(?:deg|px)?@(.+)$/.exec(tok);
      if (km) {
        const t = parseTime(km[2]);
        if (t == null || t < 0 || Number.isNaN(Number(km[1]))) return { error: `bad key "${tok}"` };
        keys.push({ t, v: Number(km[1]) });
        continue;
      }
      const e = easingOf(tok);
      if (e && keys.length) keys[keys.length - 1].easing = e;
      else return { error: `bad key "${tok}"` };
    }
    if (keys.length < 2) return { error: `track "${prop}" needs at least two keys` };
    for (let i = 1; i < keys.length; i++) if (keys[i].t < keys[i - 1].t) return { error: `track "${prop}" goes back in time` };
    out.push({ prop, keys });
  }
  return out;
}

function keyValue(prop: KeyProp, v: number): Record<string, string> {
  switch (prop) {
    case 'x':
      return { translate: `${v}px 0px` };
    case 'y':
      return { translate: `0px ${v}px` };
    case 'rotate':
      return { rotate: `${v}deg` };
    case 'scale':
      return { scale: String(v) };
    default:
      return { opacity: String(v) };
  }
}

// ------------------------------------------------------------------ plans

/** One Web Animations call: `el.animate(keyframes, {delay, duration, easing, fill:'both', composite})`. */
export interface AnimPlan {
  /** Index into the elements passed in. */
  index: number;
  kind: 'in' | 'out' | 'keys' | 'count';
  keyframes: Record<string, string | number>[];
  /** Milliseconds from the start of the scene. */
  delay: number;
  duration: number;
  easing: string;
  composite: 'replace' | 'add';
}

export interface MotionIssue {
  index: number;
  level: 'error' | 'warning';
  message: string;
}

export interface SceneElement {
  attrs: Record<string, string>;
  /** Text content, for `type`, `count` and the reading-time check. */
  text?: string;
  tag?: string;
}

export interface ScenePlan {
  plans: AnimPlan[];
  issues: MotionIssue[];
  /** When each element is on screen, relative to the scene. */
  visible: { index: number; from: number; to: number }[];
}

/** Text shorter than this on screen is flagged: nobody can read it. */
export const MIN_READ_MS = 800;

/**
 * Plan a scene's animations. `elements[0]` is the `<section>` (its
 * `data-keys` is the camera); the rest are its descendants in source order.
 */
export function planScene(elements: SceneElement[], sceneDuration: number): ScenePlan {
  const plans: AnimPlan[] = [];
  const issues: MotionIssue[] = [];
  const visible: ScenePlan['visible'] = [];
  let auto = 0;
  elements.forEach((el, index) => {
    const a = el.attrs;
    const inSpec = parseAnim(a['data-in'], 'in');
    const outSpec = parseAnim(a['data-out'], 'out');
    let from = 0;
    let to = sceneDuration;
    if (inSpec && 'error' in inSpec) issues.push({ index, level: 'error', message: `data-in: ${inSpec.error}` });
    else if (inSpec) {
      const start = inSpec.start ?? AUTO_START_MS + AUTO_STAGGER_MS * auto++;
      from = start;
      if (inSpec.preset === 'count') {
        plans.push({ index, kind: 'count', keyframes: [], delay: start, duration: inSpec.duration, easing: inSpec.easing, composite: 'replace' });
      } else {
        const easing = inSpec.preset === 'type' ? `steps(${Math.max(1, (el.text ?? '').trim().length)}, end)` : inSpec.easing;
        plans.push({
          index,
          kind: 'in',
          keyframes: [presetHidden(inSpec.preset), presetShown(inSpec.preset)],
          delay: start,
          duration: inSpec.duration,
          easing,
          composite: 'replace',
        });
      }
    }
    if (outSpec && 'error' in outSpec) issues.push({ index, level: 'error', message: `data-out: ${outSpec.error}` });
    else if (outSpec) {
      const preset = outSpec.preset === 'count' || outSpec.preset === 'type' ? 'fade' : outSpec.preset;
      const start = outSpec.start ?? Math.max(0, sceneDuration - outSpec.duration);
      to = start + outSpec.duration;
      if (start < from) issues.push({ index, level: 'error', message: `leaves at ${formatTime(start)}, before it enters at ${formatTime(from)}` });
      plans.push({
        index,
        kind: 'out',
        keyframes: [presetShown(preset), presetHidden(preset)],
        delay: start,
        duration: outSpec.duration,
        easing: outSpec.easing,
        composite: 'replace',
      });
    }
    const tracks = parseKeys(a['data-keys']);
    if ('error' in tracks) issues.push({ index, level: 'error', message: `data-keys: ${tracks.error}` });
    else {
      const xs = tracks.find((t) => t.prop === 'x');
      const ys = tracks.find((t) => t.prop === 'y');
      for (const tr of tracks) {
        if (tr.prop === 'y' && xs) continue; // folded into the x track
        const both = tr.prop === 'x' && ys ? ys : null;
        const keys: (Key & { w?: number })[] = both ? mergeXY(tr.keys, both.keys) : tr.keys;
        const k0 = keys[0].t;
        const len = Math.max(1, keys[keys.length - 1].t - k0);
        plans.push({
          index,
          kind: 'keys',
          keyframes: keys.map((k, i) => ({
            ...(both ? { translate: `${k.v}px ${k.w ?? 0}px` } : keyValue(tr.prop, k.v)),
            offset: (k.t - k0) / len,
            // WAAPI eases the segment leaving a keyframe; ours is written on the key it arrives at
            ...(keys[i + 1]?.easing ? { easing: keys[i + 1].easing! } : {}),
          })),
          delay: k0,
          duration: len,
          easing: 'linear',
          composite: tr.prop === 'opacity' ? 'replace' : 'add',
        });
      }
    }
    if (el.text?.trim() && el.tag !== 'section' && (inSpec || outSpec) && to - from < MIN_READ_MS) {
      issues.push({ index, level: 'warning', message: `text is on screen for ${formatTime(Math.max(0, to - from))}, under ${formatTime(MIN_READ_MS)}` });
    }
    if (el.tag === 'x-embed' && !('data-seek' in a)) {
      issues.push({ index, level: 'warning', message: 'embed has no data-seek: it plays in preview but cannot be exported' });
    }
    visible.push({ index, from, to });
  });
  return { plans, issues, visible };
}

/** x and y keys sampled on the union of their times, linearly in between. `v` = x, `w` = y. */
function mergeXY(xs: Key[], ys: Key[]): (Key & { w: number })[] {
  const times = [...new Set([...xs, ...ys].map((k) => k.t))].sort((a, b) => a - b);
  const at = (keys: Key[], t: number) => {
    if (t <= keys[0].t) return keys[0].v;
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i].t) {
        const p = (t - keys[i - 1].t) / Math.max(1, keys[i].t - keys[i - 1].t);
        return keys[i - 1].v + (keys[i].v - keys[i - 1].v) * p;
      }
    }
    return keys[keys.length - 1].v;
  };
  return times.map((t) => ({ t, v: at(xs, t), w: at(ys, t), easing: xs.find((k) => k.t === t)?.easing ?? ys.find((k) => k.t === t)?.easing }));
}

// ------------------------------------------------------------------ count

/** "1,284", "$3.5M", "99.9%": the number in a text, with what surrounds it. */
export function countParts(text: string): { prefix: string; value: number; decimals: number; grouped: boolean; suffix: string } | null {
  const m = /^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/s.exec(text);
  if (!m) return null;
  const digits = m[2];
  return {
    prefix: m[1],
    value: Number(digits.replace(/,/g, '')),
    decimals: digits.includes('.') ? digits.split('.')[1].length : 0,
    grouped: digits.includes(','),
    suffix: m[3],
  };
}

/** The text of a `count` element at progress `p` (0 to 1, already eased). */
export function countText(text: string, p: number): string {
  const parts = countParts(text);
  if (!parts) return text;
  const n = parts.value * Math.min(1, Math.max(0, p));
  let s = n.toFixed(parts.decimals);
  if (parts.grouped) {
    const [i, d] = s.split('.');
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : '');
  }
  return parts.prefix + s + parts.suffix;
}

/** Progress through an easing, for the few things the runtime steps by hand (`count`). */
export function easeProgress(easing: string, p: number): number {
  const x = Math.min(1, Math.max(0, p));
  if (easing === 'linear') return x;
  if (easing === 'ease-in') return x * x * x;
  if (easing === 'ease-in-out') return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  return 1 - Math.pow(1 - x, 3); // ease-out and the rest
}

// ------------------------------------------------------------------ formats

/**
 * The attributes an element has in one format: `style` with that format's
 * `data-<format>` declarations merged over it, and timing overrides such as
 * `data-in-<format>`. Null when `data-only` leaves the element out.
 */
export function attrsForFormat(attrs: Record<string, string>, format: string, formats: string[]): Record<string, string> | null {
  const only = attrs['data-only'];
  if (only != null && only.trim() && !only.trim().split(/\s+/).includes(format)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    const m = /^data-(in|out|keys|duration|transition)-([a-z][a-z0-9]*)$/.exec(k);
    if (m && formats.includes(m[2])) continue;
    if (k.startsWith('data-') && formats.includes(k.slice(5))) continue;
    out[k] = v;
  }
  const over = attrs[`data-${format}`];
  if (over) out.style = mergeStyle(attrs.style ?? '', over);
  for (const p of ['in', 'out', 'keys', 'duration', 'transition']) {
    const v = attrs[`data-${p}-${format}`];
    if (v != null) out[`data-${p}`] = v;
  }
  return out;
}

/**
 * `over` (a `data-<format>` value) with `set` applied: a value replaces or adds
 * a declaration, null drops it so the shared value shows again. Null when
 * nothing is left.
 */
export function setOverride(over: string, set: Record<string, string | null>): string | null {
  const decls = parseStyle(over)
    .filter((d) => d.prop)
    .map((d) => [d.prop, d.value] as [string, string]);
  for (const [prop, value] of Object.entries(set)) {
    const i = decls.findIndex(([p]) => p === prop);
    if (value === null) {
      if (i >= 0) decls.splice(i, 1);
    } else if (i >= 0) decls[i][1] = value;
    else decls.push([prop, value]);
  }
  return decls.length ? decls.map(([p, v]) => `${p}:${v}`).join(';') : null;
}

/**
 * Edits made while a scene is shown in a format other than the primary one:
 * style changes go to that format's override (`data-<format>`), everything
 * else (text, structure, timing) stays shared.
 */
export function editsForFormat(ops: HumanOp[], doc: DcDoc, format: string): HumanOp[] {
  const name = `data-${format}`;
  const pending = new Map<number, string | null>();
  const out: HumanOp[] = [];
  for (const op of ops) {
    if (op.kind !== 'styles' && op.kind !== 'style') {
      out.push(op);
      continue;
    }
    const el = doc.elements[op.tid];
    if (!el) continue;
    const set = op.kind === 'styles' ? op.set : { [op.prop]: op.value };
    const before = pending.has(op.tid) ? pending.get(op.tid)! : (attr(el, name) ?? null);
    const next = setOverride(before ?? '', set);
    pending.set(op.tid, next);
  }
  for (const [tid, value] of pending) out.push({ kind: 'attr', tid, name, value });
  return out;
}

/** The style an element shows in a format: `style` with its `data-<format>` merged over it. */
export function styleInFormat(attrs: { style?: string } & Record<string, string | undefined>, format: string | null): string {
  const base = attrs.style ?? '';
  const over = format ? attrs[`data-${format}`] : undefined;
  return over ? mergeStyle(base, over) : base;
}

/** `base` with every declaration in `over` replacing or added after it. */
export function mergeStyle(base: string, over: string): string {
  const extra = parseStyle(over).filter((d) => d.prop);
  const props = new Set(extra.map((d) => d.prop));
  const kept = parseStyle(base)
    .filter((d) => d.prop && !props.has(d.prop))
    .map((d) => `${d.prop}:${d.value}`);
  return [...kept, ...extra.map((d) => `${d.prop}:${d.value}`)].join(';');
}

// ------------------------------------------------------------------ timeline

export const TRANSITION_KINDS = ['cut', 'fade', 'push', 'magic'] as const;
export const DEFAULT_SCENE_MS = 4000;
export const DEFAULT_TRANSITION_MS = 500;

export interface SceneWindow {
  id: string;
  /** Milliseconds from the start of the video. */
  start: number;
  duration: number;
  /** How this scene leaves, overlapping the next one by `transition.duration`. */
  transition: { kind: (typeof TRANSITION_KINDS)[number]; duration: number };
}

export function parseTransition(v: string | undefined): SceneWindow['transition'] {
  const [kind, dur] = (v ?? '').trim().split(/\s+/);
  if (!kind || !(TRANSITION_KINDS as readonly string[]).includes(kind) || kind === 'cut') return { kind: 'cut', duration: 0 };
  const d = parseTime(dur);
  return { kind: kind as SceneWindow['transition']['kind'], duration: d != null && d > 0 ? d : DEFAULT_TRANSITION_MS };
}

/** A scene file's own timing, read from its <section> tag without a DOM. */
export function sceneTiming(source: string): { duration?: string; transition?: string } {
  const tag = /<section\b[^>]*>/i.exec(source)?.[0] ?? '';
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1];
  return { duration: attr('data-duration'), transition: attr('data-transition') };
}

/** Lay the scenes end to end, each next one starting as the previous one's transition begins. */
export function motionTimeline(scenes: { id: string; duration?: string; transition?: string }[]): { scenes: SceneWindow[]; duration: number } {
  const out: SceneWindow[] = [];
  let t = 0;
  scenes.forEach((s, i) => {
    const d = parseTime(s.duration);
    const duration = d != null && d > 0 ? d : DEFAULT_SCENE_MS;
    const tr = i < scenes.length - 1 ? parseTransition(s.transition) : { kind: 'cut' as const, duration: 0 };
    tr.duration = Math.min(tr.duration, duration / 2);
    out.push({ id: s.id, start: t, duration, transition: tr });
    t += duration - tr.duration;
  });
  const last = out[out.length - 1];
  return { scenes: out, duration: last ? last.start + last.duration : 0 };
}

/** Base CSS for a scene of any size (the slide subset's rules, sized to the format). */
export function sceneBaseCss(w: number, h: number, css: string): string {
  return css.replace(/width:1920px;height:1080px/g, `width:${w}px;height:${h}px`);
}

/**
 * A scene file checked as the editor and fast AI see it: the slide subset
 * (motion transitions take a duration, so the slide rule for them is left
 * out) and the timing rules, each tied to the element it is about.
 */
export function checkScene(doc: DcDoc, id: string, duration?: number): SlideIssue[] {
  const out = checkSlide(doc, id).filter((i) => !i.message.startsWith('data-transition is'));
  const section = doc.elements.find((e) => e.tag === 'section' && !e.parent);
  if (!section) return out;
  const tr = attr(section, 'data-transition');
  if (tr && !(TRANSITION_KINDS as readonly string[]).includes(tr.trim().split(/\s+/)[0])) out.push({ tid: section.tid, level: 'error', message: `data-transition is cut, fade, push or magic, not "${tr}".` });
  const els = doc.elements.filter((e) => e === section || within(e, section));
  const plan = planScene(
    els.map((e) => ({ tag: e.tag, attrs: Object.fromEntries(e.attrs.map((a) => [a.name, a.value])), text: e.children.some((c) => c.kind === 'el') ? undefined : e.children.map((c) => (c.kind === 'text' ? c.text : '')).join('') })),
    duration ?? parseTime(attr(section, 'data-duration')) ?? DEFAULT_SCENE_MS,
  );
  for (const i of plan.issues) out.push({ tid: els[i.index].tid, level: i.level, message: `<${els[i.index].tag}> ${i.message}` });
  return out;
}

function within(el: DcElement, root: DcElement): boolean {
  for (let p = el.parent; p; p = p.parent) if (p === root) return true;
  return false;
}

/**
 * When each element of a scene file is on screen, in one format: tid → its
 * window relative to the scene. The section itself is always on screen.
 */
export function sceneVisibility(
  doc: DcDoc,
  format: string,
  formats: string[],
): { duration: number; windows: Map<number, { from: number; to: number }>; settled: number } {
  const section = doc.elements.find((e) => e.tag === 'section' && !e.parent);
  const windows = new Map<number, { from: number; to: number }>();
  if (!section) return { duration: DEFAULT_SCENE_MS, windows, settled: 0 };
  const shown: { el: DcElement; attrs: Record<string, string> }[] = [];
  for (const e of doc.elements) {
    if (e !== section && !within(e, section)) continue;
    let gone = false;
    for (let p: DcElement | null = e; p; p = p.parent) if (!attrsForFormat(Object.fromEntries(p.attrs.map((a) => [a.name, a.value])), format, formats)) gone = true;
    if (gone) continue;
    shown.push({ el: e, attrs: attrsForFormat(Object.fromEntries(e.attrs.map((a) => [a.name, a.value])), format, formats)! });
  }
  const duration = parseTime(shown[0]?.attrs['data-duration']) ?? DEFAULT_SCENE_MS;
  const plan = planScene(
    shown.map(({ el, attrs }) => ({ tag: el.tag, attrs, text: el.children.some((c) => c.kind === 'el') ? undefined : el.children.map((c) => (c.kind === 'text' ? c.text : '')).join('') })),
    duration,
  );
  for (const v of plan.visible) windows.set(shown[v.index].el.tid, { from: v.from, to: v.to });
  // the moment everything has arrived and nothing has left yet: where an editor lands on a scene
  let arrived = 0;
  let leaving = duration;
  for (const p of plan.plans) {
    if (p.kind === 'in' || p.kind === 'count') arrived = Math.max(arrived, p.delay + p.duration);
    if (p.kind === 'out') leaving = Math.min(leaving, p.delay);
  }
  const settled = Math.max(0, Math.min(arrived, leaving - 1, duration - 1));
  return { duration, windows, settled };
}
