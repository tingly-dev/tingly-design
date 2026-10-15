import { canEncodeAudio, canEncodeVideo, getFirstEncodableVideoCodec, type AudioCodec, type VideoCodec } from 'mediabunny';

export type Container = 'mp4' | 'webm';

/** Why a video came out as it did, for a person to read: the editor says it in words. */
export type VideoNote = 'no-h264' | 'no-aac';

export interface VideoPlan {
  container: Container;
  videoCodec: VideoCodec;
  /** Every video carries an audio track (silent when the piece has no sound): some platforms refuse a file without one. `null` only when this browser cannot write sound into the container. */
  audioCodec: AudioCodec | null;
  /** Set when this is not what was asked for (MP4) or the best (MP4 with sound). */
  note?: VideoNote;
}

/** WebM codecs in the order we would rather have them: VP9 is the best supported, AV1 the newest. */
const WEBM_VIDEO: VideoCodec[] = ['vp9', 'av1', 'vp8'];

export function hasWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * What this browser can write for a video of this size, by trying the encoders
 * (not by reading the user agent). MP4 is H.264 + AAC (a piece without sound gets a silent track), the file every player and
 * social app takes; WebM is VP9 (else AV1, VP8) + Opus, which every WebCodecs
 * browser can encode. `format: 'auto'` gives MP4 where it can and WebM otherwise.
 */
export async function planVideo(opts: { width: number; height: number; format?: 'auto' | Container }): Promise<VideoPlan | null> {
  if (!hasWebCodecs()) return null;
  const { width, height } = opts;
  const want = opts.format ?? 'auto';
  let note: VideoNote | undefined;
  if (want !== 'webm') {
    const avc = await canEncodeVideo('avc', { width, height });
    const aac = await canEncodeAudio('aac');
    if (avc && aac) return { container: 'mp4', videoCodec: 'avc', audioCodec: 'aac' };
    note = avc ? 'no-aac' : 'no-h264';
  }
  const videoCodec = await getFirstEncodableVideoCodec(WEBM_VIDEO, { width, height });
  if (!videoCodec) return null;
  const audioCodec: AudioCodec | null = (await canEncodeAudio('opus')) ? 'opus' : null;
  return { container: 'webm', videoCodec, audioCodec, note: want === 'webm' ? undefined : note };
}
