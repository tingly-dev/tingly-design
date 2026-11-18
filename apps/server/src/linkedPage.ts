import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { linkModes, pageDeps, pagesOf, parseDc, parseMotion, timeSpec, type LinkedPage, type ProjectCard, type ProjectKind, type SourcePage } from '@dc/core';
import { exportFromPage, PageExportError, type PageJob } from './pageExport';
import { listTrash } from './trash';
import { ownEditor } from './running';
import { HttpError, folderGroupOf, kindOf, listProjectEntries, listProjects, nameOfFolder, projectDir, readEntry, readProject, resolveKey } from './store';

/** The tracked text files of a project, as the core's page readers take them. */
export async function textFiles(name: string): Promise<Record<string, string>> {
  const all = await readProject(name);
  return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.content]));
}

/**
 * A hash of what one page of a project is made of (core's `pageDeps`: the page's files, the pictures
 * they show, the few index fields that change the picture; every file for a one-page kind). The copy's
 * record keeps it, and the original has changed when the same page hashes differently now.
 */
export async function fingerprint(name: string, kind: ProjectKind, page: string, files?: Record<string, string>): Promise<string> {
  const text = files ?? (await textFiles(name));
  const deps = pageDeps(kind, page, text);
  let paths = deps.files;
  if (deps.whole) paths = (await listProjectEntries(name)).map((e) => e.path).filter((p) => !p.startsWith('renders/'));
  const h = createHash('sha1');
  h.update(deps.extra);
  for (const rel of [...new Set(paths)].sort()) {
    h.update('\0' + rel + '\0');
    const bytes = await readEntry(name, rel).catch(() => null);
    h.update(bytes ?? '(none)');
  }
  return `sha1:${h.digest('hex')}`;
}

export interface Source {
  name: string;
  dir: string;
  kind: ProjectKind;
}

/**
 * The project a record came from, now: where `rel` points inside this project when it is registered,
 * else the handle in `from` (an old name still answers); `deleted` when it is in the trash, `missing`
 * when it is nowhere on this machine.
 */
export async function resolveSource(target: string, rec: Pick<LinkedPage, 'from' | 'rel'>): Promise<Source | 'deleted' | 'missing'> {
  if (rec.rel && !isAbsolute(rec.rel) && !rec.rel.includes('..')) {
    const dir = resolve(projectDir(target), rec.rel);
    const name = nameOfFolder(dir);
    const kind = name ? await kindOf(dir) : null;
    if (name && kind) return { name, dir, kind };
  }
  const handle = rec.from.replace(/^projects\//, '');
  const key = resolveKey(handle);
  const dir = projectDir(key);
  const kind = await kindOf(dir).catch(() => null);
  if (kind) return { name: key, dir, kind };
  const trashed = (await listTrash().catch(() => [])).some((t) => t.name === handle || t.name === key);
  return trashed ? 'deleted' : 'missing';
}

/** Where a project sits inside another's folder (`sub/hero`), or null when it does not. */
export function relInside(outer: string, inner: string): string | null {
  const r = relative(outer, inner);
  return r && !r.startsWith('..') && !isAbsolute(r) ? r.split('\\').join('/') : null;
}

export interface SourceProject {
  name: string;
  title: string;
  kind: ProjectKind;
  /** how this project can be shown where the page goes (the preferred first) */
  modes: ('live' | 'image')[];
  /** where it sits inside the open project's folder, when it does */
  inside?: string;
  /** the opened folder it shares with the open project */
  sameFolder?: boolean;
  /** the folder group's name or the launcher group, to head the list */
  group?: string;
  pages: (SourcePage & { moving?: boolean })[];
}

/** The projects whose pages the open one can take, with each project's pages. */
export async function sourcesFor(target: string, targetKind: ProjectKind): Promise<SourceProject[]> {
  const cards = await listProjects();
  const me = folderGroupOf(target)?.id;
  const out: SourceProject[] = [];
  for (const c of cards as ProjectCard[]) {
    if (c.name === target) continue;
    const modes = linkModes(c.kind, targetKind);
    if (!modes.length) continue;
    let files: Record<string, string>;
    try {
      files = await textFiles(c.name);
    } catch {
      continue;
    }
    const pages = pagesOf(c.kind, files).map((p) => {
      if (c.kind !== 'design') return p;
      const moving = !!timeSpec(parseDc(files[p.page] ?? '').props);
      return moving ? { ...p, moving } : p;
    });
    if (!pages.length) continue;
    const inside = relInside(projectDir(target), projectDir(c.name));
    const mine = folderGroupOf(c.name)?.id;
    out.push({
      name: c.name,
      title: c.title,
      kind: c.kind,
      modes,
      ...(inside ? { inside } : {}),
      ...(me && mine === me ? { sameFolder: true } : {}),
      ...(c.group ? { group: c.group } : {}),
      pages,
    });
  }
  // inside this project first, then the same folder, then the rest by title
  const rank = (s: SourceProject) => (s.inside ? 0 : s.sameFolder ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

/** What the editor's own export menu is asked for to draw one page: the same item the person would click. */
function jobFor(kind: ProjectKind, page: string, files: Record<string, string>): PageJob {
  // a board is drawn at its own size (2x made a 5 MB picture of a full-HD board), as a slide is
  if (kind === 'design' || kind === 'slides' || kind === 'docs') return { pick: page, item: 'png' };
  if (kind === 'motion') return { item: parseMotion(files['motion.json']).cover ? 'cover' : 'frame' };
  return { item: 'png' };
}

let drawing: Promise<unknown> = Promise.resolve();

/**
 * A picture of one page of a project, drawn the way its Export menu draws it (the machine's Chrome opens
 * this editor on the project and runs the menu item, as `tingly-design export --as png` does), so what the
 * person would save from the original is what the copy shows. One at a time: each draw starts a browser.
 */
export function renderPagePng(project: string, kind: ProjectKind, page: string, files: Record<string, string>, lang = 'en'): Promise<Buffer> {
  const run = async (): Promise<Buffer> => {
    const self = ownEditor();
    if (!self) throw new HttpError(503, 'linkRenderFailed', { page, detail: 'no editor address' });
    try {
      const { results } = await exportFromPage({ editor: self.editor, project, lang, jobs: [jobFor(kind, page, files)] });
      const r = results[0];
      const file = r?.files.find((f) => f.type === 'image/png') ?? r?.files[0];
      if (!file) throw new HttpError(502, 'linkRenderFailed', { page, detail: r?.errors.join('; ') || 'nothing was saved' });
      return file.data;
    } catch (e) {
      if (e instanceof PageExportError && e.code === 'no-chrome') throw new HttpError(503, 'linkNoChrome');
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, 'linkRenderFailed', { page, detail: (e as Error).message });
    }
  };
  const next = drawing.then(run, run);
  drawing = next.catch(() => {});
  return next;
}

/** What one refresh replaced, kept so its toast can take it back; in memory, for the minutes the toast lives. */
interface Stash {
  record: LinkedPage;
  files: { rel: string; bytes: Buffer | null }[];
}
const stashes = new Map<string, Stash>();
const STASH_MAX = 20;

export const stashKey = (project: string, path: string) => `${project}\0${path}`;

export function keepStash(project: string, s: Stash): void {
  const key = stashKey(project, s.record.path);
  stashes.delete(key);
  stashes.set(key, s);
  while (stashes.size > STASH_MAX) stashes.delete(stashes.keys().next().value as string);
}

export function takeStash(project: string, path: string): Stash | undefined {
  const key = stashKey(project, path);
  const s = stashes.get(key);
  stashes.delete(key);
  return s;
}
