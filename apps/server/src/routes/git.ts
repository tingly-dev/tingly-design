import type { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError, assetRel, projectDir, removeAsset, removeFile, showPath, withLock, writeAtomic, writeAsset } from '../store';
import { commitFolder, gitState, initRepo, listStages, repoOf, stageFile, stagePaths, stageSubject, verifyStage } from '../git';
import { activeDelegates } from '../delegate';
import { publish, record } from '../hub';
import { logInfo } from '../log';
import { trOf } from '../i18n';

/** Committing a project's folder, and jumping back to one of its stages (.design/project-stages.md). */
export function registerGit(app: Hono): void {
  /** Where a commit of this project lands: the repository holding its folder and the branch, or none yet. */
  app.get('/api/projects/:p/git', async (c) => {
    const dir = projectDir(c.req.param('p'));
    const st = await gitState(dir);
    return c.json({ ...st, repo: st.repo && showPath(st.repo), folder: showPath(dir) });
  });

  /**
   * Commit the project's folder, and only it, to the nearest repository holding it. With no repository
   * and `init`, the project gets one of its own in its folder first (the commit dialog said so).
   */
  app.post('/api/projects/:p/commit', async (c) => {
    const p = c.req.param('p');
    const dir = projectDir(p);
    const { message, init } = await c.req.json<{ message?: string; init?: boolean }>().catch(() => ({ message: undefined, init: undefined }));
    try {
      if (!(await repoOf(dir))) {
        if (!init) return c.json({ ok: false, output: trOf(c)('errors.notGitRepo', { dir: showPath(dir) }) });
        await initRepo(dir);
        logInfo('git.init', { project: p, dir });
      }
      const out = await commitFolder(dir, message?.trim() || `design(${p}): update`);
      if (!out) return c.json({ ok: false, output: trOf(c)('errors.nothingToCommit') });
      logInfo('git.commit', { project: p, commit: out.split(' ')[0] });
      return c.json({ ok: true, output: out });
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      return c.json({ ok: false, output: (err.stderr || err.message).trim() }, 500);
    }
  });

  /** The project's commits, newest first; empty when there is no repository (or no commit) yet. */
  app.get('/api/projects/:p/git/stages', async (c) => {
    const dir = projectDir(c.req.param('p'));
    return c.json({ repo: !!(await repoOf(dir)), stages: await listStages(dir) });
  });

  /**
   * Jump back: write a stage's files over the project and remove what appeared since, as one new
   * change — git history is untouched, the jump lands in the change log, and the editor's toast
   * takes it back. With `dry` it only reports what would happen (the confirm dialog's numbers).
   */
  app.post('/api/projects/:p/git/restore', async (c) => {
    const p = c.req.param('p');
    const dir = projectDir(p);
    const { stage, dry } = await c.req.json<{ stage?: string; dry?: boolean }>().catch(() => ({ stage: undefined, dry: undefined }));
    if (!stage || !/^[0-9a-f]{4,40}$/.test(stage)) throw new HttpError(400, 'badStage');
    if (activeDelegates.has(p)) throw new HttpError(409, 'delegateRunning');
    if (!(await repoOf(dir))) throw new HttpError(400, 'notGitRepo', { dir: showPath(dir) });
    return withLock(p, async () => {
      if (!(await verifyStage(dir, stage))) throw new HttpError(400, 'badStage');
      const { writes, removes } = await stagePaths(dir, stage);
      const files: { path: string; before: string | null; after: string | null }[] = [];
      let binary = 0;
      for (const path of writes) {
        const content = await stageFile(dir, stage, path);
        if (!content) continue;
        const disk = await readFile(join(dir, path)).catch(() => null);
        if (disk?.equals(content)) continue;
        try {
          assetRel(path);
          // an asset (picture, font, dataset): written raw, the pages re-read it; Undo does not cover it
          binary++;
          if (!dry) await writeAsset(p, path, content);
          continue;
        } catch {
          // a text file
        }
        const before = await readFile(join(dir, path), 'utf8').catch(() => null);
        const after = content.toString('utf8');
        if (before === after) continue;
        files.push({ path, before, after });
        if (!dry) {
          const version = await writeAtomic(p, path, after);
          publish(p, { type: 'file', path, content: after, version, actor: 'human' });
        }
      }
      for (const path of removes) {
        try {
          assetRel(path);
          if (!dry) await removeAsset(p, path);
          binary++;
          continue;
        } catch {
          // a text file
        }
        const before = await readFile(join(dir, path), 'utf8').catch(() => null);
        if (before === null) continue; // gone from disk since the listing
        files.push({ path, before, after: null });
        if (!dry) {
          await removeFile(p, path);
          publish(p, { type: 'delete', path, actor: 'human' });
        }
      }
      if (!dry && (files.length > 0 || binary > 0)) {
        const subject = await stageSubject(dir, stage);
        await record(p, { actor: 'human', file: stage, summary: `restored stage ${stage}${subject ? `: ${subject}` : ''}` });
        logInfo('git.restore', { project: p, stage, writes: files.filter((f) => f.after !== null).length, removes: files.filter((f) => f.after === null).length, binary });
      }
      return c.json({ ok: true, dry: !!dry, files, binary });
    });
  });
}
