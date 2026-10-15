/**
 * A frame of a motion piece as a PNG, drawn inside the page that plays it: seek the stage to the
 * moment, draw its DOM onto a canvas (@dc/export rasterize). Built as its own file (dist/export.js)
 * and loaded on first use, so the player doesn't carry the picture code. What a foreignObject cannot
 * draw (an <x-embed> is a separate frame, a <video> layer) comes out blank.
 */
import { canvasPng, rasterize } from '@dc/export';
import type { MotionStage } from './motion';

export async function exportFrame(stage: MotionStage, root: HTMLElement, req: { t: number; scale?: number; fontCss?: string }): Promise<Blob> {
  stage.pause();
  await stage.seek(req.t);
  const canvas = await rasterize(root, { width: stage.width, height: stage.height, pixelRatio: Math.max(1, Math.min(3, req.scale ?? 1)), fontEmbedCSS: req.fontCss ?? '' });
  return canvasPng(canvas);
}

(window as unknown as { dcMotionExport: unknown }).dcMotionExport = { exportFrame };
