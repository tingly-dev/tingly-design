import type { Hono } from 'hono';
import { showPath, projectDir } from '../store';
import { commitFolder, gitState, initRepo, repoOf } from '../git';
import { logInfo } from '../log';
import { trOf } from '../i18n';

/** Committing a project's folder. */
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
}
