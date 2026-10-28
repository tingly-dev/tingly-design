import type { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { isKeptPath, isUploadPath, isDataPath } from '@dc/core';
import { ASSET_TYPES, HttpError, assetType, listAssets, removeAsset, projectDir, assetRel, readAsset, writeAsset } from '../store';
import { isPptxImportPath } from '@dc/core';
import { publish } from '../hub';

const MAX_ASSET = 20 * 1024 * 1024;

/** Project assets: uploaded files and pictures. */
export function registerAssets(app: Hono): void {
  app.get('/api/projects/:p/assets', async (c) => c.json(await listAssets(c.req.param('p'))));

  app.delete('/api/projects/:p/assets', async (c) => {
    const p = c.req.param('p');
    await removeAsset(p, c.req.query('path') ?? '');
    publish(p, { type: 'assets' });
    return c.json({ ok: true });
  });

  /** Upload an image or font (stored under assets/ by content hash, so the same file is kept once), or a request's attachment (the same, under uploads/). */
  app.post('/api/projects/:p/assets', async (c) => {
    const p = c.req.param('p');
    projectDir(p);
    const name = c.req.query('name') ?? 'file';
    const ext = (/\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? '').toLowerCase();
    const dir = c.req.query('dir');
    if (dir === 'data' ? !isDataPath(`data/x.${ext}`) : dir === 'uploads' ? !isUploadPath(`uploads/x.${ext}`) : !ASSET_TYPES[ext]) throw new HttpError(400, 'unsupportedFileType', { type: ext || name });
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) throw new HttpError(400, 'emptyFile');
    if (bytes.length > MAX_ASSET) throw new HttpError(413, 'fileTooLarge', { size: '20 MB' });
    const stem = name.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';
    // into a named folder (a design system's asset group, fonts/, a dashboard's data/): the file keeps its name
    let rel: string;
    if (dir && dir !== 'uploads') {
      rel = assetRel(`${dir.replace(/\/+$/, '')}/${stem}.${ext}`);
    } else {
      // images, and files attached to a request: named by content, so the same file is kept once
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
      rel = `${dir ?? 'assets'}/${stem}-${hash}.${ext}`;
    }
    await writeAsset(p, rel, bytes);
    publish(p, { type: 'assets', path: rel });
    return c.json({ path: rel, size: bytes.length, type: assetType(rel) });
  });

  /**
   * Keep one file of a folder a person imported, at its own path under uploads/
   * (uploads/<folder>-<hash>/…), so the page's relative links still hold.
   * Single files go through POST /assets?dir=uploads instead, named by content.
   */
  app.put('/api/projects/:p/uploads', async (c) => {
    const p = c.req.param('p');
    projectDir(p);
    const rel = c.req.query('path') ?? '';
    if (!isKeptPath(rel) && !isPptxImportPath(rel)) throw new HttpError(400, 'cannotKeep', { path: rel });
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > MAX_ASSET) throw new HttpError(413, 'fileTooLarge', { size: '20 MB' });
    await writeAsset(p, rel, bytes);
    publish(p, { type: 'assets', path: rel });
    return c.json({ path: rel, size: bytes.length });
  });

  /** Serve a project's assets (to the sandboxed frames too: images, and fonts which need CORS). */
  app.get('/api/projects/:p/raw/*', async (c) => {
    const p = c.req.param('p');
    const rel = decodeURIComponent(c.req.path.replace(/^\/api\/projects\/[^/]+\/raw\//, ''));
    const bytes = await readAsset(p, rel);
    if (!bytes) return c.json({ error: 'not found' }, 404);
    // a picture an outside edit replaced must show on the next load, so the browser asks each time and gets a 304 when it is unchanged
    const etag = `"${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}"`;
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, { etag, 'cache-control': 'private, no-cache', 'access-control-allow-origin': '*' });
    return c.body(new Uint8Array(bytes), 200, {
      'content-type': assetType(rel),
      'access-control-allow-origin': '*',
      etag,
      'cache-control': 'private, no-cache',
      'x-content-type-options': 'nosniff',
      // an SVG opened directly must not run scripts on this origin
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    });
  });
}
