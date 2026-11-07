/**
 * Animated GIFs on the motion clock. A GIF in a scene is a clip: it starts when
 * its element comes on screen and shows the frame that moment calls for, so
 * seeking, scrubbing, the exact renderer, the HTML player and every export draw
 * the same picture (an `<img>` left alone would play on the wall clock).
 * The file and the scene's `src` are untouched; only what the `<img>` draws is
 * swapped, and `clear()` puts the address back (see .design/gif-images.md).
 */
import { composeGif, gifFrameAt, parseGif, type GifPlay } from '@dc/core';

interface Clip {
  /** each frame, composed, as a PNG address */
  urls: string[];
  delays: number[];
  loops: number;
}

/** What the page could not do for a GIF; the author reads it with the scene's other notes. */
export interface GifIssue {
  index: number;
  level: 'warning';
  message: string;
}

const GIF_SRC = /\.gif(?:[?#]|$)|^data:image\/gif[;,]/i;
const KEPT = 6;
const clips = new Map<string, Promise<Clip>>();

/** Decode once per address: a scene redrawn while editing asks again for the same picture. */
function clipOf(src: string): Promise<Clip> {
  let p = clips.get(src);
  if (p) return p;
  p = build(src);
  clips.set(src, p);
  p.catch(() => clips.delete(src));
  for (const old of [...clips.keys()].slice(0, Math.max(0, clips.size - KEPT))) clips.delete(old);
  return p;
}

async function build(src: string): Promise<Clip> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let info;
  try {
    info = parseGif(bytes);
  } catch (e) {
    // a file this decoder cannot follow may still be one the browser draws (it then plays on its own); one it cannot draw is broken
    const playable = (e as { code?: string }).code === 'too-large' || (await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/gif' })).then((b) => (b.close(), true), () => false));
    throw Object.assign(e as Error, { playable });
  }
  const canvas = document.createElement('canvas');
  canvas.width = info.width;
  canvas.height = info.height;
  const g = canvas.getContext('2d')!;
  const urls: string[] = [];
  const delays: number[] = [];
  for (const f of composeGif(info)) {
    g.putImageData(new ImageData(f.rgba as Uint8ClampedArray<ArrayBuffer>, info.width, info.height), 0, 0);
    urls.push(canvas.toDataURL('image/png'));
    delays.push(f.delay);
    // let the page breathe between frames of a long one
    if (urls.length % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return { urls, delays, loops: info.loops };
}

const wording = (e: unknown) => {
  const { code, playable } = e as { code?: string; playable?: boolean };
  if (!code) return `could not be loaded (${e instanceof Error ? e.message : String(e)})`;
  if (!playable) return 'is damaged or not a picture the browser can draw';
  return code === 'too-large' ? 'is too large to follow the timeline (it plays on its own, out of step)' : 'cannot be read to follow the timeline (it plays on its own, out of step)';
};

export interface GifSync {
  /** every GIF decoded (or given up on); the notes about those that failed are in `issues` by then */
  ready: Promise<void>;
  issues: GifIssue[];
  /** show time `t` on the timeline the scene sits on */
  setTime(t: number): void;
  /** the frames set by the last `setTime` are decoded by the page, so a copy of it draws them */
  pending(): Promise<void>;
  clear(): void;
}

/**
 * `els` are the scene's elements (the list the scene's plan indexes into), `start` where the scene begins on the
 * timeline, `from` when each element comes on screen after that.
 */
export function syncGifs(els: Element[], start: number, from: (el: Element) => number): GifSync {
  let last: number | null = null;
  const issues: GifIssue[] = [];
  const live: { el: HTMLImageElement; src: string; clip: Clip; at: number; play: GifPlay; shown: number }[] = [];
  const found = els.flatMap((el, index) => {
    const src = el.tagName === 'IMG' ? (el.getAttribute('src') ?? '') : '';
    return GIF_SRC.test(src) && !src.includes('{{') ? [{ el: el as HTMLImageElement, index, src }] : [];
  });
  let waiting: Promise<unknown>[] = [];
  let gone = false;
  const ready = Promise.all(
    found.map(async ({ el, index, src }) => {
      try {
        const clip = await clipOf(src);
        if (gone || clip.urls.length < 2) return;
        const mode = el.getAttribute('data-gif');
        live.push({ el, src, clip, at: start + from(el), play: mode === 'loop' || mode === 'once' ? mode : 'file', shown: -1 });
      } catch (e) {
        issues.push({ index, level: 'warning', message: `GIF ${wording(e)}` });
      }
    }),
  ).then(() => {
    // the playhead may have moved while they were being read: draw what it shows now
    if (last !== null && !gone) show(last);
  });
  const show = (t: number) => {
    for (const g of live) {
      const k = gifFrameAt(g.clip.delays, g.clip.loops, t - g.at, g.play);
      if (k === g.shown) continue;
      g.shown = k;
      g.el.src = g.clip.urls[k];
      waiting.push(g.el.decode().catch(() => undefined));
    }
  };
  return {
    ready,
    issues,
    setTime(t) {
      last = t;
      show(t);
    },
    async pending() {
      const w = waiting;
      waiting = [];
      await Promise.all(w);
    },
    clear() {
      gone = true;
      for (const g of live) g.el.src = g.src;
      live.length = 0;
      last = null;
    },
  };
}
