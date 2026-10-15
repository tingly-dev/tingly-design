/// <reference path="./shims.d.ts" />
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

export interface GifOptions {
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** Paints frame `i` and returns its pixels. */
  renderFrame(ms: number, i: number): Promise<ImageData> | ImageData;
  /** Palette colours; 256 is the most a GIF holds. */
  colors?: number;
  loop?: boolean;
  onProgress?(done: number, total: number): void;
  signal?: AbortSignal;
}

/** Frames in, a GIF out. A GIF is 256 colours a frame, so use it for small, short loops, not for the master. */
export async function encodeGif(o: GifOptions): Promise<Blob> {
  const gif = GIFEncoder();
  const total = Math.max(1, Math.round((o.duration / 1000) * o.fps));
  const delay = Math.round(1000 / o.fps);
  for (let i = 0; i < total; i++) {
    if (o.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const { data } = await o.renderFrame((i * 1000) / o.fps, i);
    const palette = quantize(data, o.colors ?? 256, { format: 'rgb565' });
    gif.writeFrame(applyPalette(data, palette, 'rgb565'), o.width, o.height, { palette, delay, repeat: o.loop === false ? -1 : 0 });
    o.onProgress?.(i + 1, total);
  }
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
}
