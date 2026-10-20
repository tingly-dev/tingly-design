/**
 * What a motion frame needs from outside its sandboxed frame, which has no network:
 * the project's web fonts as inline CSS, built for the characters the scenes use.
 */
import { fontCss } from '@dc/export';
import type { MotionJson } from '@dc/core';

/**
 * Every character the scenes can show: their text with entities decoded (a style's `content:` included),
 * in both cases for a `text-transform`. Fonts are cut to these characters, so one left out is set in the fallback face.
 */
function textOf(scenes: Record<string, string>): string {
  const text = Object.values(scenes)
    .map((s) => new DOMParser().parseFromString(s, 'text/html').documentElement.textContent ?? '')
    .join(' ');
  return [...new Set(text + text.toUpperCase() + text.toLowerCase())].join('');
}

export function frameFonts(motion: MotionJson, scenes: Record<string, string>, base: string): Promise<string> {
  const sources = Object.values(motion.faces).flatMap((f): (string | { family: string; url: string })[] =>
    f.href && /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(f.href) ? [f.href] : f.src && /^[A-Za-z0-9_./-]+$/.test(f.src) && !f.src.includes('..') ? [{ family: f.family, url: base + f.src }] : [],
  );
  return fontCss(sources, textOf(scenes));
}
