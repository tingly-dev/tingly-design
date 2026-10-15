import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_LOW, QUALITY_MEDIUM, WebMOutputFormat } from 'mediabunny';
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
  renderFrame(canvas: HTMLCanvasElement | OffscreenCanvas, ms: number, i: number): Promise<void> | void;
  /** The finished mix, if the piece has sound (see `mixAudio`). */
  audio?: AudioBuffer;
  onProgress?(done: number, total: number): void;
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
  note?: VideoNote;
}

export class NoEncoderError extends Error {
  constructor() {
    super('no-encoder');
    this.name = 'NoEncoderError';
  }
}

/** Frames in, a video file out: seek and paint each frame, encode with WebCodecs, mux in memory. */
export async function encodeVideo(o: VideoOptions): Promise<VideoResult> {
  const plan: VideoPlan | null = await planVideo({ width: o.width, height: o.height, sound: !!o.audio, format: o.format });
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
    if (audio && o.audio) await audio.add(o.audio);
    for (let i = 0; i < total; i++) {
      if (o.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const ms = (i * 1000) / o.fps;
      await o.renderFrame(canvas, ms, i);
      await video.add(i / o.fps, 1 / o.fps);
      o.onProgress?.(i + 1, total);
    }
    video.close();
    audio?.close();
    await out.finalize();
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
    note: plan.note,
  };
}
