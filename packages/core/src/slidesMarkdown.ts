import { attr, parseDc, type DcElement, type DcNode } from './parse';
import { rootElement } from './ops';
import { sectionsOf, type DeckJson } from './deck';

/**
 * A deck as one Markdown document for reading and sharing, not a picture of
 * the slides: the deck's title, its sections and each slide's title become
 * headings, the text boxes, lists and tables become the Markdown they are,
 * pictures keep their alt text, and shapes, icons, connectors, drawings and
 * live embeds (which say nothing in text) are left out. Speaker notes follow
 * their slide as a quote. Reading order is source order, which is how the
 * slide was written; the paint order of the subset does not matter in text.
 */

export interface SlidesMarkdownOptions {
  /** The word that introduces a slide's speaker notes ("Notes"). Wording belongs to the caller. */
  notesLabel: string;
}

export interface MarkdownSlide {
  id: string;
  source: string;
}

const INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 'a', 'span', 'br', 'code', 'small', 'sub', 'sup', 'mark', 's']);
const SKIP = new Set(['aside', 'style', 'script', 'svg', 'x-embed', 'x-shape', 'x-icon', 'x-connector', 'hr']);

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const escapeText = (s: string) => s.replace(/([\\`*_[\]])|<(?=[a-z/!?])|^>/gi, (m, c) => `\\${c ?? m}`).replace(/^(#{1,6}|[-+]|\d+[.)])(\s)/, '\\$1$2');
const cell = (s: string) => s.replace(/\|/g, '\\|');

function inline(nodes: DcNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'text') out += escapeText(n.text);
    else if (n.kind === 'el') out += inlineEl(n);
  }
  return out.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n');
}

function wrap(mark: string, inner: string): string {
  const t = inner.trim();
  if (!t) return inner;
  const lead = inner.slice(0, inner.length - inner.trimStart().length);
  const trail = inner.slice(inner.trimEnd().length);
  return `${lead}${mark}${t}${mark}${trail}`;
}

function inlineEl(el: DcElement): string {
  if (SKIP.has(el.tag)) return '';
  const inner = () => inline(el.children);
  switch (el.tag) {
    case 'br':
      return '  \n';
    case 'b':
    case 'strong':
      return wrap('**', inner());
    case 'i':
    case 'em':
      return wrap('*', inner());
    case 's':
      return wrap('~~', inner());
    case 'code':
      return wrap('`', inner());
    case 'a': {
      const href = attr(el, 'href');
      const text = inner();
      return href && text.trim() ? `[${text.trim()}](${href})` : text;
    }
    default:
      return inner();
  }
}

const isInline = (n: DcNode) => n.kind === 'text' || (n.kind === 'el' && INLINE.has(n.tag));

interface Ctx {
  /** The heading level a heading inside the slide gets: one below the slide's own. */
  sub: number;
  blocks: string[];
  /** The element standing for the slide's title, which the caller prints as the slide's heading. */
  title?: DcElement;
}

function list(el: DcElement, depth: number): string[] {
  const ordered = el.tag === 'ol';
  const lines: string[] = [];
  let n = 0;
  for (const li of el.children) {
    if (li.kind !== 'el' || li.tag !== 'li') continue;
    const text = inline(li.children.filter((c) => !(c.kind === 'el' && (c.tag === 'ul' || c.tag === 'ol')))).trim();
    n += 1;
    if (text) lines.push(`${'  '.repeat(depth)}${ordered ? `${n}.` : '-'} ${text.replace(/\n\s*/g, '  \n' + '  '.repeat(depth + 1))}`);
    for (const sub of li.children) if (sub.kind === 'el' && (sub.tag === 'ul' || sub.tag === 'ol')) lines.push(...list(sub, depth + 1));
  }
  return lines;
}

function table(el: DcElement): string {
  const rows: string[][] = [];
  const collect = (e: DcElement) => {
    for (const c of e.children) {
      if (c.kind !== 'el') continue;
      if (c.tag === 'tr') rows.push(c.children.filter((x): x is DcElement => x.kind === 'el' && (x.tag === 'td' || x.tag === 'th')).map((x) => cell(norm(inline(x.children)))));
      else if (['thead', 'tbody', 'tfoot'].includes(c.tag)) collect(c);
    }
  };
  collect(el);
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (!width) return '';
  const pad = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  return [pad(rows[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(pad)].join('\n');
}

function walk(el: DcElement, c: Ctx): void {
  let run: DcNode[] = [];
  const flush = () => {
    const text = inline(run).replace(/^\s+|\s+$/g, '');
    if (text) c.blocks.push(text);
    run = [];
  };
  for (const n of el.children) {
    if (isInline(n)) {
      run.push(n);
      continue;
    }
    flush();
    if (n.kind !== 'el' || SKIP.has(n.tag)) continue;
    if (n === c.title) continue;
    if (/^h[1-6]$/.test(n.tag)) {
      const text = norm(inline(n.children));
      if (text) c.blocks.push(`${'#'.repeat(Math.min(6, c.sub))} ${text}`);
    } else if (n.tag === 'p') {
      const text = inline(n.children).trim();
      if (text) c.blocks.push(text);
    } else if (n.tag === 'ul' || n.tag === 'ol') {
      const lines = list(n, 0);
      if (lines.length) c.blocks.push(lines.join('\n'));
    } else if (n.tag === 'table') {
      const t = table(n);
      if (t) c.blocks.push(t);
    } else if (n.tag === 'img') {
      const src = attr(n, 'src');
      if (src) c.blocks.push(`![${norm(attr(n, 'alt') ?? '').replace(/[[\]]/g, '')}](${src.replace(/ /g, '%20')})`);
    } else walk(n, c);
  }
  flush();
}

/** The slide's title element (what the editor's outline shows): the first h1–h3, else the first paragraph. */
function titleOf(root: DcElement): DcElement | undefined {
  let h: DcElement | undefined;
  let p: DcElement | undefined;
  const visit = (e: DcElement) => {
    for (const n of e.children) {
      if (n.kind !== 'el' || SKIP.has(n.tag) || h) continue;
      if (/^h[1-3]$/.test(n.tag)) h = n;
      else if (n.tag === 'p' && !p) p = n;
      else visit(n);
    }
  };
  visit(root);
  return h ?? p;
}

function notesOf(root: DcElement): string {
  const aside = root.children.find((c): c is DcElement => c.kind === 'el' && c.tag === 'aside');
  return aside ? aside.children.map((n) => (n.kind === 'text' ? n.text : n.kind === 'el' ? inline([n]) : '')).join('').replace(/[ \t]+/g, ' ').trim() : '';
}

interface Rendered {
  title: string;
  body: string[];
  notes: string;
}

function render(source: string, sub: number): Rendered | undefined {
  const root = rootElement(parseDc(source));
  if (!root || attr(root, 'hidden') !== undefined) return undefined;
  const title = titleOf(root);
  const c: Ctx = { sub, blocks: [], title };
  walk(root, c);
  return { title: title ? norm(inline(title.children)) : '', body: c.blocks, notes: notesOf(root) };
}

/**
 * A footer, page number or tag line printed on every slide ("Tingly · Intro · 02") is the slide's chrome, not its
 * content: a one-line paragraph that, digits aside, repeats on at least half of three or more slides is left out.
 */
function dropRunning(slides: Rendered[]): void {
  if (slides.length < 3) return;
  const key = (b: string) => b.replace(/\d+/g, '#');
  const seen = new Map<string, number>();
  for (const r of slides) for (const k of new Set(r.body.filter((b) => b.length <= 80 && !/\n|^[#>|\-!]|^\d+\./.test(b)).map(key))) seen.set(k, (seen.get(k) ?? 0) + 1);
  const running = new Set([...seen].filter(([, n]) => n >= 3 && n >= slides.length / 2).map(([k]) => k));
  if (running.size) for (const r of slides) r.body = r.body.filter((b) => !running.has(key(b)));
}

const quote = (label: string, notes: string) =>
  notes
    .split(/\n+/)
    .map((l, i) => `> ${i === 0 ? `**${label}** ` : ''}${l.trim()}`)
    .join('\n>\n');

/**
 * `slides` in deck order. The first shown slide is the cover: the deck's title heads the document, and the cover's
 * remaining text is its introduction. Sections with a description become second-level headings and their slides
 * third-level; without sections the slides are second-level. Hidden slides are left out.
 */
export function deckToMarkdown(deck: DeckJson, slides: MarkdownSlide[], opts: SlidesMarkdownOptions): string {
  const byId = new Map(slides.map((s) => [s.id, s.source]));
  const ids = slides.map((s) => s.id);
  const groups = sectionsOf(deck, ids);
  const sectioned = groups.some((g) => g.description);
  const slideLevel = sectioned ? 3 : 2;
  const out: string[] = [];
  const title = norm(deck.title);
  if (title) out.push(`# ${escapeText(title)}`);

  const rendered = new Map(ids.map((id) => [id, render(byId.get(id) ?? '', slideLevel + 1)]));
  dropRunning([...rendered.values()].filter((r): r is Rendered => !!r));

  let first = true;
  for (const g of groups) {
    let heading = sectioned ? g.description : '';
    for (const id of g.ids) {
      const r = rendered.get(id);
      if (!r) continue;
      if (first) {
        first = false;
        // the cover: its title is the deck's title; a different one stays as a line of its own
        const t = r.title && norm(deck.title) !== r.title ? [`**${r.title}**`] : [];
        out.push(...t, ...r.body);
        if (r.notes) out.push(quote(opts.notesLabel, r.notes));
        continue;
      }
      if (heading) {
        out.push(`${'#'.repeat(2)} ${escapeText(heading)}`);
        heading = '';
      }
      if (r.title) out.push(`${'#'.repeat(slideLevel)} ${r.title}`);
      out.push(...r.body);
      if (r.notes) out.push(quote(opts.notesLabel, r.notes));
    }
  }
  return out.join('\n\n') + '\n';
}
