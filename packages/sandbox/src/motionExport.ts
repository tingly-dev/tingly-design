/**
 * Motion to video inside the page that plays it: seek the stage to each frame,
 * draw the stage's DOM onto a canvas (@dc/export FrameRasterizer), encode with WebCodecs.
 * Nothing leaves the browser. An <x-embed> is a separate frame a foreignObject
 * cannot draw, so each one on screen is asked for a picture of itself first
 * (`snapFrames`); one that gives none is reported, not hidden.
 */
import { Clock, FrameRasterizer, canvasPng, encodeGif, encodeVideo, mixAudio, snapFrames, type AudioClip, type Container, type VideoResult } from '@dc/export';
import type { MotionStage } from './motion';

// Built as its own file (dist/export.js) and loaded when someone exports, so the player doesn't carry the encoder.

export interface ExportRequest {
  format?: 'auto' | Container | 'gif';
  /** Frame size of the file; the piece's own when left out. Same aspect ratio: the picture is drawn at this size, not stretched. */
  width?: number;
  height?: number;
  /** Frames per second of the file; the piece's own when left out. */
  fps?: number;
  /** Encoder effort: `high` by default. */
  quality?: 'low' | 'medium' | 'high';
  /** Only this stretch of the piece, in milliseconds on its timeline (after speed); the whole piece when left out. Sound is left out of a stretch. */
  from?: number;
  to?: number;
  /** @font-face CSS with the fonts inlined, built by the host (`fontCss`). */
  fontCss?: string;
  audio?: AudioClip[];
  /** What frame 0 shows when the whole piece goes to MP4 or WebM: a moment of the piece, or a cover scene already mounted (`mountCover`). A GIF loops, so it never gets one. */
  cover?: CoverSource;
  /** With `cover`: also make it frame 0 of the video. Off: the cover goes in only as the file's cover picture. */
  coverFirst?: boolean;
  onProgress?(done: number, total: number): void;
  signal?: AbortSignal;
}

/** The cover: a moment of the video (ms after speed), or a cover scene's own stage, drawn finished. */
export type CoverSource = { at: number } | { stage: MotionStage; root: HTMLElement };

export interface ExportOutcome extends Omit<VideoResult, 'container' | 'ext'> {
  container: Container | 'gif';
  ext: string;
  /** Scenes with an <x-embed> that gave no picture of itself, so it is blank in the file. */
  embeds: string[];
}

/** Whether the scene `id` is on screen at `ms` (video time): from its start until its transition into the next one ends. Unknown ids count as on screen. */
function onScreen(stage: MotionStage, id: string | undefined, ms: number): boolean {
  const at = ms * stage.speed;
  const w = stage.scenes.find((s) => s.id === id);
  if (!w) return true;
  const end = w.start + w.duration + w.transition.duration;
  // the last scene stays up on the piece's final instant (see the stage's setTime)
  return at >= w.start && (at < end || (w === stage.scenes[stage.scenes.length - 1] && at <= end));
}

/** Leaves out the scenes off screen at `ms()`: every scene stays mounted, hidden, and copying those made a frame cost the whole piece, not what it shows. */
const onlyOnScreen = (stage: MotionStage, ms: () => number) => (n: Node) => !(n instanceof HTMLElement && n.classList.contains('dc-slide-host') && !onScreen(stage, n.dataset.scene, ms()));

/**
 * Pictures of the embeds on screen at `ms` (video time), each taken by its own
 * frame. Scenes whose embed gave none go into `missed`.
 */
async function embedPictures(stage: MotionStage, root: HTMLElement, ms: number, missed?: Set<string>): Promise<Map<Element, string> | undefined> {
  const frames = Array.from(root.querySelectorAll<HTMLIFrameElement>('x-embed > iframe')).filter((f) => onScreen(stage, f.closest<HTMLElement>('.dc-slide-host')?.dataset.scene, ms));
  if (!frames.length) return undefined;
  const pics = await snapFrames(frames);
  if (missed) for (const f of frames) if (!pics.has(f)) missed.add(f.closest<HTMLElement>('.dc-slide-host')?.dataset.scene ?? '');
  return pics;
}

