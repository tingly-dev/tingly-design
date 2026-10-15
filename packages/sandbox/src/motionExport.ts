/**
 * Motion to video inside the page that plays it: seek the stage to each frame,
 * draw the stage's DOM onto a canvas (@dc/export rasterize), encode with WebCodecs.
 * Nothing leaves the browser. What a foreignObject cannot draw is reported, not
 * hidden: an <x-embed> is a separate frame and comes out blank.
 */
import { canvasPng, encodeGif, encodeVideo, mixAudio, rasterize, type AudioClip, type Container, type VideoResult } from '@dc/export';
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
  /** Draw at this many pixels per pixel and scale down: sharper small type, slower. */
  scale?: number;
  /** @font-face CSS with the fonts inlined, built by the host (`fontCss`). */
  fontCss?: string;
  audio?: AudioClip[];
  onProgress?(done: number, total: number): void;
  signal?: AbortSignal;
}

export interface ExportOutcome extends Omit<VideoResult, 'container' | 'ext'> {
  container: Container | 'gif';
  ext: string;
  /** Scenes holding an <x-embed>, which this route cannot draw. */
  embeds: string[];
}

export async function exportVideo(stage: MotionStage, root: HTMLElement, req: ExportRequest): Promise<ExportOutcome> {
  const outW = Math.max(2, Math.round(req.width ?? stage.width));
  const outH = Math.max(2, Math.round(req.height ?? stage.height));
  // drawn at least at the piece's own size, and bigger when the file is: a small file is the large drawing scaled down
  const scale = Math.max(1, Math.min(3, req.scale ?? 1, Math.max(1, outW / stage.width)));
  const embeds = Array.from(new Set(Array.from(root.querySelectorAll('x-embed')).map((x) => x.closest<HTMLElement>('.dc-slide-host')?.dataset.scene ?? ''))).filter(Boolean);
  const from = Math.max(0, req.from ?? 0);
  const to = Math.min(stage.duration, req.to ?? stage.duration);
  const whole = from === 0 && to >= stage.duration;
  const fps = Math.max(1, Math.min(120, req.fps ?? stage.fps));
  const audio = req.format !== 'gif' && whole && req.audio?.length ? await mixAudio(req.audio, stage.duration / 1000) : null;
  stage.pause();
  const fontEmbedCSS = req.fontCss ?? '';
  const draw = async (ms: number) => {
    await stage.seek(from + ms);
    return rasterize(root, { width: stage.width, height: stage.height, pixelRatio: scale, fontEmbedCSS });
  };
  if (req.format === 'gif') {
    const g = document.createElement('canvas');
    g.width = outW;
    g.height = outH;
    const ctx = g.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    const blob = await encodeGif({
      width: outW,
      height: outH,
      fps,
      duration: to - from,
      signal: req.signal,
      onProgress: req.onProgress,
      async renderFrame(ms) {
        ctx.drawImage(await draw(ms), 0, 0, outW, outH);
        return ctx.getImageData(0, 0, outW, outH);
      },
    });
    return { blob, container: 'gif', ext: 'gif', mime: 'image/gif', videoCodec: 'gif', audioCodec: null, frames: Math.max(1, Math.round(((to - from) / 1000) * fps)), embeds };
  }
  const result = await encodeVideo({
    width: outW,
    height: outH,
    fps,
    duration: to - from,
    format: req.format,
    quality: req.quality,
    audio: audio ?? undefined,
    signal: req.signal,
    onProgress: req.onProgress,
    async renderFrame(canvas, ms) {
      const shot = await draw(ms);
      const g = (canvas as HTMLCanvasElement).getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(shot, 0, 0, outW, outH);
    },
  });
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
