/**
 * Motion to video inside the page that plays it: seek the stage to each frame,
 * draw the stage's DOM onto a canvas (@dc/export rasterize), encode with WebCodecs.
 * Nothing leaves the browser. What a foreignObject cannot draw is reported, not
 * hidden: an <x-embed> is a separate frame and comes out blank.
 */
import { Clock, FrameRasterizer, canvasPng, encodeVideo, mixAudio, rasterize, type AudioClip, type Container, type VideoResult } from '@dc/export';
import type { MotionStage } from './motion';

// Built as its own file (dist/export.js) and loaded when someone exports, so the player doesn't carry the encoder.

export interface ExportRequest {
  format?: 'auto' | Container;
  /** Output pixels per pixel of the piece: 1 is the piece's own size, 0.5 half of it (a quarter of the pixels to draw and encode), 2 twice. The picture is vector, so a bigger size is sharper, not blown up. */
  scale?: number;
  /** @font-face CSS with the fonts inlined, built by the host (`fontCss`). */
  fontCss?: string;
  audio?: AudioClip[];
  onProgress?(done: number, total: number): void;
  signal?: AbortSignal;
}

export interface ExportOutcome extends VideoResult {
  /** Scenes holding an <x-embed>, which this route cannot draw. */
  embeds: string[];
}

export async function exportVideo(stage: MotionStage, root: HTMLElement, req: ExportRequest): Promise<ExportOutcome> {
  const clock = new Clock();
  const { width, height } = stage;
  const scale = Math.max(0.25, Math.min(3, req.scale ?? 1));
  // video sizes are even numbers
  const outWidth = Math.max(2, 2 * Math.round((width * scale) / 2));
  const outHeight = Math.max(2, 2 * Math.round((height * scale) / 2));
  const embeds = Array.from(new Set(Array.from(root.querySelectorAll('x-embed')).map((x) => x.closest<HTMLElement>('.dc-slide-host')?.dataset.scene ?? ''))).filter(Boolean);
  const audio = req.audio?.length ? await clock.time('audio', () => mixAudio(req.audio!, stage.duration / 1000)) : null;
  stage.pause();
  const fontEmbedCSS = req.fontCss ?? '';
  const rasterizer = new FrameRasterizer({ width, height, fontEmbedCSS, clock });
  let result: VideoResult;
  try {
    result = await encodeVideo({
      width: outWidth,
      height: outHeight,
      fps: stage.fps,
      duration: stage.duration,
      format: req.format,
      audio: audio ?? undefined,
      clock,
      signal: req.signal,
      onProgress: req.onProgress,
      async prepareFrame(ms) {
        await clock.time('seek', () => stage.seek(ms));
        return rasterizer.begin(root);
      },
    });
  } finally {
    rasterizer.dispose();
  }
  return { ...result, embeds };
}

/** A frame of the piece as a PNG: the picture at one moment, at the size on screen. */
export async function exportFrame(stage: MotionStage, root: HTMLElement, req: { t: number; scale?: number; fontCss?: string }): Promise<Blob> {
  stage.pause();
  await stage.seek(req.t);
  const canvas = await rasterize(root, { width: stage.width, height: stage.height, pixelRatio: Math.max(1, Math.min(3, req.scale ?? 1)), fontEmbedCSS: req.fontCss ?? '' });
  return canvasPng(canvas);
}

(window as unknown as { dcMotionExport: unknown }).dcMotionExport = { exportVideo, exportFrame };
