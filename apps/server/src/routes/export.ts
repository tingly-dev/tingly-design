import type { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { stream } from 'hono/streaming';
import { HttpError, kindOf, projectDir } from '../store';
import { logError, logInfo } from '../log';
import { printPdf } from '../pdf';
import { type ExportReport } from '@dc/export/timing';
import { RenderError, renderCapabilities, renderMotion } from '../render';
import { trOf } from '../i18n';
import { SANDBOX_DIST } from '../layout';

/** Exact motion render, PDF and the page exports. */
export function registerExport(app: Hono): void {
  /** Whether this machine can render a motion piece exactly (Chrome and ffmpeg), so the editor knows where to send one that holds an embed. */
  app.get('/api/render', async (c) => c.json(await renderCapabilities()));

  /**
   * Render a motion piece with the machine's own Chrome and ffmpeg. The answer is a
   * stream of JSON lines: {"progress":[done,total]} while it works, then {"done":"renders/x.mp4"}
   * (served from the project's raw files) or {"error":"…","code":"…"}. Closing the request stops it.
   */
  app.post('/api/projects/:p/render', async (c) => {
    const p = c.req.param('p');
    const dir = projectDir(p);
    if ((await kindOf(dir)) !== 'motion') throw new HttpError(400, 'badRequest', { detail: 'not a motion piece' });
    const caps = await renderCapabilities();
    if (!caps.chrome || !caps.ffmpeg) throw new HttpError(501, 'noRenderer');
    type Body = { format?: string; speed?: number; container?: string; width?: number; height?: number; fps?: number; quality?: string; from?: number; to?: number; cover?: boolean; coverFirst?: boolean };
    const body = await c.req.json<Body>().catch(() => ({}) as Body);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
    const t = trOf(c);
    const ctl = new AbortController();
    logInfo('render.start', { project: basename(dir), format: body.format, container: body.container, why: 'embed-or-video' });
    return stream(c, async (s) => {
      s.onAbort(() => ctl.abort());
      c.header('content-type', 'application/x-ndjson');
      const line = (v: unknown) => s.write(JSON.stringify(v) + '\n');
      try {
        const { file, report } = await renderMotion({ dir, runtime: join(SANDBOX_DIST, 'motion.js'), format: body.format, speed: body.speed, container: body.container === 'gif' ? 'gif' : 'mp4', width: num(body.width), height: num(body.height), fps: num(body.fps), quality: body.quality === 'low' || body.quality === 'medium' ? body.quality : 'high', from: num(body.from), to: num(body.to), cover: body.cover === true && body.container !== 'gif', coverFirst: body.coverFirst === true, signal: ctl.signal, onProgress: (done, total) => void line({ progress: [done, total] }) });
        await line({ done: basename(file), report });
      } catch (e) {
        const code = e instanceof RenderError ? e.code : 'failed';
        if (code !== 'aborted') logError('render.failed', { project: basename(dir), error: (e as Error).message });
        await line({ code, error: code === 'aborted' ? '' : t('errors.renderFailed', { detail: (e as Error).message }) });
      }
    });
  });

  /**
   * A page to PDF with the machine's own Chrome: the editor builds the page (a deck one slide per page,
   * a doc), the answer is the PDF. 501 when there is no Chrome, so the editor can fall back to the print dialog.
   */
  app.post('/api/pdf', async (c) => {
    const body = await c.req.json<{ html?: string; paper?: string }>().catch(() => ({}) as { html?: string; paper?: string });
    if (typeof body.html !== 'string' || !body.html) throw new HttpError(400, 'badRequest', { detail: 'html' });
    if (!(await renderCapabilities()).chrome) throw new HttpError(501, 'noPdf');
    const started = Date.now();
    try {
      const pdf = await printPdf({ html: body.html, origin: new URL(c.req.url).origin, paper: body.paper === 'a4' ? 'a4' : 'page', signal: c.req.raw.signal });
      logInfo('pdf.done', { ms: Date.now() - started, bytes: pdf.length, paper: body.paper === 'a4' ? 'a4' : 'page' });
      return c.body(new Uint8Array(pdf), 200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' });
    } catch (e) {
      logError('pdf.failed', { ms: Date.now() - started, error: (e as Error).message });
      throw new HttpError(500, 'pdfFailed', { detail: (e as Error).message });
    }
  });

  /** An export made in the browser reports how it went, so the server log shows both routes next to each other (render.done is the other one). */
  app.post('/api/projects/:p/export-report', async (c) => {
    const dir = projectDir(c.req.param('p'));
    const body = await c.req.json<{ report?: ExportReport; why?: string }>().catch(() => ({}) as { report?: ExportReport; why?: string });
    const r = body.report;
    if (!r || typeof r.wallMs !== 'number' || typeof r.frames !== 'number') throw new HttpError(400, 'badRequest', { detail: 'no report' });
    logInfo('export.done', {
      project: basename(dir),
      route: 'browser',
      why: typeof body.why === 'string' ? body.why.slice(0, 40) : undefined,
      size: `${Number(r.width)}x${Number(r.height)}`,
      frames: r.frames,
      wall_ms: r.wallMs,
      fps: r.fps,
      ...Object.fromEntries(Object.entries(r.stages ?? {}).map(([k, v]) => [`${k}_ms`, Number((v as { ms: number }).ms)])),
    });
    return c.json({ ok: true });
  });

  /** A video rendered above, by the name the stream gave. Only files in the project's renders/ folder, only MP4 or GIF. */
  app.get('/api/projects/:p/render/:file', async (c) => {
    const dir = projectDir(c.req.param('p'));
    const file = c.req.param('file');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.(mp4|gif)$/.test(file) || file.includes('..')) throw new HttpError(400, 'notAssetPath', { path: file });
    const bytes = await readFile(join(dir, 'renders', file)).catch(() => null);
    if (!bytes) return c.json({ error: 'not found' }, 404);
    return c.body(new Uint8Array(bytes), 200, { 'content-type': file.endsWith('.gif') ? 'image/gif' : 'video/mp4', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  });
}
