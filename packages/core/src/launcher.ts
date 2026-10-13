import { CANVAS_FILE, parseCanvas } from './canvas';
import { DASH_INDEX, parseDash } from './dash';
import { DECK_FILE, faceMarkup, parseDeck, slideFile, type ProjectKind } from './deck';
import { DOC_INDEX, parseDoc, tabFile } from './docs';
import { DS_INDEX, DS_TOKENS, componentNames, parseDsIndex, resolveTokens } from './designSystem';
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
  preview: ProjectPreview;
}

export type ProjectPreview =
  | {
      kind: 'design';
      /** every artboard's box, for the minimap */
      boards: { x: number; y: number; w: number; h: number; title: string }[];
      /** the board the canvas opens on (or its first), rendered live */
      board?: { file: string; w: number; h: number; source: string };
    }
  | { kind: 'slides'; cover?: { file: string; source: string; head: string } }
  | { kind: 'design-system'; colors: string[]; components: string[]; fonts: string[] }
  | { kind: 'dashboard'; datasets: string[] }
  | { kind: 'docs'; tabs: { title: string; depth: number }[]; excerpt: string }
  | {
      kind: 'motion';
      /** every format's name and size, the primary one first */
      formats: { name: string; w: number; h: number }[];
      /** seconds of video, after speed */
      seconds: number;
      /** what the card shows standing still: the cover scene, else the first scene at its end */
      still?: { motion: MotionJson; id: string; source: string };
    };

/** A source the launcher frame renders; larger ones show the schematic preview only. */
const MAX_PREVIEW_SOURCE = 200_000;

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
  if (kind === 'slides') {
    const deck = parseDeck(await read(DECK_FILE));
    const id: string | undefined = deck.cover && deck.order.includes(deck.cover) ? deck.cover : deck.order[0];
    const source = id ? await small(slideFile(id)) : undefined;
    return {
      name,
      title: deck.title,
      kind,
      updatedAt,
      count: deck.order.length,
      preview: { kind, cover: id && source !== undefined ? { file: slideFile(id), source, head: faceMarkup(deck) } : undefined },
    };
  }
  if (kind === 'motion') {
    const motion = parseMotion(await read(MOTION_FILE));
    const sources: Record<string, string> = {};
    for (const id of motion.order) {
      const s = await read(sceneFile(id));
      if (s !== undefined) sources[id] = s;
    }
    const ids = motion.order.filter((id) => id in sources);
    const timeline = motionTimeline(ids.map((id) => ({ id, ...sceneTiming(sources[id]) })));
    const coverId = motion.cover && 'scene' in motion.cover ? motion.cover.scene : undefined;
    const stillId = coverId && (await small(sceneFile(coverId))) !== undefined ? coverId : ids[0];
    const stillSource = stillId ? (stillId === coverId ? await small(sceneFile(stillId)) : sources[stillId]) : undefined;
    const primary = primaryFormat(motion);
    const formats = [primary, ...Object.keys(motion.formats).filter((f) => f !== primary)].map((name) => ({ name, w: motion.formats[name].size[0], h: motion.formats[name].size[1] }));
    return {
      name,
      title: motion.title,
      kind,
      updatedAt,
      count: ids.length,
      preview: {
        kind,
        formats,
        seconds: Math.round(timeline.duration / speedOf(motion.speed) / 100) / 10,
        still: stillId && stillSource !== undefined && stillSource.length <= MAX_PREVIEW_SOURCE ? { motion, id: stillId, source: stillSource } : undefined,
      },
    };
  }
  if (kind === 'design-system') {
    const index = parseDsIndex(await read(DS_INDEX));
    const tokens = resolveTokens((await read(DS_TOKENS)) ?? '');
    const theme = tokens.themes[0]?.id;
    const colors = tokens.colors.map((c) => (theme && c.values[theme]) || Object.values(c.values)[0]).filter((v): v is string => !!v);
    const components = componentNames(files, await read('components/bundle.js'));
    const fonts = [...new Set(Object.values(tokens.families).map((f) => f.split(',')[0].replace(/["']/g, '').trim()))].filter(Boolean);
    return { name, title: index.title, kind, updatedAt, count: components.length, preview: { kind, colors: colors.slice(0, 12), components: components.slice(0, 8), fonts: fonts.slice(0, 3) } };
  }
  if (kind === 'dashboard') {
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
    return { name, title: dash.title, kind, updatedAt, count: sets.length, preview: { kind, datasets: titles } };
  }
  if (kind === 'docs') {
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
      name,
      title: doc.title,
      kind,
      updatedAt,
      count: doc.tabs.length,
      preview: { kind, tabs: doc.tabs.slice(0, 6).map((t) => ({ title: t.title, depth: depth(t.parent) })), excerpt },
    };
  }
  const canvas = parseCanvas(await read(CANVAS_FILE));
  const boards = canvas.order.map((f) => ({ file: f, ...canvas.boards[f] }));
  const launch = canvas.launch.file && canvas.boards[canvas.launch.file] ? canvas.launch.file : boards[0]?.file;
  const entry = launch ? canvas.boards[launch] : undefined;
  const source = launch ? await small(launch) : undefined;
  return {
    name,
    title: canvas.title,
    kind,
    updatedAt,
    count: boards.length,
    preview: {
      kind,
      boards: boards.slice(0, 24).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, title: b.title ?? b.file })),
      board: launch && entry && source !== undefined ? { file: launch, w: entry.w, h: entry.h, source } : undefined,
    },
  };
}
