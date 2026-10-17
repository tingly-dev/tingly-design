/**
 * A whole project read as data, for anything that is not the editor: what is in
 * it (`outlineProject`) and what is wrong with it (`checkProject`). Both take the
 * project's text files by path, so the CLI, the server and tests share them.
 * No wording here: a problem is a code with its parameters, plus the checker's
 * own message where a per-file checker already wrote one (see .design/cli.md).
 */
import { CANVAS_FILE, isBoardFile, parseCanvas } from './canvas';
import { checkCanvas } from './canvasCheck';
import { DASH_INDEX, DASH_PAGE, datasetIdOf, parseDash, parseDataset } from './dash';
import { DECK_FILE, deckOrder, parseDeck, slideFile, type ProjectKind } from './deck';
import { DS_INDEX, DS_TOKENS, parseDsIndex, resolveTokens } from './designSystem';
import { DOC_INDEX, parseDoc, tabFile, tabOrder, wordCount } from './docs';
import { INDEX_FILE } from './launcher';
import { MOTION_FILE, motionTimeline, parseMotion, sceneFile, sceneTiming, checkScene } from './motion';
import { parseDc } from './parse';
import { checkSlide, type IssueLevel } from './slides';

/** The project's text files, path → content, as the server reads them. */
export type ProjectFiles = Record<string, string>;

/** One thing in a project, in the order a person sees it in the editor. */
export interface OutlineItem {
  /** board, slide, scene, tab, dataset, page, format, color, font, component */
  type: string;
  id: string;
  title?: string;
  file?: string;
  /** Pixels: a board's or a format's size. */
  size?: [number, number];
  /** Milliseconds from the start of the video (a scene, at the piece's speed). */
  start?: number;
  /** Milliseconds (a scene, at the piece's speed). */
  duration?: number;
  /** How a scene leaves: its transition and how long it overlaps the next one. */
  transition?: string;
  /** A doc tab's parent tab. */
  parent?: string;
  /** A doc tab's length. */
  words?: number;
  /** Where a dataset's rows come from: `file` or `query`. */
  source?: string;
}

export interface ProjectOutline {
  kind: ProjectKind;
  title: string;
  items: OutlineItem[];
  /** Motion only: the whole video, in milliseconds at the piece's speed. */
  duration?: number;
}

export type ProblemCode = 'badIndex' | 'missingFile' | 'unlisted' | 'badFile' | 'issue' | 'badDataset' | 'badTokens' | 'badCover' | 'canvas' | 'snapshot' | 'seek' | 'pageError' | 'notLoaded' | 'layout';

export interface ProjectProblem {
  level: Exclude<IssueLevel, 'note'>;
  file: string;
  code: ProblemCode;
  /** What the per-file checker said (`issue`, `badFile`, `badDataset`, `badTokens`), or the page (`pageError`, `notLoaded`), in its own words. */
  message?: string;
  /** The file a missing reference points at (`missingFile`), the index an unlisted file is missing from (`unlisted`), or the cover scene (`badCover`). */
  ref?: string;
  /** `canvas`: the `checkCanvas` rule id; `layout`: what the snapshot's layout probe found (`clipped`, `outside`, `contrast`, `blank`); and the values its wording needs. */
  rule?: string;
  params?: Record<string, string | number>;
}

