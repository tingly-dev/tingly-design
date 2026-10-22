export interface AudioClip {
  /** The file's bytes (mp3, wav, m4a, ogg… whatever the browser decodes). */
  data: ArrayBuffer;
  /** Where it starts in the video, seconds. */
  start: number;
  /** Decibels. */
  gain: number;
}

/**
 * The clips of a piece as one stereo track as long as the video: each delayed to its start and set to
 * its gain. `from` (seconds) makes the track start there on the piece's timeline, for a single scene:
 * a clip already playing at that moment is joined part-way in.
 */
export async function mixAudio(clips: AudioClip[], seconds: number, sampleRate = 48000, from = 0): Promise<AudioBuffer | null> {
  if (!clips.length || typeof OfflineAudioContext === 'undefined') return null;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * sampleRate)), sampleRate);
  for (const c of clips) {
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(c.data.slice(0));
    } catch {
      continue;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 10 ** (c.gain / 20);
    src.connect(gain).connect(ctx.destination);
    const at = c.start - from;
    if (at >= 0) src.start(at);
    else if (-at < buffer.duration) src.start(0, -at);
  }
  return ctx.startRendering();
}

/** Sample counts that add up to `seconds` of silence, a second each (the last one shorter). */
export function silentChunks(seconds: number, sampleRate = 48000): number[] {
  let left = Math.max(1, Math.ceil(seconds * sampleRate));
  const out: number[] = [];
  while (left > 0) {
    const n = Math.min(left, sampleRate);
    out.push(n);
    left -= n;
  }
  return out;
}
