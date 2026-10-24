/**
 * A slide deck: `deck.json` plus one `slides/<id>.html` per slide, the file
 * layout of the original Slides type (there under `project/`). Each slide file
 * is exactly one `<section id="<id>" …>` on the deck’s canvas (1920×1080 by default), written in
 * a closed subset of HTML and inline CSS (see `slides.ts`).
 */

import { validSize } from './boardSizes';
import { HIDE_CSS } from './layers';

export const DECK_FILE = 'deck.json';
export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

export interface DeckSection {
  description: string;
  start: string;
}

export interface DeckFace {
  family: string;
  href?: string;
  src?: string;
}

export interface DeckJson {
  v: number;
  title: string;
  /** Omitted in older decks, which use 1920×1080. */
  size?: [number, number];
  order: string[];
  sections: Record<string, DeckSection>;
  cover?: string;
  faces: Record<string, DeckFace>;
  designSystems: unknown[];
  [k: string]: unknown;
}

export type ProjectKind = 'design' | 'slides' | 'design-system' | 'dashboard' | 'docs' | 'motion';

export const SLIDE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isSlideId(id: string): boolean {
  return SLIDE_ID_RE.test(id);
}

export function slideFile(id: string): string {
  return `slides/${id}.html`;
}

export function isSlideFile(path: string): boolean {
  return /^slides\/[A-Za-z0-9_-]{1,64}\.html$/.test(path);
}

export function slideIdOf(path: string): string | null {
  const m = /^slides\/([A-Za-z0-9_-]{1,64})\.html$/.exec(path);
  return m ? m[1] : null;
}

/** Which editor a project needs, from the files it holds. */
export function projectKind(files: Iterable<string>): ProjectKind | null {
  let design = false;
  let ds = false;
  for (const f of files) {
    if (f === DECK_FILE) return 'slides';
    if (f === 'dash.json') return 'dashboard';
    if (f === 'doc.json') return 'docs';
    if (f === 'motion.json') return 'motion';
    if (f === 'canvas.json') design = true;
    if (f === 'design-system.json') ds = true;
  }
  return design ? 'design' : ds ? 'design-system' : null;
}

export function parseDeck(text: string | undefined): DeckJson {
  let raw: Partial<DeckJson> = {};
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    raw = {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const order = Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === 'string' && isSlideId(id)) : [];
  const sections: Record<string, DeckSection> = {};
  if (raw.sections && typeof raw.sections === 'object') {
    for (const [k, s] of Object.entries(raw.sections)) {
      if (s && typeof s === 'object' && typeof s.start === 'string') sections[k] = { ...s, description: String(s.description ?? '') };
    }
  }
  const faces: Record<string, DeckFace> = {};
  if (raw.faces && typeof raw.faces === 'object') {
    for (const [k, f] of Object.entries(raw.faces)) {
      if (f && typeof f === 'object' && typeof f.family === 'string') faces[k] = f;
    }
  }
  return {
    ...raw,
    size: validSize(raw.size) ?? undefined,
    v: raw.v ?? 4,
    title: typeof raw.title === 'string' ? raw.title : 'Untitled deck',
    order: [...new Set(order)],
    sections,
    faces,
    designSystems: Array.isArray(raw.designSystems) ? raw.designSystems : [],
  };
}

/** Every slide in a deck uses this size; existing decks retain their original dimensions. */
export function deckSize(deck: Pick<DeckJson, 'size'>): [number, number] {
  return validSize(deck.size) ?? [SLIDE_W, SLIDE_H];
}

export function stringifyDeck(d: DeckJson): string {
  return JSON.stringify(d, null, 2) + '\n';
}

/** Slide ids in deck order: `order` first (those with a file), then files `order` leaves out. */
export function deckOrder(deck: DeckJson, files: Iterable<string>): string[] {
  const have = new Set<string>();
  for (const f of files) {
    const id = slideIdOf(f);
    if (id) have.add(id);
  }
  const out = deck.order.filter((id) => have.has(id));
  for (const id of [...have].sort()) if (!out.includes(id)) out.push(id);
  return out;
}

/** The section each slide falls in: a section runs from its `start` to the next section's start. */
export function sectionsOf(deck: DeckJson, ids: string[]): { key: string; description: string; ids: string[] }[] {
  const starts = new Map<string, { key: string; description: string }>();
  for (const [key, s] of Object.entries(deck.sections)) if (ids.includes(s.start)) starts.set(s.start, { key, description: s.description });
  const out: { key: string; description: string; ids: string[] }[] = [];
  for (const id of ids) {
    const s = starts.get(id);
    if (s || !out.length) out.push({ key: s?.key ?? '', description: s?.description ?? '', ids: [] });
    out[out.length - 1].ids.push(id);
  }
  return out;
}

export function uniqueSlideId(taken: Iterable<string>, stem = 'slide'): string {
  const set = new Set(taken);
  const base = stem.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 56) || 'slide';
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function uniqueSectionKey(deck: DeckJson): string {
  let i = Object.keys(deck.sections).length + 1;
  while (deck.sections['s' + i]) i++;
  return 's' + i;
}

