import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import {
  CANVAS_FILE,
  MOTION_FILE,
  isMotionFile,
  newMotion,
  sceneFile,
  DASH_DATA_TYPES,
  IMAGE_TYPES,
  isKeptPath,
  isUploadPath,
  DOC_INDEX,
  isDocFile,
  newDocTab,
  parseDoc,
  stringifyDoc,
  tabFile,
  DASH_INDEX,
  DASH_PAGE,
  DASH_STARTER_PAGE,
  isDashFile,
  isDataPath,
  newDash,
  parseDash,
  stringifyDash,
  DECK_FILE,
  DS_INDEX,
  DS_README,
  DS_TOKENS,
  DS_TOKENS_CSS,
  compileTokensCss,
  isDsTextFile,
  namespaceOf,
  newDsIndex,
  parseDsIndex,
  resolveTokens,
  starterTokens,
  stringifyDsIndex,
  isBoardFile,
  isSlideFile,
  newBoardSource,
  newSlideSource,
  parseCanvas,
  parseDeck,
  slideFile,
  stringifyCanvas,
  stringifyDeck,
  projectCard,
  type ProjectCard,
  type ProjectKind,
} from '@dc/core';
import { PROJECTS_DIR, SAMPLES_DIR } from './layout';
import type { ErrorKey, Language, TFunction } from '@dc/i18n';
import { translator } from '@dc/i18n';

export { PROJECTS_DIR, ROOT as REPO_ROOT } from './layout';

export interface FileState {
  content: string;
  version: string;
}

export function versionOf(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

export function isProjectName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name);
}

export function projectDir(name: string): string {
  if (!isProjectName(name)) throw new HttpError(400, 'badProjectName');
  return join(PROJECTS_DIR, name);
}

/**
 * A refused request. `key` names the message in @dc/i18n's `errors` area; the server's error
 * handler words it in the language of the request, so the person reads it in the editor's language.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    public key: ErrorKey,
    public params: Record<string, string | number> = {},
  ) {
    super(key);
  }
}

/** A path inside a project that the editor is allowed to read and write. */
export function safeRel(rel: string): string {
  const r = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (r === CANVAS_FILE || isBoardFile(r) || r === DECK_FILE || isSlideFile(r)) return r;
  if (isDashFile(r) || isDocFile(r) || isMotionFile(r)) return r;
  // a design system's text files, and a copy of one installed into a canvas or deck
  if (isDsTextFile(r) || /^ds\/[a-z0-9][a-z0-9_-]{0,63}\/tokens\.json$/.test(r)) return r;
  throw new HttpError(400, 'notProjectFile', { path: rel });
}

/** Images and fonts a project keeps beside its files (binary, never edited as text). */
export const ASSET_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

/** The media type a project's binary file is served with. */
export function assetType(rel: string): string {
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
  if (rel.startsWith('uploads/')) return uploadType(ext);
  return (rel.startsWith('data/') ? DASH_DATA_TYPES[ext] : ASSET_TYPES[ext]) ?? 'application/octet-stream';
}

/** A file kept in uploads/ is served as an image, a font, a PDF, an SVG, or else plain text (never as a page or a script). */
function uploadType(ext: string): string {
  if (IMAGE_TYPES[ext]) return IMAGE_TYPES[ext];
  if (ext !== 'svg' && ASSET_TYPES[ext]) return ASSET_TYPES[ext];
  if (ext === 'ico') return 'image/x-icon';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'svg') return 'image/svg+xml';
  return 'text/plain; charset=utf-8';
}

export function assetRel(rel: string): string {
  const r = rel.replace(/\\/g, '/');
  // a dashboard's data files: csv, tsv, json, SQLite
  if (isDataPath(r)) return r;
  // what people brought in: files attached to requests, folders they imported
  if (isUploadPath(r) || isKeptPath(r)) return r;
  const m = /^(assets(?:\/[A-Za-z0-9_][A-Za-z0-9_ -]{0,60})?|fonts|ds\/[a-z0-9][a-z0-9_-]{0,63}\/(?:assets(?:\/[A-Za-z0-9_][A-Za-z0-9_ -]{0,60})?|fonts))\/([A-Za-z0-9_-][A-Za-z0-9_. -]{0,120})\.([a-z0-9]+)$/i.exec(r);
  if (!m || r.includes('..') || !ASSET_TYPES[m[3].toLowerCase()]) throw new HttpError(400, 'notAssetPath', { path: rel });
  return r;
}

