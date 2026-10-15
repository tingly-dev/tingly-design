export interface AudioClip {
  /** The file's bytes (mp3, wav, m4a, ogg… whatever the browser decodes). */
  data: ArrayBuffer;
  /** Where it starts in the video, seconds. */
  start: number;
  /** Decibels. */
  gain: number;
}

/** The clips of a piece as one stereo track as long as the video: each delayed to its start and set to its gain. */
export async function mixAudio(clips: AudioClip[], seconds: number, sampleRate = 48000): Promise<AudioBuffer | null> {
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
    src.start(Math.max(0, c.start));
  }
  return ctx.startRendering();
}
