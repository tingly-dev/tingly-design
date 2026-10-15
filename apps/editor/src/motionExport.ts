/**
 * What the motion exporter needs from outside its sandboxed frame, which has no
 * network: the project's fonts as inline CSS, and its audio files' bytes.
 */
import { fontCss, type AudioClip } from '@dc/export';
import type { MotionJson } from '@dc/core';

const textOf = (scenes: Record<string, string>) => Object.values(scenes).map((s) => s.replace(/<[^>]*>/g, ' ')).join(' ');

export async function exportInputs(motion: MotionJson, scenes: Record<string, string>, base: string): Promise<{ fontCss: string; audio: AudioClip[] }> {
  const sources = Object.values(motion.faces).flatMap((f): (string | { family: string; url: string })[] =>
    f.href && /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(f.href) ? [f.href] : f.src && /^[A-Za-z0-9_./-]+$/.test(f.src) && !f.src.includes('..') ? [{ family: f.family, url: base + f.src }] : [],
  );
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
  return { fontCss: await fontCss(sources, textOf(scenes)), audio };
}

/** Scenes a browser export draws wrongly: an embed is a separate frame and a video layer is not seeked. These go to the server's Chrome. */
export function exactScenes(scenes: Record<string, string>): string[] {
  return Object.entries(scenes)
    .filter(([, src]) => /<x-embed\b|<video\b/i.test(src))
    .map(([id]) => id);
}
