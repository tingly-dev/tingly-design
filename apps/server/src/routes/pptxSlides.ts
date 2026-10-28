import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { importPptx } from '@dc/core';
import { HttpError, kindOf, projectDir } from '../store';

/** Converting a PowerPoint into the slides of the open deck: this endpoint is a pure
 * conversion and writes nothing. The editor owns the transaction: it keeps the uploads,
 * appends the slide ids to deck.json first (so pages appear in place as they land) and
 * writes the pages one by one, with rollback and one undo for the whole batch. */
export function registerPptxSlides(app: Hono): void {
  app.post('/api/projects/:p/pptx-slides', async (c) => {
    const p = c.req.param('p');
    if ((await kindOf(projectDir(p))) !== 'slides') throw new HttpError(400, 'pptxIntoSlides');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) throw new HttpError(400, 'emptyFile');
    // the same collision-free namespace a new-project import uses; slide ids and the
    // uploads/ folder derive from it, so two appends can never collide
    const id = `pptx-${randomUUID().replace(/-/g, '')}`;
    const name = (c.req.query('name') ?? '').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, ' ').trim();
    const result = importPptx(bytes, { id, title: name || 'deck' });
    if (!result.ok) return c.json({ ok: false as const, diagnostics: result.diagnostics }, 400);
    const files: Record<string, string> = {};
    for (const [path, content] of Object.entries(result.files)) {
      if (path === 'deck.json' || path.startsWith('slides/')) continue;
      files[path] = Buffer.from(content).toString('base64');
    }
    return c.json({
      ok: true as const,
      id,
      size: result.report.size,
      slides: result.report.slides.map((s) => ({ id: s.id, source: Buffer.from(result.files[`slides/${s.id}.html`]).toString('utf8') })),
      files,
      diagnostics: result.diagnostics,
    });
  });
}
