import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_MANIFEST,
  DS_TOKENS,
  INDEX_FILE,
  archiveKeeps,
  archivePath,
  freeName,
  installedSystems,
  planArchive,
  projectNameFrom,
  renameSystems,
  type ArchiveManifest,
  type ArchiveOptions,
} from '@dc/core';
import { HttpError, PROJECTS_DIR, isProjectName, kindOf, linkedProjects, projectDir } from './store';
import { VERSION } from './layout';

/**
 * A whole project as one .zip and back (.design/project-archive.md). The rules on what goes in
 * and how an archive is read are in core (`projectArchive.ts`); this file reads and writes the
 * folders.
 */

/** Unpacking stops past these, so a hostile archive cannot fill the disk. */
const MAX_FILES = 20_000;
const MAX_BYTES = 1024 ** 3;

/** Every file under a folder, `/`-separated, dot files included (the archive rules decide). */
async function walkAll(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walkAll(p, base, out);
    else if (e.isFile()) out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

async function addFolder(into: Zippable, dir: string, prefix: string, opts: Pick<ArchiveOptions, 'journal'>): Promise<number> {
  let n = 0;
  for (const rel of await walkAll(dir)) {
    if (!archiveKeeps(rel, opts)) continue;
    into[`${prefix}/${rel}`] = [new Uint8Array(await readFile(join(dir, rel))), { level: /\.(png|jpe?g|gif|webp|mp4|webm|mp3|m4a|woff2?|zip)$/i.test(rel) ? 0 : 6 }];
    n++;
  }
  return n;
}

/** The project's .zip: its folder, and beside it the design systems it installed when asked. `dir` is for a folder named by path (the command line). */
export async function packProject(name: string, opts: ArchiveOptions, dir = projectDir(name)): Promise<{ bytes: Uint8Array; file: string; files: number; systems: string[] }> {
  const kind = await kindOf(dir);
  if (!kind) throw new HttpError(404, 'noProject', { name });
  const zip: Zippable = {};
  let files = await addFolder(zip, dir, name, opts);
  const systems: string[] = [];
  if (opts.systems && (kind === 'design' || kind === 'slides')) {
    const index = await readFile(join(dir, INDEX_FILE[kind]), 'utf8').catch(() => undefined);
    for (const sys of installedSystems(index)) {
      if (sys === name || !isProjectName(sys)) continue;
      const sdir = projectDir(sys);
      if ((await kindOf(sdir)) !== 'design-system') continue;
      files += await addFolder(zip, sdir, sys, { journal: false });
      systems.push(sys);
    }
  }
  const manifest: ArchiveManifest = { format: ARCHIVE_FORMAT, project: name, kind, systems, journal: opts.journal, exportedAt: new Date().toISOString(), version: VERSION };
  zip[ARCHIVE_MANIFEST] = strToU8(JSON.stringify(manifest, null, 2) + '\n');
  return { bytes: zipSync(zip), file: `${name}.zip`, files, systems };
}

/** Every name a new project may not take: the folders in the projects folder and the linked names. */
async function takenNames(): Promise<Set<string>> {
  await mkdir(PROJECTS_DIR, { recursive: true });
  const taken = new Set(linkedProjects().keys());
  for (const e of await readdir(PROJECTS_DIR)) taken.add(e);
  return taken;
}

/** Write one folder of the archive as a new project: into a hidden folder first, then moved into place. */
async function writeProject(files: Record<string, Uint8Array>, prefix: string, name: string, edit?: (rel: string, bytes: Uint8Array) => Uint8Array): Promise<void> {
  const tmp = join(PROJECTS_DIR, `.import-${randomUUID()}`);
  try {
    for (const [path, bytes] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue;
      const rel = path.slice(prefix.length);
      if (!rel || !archiveKeeps(rel, { journal: true })) continue;
      const to = join(tmp, ...rel.split('/'));
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, edit ? edit(rel, bytes) : bytes);
    }
    await rename(tmp, projectDir(name));
  } catch (e) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/** A project from a .zip: it joins the projects folder under a free name, its design systems beside it. */
export async function unpackProject(bytes: Uint8Array, fileName: string): Promise<{ name: string; systems: string[] }> {
  let count = 0;
  let total = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes, {
      filter: (f) => {
        if (f.name.endsWith('/')) return false;
        count++;
        total += f.originalSize;
        if (count > MAX_FILES || total > MAX_BYTES) throw new HttpError(413, 'archiveTooBig');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'archiveUnreadable');
  }
  const files: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(raw)) {
    const p = archivePath(name);
    // macOS adds a __MACOSX folder of resource forks to zips it makes
    if (p && !p.startsWith('__MACOSX/')) files[p] = data;
  }
  let manifest: ArchiveManifest | null = null;
  if (files[ARCHIVE_MANIFEST]) {
    try {
      manifest = JSON.parse(strFromU8(files[ARCHIVE_MANIFEST]));
    } catch {
      manifest = null;
    }
  }
  const plan = planArchive(Object.keys(files), manifest, projectNameFrom(fileName));
  if (!plan) throw new HttpError(400, 'archiveNoProject');
  const taken = await takenNames();
  const renamed: Record<string, string> = {};
  const systems: string[] = [];
  for (const s of plan.systems) {
    // the same system is already here, unchanged: the project uses that one
    const same = taken.has(s.name) && isProjectName(s.name) && (await kindOf(projectDir(s.name))) === 'design-system' && (await readFile(join(projectDir(s.name), DS_TOKENS), 'utf8').catch(() => null)) === (files[`${s.prefix}${DS_TOKENS}`] ? strFromU8(files[`${s.prefix}${DS_TOKENS}`]) : undefined);
    if (same) continue;
    const name = freeName(s.name, taken);
    await writeProject(files, s.prefix, name);
    taken.add(name);
    systems.push(name);
    if (name !== s.name) renamed[s.name] = name;
  }
  const name = freeName(plan.project.name, taken);
  const index = INDEX_FILE[plan.project.kind];
  await writeProject(files, plan.project.prefix, name, (rel, b) => (rel === index && Object.keys(renamed).length ? strToU8(renameSystems(strFromU8(b), renamed)) : b));
  return { name, systems };
}
