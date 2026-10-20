import { execFile } from 'node:child_process';
import { stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

/**
 * A project's place in git (.design/project-git.md): the nearest repository that holds its folder,
 * whichever that is (this one, a host's, the code repository a linked folder sits in), or a new one
 * of its own made at its first commit. Every command runs in the project folder and touches only it.
 */

const run = promisify(execFile);

/** What the server keeps beside a project's files for this machine only: the change log, dashboard runs, rendered videos. Never committed. */
const LOCAL = ['.journal.jsonl', '.runs.json', '.claude-session.json', '.transcript.jsonl', 'renders/'];
const PATHS = ['.', ...LOCAL.map((f) => `:(exclude)${f.replace(/\/$/, '')}`)];
const git = (cwd: string, ...args: string[]) => run('git', args, { cwd }).then((r) => r.stdout.trim());

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
  const status = await git(dir, 'status', '--porcelain', '--untracked-files=all', '--', ...PATHS).catch(() => '');
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
  await git(dir, 'add', '-A', '--', '.');
  const local = await git(dir, 'diff', '--cached', '--name-only', '--relative', '--diff-filter=A', '--', ...LOCAL.map((f) => f.replace(/\/$/, ''))).catch(() => '');
  if (local) await git(dir, 'rm', '--cached', '-q', '--', ...local.split('\n'));
  if (!(await git(dir, 'diff', '--cached', '--stat', '--', '.'))) return null;
  // `-- .` keeps whatever else is staged in a repository this folder shares with other work out of the commit
  await git(dir, 'commit', '-q', '-m', message, '--', '.');
  return (await git(dir, 'log', '-1', '--format=%h %s')).split('\n')[0];
}