export async function exportVideo(stage: MotionStage, root: HTMLElement, req: ExportRequest): Promise<ExportOutcome> {
  const clock = new Clock();
  const outW = Math.max(2, Math.round(req.width ?? stage.width));
  const outH = Math.max(2, Math.round(req.height ?? stage.height));
  const missed = new Set<string>();
  const from = Math.max(0, req.from ?? 0);
  const to = Math.min(stage.duration, req.to ?? stage.duration);
  const whole = from === 0 && to >= stage.duration;
  const fps = Math.max(1, Math.min(120, req.fps ?? stage.fps));
  const audio = req.format !== 'gif' && req.audio?.length ? await clock.time('audio', () => mixAudio(req.audio!, (to - from) / 1000, 48000, from / 1000)) : null;
  stage.pause();
  // the picture is vector: it is drawn at the file's size, so a small file is not a big one scaled down and a big one is not blown up
  let now = 0;
  const rasterizer = new FrameRasterizer({ width: stage.width, height: stage.height, fontEmbedCSS: req.fontCss ?? '', filter: onlyOnScreen(stage, () => now), clock });
  const cover = whole && req.format !== 'gif' ? req.cover : undefined;
  /** The cover, drawn: a moment of the piece, or a cover scene already mounted at its end. */
  const coverFrame = async (c: CoverSource) => {
    if ('at' in c) {
      now = c.at;
      await clock.time('seek', () => stage.seek(c.at, { painted: false }));
    }
    const [st, holder] = 'at' in c ? [stage, root] : [c.stage, c.root];
    const pics = await clock.time('embeds', () => embedPictures(st, holder, 'at' in c ? c.at : c.stage.duration));
    return rasterizer.begin(holder, pics);
  };
  const prepare = async (ms: number, i = -1) => {
    if (i === 0 && cover && req.coverFirst) return coverFrame(cover);
    now = from + ms;
    // the copy reads computed styles, which hold the new time as soon as it is set; waiting for a paint only costs vsyncs
    await clock.time('seek', () => stage.seek(from + ms, { painted: false }));
    const pics = await clock.time('embeds', () => embedPictures(stage, root, from + ms, missed));
    return rasterizer.begin(root, pics);
  };
  const embeds = () => [...missed].filter(Boolean);
  try {
    if (req.format === 'gif') {
      const g = document.createElement('canvas');
      g.width = outW;
      g.height = outH;
      const ctx = g.getContext('2d', { willReadFrequently: true })!;
      const blob = await encodeGif({
        width: outW,
        height: outH,
        fps,
        duration: to - from,
        signal: req.signal,
        onProgress: req.onProgress,
        async renderFrame(ms) {
          const f = await prepare(ms);
          await clock.time('decode', () => f.ready);
          f.draw(g);
          return clock.time('encode', () => ctx.getImageData(0, 0, outW, outH));
        },
      });
      const frames = Math.max(1, Math.round(((to - from) / 1000) * fps));
      return { blob, container: 'gif', ext: 'gif', mime: 'image/gif', videoCodec: 'gif', audioCodec: null, frames, report: clock.report({ route: 'browser', frames, width: outW, height: outH }), embeds: embeds() };
    }
    // the cover also goes in as the file's cover picture, at the file's size
    let coverArt: Uint8Array | undefined;
    if (cover) {
      const art = document.createElement('canvas');
      art.width = outW;
      art.height = outH;
      const f = await coverFrame(cover);
      await f.ready;
      f.draw(art);
      coverArt = new Uint8Array(await (await canvasPng(art)).arrayBuffer());
    }
    const result = await encodeVideo({
      coverArt,
      width: outW,
      height: outH,
      fps,
      duration: to - from,
      format: req.format,
      quality: req.quality,
      audio: audio ?? undefined,
      clock,
      signal: req.signal,
      onProgress: req.onProgress,
      prepareFrame: prepare,
    });
    return { ...result, embeds: embeds() };
  } finally {
    rasterizer.dispose();
  }
}

/** The cover as a PNG: a moment of the piece, or a cover scene at its end. */
export function exportCover(stage: MotionStage, root: HTMLElement, cover: CoverSource, req: { scale?: number; fontCss?: string }): Promise<Blob> {
  return 'at' in cover ? exportFrame(stage, root, { ...req, t: cover.at }) : exportFrame(cover.stage, cover.root, { ...req, t: cover.stage.duration });
}

/** A frame of the piece as a PNG: the picture at one moment, at the size on screen. */
export async function exportFrame(stage: MotionStage, root: HTMLElement, req: { t: number; scale?: number; fontCss?: string }): Promise<Blob> {
  stage.pause();
  await stage.seek(req.t, { painted: false });
  const pics = await embedPictures(stage, root, req.t);
  const scale = Math.max(1, Math.min(3, req.scale ?? 1));
  const r = new FrameRasterizer({ width: stage.width, height: stage.height, fontEmbedCSS: req.fontCss ?? '', filter: onlyOnScreen(stage, () => req.t) });
  try {
    const f = await r.begin(root, pics);
    await f.ready;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(stage.width * scale);
    canvas.height = Math.round(stage.height * scale);
    f.draw(canvas);
    return canvasPng(canvas);
  } finally {
    r.dispose();
  }
}

(window as unknown as { dcMotionExport: unknown }).dcMotionExport = { exportVideo, exportFrame, exportCover };
