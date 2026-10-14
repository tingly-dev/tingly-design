/**
 * Motion to video inside the page that plays it: seek the stage to each frame,
 * draw the stage's DOM onto a canvas (@dc/export rasterize), encode with WebCodecs.
 * Nothing leaves the browser. What a foreignObject cannot draw is reported, not
 * hidden: an <x-embed> is a separate frame and comes out blank.
 */
import { encodeVideo, mixAudio, rasterize, type AudioClip, type Container, type VideoResult } from '@dc/export';
import type { MotionStage } from './motion';

// Built as its own file (dist/export.js) and loaded when someone exports, so the player doesn't carry the encoder.

export interface ExportRequest {
  format?: 'auto' | Container;
  /** Draw at this many pixels per pixel and scale down: sharper small type, slower. */
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
  const { width, height } = stage;
  const scale = Math.max(1, Math.min(3, req.scale ?? 1));
  const embeds = Array.from(new Set(Array.from(root.querySelectorAll('x-embed')).map((x) => x.closest<HTMLElement>('.dc-slide-host')?.dataset.scene ?? ''))).filter(Boolean);
  const audio = req.audio?.length ? await mixAudio(req.audio, stage.duration / 1000) : null;
  stage.pause();
  const fontEmbedCSS = req.fontCss ?? '';
  const result = await encodeVideo({
    width,
    height,
    fps: stage.fps,
    duration: stage.duration,
    format: req.format,
    audio: audio ?? undefined,
    signal: req.signal,
    onProgress: req.onProgress,
    async renderFrame(canvas, ms) {
      await stage.seek(ms);
      const shot = await rasterize(root, { width, height, pixelRatio: scale, fontEmbedCSS });
      const g = (canvas as HTMLCanvasElement).getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(shot, 0, 0, width, height);
    },
  });
  return { ...result, embeds };
}

(window as unknown as { dcMotionExport: unknown }).dcMotionExport = { exportVideo };
