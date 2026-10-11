import { attr, type DcDoc, type DcElement } from './parse';
import { parseStyle } from './style';

/**
 * The slide subset (the original Slides type's `format.md`), as a checker.
 *
 * The original editor parses each slide into a typed model and refuses
 * anything outside the subset (the slide opens read-only). Here the source
 * stays the truth and is edited in place, so the subset is a lint instead:
 * `error` is something the original would refuse, `warning` something it
 * would change on the way in, `note` a layout hint. The editor shows them and
 * the fast editor gets them back as feedback.
 */

export type IssueLevel = 'error' | 'warning' | 'note';

export interface SlideIssue {
  tid: number | null;
  level: IssueLevel;
  message: string;
}

export const SLIDE_TAGS = new Set([
  'section', 'h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'br', 'b', 'i', 'u', 'a', 'span', 'div', 'img', 'svg',
  'table', 'tbody', 'thead', 'tr', 'th', 'td', 'hr', 'aside', 'x-shape', 'x-icon', 'x-connector', 'x-embed',
]);

export const SHAPE_KINDS = ['rect', 'rounded', 'ellipse', 'diamond', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'line'] as const;

export const ICON_NAMES = [
  'Activity', 'Book', 'Chart', 'Chat', 'Check', 'CheckCircle', 'Clock', 'Cloud', 'Code', 'Database', 'Globe', 'GraduationCap',
  'Home', 'Key', 'Lightbulb', 'Lightning', 'Link', 'Lock', 'PaperPlane', 'Play', 'Search', 'Settings', 'Star', 'ThumbsUp',
  'Tool', 'Trust', 'Users', 'Verified', 'Warning', 'Wrench',
] as const;

export const TRANSITIONS = ['fade', 'push', 'magic'] as const;
export const BUILDS = ['fade', 'rise', 'drop', 'left', 'right', 'scale', 'pop'] as const;

/** Every property the subset knows. */
export const SLIDE_PROPS = new Set([
  'position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'display', 'flex-direction', 'flex-wrap', 'gap', 'align-items', 'justify-content', 'justify-items', 'align-self',
  'justify-self', 'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'grid-template-columns', 'grid-template-rows',
  'grid-column', 'grid-row', 'aspect-ratio', 'padding', 'overflow', 'font-family', 'font-size', 'font-weight', 'font-style',
  'font', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'text-decoration',
  'font-variant-numeric', '-webkit-text-stroke', 'color', 'background', 'background-clip', '-webkit-background-clip',
  '-webkit-text-fill-color', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius',
  'box-shadow', 'text-shadow', 'opacity', 'transform', 'filter', 'backdrop-filter', 'mix-blend-mode', 'object-fit',
]);

/** Accepted only when they change nothing. */
const NO_OPS: Record<string, RegExp> = {
  margin: /^0(px)?$/,
  'box-sizing': /^border-box$/,
  'grid-template': /^none$/,
};

/** Written by hand often enough to heal rather than refuse. */
const HEALS: Record<string, string> = {
  'background-color': 'background',
  'padding-top': 'padding',
  'padding-right': 'padding',
  'padding-bottom': 'padding',
  'padding-left': 'padding',
  'object-position': 'data-crop',
};

const HINTS: Record<string, string> = {
  iframe: 'use <x-embed> (pinned, a direct child of <section>)',
  canvas: 'put it in an <x-embed>',
  script: 'scripts run only inside <x-embed>',
  style: 'every style is inline; fonts go in deck.json "faces"',
  video: 'use <img> (a poster) or an <x-embed>',
  h4: 'use <h3>',
  h5: 'use <h3> or <p>',
  h6: 'use <p>',
  strong: 'use <b>',
  em: 'use <i>',
  button: 'a pill is a <p> with background, padding and border-radius',
  blockquote: 'use a <div> with a <p>',
  figure: 'use a <div>',
  header: 'use a <div>',
  footer: 'use a <div>',
  main: 'use a <div>',
  article: 'use a <div>',
  nav: 'use a <div>',
  small: 'use a <span style="color:…"> or a smaller <p>',
  code: 'use a <p> with a monospace font-family',
  pre: 'use a <p> with a monospace font-family',
};

