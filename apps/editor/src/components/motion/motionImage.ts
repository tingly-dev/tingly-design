/**
 * What a motion frame needs from outside its sandboxed frame, which has no network:
 * the project's web fonts as inline CSS, built for the characters the scenes use.
 */
import { fontCss } from '@dc/export';
import type { MotionJson } from '@dc/core';

const textOf = (scenes: Record<string, string>) => Object.values(scenes).map((s) => s.replace(/<[^>]*>/g, ' ')).join(' ');

export function frameFonts(motion: MotionJson, scenes: Record<string, string>, base: string): Promise<string> {
  const sources = Object.values(motion.faces).flatMap((f): (string | { family: string; url: string })[] =>
    f.href && /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(f.href) ? [f.href] : f.src && /^[A-Za-z0-9_./-]+$/.test(f.src) && !f.src.includes('..') ? [{ family: f.family, url: base + f.src }] : [],
  );
  return fontCss(sources, textOf(scenes));
}
