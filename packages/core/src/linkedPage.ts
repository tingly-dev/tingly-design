/**
 * A linked page: a page of another project (a canvas artboard, a slide, a doc tab, a dashboard, a
 * motion piece) kept in the open project as a copy, with a record of where it came from so the person
 * is told when the original changed and can update the copy in one step. See
 * .design/cross-kind-embedding.md.
 *
 * The copy is what is drawn, exported and zipped; the record (the target index's `imports`) is only
 * provenance. It is a plain picture (a Markdown image, an `<img>`, an image on the canvas) or, for a
 * canvas artboard in slides and motion, the `<x-embed src>` of .design/import-from-project.md, so
 * nothing outside this module needs a new syntax.
 */
import { boardDeps, isBoardEmbedPath } from './boardEmbed';
import { deckSize, parseDeck, type ProjectKind } from './deck';
import { outlineProject, type ProjectFiles } from './project';

/** What a record keeps: a copy that runs in a frame (`live`, with a picture beside it) or only a picture of the page (`image`). The element on the page is what shows one or the other. */
export type LinkMode = 'live' | 'image';

export const LINK_DIR = 'uploads/linked';

/** The record a project keeps per linked page, in its index's `imports`. */
export interface LinkedPage {
  /** The copy in this project; also the record's key. A picture: `uploads/linked/<id>/<stem>.png`; an artboard: `uploads/<from>-<stem>/<board>`. */
  path: string;
  /** The project it came from: `projects/<handle>`. */
  from: string;
  /** Where the source sits relative to this project's folder, when it is inside it (a sub-project); tried before `from`. */
  rel?: string;
  /** The source's kind, and the page's stable id in it: a board's file, a slide id, a tab id; one page kinds use `index`. */
  kind: ProjectKind;
  page: string;
  mode: LinkMode;
  /** The picture kept beside a live copy (`uploads/linked/<id>/<stem>.png`); a record that is only a picture has none (`path` is it). */
  poster?: string;
  /** A hash of the source page when the copy was made; the original changed when it no longer matches. */
  at?: string;
  copiedAt: string;
}

/** The one page of a kind that has just one. */
export const SINGLE_PAGE = 'index';

/** What a project may take from another, by the kind taking it: `into` -> `from` -> how it can be shown. A kind not listed under `into` takes nothing. */
export const LINKABLE: Record<ProjectKind, Partial<Record<ProjectKind, LinkMode[]>>> = {
  design: { design: ['image'], slides: ['image'], docs: ['image'], dashboard: ['image'], motion: ['image'] },
  slides: { design: ['live', 'image'], slides: ['image'], docs: ['image'], dashboard: ['live', 'image'], motion: ['image'] },
  docs: { design: ['image'], slides: ['image'], docs: ['image'], dashboard: ['image'], motion: ['image'] },
  motion: { design: ['live', 'image'], slides: ['image'], docs: ['image'], dashboard: ['image'], motion: ['image'] },
  // a dashboard's page takes only data: pictures of at most 256 KB and drops frames; a design system's README is guidance, not a page to fill
  dashboard: {},
  'design-system': {},
};

/** The ways `from` can be shown in `into`, the preferred first; empty when it cannot be taken. */
export function linkModes(from: ProjectKind, into: ProjectKind): LinkMode[] {
  return LINKABLE[into][from] ?? [];
}

/** Can this project take a page of another at all? */
export const takesPages = (into: ProjectKind): boolean => Object.keys(LINKABLE[into]).length > 0;

/** One page a project can hand out. */
export interface SourcePage {
  page: string;
  title: string;
  size?: [number, number];
}

/** The pages of a project, in its order: a canvas's artboards, a deck's slides, a doc's tabs, and the one page of a dashboard or a motion piece. */
export function pagesOf(kind: ProjectKind, files: ProjectFiles): SourcePage[] {
  if (kind === 'design-system') return [];
  const o = outlineProject(kind, files);
  if (kind === 'dashboard' || kind === 'motion') return [{ page: SINGLE_PAGE, title: o.title || '' }];
  return o.items
    .filter((i) => i.type === 'board' || i.type === 'slide' || i.type === 'tab')
    .map((i) => ({ page: i.type === 'board' ? String(i.file) : String(i.id), title: i.title || String(i.id), ...(i.size ? { size: i.size as [number, number] } : {}) }));
}

/**
 * What the picture of a page depends on: the files whose bytes decide it, and a few fields of the
 * index that do too. `whole` is a one-page kind: any file of the project counts. Detecting the
 * original's change is comparing a hash of this now with the one kept in the record.
 */
export interface PageDeps {
  files: string[];
  extra: string;
  whole?: boolean;
}

