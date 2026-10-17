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

/**
 * Pictures of the embeds on screen at `ms` (video time), each taken by its own
 * frame. Scenes whose embed gave none go into `missed`.
 */
async function embedPictures(stage: MotionStage, root: HTMLElement, ms: number, missed?: Set<string>): Promise<Map<Element, string> | undefined> {
  const at = ms * stage.speed;
  const frames = Array.from(root.querySelectorAll<HTMLIFrameElement>('x-embed > iframe')).filter((f) => {
    const id = f.closest<HTMLElement>('.dc-slide-host')?.dataset.scene;
    const w = stage.scenes.find((s) => s.id === id);
    // a scene is on screen from its start until its transition into the next one ends
    return !w || (at >= w.start && at < w.start + w.duration + w.transition.duration);
  });
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
  const audio = req.format !== 'gif' && whole && req.audio?.length ? await clock.time('audio', () => mixAudio(req.audio!, stage.duration / 1000)) : null;
  stage.pause();
  // the picture is vector: it is drawn at the file's size, so a small file is not a big one scaled down and a big one is not blown up
  const rasterizer = new FrameRasterizer({ width: stage.width, height: stage.height, fontEmbedCSS: req.fontCss ?? '', clock });
  const cover = whole && req.format !== 'gif' ? req.cover : undefined;
  const prepare = async (ms: number, i = -1) => {
    if (i === 0 && cover && 'root' in cover) {
      const pics = await clock.time('embeds', () => embedPictures(cover.stage, cover.root, cover.stage.duration));
      return rasterizer.begin(cover.root, pics);
    }
    if (i === 0 && cover && 'at' in cover) ms = cover.at;
    await clock.time('seek', () => stage.seek(from + ms));
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
    const result = await encodeVideo({
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
  await stage.seek(req.t);
  const pics = await embedPictures(stage, root, req.t);
  const scale = Math.max(1, Math.min(3, req.scale ?? 1));
  const r = new FrameRasterizer({ width: stage.width, height: stage.height, fontEmbedCSS: req.fontCss ?? '' });
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