function json(text: string | undefined): unknown {
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function outlineProject(kind: ProjectKind, files: ProjectFiles): ProjectOutline {
  const index = files[INDEX_FILE[kind]];
  if (kind === 'design') {
    const c = parseCanvas(index);
    const order = [...c.order.filter((f) => c.boards[f]), ...Object.keys(c.boards).filter((f) => !c.order.includes(f))];
    return { kind, title: c.title, items: order.map((f) => ({ type: 'board', id: f.replace(/\.dc\.html$/, ''), file: f, title: c.boards[f].title, size: [c.boards[f].w, c.boards[f].h] })) };
  }
  if (kind === 'slides') {
    const d = parseDeck(index);
    return { kind, title: d.title, items: deckOrder(d, Object.keys(files)).map((id) => ({ type: 'slide', id, file: slideFile(id), title: firstHeading(files[slideFile(id)]) })) };
  }
  if (kind === 'motion') {
    const m = parseMotion(index);
    const speed = m.speed && m.speed > 0 ? m.speed : 1;
    const ids = m.order.filter((id) => files[sceneFile(id)] !== undefined);
    const t = motionTimeline(ids.map((id) => ({ id, ...sceneTiming(files[sceneFile(id)]) })));
    const at = (ms: number) => Math.round(ms / speed);
    return {
      kind,
      title: m.title,
      duration: at(t.duration),
      items: [
        ...Object.entries(m.formats).map(([id, f]) => ({ type: 'format', id, size: f.size })),
        ...t.scenes.map((s) => ({
          type: 'scene',
          id: s.id,
          file: sceneFile(s.id),
          title: firstHeading(files[sceneFile(s.id)]),
          start: at(s.start),
          duration: at(s.duration),
          ...(s.transition.duration ? { transition: `${s.transition.kind} ${at(s.transition.duration)}ms` } : {}),
        })),
      ],
    };
  }
  if (kind === 'docs') {
    const d = parseDoc(index);
    return { kind, title: d.title, items: tabOrder(d).map((t) => ({ type: 'tab', id: t.id, title: t.title, file: tabFile(t.id), ...(t.parent ? { parent: t.parent } : {}), words: wordCount(files[tabFile(t.id)] ?? '') })) };
  }
  if (kind === 'dashboard') {
    const d = parseDash(index);
    const items: OutlineItem[] = [{ type: 'page', id: 'index', file: DASH_PAGE }];
    for (const f of Object.keys(files).sort()) {
      const id = datasetIdOf(f);
      if (!id) continue;
      const { dataset } = parseDataset(files[f]);
      items.push({ type: 'dataset', id, file: f, title: dataset?.title, source: dataset?.source.kind });
    }
    return { kind, title: d.title, items };
  }
  const ds = parseDsIndex(index);
  const tokens = resolveTokens(json(files[DS_TOKENS]) ?? {});
  const items: OutlineItem[] = [
    ...tokens.colors.map((c) => ({ type: 'color', id: c.name })),
    ...Object.keys(tokens.families).map((id) => ({ type: 'font', id })),
    ...Object.keys(files)
      .filter((f) => /^components\/[^/]+\.html$/.test(f))
      .sort()
      .map((f) => ({ type: 'component', id: f.slice('components/'.length, -'.html'.length), file: f })),
  ];
  return { kind, title: ds.title, items };
}

/** The first heading's text, as the slide or scene's name in a list. */
function firstHeading(src: string | undefined): string | undefined {
  const m = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(src ?? '');
  const text = m?.[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 80) : undefined;
}

/**
 * Everything the editor would complain about, without drawing anything: the index
 * file reads, every file it lists is there, each artboard, slide and scene passes its
 * own checker, datasets and tokens parse. Drawing problems (a picture that does not
 * load, an embed that throws) need a page and are not found here.
 */
export function checkProject(kind: ProjectKind, files: ProjectFiles): ProjectProblem[] {
  const out: ProjectProblem[] = [];
  const indexFile = INDEX_FILE[kind];
  if (!isObject(json(files[indexFile]))) {
    out.push({ level: 'error', file: indexFile, code: 'badIndex' });
    return out;
  }
  const missing = (file: string, ref: string) => out.push({ level: 'error', file, code: 'missingFile', ref });
  const issues = (file: string, list: { level: IssueLevel; message: string }[]) => {
    for (const i of list) if (i.level !== 'note') out.push({ level: i.level, file, code: 'issue', message: i.message });
  };

  if (kind === 'design') {
    const c = parseCanvas(files[CANVAS_FILE]);
    for (const f of Object.keys(c.boards)) {
      if (files[f] === undefined) missing(CANVAS_FILE, f);
      else for (const e of parseDc(files[f]).errors) out.push({ level: 'error', file: f, code: 'badFile', message: e });
    }
    for (const f of Object.keys(files)) if (isBoardFile(f) && !f.includes('/') && !c.boards[f]) out.push({ level: 'warning', file: f, code: 'unlisted', ref: CANVAS_FILE });
    // the listing rules above already cover missing and unlisted boards
    const boards = Object.fromEntries(Object.entries(files).filter(([f]) => c.boards[f]));
    for (const i of checkCanvas({ canvas: files[CANVAS_FILE], boards })) {
      if (i.rule === 'board-file-missing' || i.rule === 'board-unlisted') continue;
      out.push({ level: i.level, file: i.file, code: 'canvas', rule: i.rule, params: { line: i.line, ...i.params } });
    }
  } else if (kind === 'slides') {
    const d = parseDeck(files[DECK_FILE]);
    for (const id of d.order) if (files[slideFile(id)] === undefined) missing(DECK_FILE, slideFile(id));
    for (const id of deckOrder(d, Object.keys(files))) issues(slideFile(id), checkSlide(parseDc(files[slideFile(id)]), id));
  } else if (kind === 'motion') {
    const m = parseMotion(files[MOTION_FILE]);
    for (const id of m.order) {
      const f = sceneFile(id);
      if (files[f] === undefined) missing(MOTION_FILE, f);
      else issues(f, checkScene(parseDc(files[f]), id));
    }
    if (m.cover && 'scene' in m.cover && files[sceneFile(m.cover.scene)] === undefined) out.push({ level: 'error', file: MOTION_FILE, code: 'badCover', ref: m.cover.scene });
  } else if (kind === 'docs') {
    const d = parseDoc(files[DOC_INDEX]);
    for (const t of d.tabs) if (files[tabFile(t.id)] === undefined) missing(DOC_INDEX, tabFile(t.id));
  } else if (kind === 'dashboard') {
    if (files[DASH_PAGE] === undefined) missing(DASH_INDEX, DASH_PAGE);
    for (const f of Object.keys(files)) {
      if (!datasetIdOf(f)) continue;
      const { error } = parseDataset(files[f]);
      if (error) out.push({ level: 'error', file: f, code: 'badDataset', message: error });
    }
  } else if (kind === 'design-system') {
    if (files[DS_TOKENS] === undefined) missing(DS_INDEX, DS_TOKENS);
    else {
      const raw = json(files[DS_TOKENS]);
      if (!isObject(raw)) out.push({ level: 'error', file: DS_TOKENS, code: 'badTokens' });
      else for (const i of resolveTokens(raw).issues) out.push({ level: 'warning', file: DS_TOKENS, code: 'badTokens', message: `${i.at}: ${i.message}` });
    }
  }
  return out;
}

/**
 * Where `history --since` starts: after a change-log entry (its id, as `history --json`
 * gives it, so an agent can ask "what changed since I last looked"), or after a time
 * (an ISO date, or how long ago: `30m`, `2h`, `1d`). Null when it is neither.
 */
export function parseSince(since: string, now = Date.now()): { id: string } | { after: number } | null {
  const v = since.trim();
  const ago = /^(\d+)\s*(s|m|h|d)$/i.exec(v);
  if (ago) return { after: now - Number(ago[1]) * { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7 }[ago[2].toLowerCase() as 's' | 'm' | 'h' | 'd'] };
  if (/^[0-9a-f]{8}$/i.test(v)) return { id: v.toLowerCase() };
  const at = /^\d{4}-\d{2}-\d{2}/.test(v) ? Date.parse(v) : NaN;
  return Number.isNaN(at) ? null : { after: at };
}

/** The change-log entries after `since`, oldest first; null when `since` names an entry that is not there (it was trimmed, or belongs to another project). */
export function journalSince<E extends { id: string; at: string }>(entries: E[], since: { id: string } | { after: number } | null): E[] | null {
  if (!since) return entries;
  if ('id' in since) {
    const i = entries.findIndex((e) => e.id === since.id);
    return i < 0 ? null : entries.slice(i + 1);
  }
  return entries.filter((e) => Date.parse(e.at) > since.after);
}