const REFS = /(?:\b(?:src|href)\s*=\s*["']|url\(\s*["']?)((?:uploads|assets)\/[^"')\s]+)/g;
const MD_REFS = /\]\(\s*(?:\.\.\/)?((?:uploads|assets)\/[^)\s"']+)/g;

const refs = (text: string, re: RegExp): string[] => [...new Set([...text.matchAll(re)].map((m) => m[1]).filter((p) => !p.includes('..')))];

export function pageDeps(kind: ProjectKind, page: string, files: ProjectFiles): PageDeps {
  if (kind === 'dashboard' || kind === 'motion') return { files: [], extra: '', whole: true };
  if (kind === 'design') {
    const todo = [page];
    const seen = new Set<string>();
    const assets = new Set<string>();
    while (todo.length) {
      const f = todo.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const src = files[f];
      if (src === undefined) continue;
      const d = boardDeps(src, f);
      todo.push(...d.boards);
      for (const a of d.files) assets.add(a);
    }
    let size = '';
    try {
      const b = (JSON.parse(files['canvas.json'] ?? '{}') as { boards?: Record<string, { w?: number; h?: number }> }).boards?.[page];
      size = JSON.stringify([b?.w, b?.h]);
    } catch {
      // an unreadable index: the board's own files still decide
    }
    return { files: [...seen, ...assets], extra: size };
  }
  if (kind === 'slides') {
    const file = `slides/${page}.html`;
    const src = files[file] ?? '';
    const deck = parseDeck(files['deck.json']);
    return { files: [file, ...refs(src, REFS)], extra: JSON.stringify({ size: deckSize(deck), faces: deck.faces }) };
  }
  // docs
  const file = `tabs/${page}.md`;
  const src = files[file] ?? '';
  let look = '';
  try {
    const d = JSON.parse(files['doc.json'] ?? '{}') as { settings?: unknown; theme?: unknown; designSystems?: unknown };
    look = JSON.stringify({ s: d.settings, t: d.theme, d: d.designSystems });
  } catch {
    // an unreadable index
  }
  return { files: [file, ...refs(src, MD_REFS), ...Object.keys(files).filter((f) => /^ds\/[^/]+\/tokens\.json$/.test(f))], extra: look };
}

/** A folder id for a new picture's copy: short, lowercase, not among `taken`. */
export function newLinkId(taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(taken);
  for (;;) {
    const id = Math.floor(random() * 36 ** 5)
      .toString(36)
      .padStart(5, '0');
    if (!used.has(id)) return id;
  }
}

/** The folder a picture's copy lives in. */
export const linkedDir = (id: string): string => `${LINK_DIR}/${id}`;

/** A file name for the picture of a page: the page's stem, safe in a path. */
export function linkedStem(page: string): string {
  return page.replace(/\.dc\.html$/, '').replace(/\.[a-z]+$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'page';
}

/** Is this the copy of a linked picture (`uploads/linked/<id>/…`)? */
export const isLinkedPicture = (path: string): boolean => /^uploads\/linked\/[a-z0-9]{1,16}\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.png$/.test(path) && !path.includes('..');

const KINDS: ProjectKind[] = ['design', 'slides', 'design-system', 'dashboard', 'docs', 'motion'];

/**
 * Every linked page in an index's `imports`. A record written by the artboard import before pages
 * were linked (no `kind`, a `board`) is a live artboard of a canvas, so it reads as one.
 */
export function linkedPagesOf(index: { imports?: unknown } | undefined): LinkedPage[] {
  const raw = index?.imports;
  if (!Array.isArray(raw)) return [];
  const out: LinkedPage[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || typeof r.path !== 'string' || typeof r.from !== 'string') continue;
    const copiedAt = typeof r.copiedAt === 'string' ? r.copiedAt : '';
    const legacyBoard = typeof r.board === 'string' && isBoardEmbedPath(r.path);
    const kind = KINDS.includes(r.kind as ProjectKind) ? (r.kind as ProjectKind) : legacyBoard ? 'design' : null;
    const page = typeof r.page === 'string' ? r.page : legacyBoard ? (r.board as string) : null;
    if (!kind || !page) continue;
    const mode: LinkMode = r.mode === 'live' || r.mode === 'image' ? r.mode : legacyBoard ? 'live' : 'image';
    out.push({ path: r.path, from: r.from, ...(typeof r.rel === 'string' && r.rel ? { rel: r.rel } : {}), kind, page, mode, ...(typeof r.poster === 'string' && isLinkedPicture(r.poster) ? { poster: r.poster } : {}), ...(typeof r.at === 'string' ? { at: r.at } : {}), copiedAt });
  }
  return out;
}

/** The index's `imports` with `rec` put in (replacing the record of the same `path`); other keys of a record and other records stay as they are. */
export function putLinked(imports: unknown, rec: LinkedPage & { board?: string }): unknown[] {
  const list = Array.isArray(imports) ? [...imports] : [];
  const at = list.findIndex((r) => r && (r as { path?: unknown }).path === rec.path);
  // an artboard's record keeps `board` so editors from before linked pages still read it
  const next = rec.kind === 'design' && rec.mode === 'live' ? { ...rec, board: rec.page } : rec;
  if (at >= 0) list[at] = { ...(list[at] as object), ...next };
  else list.push(next);
  return list;
}

/** The index's `imports` without the record of `path`. */
export function dropLinked(imports: unknown, path: string): unknown[] {
  return (Array.isArray(imports) ? imports : []).filter((r) => !(r && (r as { path?: unknown }).path === path));
}

/** A PNG's pixel size, read from its header, or null when it is not one. */
export function pngSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [v.getUint32(16), v.getUint32(20)];
}

/** The state of one linked page against its original, as `link-check` reports it. */
export type LinkState = 'current' | 'changed' | 'deleted' | 'missing' | 'unreadable';

/** One project the picker lists: how its pages can be shown here, where it sits relative to the open project, and its pages. */
export interface LinkSource {
  name: string;
  title: string;
  kind: ProjectKind;
  /** how this project's pages can be shown where they go (the preferred first) */
  modes: LinkMode[];
  /** where it sits inside the open project's folder, when it does */
  inside?: string;
  /** the opened folder it shares with the open project */
  sameFolder?: boolean;
  /** the launcher group it is filed under */
  group?: string;
  pages: (SourcePage & { moving?: boolean })[];
}

/** What `link-check` says about one record. */
export interface LinkCheck {
  path: string;
  state: LinkState;
  /** the original project now (its handle) and its title, and the page's title, when it could be found */
  project?: string;
  title?: string;
  page?: string;
}
