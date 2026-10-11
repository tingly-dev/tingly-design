import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANVAS_FILE, isBoardFile, newBoardSource, parseCanvas, stringifyCanvas } from '@dc/core';

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
  if (r === CANVAS_FILE || isBoardFile(r)) return r;
  throw new HttpError(400, `not a canvas file: ${rel}`);
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

export async function listProjects(): Promise<{ name: string; title: string }[]> {
  await mkdir(PROJECTS_DIR, { recursive: true });
  const out: { name: string; title: string }[] = [];
  for (const e of await readdir(PROJECTS_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || !isProjectName(e.name)) continue;
    try {
      const c = parseCanvas(await readFile(join(PROJECTS_DIR, e.name, CANVAS_FILE), 'utf8'));
      out.push({ name: e.name, title: c.title });
    } catch {
      // not a canvas
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readProject(name: string): Promise<Record<string, FileState>> {
  const dir = projectDir(name);
  try {
    await stat(join(dir, CANVAS_FILE));
  } catch {
    throw new HttpError(404, `no project ${name}`);
  }
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

export async function removeFile(name: string, rel: string): Promise<void> {
  ownWrites.set(`${name}/${rel}`, 'deleted');
  await rm(join(projectDir(name), safeRel(rel)), { force: true });
}

export async function createProject(name: string, title: string): Promise<void> {
  const dir = projectDir(name);
  try {
    await stat(join(dir, CANVAS_FILE));
    throw new HttpError(409, `project ${name} exists`);
  } catch (e) {
    if (e instanceof HttpError) throw e;
  }
  await mkdir(dir, { recursive: true });
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
