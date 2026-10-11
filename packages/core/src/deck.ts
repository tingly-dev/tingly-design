/**
 * A slide deck: `deck.json` (the index) plus one `slides/<id>.html` per
 * slide, each holding exactly one `<section id="<id>">` on a 1920×1080
 * canvas. Field names follow the original Slides type so decks move between
 * the two (there the files sit under `project/`; here the project folder is
 * the deck).
 */

export const DECK_FILE = 'deck.json';
export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

export interface DeckFace {
  family: string;
  /** a `https://fonts.googleapis.com/css2?…` stylesheet */
  href?: string;
  /** a font file inside the deck */
  src?: string;
}

export interface DeckSection {
  description: string;
  /** id of the section's first slide */
  start?: string;
  /** an empty section: the slide it sits before */
  before?: string;
}

export interface DeckJson {
  v: number;
  title: string;
  /** cover slide id (the thumbnail) */
  cover?: string;
  order: string[];
  sections: Record<string, DeckSection>;
  faces: Record<string, DeckFace>;
  designSystems: unknown[];
  [k: string]: unknown;
}

export const SLIDE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isSlideId(id: string): boolean {
  return SLIDE_ID_RE.test(id);
}

export function slideFile(id: string): string {
  return `slides/${id}.html`;
}

export function isSlideFile(path: string): boolean {
  const m = /^slides\/([^/]+)\.html$/.exec(path);
  return !!m && isSlideId(m[1]);
}

export function slideIdOf(path: string): string | null {
  const m = /^slides\/([^/]+)\.html$/.exec(path);
  return m && isSlideId(m[1]) ? m[1] : null;
}

export function parseDeck(text: string | undefined): DeckJson {
  let raw: Partial<DeckJson> = {};
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    raw = {};
  }
  return {
    ...raw,
    v: raw.v ?? 4,
    title: raw.title ?? 'Untitled deck',
    order: (raw.order ?? []).filter(isSlideId),
    sections: raw.sections && typeof raw.sections === 'object' ? raw.sections : {},
    faces: raw.faces && typeof raw.faces === 'object' ? raw.faces : {},
    designSystems: Array.isArray(raw.designSystems) ? raw.designSystems : [],
  };
}

export function stringifyDeck(d: DeckJson): string {
  return JSON.stringify(d, null, 2) + '\n';
}

/** Slide ids in show order: `order` first (only those whose file exists), then files `order` leaves out. */
export function deckSlides(deck: DeckJson, files: Iterable<string>): string[] {
  const have = new Set<string>();
  for (const f of files) {
    const id = slideIdOf(f);
    if (id) have.add(id);
  }
  const out = deck.order.filter((id, i) => have.has(id) && deck.order.indexOf(id) === i);
  for (const id of [...have].sort()) if (!out.includes(id)) out.push(id);
  return out;
}

/** Google Fonts stylesheets the slides need. Faces with a local `src` become @font-face rules instead. */
export function deckFontLinks(deck: DeckJson): string[] {
  const out: string[] = [];
  for (const f of Object.values(deck.faces)) {
    if (f && typeof f.href === 'string' && f.href.startsWith('https://fonts.googleapis.com/css2?')) out.push(f.href);
  }
  return out.slice(0, 4);
}

export function deckFontFaces(deck: DeckJson): { family: string; src: string }[] {
  const out: { family: string; src: string }[] = [];
  for (const f of Object.values(deck.faces)) {
    if (f && typeof f.src === 'string' && /^[A-Za-z][\w -]{0,39}$/.test(f.family) && !f.src.includes('..')) out.push({ family: f.family, src: f.src });
  }
  return out.slice(0, 4);
}

export interface SectionRun {
  /** key in `sections`, or '-' for the undescribed opening run */
  key: string;
  description: string;
  slides: string[];
}