const DEFAULT_SECTION_STYLE =
  "background:#fbfbf8;color:#1d1d1b;font-family:'Noto Sans SC', Arial, sans-serif;padding:128px;display:flex;flex-direction:column;gap:48px";

/** A new slide. `like` is a neighbour's section style, so a new slide keeps the deck's look. */
export function newSlideSource(id: string, opts: { like?: string; title?: string; body?: string; size?: [number, number]; titleSize?: number } = {}): string {
  const [w, h] = deckSize({ size: opts.size });
  const k = Math.min(w / SLIDE_W, h / SLIDE_H);
  const style = (opts.like ?? DEFAULT_SECTION_STYLE.replace('padding:128px', `padding:${Math.round(128 * k)}px`).replace('gap:48px', `gap:${Math.round(48 * k)}px`))
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && /^(background|color|font-family|padding|display|flex-direction|gap)\s*:/.test(d))
    .join(';');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = opts.body ?? 'Double-click to edit text, or ask AI below to change this slide.';
  return `<section id="${id}" style="${style.replace(/"/g, "'") || DEFAULT_SECTION_STYLE}">
<h2 style="font-size:${Math.round((opts.titleSize ?? 72) * k)}px;font-weight:600;line-height:1.1">${esc(opts.title ?? 'Title')}</h2>
${body === '' ? '' : `<p style="font-size:${Math.round(32 * k)}px;line-height:1.4;width:${Math.round(960 * k)}px">${esc(body)}</p>\n`}</section>
`;
}

/** Point a slide file's `<section id>` at a new id (duplicating, renaming). */
export function withSlideId(source: string, id: string): string {
  return source.replace(/(<section\b[^>]*?\bid\s*=\s*)(["'])[^"']*\2/i, `$1"${id}"`);
}

/** Markup that loads the deck's typefaces: Google Fonts links and @font-face rules. */
export function faceMarkup(deck: DeckJson, base = ''): string {
  const out: string[] = [];
  for (const f of Object.values(deck.faces)) {
    if (f.href && /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(f.href)) {
      out.push(`<link rel="stylesheet" href="${f.href.replace(/"/g, '&quot;')}">`);
    } else if (f.src && /^[A-Za-z0-9_./-]+$/.test(f.src) && !f.src.includes('..')) {
      out.push(`<style>@font-face{font-family:"${f.family.replace(/["\\]/g, '')}";src:url("${base}${f.src}")}</style>`);
    }
  }
  return out.join('\n');
}

/** Google Fonts family name → a `faces` entry (the `css2` link the original writes). */
export function googleFace(family: string, weights = '400;700'): [string, DeckFace] {
  const key = family.toLowerCase().replace(/\s+/g, '-');
  const href = `https://fonts.googleapis.com/css2?family=${family.trim().replace(/\s+/g, '+')}:wght@${weights}&display=swap`;
  return [key, { family: family.trim(), href }];
}

/** The base stylesheet for the slide subset: tag defaults and what "no display" means. */
export const SLIDE_BASE_CSS = `
${HIDE_CSS}
.dc-slide-host{position:relative;width:${SLIDE_W}px;height:${SLIDE_H}px;overflow:hidden}
.dc-slide-host section{position:relative;width:${SLIDE_W}px;height:${SLIDE_H}px;overflow:hidden;box-sizing:border-box;font-size:32px;line-height:1.4;font-weight:400}
.dc-slide-host section *{box-sizing:border-box;margin:0}
.dc-slide-host section:not([style*=display]),.dc-slide-host section div:not([style*=display]){display:flex;flex-direction:column}
.dc-slide-host section div[style*=display]{display:flex}
.dc-slide-host section h1{font-size:96px;font-weight:600;line-height:1.1}
.dc-slide-host section h2{font-size:64px;font-weight:600;line-height:1.15}
.dc-slide-host section h3{font-size:44px;font-weight:600;line-height:1.2}
.dc-slide-host section h1,.dc-slide-host section h2,.dc-slide-host section h3,.dc-slide-host section p{overflow-wrap:break-word}
.dc-slide-host section ul,.dc-slide-host section ol{padding-left:1.2em}
.dc-slide-host section li+li{margin-top:.3em}
.dc-slide-host section [data-text]{gap:.5em}
.dc-slide-host section [data-text] ul,.dc-slide-host section [data-text] ol{padding-left:var(--dc-indent,1.2em)}
.dc-slide-host section img{display:block;max-width:none}
.dc-slide-host section svg{display:block}
.dc-slide-host section table{border-collapse:collapse;width:100%}
.dc-slide-host section th,.dc-slide-host section td{padding:.35em .6em;border-bottom:1px solid rgba(127,127,127,.35);text-align:left;vertical-align:top}
.dc-slide-host section th{font-weight:600}
.dc-slide-host section hr{border:0;border-top:2px solid currentColor;width:100%;height:0}
.dc-slide-host section a{color:inherit}
.dc-slide-host section aside{display:none}
.dc-slide-host section[hidden]{display:flex}
.dc-slide-host x-shape,.dc-slide-host x-icon,.dc-slide-host x-embed{display:block}
.dc-slide-host x-connector{display:block;position:absolute;left:0;top:0;width:0;height:0;overflow:visible}
`;
