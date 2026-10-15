import { boardFilesFor } from '@dc/core';
import { useMemo } from 'react';
import { display, useStore } from './store';

/**
 * Artboards imported from a canvas into a slide or a scene (see
 * .design/import-from-project.md): the markup that puts one on the page, and
 * the artboard files a frame needs to draw the embeds of the pages it shows.
 */

/**
 * An `<x-embed src>` for an imported artboard on a page of `frame` size. One
 * that moves is an effect: it fills the page and goes behind everything
 * (`back`). A still one sits in the middle, at most 60% of the page, keeping
 * its shape. `extra` is attributes to add (`data-seek`, `data-in`).
 */
export function boardEmbed(path: string, frame: [number, number], size: [number, number], moving: boolean, extra = ''): { html: string; back: boolean } {
  const [W, H] = frame;
  const box = moving
    ? { left: 0, top: 0, w: W, h: H }
    : (() => {
        const k = Math.min(1, (W * 0.6) / size[0], (H * 0.6) / size[1]);
        const w = Math.round(size[0] * k);
        const h = Math.round(size[1] * k);
        return { left: Math.round((W - w) / 2), top: Math.round((H - h) / 2), w, h };
      })();
  const src = path.replace(/"/g, '&quot;');
  return {
    html: `<x-embed src="${src}"${extra ? ' ' + extra : ''} style="position:absolute;left:${box.left}px;top:${box.top}px;width:${box.w}px;height:${box.h}px"></x-embed>`,
    back: moving,
  };
}

/** The artboard files the embeds in these page files need, kept stable while none of them changes. */
export function useBoardFiles(pages: string[]): Record<string, string> {
  const key = useStore((s) => {
    const files = boardFilesFor(
      pages.map((p) => display(s, p)),
      (p) => display(s, p),
    );
    return JSON.stringify(files);
  });
  return useMemo(() => JSON.parse(key) as Record<string, string>, [key]);
}