const MAX_ELEMENTS = 200;
const MAX_DIV_DEPTH = 15;
const MAX_PINNED = 24;
const MAX_EMBED = 16 * 1024;
const MAX_EMBEDS = 8;
const MAX_SVG = 52 * 1024;

function px(v: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(v.trim());
  return m ? Number(m[1]) : null;
}

export function sectionOf(doc: DcDoc): DcElement | undefined {
  return doc.children.find((n): n is DcElement => n.kind === 'el');
}

export function isPinned(el: DcElement): boolean {
  return parseStyle(attr(el, 'style') ?? '').some((d) => d.prop === 'position' && d.value === 'absolute');
}

/** Check one slide file. `id` is the id its file name gives it. */
export function checkSlide(doc: DcDoc, id?: string): SlideIssue[] {
  const out: SlideIssue[] = [];
  const add = (el: DcElement | null, level: IssueLevel, message: string) => out.push({ tid: el?.tid ?? null, level, message });

  const tops = doc.children.filter((n) => n.kind === 'el') as DcElement[];
  const stray = doc.children.some((n) => n.kind === 'text' && n.text.trim());
  if (!doc.slide || tops.length !== 1 || tops[0].tag !== 'section') {
    add(null, 'error', 'A slide file is exactly one <section id="…" style="…">, with nothing before or after it.');
    if (!tops.length) return out;
  }
  if (stray) add(null, 'error', 'Text outside the <section> is dropped.');
  for (const e of doc.errors) add(null, 'error', e);

  const section = tops[0];
  const sid = attr(section, 'id');
  if (section.tag === 'section') {
    if (!sid) add(section, 'error', 'The <section> needs an id (the slide id, the same as its file name).');
    else if (id && sid !== id) add(section, 'error', `The <section> id "${sid}" differs from its file name (${id}.html).`);
    const ss = parseStyle(attr(section, 'style') ?? '');
    if (!ss.some((d) => d.prop === 'background' || d.prop === 'background-color')) add(section, 'warning', 'Set a background on every slide.');
    const tr = attr(section, 'data-transition');
    if (tr && !(TRANSITIONS as readonly string[]).includes(tr)) add(section, 'error', `data-transition is fade, push or magic, not "${tr}".`);
  }

  let count = 0;
  let embeds = 0;
  const visit = (el: DcElement, divDepth: number) => {
    count++;
    const tag = el.tag;
    if (!SLIDE_TAGS.has(tag)) {
      add(el, 'error', `<${tag}> is not in the slide subset${HINTS[tag] ? `: ${HINTS[tag]}` : ''}.`);
      return;
    }
    // attributes
    for (const a of el.attrs) {
      const n = a.name.toLowerCase();
      if (/^on/.test(n)) add(el, 'error', `${a.name}= never runs on a slide; scripts live only inside <x-embed>.`);
      else if (n === 'class') add(el, 'warning', 'class is ignored: every style is inline.');
    }
    if (tag !== 'svg') checkStyle(el, add);

    switch (tag) {
      case 'svg': {
        const text = doc.source.slice(el.range.start, el.range.end);
        if (text.length > MAX_SVG) add(el, 'error', `This <svg> is ${Math.round(text.length / 1024)} KB; at most 52 KB.`);
        if (/<script\b|<foreignObject\b|\son[a-z]+\s*=/i.test(text)) add(el, 'error', '<svg> may hold no script, on…= or foreignObject.');
        if (/\b(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i.test(text)) add(el, 'error', '<svg> may load nothing by URL; local #id references only.');
        if (/<text\b/i.test(text)) add(el, 'note', 'Text inside <svg> never gets the deck fonts: put labels in <p>s over it.');
        if (!attr(el, 'aria-label')) add(el, 'note', '<svg aria-label="…"> is its alt text.');
        return;
      }
      case 'x-embed': {
        embeds++;
        const text = doc.source.slice(el.range.start, el.range.end);
        if (text.length > MAX_EMBED) add(el, 'error', `This <x-embed> is ${Math.round(text.length / 1024)} KB; at most 16 KB.`);
        if (el.parent !== section) add(el, 'error', '<x-embed> must be a direct child of <section>.');
        if (!isPinned(el)) add(el, 'error', '<x-embed> must be pinned: position:absolute with left/top and width/height.');
        return;
      }
      case 'x-shape': {
        const k = attr(el, 'kind') ?? 'rect';
        if (!(SHAPE_KINDS as readonly string[]).includes(k)) add(el, 'error', `<x-shape kind="${k}"> is not a shape; use ${SHAPE_KINDS.join(', ')}.`);
        break;
      }
      case 'x-icon': {
        const n = attr(el, 'name') ?? '';
        if (!(ICON_NAMES as readonly string[]).includes(n)) add(el, 'error', `<x-icon name="${n}"> is not an icon name.`);
        break;
      }
      case 'x-connector': {
        const has = ['x1', 'y1', 'x2', 'y2'].filter((k) => attr(el, k) !== undefined).length;
        if (has && has < 4) add(el, 'error', '<x-connector> needs all of x1 y1 x2 y2 (or none, as a sized flow child).');
        break;
      }
      case 'img': {
        const src = attr(el, 'src') ?? '';
        if (attr(el, 'alt') === undefined) add(el, 'note', '<img> needs alt (alt="" when decorative).');
        if (/^data:/.test(src)) add(el, 'warning', 'Images are files, not data: URIs (the original refuses them).');
        else if (/^(https?:)?\/\//.test(src)) add(el, 'warning', 'Images are files of the deck, not URLs (the original refuses them).');
        break;
      }
      case 'aside': {
        const last = (el.parent?.children.filter((n) => n.kind === 'el') ?? []).at(-1);
        if (el.parent !== section) add(el, 'error', '<aside> (speaker notes) is a direct child of <section>.');
        else if (last !== el) add(el, 'error', '<aside> (speaker notes) is the last child of <section>.');
        if (el.children.some((c) => c.kind === 'el')) add(el, 'warning', 'Speaker notes are plain text.');
        return;
      }
      case 'li':
        if (el.parent?.tag !== 'ul' && el.parent?.tag !== 'ol') add(el, 'error', '<li> belongs in a <ul> or <ol>.');
        break;
      case 'ul':
      case 'ol':
        for (let a = el.parent; a; a = a.parent) if (a.tag === 'li') add(el, 'error', 'Lists do not nest.');
        break;
      case 'span': {
        const st = parseStyle(attr(el, 'style') ?? '');
        if (st.some((d) => d.prop === 'font-size' || d.prop === 'font-family')) add(el, 'warning', 'A <span> takes no size or font: use two blocks.');
        break;
      }
    }
    const nextDepth = tag === 'div' ? divDepth + 1 : divDepth;
    if (nextDepth > MAX_DIV_DEPTH) add(el, 'error', `<div>s nest ${MAX_DIV_DEPTH} deep at most.`);
    let pinned = 0;
    for (const c of el.children) {
      if (c.kind === 'text' && c.text.trim() && /^(section|div|ul|ol|table|tr)$/.test(tag)) {
        add(el, 'warning', `Text directly inside <${tag}> has no box of its own: wrap it in a <p>.`);
      }
      if (c.kind !== 'el') continue;
      if (isPinned(c)) pinned++;
      visit(c, nextDepth);
    }
    if (pinned > MAX_PINNED && tag !== 'section') add(el, 'error', `At most ${MAX_PINNED} pinned children in one <div>.`);
  };
  if (section) visit(section, 0);
  if (count > MAX_ELEMENTS) add(section, 'error', `${count} elements: a slide holds at most ${MAX_ELEMENTS}.`);
  if (embeds > MAX_EMBEDS) add(section, 'error', `${embeds} <x-embed>s: at most ${MAX_EMBEDS} per slide.`);
  return out;
}

function checkStyle(el: DcElement, add: (el: DcElement, level: IssueLevel, message: string) => void): void {
  const style = attr(el, 'style');
  if (!style) return;
  for (const d of parseStyle(style)) {
    if (!d.prop) {
      add(el, 'error', `"${d.value}" is not a declaration.`);
      continue;
    }
    const v = d.value.replace(/\s*!important$/, '');
    if (NO_OPS[d.prop]) {
      if (!NO_OPS[d.prop].test(v)) add(el, 'error', `${d.prop} is not in the subset (only ${d.prop}:${NO_OPS[d.prop].source.replace(/[\^$()?]/g, '')}): use padding or gap.`);
      continue;
    }
    if (HEALS[d.prop]) {
      add(el, 'warning', `${d.prop} is healed to ${HEALS[d.prop]}: write that instead.`);
      continue;
    }
    if (!SLIDE_PROPS.has(d.prop) && !(el.tag === 'x-connector' && (d.prop === 'border-width' || d.prop === 'border-style'))) {
      const hint = d.prop === 'z-index' ? ': later children paint over earlier ones' : d.prop.startsWith('margin') ? ': use padding or gap' : '';
      add(el, 'error', `${d.prop} is not in the slide subset${hint}.`);
      continue;
    }
    if (/var\(/.test(v)) add(el, 'error', `${d.prop}: var() is not in the subset; write the value.`);
    if (/currentcolor/i.test(v) && d.prop !== '-webkit-text-fill-color') add(el, 'error', `${d.prop}: currentColor is not in the subset.`);
    if (d.prop !== 'letter-spacing' && /\d(r?em|vw|vh|vmin|vmax|ch|ex)\b/.test(v)) add(el, 'error', `${d.prop}: ${v} — lengths are px (no em, rem, vw, vh).`);
    if (/\dpt\b/.test(v)) add(el, 'note', `${d.prop}: pt converts to px (×2).`);
    if (d.prop === 'font-size') {
      const n = px(v);
      if (n !== null && n < 24) add(el, 'note', `font-size ${n}px: nothing on a slide goes under 24px.`);
    }
    if (d.prop === 'position' && !/^(absolute|relative)$/.test(v)) add(el, 'error', `position is absolute or relative, not ${v}.`);
    if (d.prop === 'display' && !/^(flex|grid|none)$/.test(v)) add(el, 'error', `display is flex, grid or none, not ${v}.`);
    if (d.prop === 'transform' && /matrix|perspective|rotate[XYZ3]|translate3d|scale3d/.test(v)) add(el, 'error', `transform: ${v} — 2D translate, rotate, scale and skew only.`);
  }
}

/** One-line summaries of a slide's issues, for the fast editor's feedback. */
export function issueText(issues: SlideIssue[], handle: (tid: number) => string): string {
  return issues
    .filter((i) => i.level !== 'note')
    .map((i) => `- ${i.level}${i.tid !== null ? ` ${handle(i.tid)}` : ''}: ${i.message}`)
    .join('\n');
}

const RELATIVE = /(^|;)\s*position\s*:\s*relative/;

/**
 * The subset's paint order, as a z-index: children of the slide (or of a
 * position:relative div) paint in source order, and all flow content paints
 * as one layer where the first flow child sits — so a pinned backdrop written
 * first stays under the text. Plain CSS would paint every pinned box on top.
 */
export function paintLayer(el: DcElement): number | undefined {
  const parent = el.parent;
  if (!parent || (parent.parent && !RELATIVE.test(attr(parent, 'style') ?? ''))) return undefined;
  const kids = parent.children.filter((k): k is DcElement => k.kind === 'el' && k.tag !== 'aside');
  const i = kids.indexOf(el);
  if (i < 0) return undefined;
  const firstFlow = kids.findIndex((k) => !isPinned(k));
  return isPinned(el) || firstFlow < 0 ? i + 1 : firstFlow + 1;
}
