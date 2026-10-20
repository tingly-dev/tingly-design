/**
 * What the motion exporter needs from outside its sandboxed frame, which has no
 * network: the project's fonts as inline CSS, and its audio files' bytes.
 */
import type { AudioClip } from '@dc/export';
import type { MotionJson } from '@dc/core';
import { frameFonts } from './motionImage';

export async function exportInputs(motion: MotionJson, scenes: Record<string, string>, base: string): Promise<{ fontCss: string; audio: AudioClip[] }> {
  const audio: AudioClip[] = [];
  for (const a of motion.audio) {
    if (!/^[A-Za-z0-9_./-]+$/.test(a.src) || a.src.includes('..')) continue;
    try {
      const r = await fetch(base + a.src);
      if (r.ok) audio.push({ data: await r.arrayBuffer(), start: a.start ?? 0, gain: a.gain ?? 0 });
    } catch {
      /* a missing file leaves the video without it; the checker reports missing audio */
    }
  }
  return { fontCss: await frameFonts(motion, scenes, base), audio };
}

/** Scenes the server's Chrome draws better when the machine has it: a video layer is not seeked in the browser, and an embed is drawn there from the picture its frame hands over (.design/export.md). */
export function exactScenes(scenes: Record<string, string>): string[] {
  return Object.entries(scenes)
    .filter(([, src]) => /<x-embed\b|<video\b/i.test(src))
    .map(([id]) => id);
}
