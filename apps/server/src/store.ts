import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANVAS_FILE,
  DECK_FILE,
  isBoardFile,
  isSlideFile,
  newBoardSource,
  newDeck,
  newSlideSource,
  parseCanvas,
  parseDeck,
  slideFile,
  stringifyCanvas,
  stringifyDeck,
} from '@dc/core';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const PROJECTS_DIR = resolve(process.env.DC_PROJECTS ?? join(REPO_ROOT, 'projects'));

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
  if (!isProjectName(name)) throw new HttpError(400, 'bad project name');
  return join(PROJECTS_DIR, name);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A path inside a project that the editor is allowed to read and write. */
export function safeRel(rel: string): string {
  const r = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (r === CANVAS_FILE || isBoardFile(r) || r === DECK_FILE || isSlideFile(r)) return r;
  throw new HttpError(400, `not a canvas or deck file: ${rel}`);
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

export type ProjectKind = 'design' | 'slides';

export interface ProjectInfo {
  name: string;
  title: string;
  kind: ProjectKind;
}

export async function listProjects(): Promise<ProjectInfo[]> {
  await mkdir(PROJECTS_DIR, { recursive: true });
  const out: ProjectInfo[] = [];
  for (const e of await readdir(PROJECTS_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || !isProjectName(e.name)) continue;
    try {
      const c = parseCanvas(await readFile(join(PROJECTS_DIR, e.name, CANVAS_FILE), 'utf8'));
      out.push({ name: e.name, title: c.title, kind: 'design' });
      continue;
    } catch {
      // not a canvas
    }
    try {
      const d = parseDeck(await readFile(join(PROJECTS_DIR, e.name, DECK_FILE), 'utf8'));
      out.push({ name: e.name, title: d.title, kind: 'slides' });
    } catch {
      // not a deck either
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function projectKind(name: string): Promise<ProjectKind | null> {
  const dir = projectDir(name);
  if (await exists(join(dir, CANVAS_FILE))) return 'design';
  if (await exists(join(dir, DECK_FILE))) return 'slides';
  return null;
}

export async function readProject(name: string): Promise<Record<string, FileState>> {
  const dir = projectDir(name);
  if (!(await projectKind(name))) throw new HttpError(404, `no project ${name}`);
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
  const tmp = path + `.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, 'utf8');
  const v = versionOf(content);
  ownWrites.set(`${name}/${rel}`, v);
  await rename(tmp, path);
  return v;
}

/** Media a deck's slides may reference: images and font files inside the project folder. */
const ASSET_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
};

export async function readAsset(name: string, rel: string): Promise<{ body: Buffer; type: string } | null> {
  const r = rel.replace(/\\/g, '/');
  if (!r || r.split('/').some((seg) => !seg || seg === '..' || seg.startsWith('.'))) return null;
  const ext = /\.([A-Za-z0-9]+)$/.exec(r)?.[1]?.toLowerCase();
  // `/_blob/<id>` uploads (the original's asset store) keep no extension
  const type = ext ? ASSET_TYPES[ext] : r.startsWith('_blob/') ? 'application/octet-stream' : undefined;
  if (!type) return null;
  try {
    return { body: await readFile(join(projectDir(name), r)), type };
  } catch {
    return null;
  }
}

/** Save an uploaded image under assets/, never over another file; returns its path in the project. */
export async function saveAsset(name: string, fileName: string, body: Uint8Array): Promise<string> {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? '';
  if (!ASSET_TYPES[ext] || !ASSET_TYPES[ext].startsWith('image/')) throw new HttpError(400, '只能上传 png、jpg、gif、webp、avif 或 svg 图片');
  if (body.byteLength > 15 * 1024 * 1024) throw new HttpError(413, '图片超过 15 MB');
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'image';
  const dir = join(projectDir(name), 'assets');
  await mkdir(dir, { recursive: true });
  let rel = `assets/${stem}.${ext}`;
  for (let i = 2; await exists(join(projectDir(name), rel)); i++) rel = `assets/${stem}-${i}.${ext}`;
  await writeFile(join(projectDir(name), rel), body);
  return rel;
}

export async function removeFile(name: string, rel: string): Promise<void> {
  ownWrites.set(`${name}/${rel}`, 'deleted');
  await rm(join(projectDir(name), safeRel(rel)), { force: true });
}

export async function createProject(name: string, title: string, kind: ProjectKind = 'design'): Promise<void> {
  const dir = projectDir(name);
  if (await projectKind(name)) throw new HttpError(409, `project ${name} exists`);
  await mkdir(dir, { recursive: true });
  if (kind === 'slides') {
    const deck = newDeck(title, 'cover');
    await writeAtomic(name, slideFile('cover'), newSlideSource('cover', { title }));
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
  await writeAtomic(name, 'Main.dc.html', newBoardSource({ title, w: 1200, h: 760 }));
}