/** The deck cut into its sections, in show order. */
export function sectionRuns(deck: DeckJson, slides: string[]): SectionRun[] {
  const startAt = new Map<string, string>();
  const empties: { key: string; before?: string }[] = [];
  for (const [key, s] of Object.entries(deck.sections)) {
    if (s.start && slides.includes(s.start) && !startAt.has(s.start)) startAt.set(s.start, key);
    else if (!s.start) empties.push({ key, before: s.before });
  }
  const runs: SectionRun[] = [];
  let cur: SectionRun = { key: '-', description: '', slides: [] };
  const flushEmpties = (before: string | undefined) => {
    for (const e of empties) if (e.before === before) runs.push({ key: e.key, description: deck.sections[e.key].description ?? '', slides: [] });
  };
  for (const id of slides) {
    const key = startAt.get(id);
    if (key) {
      if (cur.slides.length || cur.key !== '-') runs.push(cur);
      flushEmpties(id);
      cur = { key, description: deck.sections[key].description ?? '', slides: [] };
    }
    cur.slides.push(id);
  }
  if (cur.slides.length || cur.key !== '-' || !runs.length) runs.push(cur);
  flushEmpties(undefined);
  return runs.filter((r) => r.key !== '-' || r.slides.length);
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

/** Give a copied slide's section its new id (`<section id="old"` → `id="new"`). */
export function renameSlideSource(source: string, id: string): string {
  return source.replace(/(<section\b[^>]*?\bid=)(["'])[^"']*\2/i, `$1"${id}"`);
}

/** A new slide, styled like `like` (its section's background, colors and font) when given. */
export function newSlideSource(id: string, opts: { like?: string; title?: string } = {}): string {
  const title = (opts.title ?? '标题').replace(/</g, '&lt;');
  let look = 'background:#f7f6f2;color:#1d1f24;font-family:Georgia, serif';
  if (opts.like) {
    const m = /<section\b[^>]*?\bstyle=(["'])([\s\S]*?)\1/i.exec(opts.like);
    if (m) {
      const keep = m[2]
        .split(';')
        .map((d) => d.trim())
        .filter((d) => /^(background|color|font-family)\s*:/i.test(d));
      if (keep.length) look = keep.join(';');
    }
  }
  return `<section id="${id}" style="${look};padding:128px;display:flex;flex-direction:column;gap:48px">
<h2 style="font-size:72px;line-height:1.1">${title}</h2>
<p style="font-size:32px;line-height:1.4;width:960px">双击改字，或在下方让 AI 修改。</p>
</section>
`;
}

export function newDeck(title: string, first: string): DeckJson {
  return {
    v: 4,
    createdOnFiles: { v: 1, at: new Date().toISOString() },
    lists: 'css',
    title,
    cover: first,
    order: [first],
    sections: {},
    faces: {},
    designSystems: [],
  };
}

// --------------------------------------------------------------- the slide subset

export const ICON_NAMES = [
  'Activity', 'Book', 'Chart', 'Chat', 'Check', 'CheckCircle', 'Clock', 'Cloud', 'Code', 'Database', 'Globe',
  'GraduationCap', 'Home', 'Key', 'Lightbulb', 'Lightning', 'Link', 'Lock', 'PaperPlane', 'Play', 'Search',
  'Settings', 'Star', 'ThumbsUp', 'Tool', 'Trust', 'Users', 'Verified', 'Warning', 'Wrench',
] as const;

export const SHAPE_KINDS = ['rect', 'rounded', 'ellipse', 'diamond', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'line'] as const;

export const TRANSITIONS = ['none', 'fade', 'push', 'magic'] as const;
export const BUILDS = ['fade', 'rise', 'drop', 'left', 'right', 'scale', 'pop'] as const;

/** `data-build-in="rise 2 auto"` → its parts. */
export function parseBuild(v: string | null | undefined): { kind: string; order: number; auto: boolean } | null {
  if (!v) return null;
  const parts = v.trim().split(/\s+/);
  const kind = parts[0];
  if (!(BUILDS as readonly string[]).includes(kind)) return null;
  const n = parts.find((p) => /^\d+$/.test(p));
  return { kind, order: n ? Math.min(50, Math.max(1, Number(n))) : 0, auto: parts.includes('auto') };
}

/** The speaker notes of a slide: the text of its `<aside>`. */
export function slideNotes(source: string): string {
  const m = /<aside\b[^>]*>([\s\S]*?)<\/aside>/i.exec(source);
  if (!m) return '';
  return m[1]
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Replace (or add, or with '' remove) a slide's `<aside>` notes; everything else stays as written. */
export function setSlideNotes(source: string, notes: string): string {
  const text = notes.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 4000);
  const m = /\n?<aside\b[^>]*>[\s\S]*?<\/aside>/i.exec(source);
  if (m) {
    if (!text.trim()) return source.slice(0, m.index) + source.slice(m.index + m[0].length);
    const open = /<aside\b[^>]*>/i.exec(m[0])!;
    const start = m.index + m[0].indexOf(open[0]) + open[0].length;
    const end = m.index + m[0].length - '</aside>'.length;
    return source.slice(0, start) + text + source.slice(end);
  }
  if (!text.trim()) return source;
  const close = source.toLowerCase().lastIndexOf('</section>');
  if (close < 0) return source;
  const nl = source[close - 1] === '\n' ? '' : '\n';
  return source.slice(0, close) + `${nl}<aside>${text}</aside>\n` + source.slice(close);
}

/** The slide's first heading (else first text), for labels. */
export function slideTitle(source: string): string {
  const h = /<h[123]\b[^>]*>([\s\S]*?)<\/h[123]>/i.exec(source) ?? /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(source);
  if (!h) return '';
  const t = h[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 59) + '…' : t;
}