export async function kindOf(dir: string): Promise<ProjectKind | null> {
  for (const [file, kind] of [[DECK_FILE, 'slides'], [DASH_INDEX, 'dashboard'], [DOC_INDEX, 'docs'], [MOTION_FILE, 'motion'], [CANVAS_FILE, 'design'], [DS_INDEX, 'design-system']] as const) {
    try {
      await stat(join(dir, file));
      return kind;
    } catch {
      // try the next
    }
  }
  return null;
}

export function isTracked(rel: string): boolean {
  try {
    safeRel(rel);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir: string, base: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, base, out);
    else {
      const rel = relative(base, p).split(sep).join('/');
      if (isTracked(rel)) out.push(rel);
    }
  }
}

/**
 * A projects folder that does not exist yet starts with the samples, so a
 * host's first visit opens on working sample projects instead of an empty
 * launcher. An existing folder, even an empty one, is left alone: someone
 * who deleted every project does not get the samples back. DC_SAMPLES=0
 * turns this off.
 */
export async function seedSamples(): Promise<boolean> {
  if (process.env.DC_SAMPLES === '0' || SAMPLES_DIR === PROJECTS_DIR) return false;
  if (await stat(PROJECTS_DIR).catch(() => null)) return false;
  if (!(await stat(SAMPLES_DIR).catch(() => null))) return false;
  // journals and dashboard run reports belong to whoever used the samples before
  await cp(SAMPLES_DIR, PROJECTS_DIR, { recursive: true, filter: (src) => !/[/\\]\.(journal\.jsonl|runs\.json)$/.test(src) });
  return true;
}

