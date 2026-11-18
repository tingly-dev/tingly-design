import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { freeName, projectCard, type TrashedProject } from '@dc/core';
import { activeDelegates } from './delegate';
import { HttpError, PROJECTS_DIR, isProjectName, kindOf, linkedProjects, nameOfFolder, parentName, projectDir, readGroups, refreshNested, setGroup, subProjectsOf, walk } from './store';
import { logInfo } from './log';

/**
 * Deleting a project moves its folder, history and all, into `<projects>/.trash/<id>/` with the
 * launcher group it was filed under kept beside it (`<id>.json`); nothing is lost until "Delete
 * forever". A dot folder is not a project name, so the launcher, the watcher and the archive never see it.
 */
const TRASH = join(PROJECTS_DIR, '.trash');

interface Meta {
  name: string;
  deletedAt: string;
  group?: string;
  /** a sub-project: the folder of the project it was under, and its own folder name there, so restoring puts it back */
  under?: { dir: string; folder: string };
}

const idOk = (id: string) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id);

async function readMeta(id: string): Promise<Meta | null> {
  try {
    const m = JSON.parse(await readFile(join(TRASH, `${id}.json`), 'utf8')) as Meta;
    return typeof m.name === 'string' ? m : null;
  } catch {
    return null;
  }
}

export async function trashProject(name: string): Promise<{ id: string }> {
  const dir = projectDir(name);
  const sub = parentName(name) !== undefined;
  if (!sub && (dir !== join(PROJECTS_DIR, name) || linkedProjects().has(name))) throw new HttpError(409, 'notInProjects', { name });
  if (!(await kindOf(dir))) throw new HttpError(404, 'noProject', { name });
  if (activeDelegates.has(name) || subProjectsOf(name).some((n) => activeDelegates.has(n))) throw new HttpError(409, 'projectBusy');
  const id = `${name}-${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
  const group = (await readGroups())[name];
  await mkdir(TRASH, { recursive: true });
  await writeFile(join(TRASH, `${id}.json`), JSON.stringify({ name, deletedAt: new Date().toISOString(), ...(group ? { group } : {}), ...(sub ? { under: { dir: dirname(dir), folder: basename(dir) } } : {}) } satisfies Meta) + '\n', 'utf8');
  await rename(dir, join(TRASH, id));
  refreshNested();
  if (group) await setGroup(name, '');
  logInfo('project.trashed', { project: name, id });
  return { id };
}

export async function listTrash(): Promise<TrashedProject[]> {
  const out: TrashedProject[] = [];
  for (const e of await readdir(TRASH, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || !idOk(e.name)) continue;
    const dir = join(TRASH, e.name);
    const [kind, meta] = [await kindOf(dir), await readMeta(e.name)];
    if (!kind || !meta) continue;
    try {
      const files: string[] = [];
      await walk(dir, dir, files);
      let newest = 0;
      for (const f of files) newest = Math.max(newest, (await stat(join(dir, f)).catch(() => null))?.mtimeMs ?? 0);
      const read = (rel: string) => readFile(join(dir, rel), 'utf8').catch(() => undefined);
      out.push({ ...(await projectCard(meta.name, kind, files, read, newest ? new Date(newest).toISOString() : null)), id: e.name, deletedAt: meta.deletedAt });
    } catch {
      // unreadable index: left in the trash, only "Delete forever" reaches it
    }
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Put a trashed project back under its own name, or the next free one when the name has been used since. */
export async function restoreTrash(id: string): Promise<{ name: string }> {
  const meta = idOk(id) ? await readMeta(id) : null;
  if (!meta || !(await stat(join(TRASH, id)).catch(() => null))) throw new HttpError(404, 'noTrashed');
  // a sub-project goes back under the project it was in, while that is still a project and the place is free
  if (meta.under && (await kindOf(meta.under.dir)) && !(await stat(join(meta.under.dir, meta.under.folder)).catch(() => null))) {
    const to = join(meta.under.dir, meta.under.folder);
    await rename(join(TRASH, id), to);
    await rm(join(TRASH, `${id}.json`), { force: true });
    refreshNested();
    const name = nameOfFolder(to) ?? meta.name;
    logInfo('project.restored', { project: name, id });
    return { name };
  }
  const taken = new Set(await readdir(PROJECTS_DIR).catch(() => [] as string[]));
  for (const n of linkedProjects().keys()) taken.add(n);
  const name = freeName(meta.under && isProjectName(meta.under.folder) ? meta.under.folder : meta.name, taken);
  await rename(join(TRASH, id), join(PROJECTS_DIR, name));
  await rm(join(TRASH, `${id}.json`), { force: true });
  refreshNested();
  if (meta.group && name === meta.name) await setGroup(name, meta.group);
  logInfo('project.restored', { project: name, id });
  return { name };
}

/** Delete forever; without an id, the whole trash. */
export async function purgeTrash(id?: string): Promise<void> {
  if (id === undefined) return void (await rm(TRASH, { recursive: true, force: true }));
  if (!idOk(id)) throw new HttpError(404, 'noTrashed');
  await rm(join(TRASH, id), { recursive: true, force: true });
  await rm(join(TRASH, `${id}.json`), { force: true });
  logInfo('project.purged', { id });
}
