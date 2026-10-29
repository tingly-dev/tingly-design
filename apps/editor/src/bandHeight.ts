/**
 * How tall each resizable band is, as the person left it (a drag on its bottom edge): the
 * counterpart of `sideWidth.ts` for the rows under a canvas of content. The height is a CSS
 * variable on the page (`--h-<id>`) that the band's rule reads with its default as the fallback,
 * and a remembered number. A band keeps its height whatever it holds, so what is on screen
 * never jumps when the content changes. See .design/side-columns.md.
 */
import { readPref, writePref } from './local';

export const BANDS = {
  /** motion's element rows under the scene blocks */
  motionlanes: { def: 132, min: 44, max: 360 },
} as const;

export type BandId = keyof typeof BANDS;

const key = (id: BandId) => `dc.h.${id}`;
const clamp = (id: BandId, px: number) => Math.round(Math.min(BANDS[id].max, Math.max(BANDS[id].min, px)));

/** The remembered height of a band, or its default. */
export function bandHeight(id: BandId): number {
  const n = Number(readPref(key(id)));
  return Number.isFinite(n) && n > 0 ? clamp(id, n) : BANDS[id].def;
}

function paint(id: BandId, px: number | null) {
  const root = document.documentElement.style;
  if (px === null) root.removeProperty(`--h-${id}`);
  else root.setProperty(`--h-${id}`, `${px}px`);
}

/** Put every remembered height on the page; a band nobody resized keeps its own CSS. */
export function applyBandHeights(): void {
  for (const id of Object.keys(BANDS) as BandId[]) if (readPref(key(id))) paint(id, bandHeight(id));
}

/** Show a height while it is being dragged (nothing is remembered until `keepBandHeight`). */
export function dragBandHeight(id: BandId, px: number): number {
  const h = clamp(id, px);
  paint(id, h);
  return h;
}

export function keepBandHeight(id: BandId, px: number): void {
  writePref(key(id), String(clamp(id, px)));
}

/** Put back what is saved (or the band's own height when nothing is), after a drag that was not kept. */
export function restoreBandHeight(id: BandId): number {
  paint(id, readPref(key(id)) ? bandHeight(id) : null);
  return bandHeight(id);
}

/** Back to the band's own height. */
export function resetBandHeight(id: BandId): void {
  writePref(key(id), '');
  paint(id, null);
}