export async function listProjects(): Promise<ProjectCard[]> {
  await mkdir(PROJECTS_DIR, { recursive: true });
  const out: ProjectCard[] = [];
  for (const e of await readdir(PROJECTS_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || !isProjectName(e.name)) continue;
    const dir = join(PROJECTS_DIR, e.name);
    const kind = await kindOf(dir);
    if (!kind) continue;
    try {
      const files: string[] = [];
      await walk(dir, dir, files);
      let newest = 0;
      for (const f of files) {
        try {
          newest = Math.max(newest, (await stat(join(dir, f))).mtimeMs);
        } catch {
          // gone meanwhile
        }
      }
      const read = (rel: string) => readFile(join(dir, rel), 'utf8').catch(() => undefined);
      out.push(await projectCard(e.name, kind, files, read, newest ? new Date(newest).toISOString() : null));
    } catch {
      // unreadable index
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readProject(name: string): Promise<Record<string, FileState>> {
  const dir = projectDir(name);
  if (!(await kindOf(dir))) throw new HttpError(404, 'noProject', { name });
  const files: string[] = [];
  await walk(dir, dir, files);
  const out: Record<string, FileState> = {};
  for (const f of files) {
    const content = await readFile(join(dir, f), 'utf8');
    out[f] = { content, version: versionOf(content) };
  }
  return out;
}

export async function readOne(name: string, rel: string): Promise<FileState | null> {
  try {
    const content = await readFile(join(projectDir(name), safeRel(rel)), 'utf8');
    return { content, version: versionOf(content) };
  } catch {
    return null;
  }
}

/** Writes happen one at a time per project so the version check and the write are atomic. */
const locks = new Map<string, Promise<unknown>>();
export function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(name) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(name, next.catch(() => {}));
  return next;
}

/** Versions this server wrote, so the file watcher can tell our writes from outside edits. */
export const ownWrites = new Map<string, string>();

export async function writeAtomic(name: string, rel: string, content: string): Promise<string> {
  const path = join(projectDir(name), safeRel(rel));
  await mkdir(dirname(path), { recursive: true });
  // unique per write: two writes of one file in the same millisecond must not share a temp file
  const tmp = path + `.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  await writeFile(tmp, content, 'utf8');
  const v = versionOf(content);
  ownWrites.set(`${name}/${rel}`, v);
  await rename(tmp, path);
  return v;
}

export async function writeAsset(name: string, rel: string, bytes: Uint8Array): Promise<void> {
  const path = join(projectDir(name), assetRel(rel));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

export async function readAsset(name: string, rel: string): Promise<Buffer | null> {
  try {
    return await readFile(join(projectDir(name), assetRel(rel)));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return null;
  }
}

/**
 * tokens.css is generated from tokens.json (never written by hand): rebuilt
 * whenever tokens.json changes, from the editor, Claude Code or a terminal.
 * Returns the new content when it changed.
 */
export async function regenTokensCss(name: string): Promise<{ content: string; version: string } | null> {
  const tokens = await readOne(name, DS_TOKENS);
  if (!tokens) return null;
  const index = await readOne(name, DS_INDEX);
  const t = resolveTokens(tokens.content);
  const css = compileTokensCss(t, { title: index ? parseDsIndex(index.content).title : t.name });
  const cur = await readOne(name, DS_TOKENS_CSS);
  if (cur?.content === css) return null;
  return { content: css, version: await writeAtomic(name, DS_TOKENS_CSS, css) };
}

/** Binary files of a project (images, fonts), for the asset views. */
export async function listAssets(name: string): Promise<{ path: string; size: number }[]> {
  const dir = projectDir(name);
  const out: { path: string; size: number }[] = [];
  const visit = async (d: string) => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await visit(p);
      else {
        const rel = relative(dir, p).split(sep).join('/');
        try {
          assetRel(rel);
          out.push({ path: rel, size: (await stat(p)).size });
        } catch {
          // a text file or something else
        }
      }
    }
  };
  for (const top of ['assets', 'fonts', 'ds', 'data']) await visit(join(dir, top));
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function removeAsset(name: string, rel: string): Promise<void> {
  await rm(join(projectDir(name), assetRel(rel)), { force: true });
}

export async function removeFile(name: string, rel: string): Promise<void> {
  ownWrites.set(`${name}/${rel}`, 'deleted');
  await rm(join(projectDir(name), safeRel(rel)), { force: true });
}

/** A new project, its starter copy in `lang`: the language of whoever created it. */
export async function createProject(name: string, title: string, kind: ProjectKind = 'design', lang: Language = 'en'): Promise<void> {
  const t: TFunction = translator(lang);
  const dir = projectDir(name);
  if (await kindOf(dir)) throw new HttpError(409, 'projectExists', { name });
  await mkdir(dir, { recursive: true });
  if (kind === 'design-system') {
    const ns = namespaceOf(title) === 'DS' ? namespaceOf(name) : namespaceOf(title);
    await writeAtomic(name, DS_TOKENS, starterTokens(title));
    await writeAtomic(name, DS_README, t('starter.dsReadme', { title }));
    await regenTokensCss(name);
    await writeAtomic(name, DS_INDEX, stringifyDsIndex(newDsIndex(title, ns)));
    return;
  }
  if (kind === 'docs') {
    await writeAtomic(name, tabFile('main'), newDocTab(title));
    await writeAtomic(name, DOC_INDEX, stringifyDoc(parseDoc(JSON.stringify({ title, tabs: [{ id: 'main', title: t('starter.docTab') }] }))));
    return;
  }
  if (kind === 'motion') {
    const { motion, scenes } = newMotion(title, t('starter.motionHint'));
    for (const [id, source] of Object.entries(scenes)) await writeAtomic(name, sceneFile(id), source);
    await writeAtomic(name, MOTION_FILE, JSON.stringify(motion, null, 2) + '\n');
    return;
  }
  if (kind === 'dashboard') {
    await writeAtomic(name, DASH_PAGE, DASH_STARTER_PAGE.replace('TITLE', title.replace(/[<&>]/g, '')).replace('HINT', t('starter.dashEmpty')));
    await writeAtomic(name, DASH_INDEX, stringifyDash(newDash(title)));
    return;
  }
  if (kind === 'slides') {
    const deck = parseDeck(JSON.stringify({
      v: 4,
      createdOnFiles: { v: 1, at: new Date().toISOString() },
      lists: 'css',
      title,
      cover: 'cover',
      order: ['cover'],
      sections: {},
      faces: {},
      designSystems: [],
    }));
    await writeAtomic(name, slideFile('cover'), newSlideSource('cover', {
      like: "background:#14161c;color:#f4f1ea;font-family:'Noto Sans SC', Arial, sans-serif;padding:128px;display:flex;flex-direction:column;justify-content:center;gap:40px",
      title,
      body: t('starter.deckHint'),
    }).replace('font-size:72px', 'font-size:112px'));
    await writeAtomic(name, DECK_FILE, stringifyDeck(deck));
    return;
  }
  const canvas = parseCanvas(JSON.stringify({
    v: 3,
    title,
    createdOnFiles: { v: 1, at: new Date().toISOString() },
    boards: { 'Main.dc.html': { x: 0, y: 0, w: 1200, h: 760, title } },
    order: ['Main.dc.html'],
  }));
  await writeAtomic(name, CANVAS_FILE, stringifyCanvas(canvas));
  await writeAtomic(name, 'Main.dc.html', newBoardSource({ title, w: 1200, h: 760, lang, hint: t('starter.canvasHint') }));
}
