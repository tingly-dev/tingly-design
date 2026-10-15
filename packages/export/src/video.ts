import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_LOW, QUALITY_MEDIUM, WebMOutputFormat } from 'mediabunny';
import type { Frame } from './frames';
import { Clock, type ExportReport } from './timing';
import { silentChunks } from './audio';
import { planVideo, type Container, type VideoNote, type VideoPlan } from './capabilities';

export interface VideoOptions {
  /** Output size in pixels. */
  width: number;
  height: number;
  fps: number;
  /** Milliseconds of video. */
  duration: number;
  format?: 'auto' | Container;
  /** How much bitrate to spend: `high` (the default) keeps fine text clean, `low` makes the smallest file. */
  quality?: 'low' | 'medium' | 'high';
  /** Paints frame `i` (video time `ms`) onto `canvas`, which is `width` × `height`. */
  renderFrame?(canvas: HTMLCanvasElement | OffscreenCanvas, ms: number, i: number): Promise<void> | void;
  /**
   * Instead of `renderFrame`: does the part of frame `i` that needs the page to stand still (seek, copy the tree)
   * and returns a frame that finishes by itself. The next frame is prepared while the browser decodes this one and
   * the encoder takes the one before, so a frame costs the longest of the three, not their sum.
   */
  prepareFrame?(ms: number, i: number): Promise<Frame>;
  /** The finished mix, if the piece has sound (see `mixAudio`). Without it the file gets a silent track of the same length. */
  audio?: AudioBuffer;
  onProgress?(done: number, total: number): void;
  /** Collects the time of each stage; `renderFrame` times its own stages (seek, raster, paint) on the same clock; encoding and finishing are timed here. */
  clock?: Clock;
  signal?: AbortSignal;
}

export interface VideoResult {
  blob: Blob;
  container: Container;
  ext: string;
  mime: string;
  videoCodec: string;
  audioCodec: string | null;
  frames: number;
  report: ExportReport;
  note?: VideoNote;
}

export class NoEncoderError extends Error {
  constructor() {
    super('no-encoder');
    this.name = 'NoEncoderError';
  }
}

/** An empty stereo track as long as the video, a second at a time so a long piece does not hold the whole silence in memory. */
async function addSilence(source: AudioBufferSource, seconds: number, sampleRate = 48000): Promise<void> {
  for (const length of silentChunks(seconds, sampleRate)) await source.add(new AudioBuffer({ length, sampleRate, numberOfChannels: 2 }));
}

/** Frames in, a video file out: seek and paint each frame, encode with WebCodecs, mux in memory. */
export async function encodeVideo(o: VideoOptions): Promise<VideoResult> {
  const clock = o.clock ?? new Clock();
  const plan: VideoPlan | null = await planVideo({ width: o.width, height: o.height, format: o.format });
  if (!plan) throw new NoEncoderError();
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(o.width, o.height) : Object.assign(document.createElement('canvas'), { width: o.width, height: o.height });
  const target = new BufferTarget();
  const out = new Output({ format: plan.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target });
  const quality = { low: QUALITY_LOW, medium: QUALITY_MEDIUM, high: QUALITY_HIGH }[o.quality ?? 'high'];
  const video = new CanvasSource(canvas, { codec: plan.videoCodec, quality, keyFrameInterval: 2 });
  out.addVideoTrack(video, { frameRate: o.fps });
  const audio = o.audio && plan.audioCodec ? new AudioBufferSource({ codec: plan.audioCodec, quality: QUALITY_HIGH }) : null;
  if (audio) out.addAudioTrack(audio);
  const total = Math.max(1, Math.round((o.duration / 1000) * o.fps));
  try {
    await out.start();
    if (audio) await (o.audio ? audio.add(o.audio) : addSilence(audio, o.duration / 1000));
    // the frame prepared last, waiting for the browser to decode it; and the encoder's answer to the frame before
    let waiting: { frame: Frame; i: number } | null = null;
    let encoding: Promise<void> = Promise.resolve();
    const finishFrame = async () => {
      if (!waiting) return;
      const { frame, i } = waiting;
      waiting = null;
      await clock.time('decode', () => frame.ready);
      await clock.time('encode', () => encoding);
      frame.draw(canvas);
      // the encoder has taken a copy of the canvas by the time add() returns its promise, so the next frame may be drawn right away
      encoding = video.add(i / o.fps, 1 / o.fps);
      encoding.catch(() => {});
      o.onProgress?.(i + 1, total);
    };
    for (let i = 0; i < total; i++) {
      if (o.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const ms = (i * 1000) / o.fps;
      if (o.prepareFrame) {
        const frame = await o.prepareFrame(ms, i);
        await finishFrame();
        waiting = { frame, i };
      } else {
        await o.renderFrame!(canvas, ms, i);
        await clock.time('encode', () => video.add(i / o.fps, 1 / o.fps));
        o.onProgress?.(i + 1, total);
      }
    }
    await finishFrame();
    await clock.time('encode', () => encoding);
    video.close();
    audio?.close();
    await clock.time('finish', () => out.finalize());
  } catch (e) {
    await out.cancel().catch(() => {});
    throw e;
  }
  const mime = plan.container === 'mp4' ? 'video/mp4' : 'video/webm';
  return {
    blob: new Blob([target.buffer!], { type: mime }),
    container: plan.container,
    ext: plan.container,
    mime,
    videoCodec: plan.videoCodec,
    audioCodec: plan.audioCodec,
    frames: total,
    report: clock.report({ route: 'browser', frames: total, width: o.width, height: o.height }),
    note: plan.note,
  };
}
