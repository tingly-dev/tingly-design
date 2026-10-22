import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectDir, safeRel } from './store';

/**
 * Earlier versions of a doc's tabs (.design/docs-history.md): before a write replaces `tabs/<id>.md`,
 * the text it replaces is kept under `.history/` (local to this machine, never in an archive or a
 * commit), at most one per minute per file and the newest few dozen. Reading never touches the file.
 */

const KEEP = 40;
const EVERY_MS = 60_000;

const dirOf = (project: string, rel: string) => join(projectDir(project), '.history', rel.replace(/\//g, '__'));
const watched = (rel: string) => /^tabs\/[^/]+\.md$/.test(rel);

export interface Snapshot {
  id: string;
  at: string;
}

/** Snapshots of one file are made one at a time, so the freshness check and the prune see each other. */
const chains = new Map<string, Promise<unknown>>();

/** Before a write replaces `file` with `next`: keep the text it replaces (tabs only; the read is skipped for every other file). */
export async function keepReplaced(project: string, rel: string, file: string, next: string): Promise<void> {
  const norm = safeRel(rel);
  if (!watched(norm)) return;
  const before = await readFile(file, 'utf8').catch(() => null);
  if (before === null || before === next) return;
  await snapshotBefore(project, norm, before);
}

/** Keep `before` when the last copy is not fresh, or always with `force` (a restore keeps what it replaces). */
export function snapshotBefore(project: string, rel: string, before: string, force = false): Promise<void> {
  const key = `${project}/${rel}`;
  const run = (chains.get(key) ?? Promise.resolve()).then(() => snapshot(project, rel, before, force));
  chains.set(key, run.catch(() => {}));
  return run;
}

async function snapshot(project: string, rel: string, before: string, force: boolean): Promise<void> {
  if (!before.trim() || !watched(rel)) return;
  try {
    const dir = dirOf(project, rel);
    await mkdir(dir, { recursive: true });
    const names = (await readdir(dir)).filter((n) => n.endsWith('.md')).sort();
    const last = names[names.length - 1];
    if (last) {
      if (!force && Date.now() - Date.parse(last.slice(0, -3).replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z')) < EVERY_MS) return;
      if ((await readFile(join(dir, last), 'utf8')) === before) return;
    }
    const name = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-') + '.md';
    if (names.includes(name)) return;
    await writeFile(join(dir, name), before, 'utf8');
    for (const old of names.slice(0, Math.max(0, names.length + 1 - KEEP))) await rm(join(dir, old), { force: true });
  } catch {
    // history is a convenience: a write must never fail because of it
  }
}

/** The kept versions of a tab, newest first. */
export async function listSnapshots(project: string, rel: string): Promise<Snapshot[]> {
  if (!watched(rel)) return [];
  try {
    const names = (await readdir(dirOf(project, rel))).filter((n) => n.endsWith('.md')).sort().reverse();
    return names.map((n) => ({ id: n.slice(0, -3), at: n.slice(0, -3).replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z') }));
  } catch {
    return [];
  }
}

export async function readSnapshot(project: string, rel: string, id: string): Promise<string | null> {
  if (!watched(rel) || !/^[0-9TZ-]+$/.test(id)) return null;
  try {
    return await readFile(join(dirOf(project, rel), id + '.md'), 'utf8');
  } catch {
    return null;
  }
}
