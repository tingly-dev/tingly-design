import { CANVAS_FILE, parseCanvas } from './canvas';
import { DASH_INDEX, parseDash } from './dash';
import { DECK_FILE, deckSize, faceMarkup, parseDeck, slideFile, type ProjectKind } from './deck';
import { DOC_INDEX, parseDoc, tabFile } from './docs';
import { DS_COVER, DS_INDEX, DS_TOKENS, componentNames, dsGlance, type DsGlance, parseDsIndex, resolveTokens } from './designSystem';
import { MOTION_FILE, motionTimeline, parseMotion, primaryFormat, sceneFile, sceneTiming, speedOf, type MotionJson } from './motion';

/** What the launcher shows on a project's card: a title, counts and a small preview. */
export interface ProjectCard {
  name: string;
  title: string;
  kind: ProjectKind;
  /** the newest change to any of its files, ISO time */
  updatedAt: string | null;
  /** one count that says how big it is, e.g. 4 boards */
  count: number;
  /** the group the person filed it under on the launcher, if any */
  group?: string;
  /** the opened folder the project is in (its id and `~/…` path); `derived` when `group` is that folder's name and not one the person chose */
  folderGroup?: { id: string; path: string; derived: boolean };
  /** where its folder is, when it lives outside the projects folder (`~/…` under the home folder) */
  path?: string;
  /** names earlier versions gave it, which sources recorded in other projects may still carry */
  aliases?: string[];
  preview: ProjectPreview;
}

/** The file that holds a project's title, per kind. */
export const INDEX_FILE: Record<ProjectKind, string> = {
  design: CANVAS_FILE,
  slides: DECK_FILE,
  'design-system': DS_INDEX,
  dashboard: DASH_INDEX,
  docs: DOC_INDEX,
  motion: MOTION_FILE,
};

/** The index file's text with a new title, or undefined when it is not a JSON object. */
export function retitle(source: string | undefined, title: string): string | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(source ?? '{}');
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return JSON.stringify({ ...(raw as Record<string, unknown>), title }, null, 2) + '\n';
}

/** A group's name as stored: trimmed, one line, at most 40 characters; empty means no group. */
export function cleanGroup(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
}

export type ProjectPreview =
  | {
      kind: 'design';
      /** every artboard's box, for the minimap */
      boards: { x: number; y: number; w: number; h: number; title: string }[];
      /** the board the canvas opens on (or its first), rendered live */
      board?: { file: string; w: number; h: number; source: string };
    }
  | { kind: 'slides'; cover?: { file: string; source: string; head: string; size?: [number, number] } }
  | {
      kind: 'design-system';
      colors: string[];
      components: string[];
      fonts: string[];
      glance: DsGlance;
      /** the second theme, when there is one, for a light | dark sample */
      alt?: { name: string; glance: DsGlance };
      /** Google Fonts stylesheets the sample's faces need */
      hosted: string[];
      /** it has a cover (components/Cover/preview.html), which the card draws, fetching it when it scrolls near */
      cover: boolean;
    }
  | { kind: 'dashboard'; datasets: string[] }
  | { kind: 'docs'; tabs: { title: string; depth: number }[]; excerpt: string }
  | {
      kind: 'motion';
      /** every format's name and size, the primary one first */
      formats: { name: string; w: number; h: number }[];
      /** seconds of video, after speed */
      seconds: number;
      /** what the card shows standing still: the cover scene, the scene a cover frame falls in with `at` (authored ms into it), else most of the way through the first scene */
      still?: { motion: MotionJson; id: string; source: string; at?: number };
    };

/** A source the launcher frame renders; larger ones show the schematic preview only. */
const MAX_PREVIEW_SOURCE = 200_000;

interface CardCtx {
  files: string[];
  read: (rel: string) => Promise<string | undefined>;
  /** `read`, but nothing for a source too large for the launcher frame to render. */
  small: (rel: string) => Promise<string | undefined>;
}

type CardBody = Pick<ProjectCard, 'title' | 'count' | 'preview'>;

