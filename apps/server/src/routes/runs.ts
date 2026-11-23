import type { Hono } from 'hono';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DASH_RUNS, LOOK_DIR } from '@dc/core';
import { HttpError, projectDir } from '../store';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * What an open page reports about itself for Claude Code to read: the runs document (`.runs.json`, a
 * dashboard's data and drawing, a deck's layout warnings) and pictures of the slides it drew
 * (`renders/look/`). Local to this machine, never tracked or archived.
 */
export function registerRuns(app: Hono): void {
  app.put('/api/projects/:p/runs', async (c) => {
    const p = c.req.param('p');
    const text = await c.req.text();
    if (text.length > 256 * 1024) throw new HttpError(413, 'runsTooLarge', { size: '256 KB' });
    JSON.parse(text);
    await writeFile(join(projectDir(p), DASH_RUNS), text, 'utf8');
    return c.json({ ok: true });
  });

  /** A picture of one slide as the open deck drew it: `<slide id>.png`, a PNG of at most 4 MB. */
  app.put('/api/projects/:p/look/:name', async (c) => {
    const p = c.req.param('p');
    const name = c.req.param('name');
    if (!/^[A-Za-z0-9_-]{1,64}\.png$/.test(name)) throw new HttpError(400, 'slidePictureName');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > 4 * 1024 * 1024) throw new HttpError(413, 'slidePictureTooLarge', { size: '4 MB' });
    if (!PNG.every((b, i) => bytes[i] === b)) throw new HttpError(400, 'slidePictureName');
    const dir = join(projectDir(p), LOOK_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), bytes);
    return c.json({ ok: true, path: `${LOOK_DIR}/${name}` });
  });
}
