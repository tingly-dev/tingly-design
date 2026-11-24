import { execFile } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { INDEX_FILE } from '@dc/core';

/**
 * A project's place in git (.design/project-git.md): the nearest repository that holds its folder,
 * whichever that is (this one, a host's, the code repository a linked folder sits in), or a new one
 * of its own made at its first commit. Every command runs in the project folder and touches only it.
 */

const run = promisify(execFile);

/** What the server keeps beside a project's files for this machine only: the change log, dashboard runs, rendered videos. Never committed. */
const LOCAL = ['.journal.jsonl', '.runs.json', '.claude-session.json', '.transcript.jsonl', '.image.json', '.references.json', 'renders/', '.history/'];
const PATHS = ['.', ...LOCAL.map((f) => `:(exclude)${f.replace(/\/$/, '')}`)];
const INDEX_FILES = Object.values(INDEX_FILE);

/**
 * The folders directly inside a project that are projects of their own (.design/sub-projects.md): a
 * project's commits, stages and jump back never take them, they have their own.
 */
function subFolders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && INDEX_FILES.some((f) => existsSync(join(dir, e.name, f))))
      .map((e) => e.name);
  } catch {
    return [];
  }
}
/** `.` and the pathspecs that leave the sub-projects out. */
const here = (dir: string) => ['.', ...subFolders(dir).map((n) => `:(exclude)${n}`)];
const git = (cwd: string, ...args: string[]) => run('git', args, { cwd }).then((r) => r.stdout.trim());
const gitRaw = (cwd: string, ...args: string[]) => run('git', args, { cwd, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }).then((r) => r.stdout as Buffer);
const isLocalPath = (rel: string) => LOCAL.some((f) => (f.endsWith('/') ? rel.startsWith(f) : rel === f));

/** One commit of this project's folder: a stage the editor can jump back to (.design/project-stages.md). */
export interface Stage {
  id: string;
  /** when the commit was made (ISO) */
  at: string;
  message: string;
}

/** This project folder's commits, newest first; empty when there is no repository or no commit yet. */
export async function listStages(dir: string): Promise<Stage[]> {
  if (!(await repoOf(dir))) return [];
  try {
    const out = await git(dir, 'log', '-n', '50', '--format=%h%x1f%cI%x1f%s', '--', ...here(dir));
    return out
      ? out.split('\n').map((line) => {
          const [id, at, message] = line.split('\x1f');
          return { id, at, message: message ?? '' };
        })
      : [];
  } catch {
    return []; // a repository with no commit yet
  }
}

/** A jump back to `id` would write the stage's files over the project and remove what appeared since; paths are project-relative. */
export async function stagePaths(dir: string, id: string): Promise<{ writes: string[]; removes: string[] }> {
  const [tree, now] = await Promise.all([
    gitRaw(dir, 'ls-tree', '-r', '--name-only', '-z', id, '--', '.'),
    gitRaw(dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'),
  ]);
  const subs = subFolders(dir).map((n) => `${n}/`);
  const own = (f: string) => !subs.some((p) => f.startsWith(p));
  const stage = new Set(tree.toString('utf8').split('\0').filter((f) => f && own(f)));
  const disk = now
    .toString('utf8')
    .split('\0')
    .filter((f) => f && own(f) && !isLocalPath(f));
  return { writes: [...stage], removes: disk.filter((f) => !stage.has(f)) };
}

/** True when `id` names a commit this repository actually has. */
export async function verifyStage(dir: string, id: string): Promise<boolean> {
  return git(dir, 'rev-parse', '--verify', '--quiet', `${id}^{commit}`).then(() => true, () => false);
}

/** A file's content at a stage, or null when the stage does not hold it. */
export async function stageFile(dir: string, id: string, path: string): Promise<Buffer | null> {
  // `./` keeps the path relative to the project folder, not to the repository's top
  return gitRaw(dir, 'show', `${id}:./${path}`).catch(() => null);
}

/** The stage's own one-line subject, for the change log entry. */
export async function stageSubject(dir: string, id: string): Promise<string> {
  return git(dir, 'log', '-1', '--format=%s', id).catch(() => '');
}


/** The top of the repository holding `path`, or null; `path` need not exist yet (its nearest existing parent is asked). */
export async function repoOf(path: string): Promise<string | null> {
  let dir = path;
  while (!(await stat(dir).then((s) => s.isDirectory(), () => false))) {
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return git(dir, 'rev-parse', '--show-toplevel').catch(() => null);
}

export interface GitState {
  /** the repository's top folder, or null when the project is in none */
  repo: string | null;
  /** the branch a commit lands on; empty on a detached head */
  branch: string;
  /** files of this project that a commit would take */
  changes: number;
}

export async function gitState(dir: string): Promise<GitState> {
  const repo = await repoOf(dir);
  if (!repo) return { repo: null, branch: '', changes: 0 };
  // symbolic-ref also names the branch of a repository with no commit yet
  const branch = await git(dir, 'symbolic-ref', '--short', '-q', 'HEAD').catch(() => '');
  const status = await git(dir, 'status', '--porcelain', '--untracked-files=all', '--', ...PATHS, ...subFolders(dir).map((n) => `:(exclude)${n}`)).catch(() => '');
  return { repo, branch, changes: status ? status.split('\n').length : 0 };
}

/** A repository of the project's own, in its folder. */
export async function initRepo(dir: string): Promise<void> {
  await git(dir, 'init', '-q');
  // so a commit made in a terminal leaves them out too
  await writeFile(join(dir, '.gitignore'), LOCAL.join('\n') + '\n', { flag: 'wx' }).catch(() => {});
}

/** Commits this project's folder only; null when there was nothing to commit, else git's first line. */
export async function commitFolder(dir: string, message: string): Promise<string | null> {
  // exclude pathspecs on `add` fail outright when .gitignore also names the file, so add all and take the local files back out
  const only = here(dir);
  await git(dir, 'add', '-A', '--', ...only);
  const local = await git(dir, 'diff', '--cached', '--name-only', '--relative', '--diff-filter=A', '--', ...LOCAL.map((f) => f.replace(/\/$/, ''))).catch(() => '');
  if (local) await git(dir, 'rm', '--cached', '-q', '--', ...local.split('\n'));
  if (!(await git(dir, 'diff', '--cached', '--stat', '--', ...only))) return null;
  // `-- .` keeps whatever else is staged in a repository this folder shares with other work out of the commit
  await git(dir, 'commit', '-q', '-m', message, '--', ...only);
  return (await git(dir, 'log', '-1', '--format=%h %s')).split('\n')[0];
}