/** What each kind shows on its card: one entry per kind, so a kind added later fails to compile until it has a preview. */
const CARD: Record<ProjectKind, (c: CardCtx) => Promise<CardBody>> = {
  async slides({ read, small }) {
    const deck = parseDeck(await read(DECK_FILE));
    const id: string | undefined = deck.cover && deck.order.includes(deck.cover) ? deck.cover : deck.order[0];
    const source = id ? await small(slideFile(id)) : undefined;
    return {
      title: deck.title,
      count: deck.order.length,
      preview: { kind: 'slides', cover: id && source !== undefined ? { file: slideFile(id), source, head: faceMarkup(deck), size: deckSize(deck) } : undefined },
    };
  },
  async motion({ read, small }) {
    const motion = parseMotion(await read(MOTION_FILE));
    const sources: Record<string, string> = {};
    for (const id of motion.order) {
      const s = await read(sceneFile(id));
      if (s !== undefined) sources[id] = s;
    }
    const ids = motion.order.filter((id) => id in sources);
    const timeline = motionTimeline(ids.map((id) => ({ id, ...sceneTiming(sources[id]) })));
    const coverId = motion.cover && 'scene' in motion.cover ? motion.cover.scene : undefined;
    // a cover frame: the scene under it, stopped that far in (a transition in progress shows the scene coming in)
    const coverAt = motion.cover && 'at' in motion.cover ? Math.min(motion.cover.at, timeline.duration) : undefined;
    const under = coverAt !== undefined ? timeline.scenes.findLast((w) => coverAt >= w.start) : undefined;
    const stillId = coverId && (await small(sceneFile(coverId))) !== undefined ? coverId : (under?.id ?? ids[0]);
    const stillSource = stillId ? (stillId === coverId ? await small(sceneFile(stillId)) : sources[stillId]) : undefined;
    const primary = primaryFormat(motion);
    const formats = [primary, ...Object.keys(motion.formats).filter((f) => f !== primary)].map((name) => ({ name, w: motion.formats[name].size[0], h: motion.formats[name].size[1] }));
    return {
      title: motion.title,
      count: ids.length,
      preview: {
        kind: 'motion',
        formats,
        seconds: Math.round(timeline.duration / speedOf(motion.speed) / 100) / 10,
        still: stillId && stillSource !== undefined && stillSource.length <= MAX_PREVIEW_SOURCE ? { motion, id: stillId, source: stillSource, ...(under && stillId === under.id ? { at: coverAt! - under.start } : {}) } : undefined,
      },
    };
  },
  async 'design-system'({ files, read }) {
    const index = parseDsIndex(await read(DS_INDEX));
    const tokens = resolveTokens((await read(DS_TOKENS)) ?? '');
    const theme = tokens.themes[0]?.id;
    const glance = dsGlance(tokens);
    // the roles first (page, card, text, brand), then the rest, so a few swatches already say what the system is
    const roles = [glance.paper, glance.surface, glance.ink, glance.accent].filter((v): v is string => !!v);
    const rest = tokens.colors.map((c) => (theme && c.values[theme]) || Object.values(c.values)[0]).filter((v): v is string => !!v && !roles.includes(v));
    const colors = [...roles, ...rest];
    const components = componentNames(files, await read('components/bundle.js'));
    const fonts = [...new Set(Object.values(tokens.families).map((f) => f.split(',')[0].replace(/["']/g, '').trim()))].filter(Boolean);
    const cover = files.includes(DS_COVER);
    return { title: index.title, count: components.length, preview: { kind: 'design-system', colors: colors.slice(0, 12), components: components.slice(0, 8), fonts: fonts.slice(0, 3), glance, alt: tokens.themes[1] ? { name: tokens.themes[1].name, glance: dsGlance(tokens, tokens.themes[1].id) } : undefined, hosted: tokens.hosted.map((h) => h.href).slice(0, 4), cover } };
  },
  async dashboard({ files, read }) {
    const dash = parseDash(await read(DASH_INDEX));
    const sets = files.filter((f) => /^datasets\/[^/]+\.json$/.test(f)).sort();
    const titles: string[] = [];
    for (const f of sets.slice(0, 6)) {
      let t = f.slice('datasets/'.length, -'.json'.length);
      try {
        const j = JSON.parse((await read(f)) ?? '{}') as { title?: unknown };
        if (typeof j.title === 'string' && j.title.trim()) t = j.title;
      } catch {
        // keep the file name
      }
      titles.push(t);
    }
    return { title: dash.title, count: sets.length, preview: { kind: 'dashboard', datasets: titles } };
  },
  async docs({ read }) {
    const doc = parseDoc(await read(DOC_INDEX));
    const depth = (parent: string | undefined): number => {
      let n = 0;
      for (let p = parent; p && n < 4; p = doc.tabs.find((x) => x.id === p)?.parent) n++;
      return n;
    };
    const first = doc.tabs[0];
    const md = first ? ((await read(tabFile(first.id))) ?? '') : '';
    const excerpt =
      md
        .split(/\n\s*\n/)
        .map((b) => b.trim())
        .find((b) => b && !/^(#|>|\||[-*+] |\d+\. |```|<|!\[)/.test(b) && !/^\w[\w ]*:/.test(b))
        ?.replace(/[*_`[\]]|\(https?:[^)]*\)/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 160) ?? '';
    return {
      title: doc.title,
      count: doc.tabs.length,
      preview: { kind: 'docs', tabs: doc.tabs.slice(0, 6).map((t) => ({ title: t.title, depth: depth(t.parent) })), excerpt },
    };
  },
  async design({ read, small }) {
    const canvas = parseCanvas(await read(CANVAS_FILE));
    const boards = canvas.order.map((f) => ({ file: f, ...canvas.boards[f] }));
    const launch = canvas.launch.file && canvas.boards[canvas.launch.file] ? canvas.launch.file : boards[0]?.file;
    const entry = launch ? canvas.boards[launch] : undefined;
    const source = launch ? await small(launch) : undefined;
    return {
      title: canvas.title,
      count: boards.length,
      preview: {
        kind: 'design',
        boards: boards.slice(0, 24).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, title: b.title ?? b.file })),
        board: launch && entry && source !== undefined ? { file: launch, w: entry.w, h: entry.h, source } : undefined,
      },
    };
  },
};

/** The card for one project, from its tracked files and a reader for them. */
export async function projectCard(
  name: string,
  kind: ProjectKind,
  files: string[],
  read: (rel: string) => Promise<string | undefined>,
  updatedAt: string | null = null,
): Promise<ProjectCard> {
  const small = async (rel: string) => {
    const s = await read(rel);
    return s !== undefined && s.length <= MAX_PREVIEW_SOURCE ? s : undefined;
  };
  return { name, kind, updatedAt, ...(await CARD[kind]({ files, read, small })) };
}
