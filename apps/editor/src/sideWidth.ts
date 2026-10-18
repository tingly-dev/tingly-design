/**
 * How wide each side column is, as the person left it (a drag on its edge). The width is a CSS
 * variable on the page (`--w-<id>`), which the column's rule reads with its old width as the
 * fallback, and a remembered number. See .design/chat-panel.md.
 */
import { readPref, writePref } from './local';

export const SIDES = {
  /** the conversation column on the left (default 340) */
  chat: { def: 340, min: 280, max: 560 },
  /** the right-hand panel of canvas, slides and motion */
  inspector: { def: 312, min: 260, max: 600 },
  /** the slide strip */
  strip: { def: 216, min: 150, max: 420 },
  /** a doc's tab list */
  doctabs: { def: 220, min: 160, max: 420 },
  /** a doc's comments */
  docrail: { def: 320, min: 240, max: 560 },
  /** a design system's navigation */
  dsnav: { def: 220, min: 160, max: 420 },
  /** a dashboard's data sources or code */
  dashside: { def: 400, min: 280, max: 720 },
} as const;

export type SideId = keyof typeof SIDES;

const key = (id: SideId) => `dc.w.${id}`;
const clamp = (id: SideId, px: number) => Math.round(Math.min(SIDES[id].max, Math.max(SIDES[id].min, px)));

/** The remembered width of a column, or its default. */
export function sideWidth(id: SideId): number {
  const n = Number(readPref(key(id)));
  return Number.isFinite(n) && n > 0 ? clamp(id, n) : SIDES[id].def;
}

function paint(id: SideId, px: number | null) {
  const root = document.documentElement.style;
  if (px === null) root.removeProperty(`--w-${id}`);
  else root.setProperty(`--w-${id}`, `${px}px`);
}

/** Put every remembered width on the page; a column nobody resized keeps its own CSS. */
export function applySideWidths(): void {
  for (const id of Object.keys(SIDES) as SideId[]) if (readPref(key(id))) paint(id, sideWidth(id));
}

/** Show a width while it is being dragged (nothing is remembered until `keepSideWidth`). */
export function dragSideWidth(id: SideId, px: number): number {
  const w = clamp(id, px);
  paint(id, w);
  return w;
}

export function keepSideWidth(id: SideId, px: number): void {
  writePref(key(id), String(clamp(id, px)));
}

/** Back to the column's own width. */
export function resetSideWidth(id: SideId): void {
  writePref(key(id), '');
  paint(id, null);
}
