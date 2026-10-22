/**
 * One-click PDF: the page an editor built (a deck laid out one slide per page, a doc) is
 * printed by the Chrome or Edge already on the machine, the same one the exact video render
 * uses. Without it the editor falls back to the browser's print dialog. See .design/export-menu.md.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChrome, launchBrowser } from './chrome';

export type Paper = 'page' | 'a4';

export class PdfError extends Error {
  constructor(public code: 'no-chrome' | 'failed', message = '') {
    super(message || code);
  }
}

/** Print `html` to a PDF. `origin` is where the editor's server is, so `/api/…` image paths in the page resolve. `page` takes the size from the page's own `@page` rule (slides); `a4` suits a document. */
export async function printPdf(o: { html: string; origin: string; paper: Paper; signal?: AbortSignal }): Promise<Buffer> {
  const chrome = findChrome();
  if (!chrome) throw new PdfError('no-chrome');
  const tmp = mkdtempSync(join(tmpdir(), 'dc-pdf-'));
  const file = join(tmp, 'page.html');
  const base = `<base href="${o.origin.replace(/"/g, '')}/">`;
  writeFileSync(file, /<head[^>]*>/i.test(o.html) ? o.html.replace(/<head[^>]*>/i, (m) => m + base) : base + o.html);
  const run = launchBrowser({ chrome, prefix: 'dc-pdf', tmp, signal: o.signal, timeoutMs: 90_000 });
  try {
    const { cdp } = run;
    const { sessionId, send: s } = await run.page();
    await s('Page.enable');
    const loaded = new Promise<void>((ok) => cdp.on((m) => m.method === 'Page.loadEventFired' && m.sessionId === sessionId && ok()));
    await s('Page.navigate', { url: `file://${file}` });
    await loaded;
    // web fonts and pictures that load late would print as their fallbacks
    await s('Runtime.evaluate', {
      expression: `Promise.all([document.fonts.ready, ...[...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r }))]).then(() => new Promise(r => setTimeout(r, 200)))`,
      awaitPromise: true,
    });
    const paper = o.paper === 'a4' ? { paperWidth: 8.27, paperHeight: 11.69, marginTop: 0.6, marginBottom: 0.6, marginLeft: 0.6, marginRight: 0.6 } : { preferCSSPageSize: true };
    const { data } = await s<{ data: string }>('Page.printToPDF', { printBackground: true, ...paper });
    return Buffer.from(data, 'base64');
  } catch (e) {
    if (o.signal?.aborted) throw new PdfError('failed', 'aborted');
    throw e instanceof PdfError ? e : new PdfError('failed', (e as Error).message);
  } finally {
    await run.close();
  }
}
