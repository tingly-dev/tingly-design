/**
 * Exports that only the editor's page can make (pictures of boards, slides, tabs and views; a
 * deck's or a doc's PDF, HTML and Markdown): the machine's Chrome opens the editor on the project
 * and runs the Import / Export menu's own items through `window.tinglyDesign` (the editor's
 * headless.ts), so the file is the one the button saves. Used by `tingly-design export` and
 * `check --snapshots`; see .design/cli.md §4.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log } from './log';
import { Cdp, chromeArgs, findChrome } from './render';

export interface PageJob {
  /** a board, slide, tab or view to show first */
  pick?: string;
  /** the menu item's id */
  item: string;
}

export interface PageFile {
  name: string;
  type: string;
  data: Buffer;
}

export interface PageResult extends PageJob {
  files: PageFile[];
  /** what the editor would have shown as an error; `no-pick:<x>`, `no-item:<id>` and `disabled:<id>` when there was nothing to run */
  errors: string[];
}

export class PageExportError extends Error {
  constructor(public code: 'no-chrome' | 'no-editor' | 'failed', message = '') {
    super(message || code);
  }
}

/** Opens `editor` (the editor's address, with a trailing slash) on `project` and runs `jobs` in order. */
export async function exportFromPage(o: { editor: string; project: string; lang: string; jobs: PageJob[]; signal?: AbortSignal; width?: number; height?: number }): Promise<PageResult[]> {
  const chrome = findChrome();
  if (!chrome) throw new PageExportError('no-chrome');
  const tmp = mkdtempSync(join(tmpdir(), 'dc-page-'));
  const browser = spawn(chrome, chromeArgs(join(tmp, 'profile')), { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const stop = () => browser.kill('SIGKILL');
  o.signal?.addEventListener('abort', stop);
  try {
    const cdp = new Cdp(browser);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = <T = any>(method: string, params: object = {}) => cdp.send<T>(method, params, sessionId);
    await s('Page.enable');
    await s('Runtime.enable');
    await s('Network.enable');
    // what the page is still fetching (datasets, fonts, pictures, a frame's files): a picture taken before they arrive shows placeholders
    const inflight = new Map<string, string>();
    let lastNet = Date.now();
    cdp.on((m) => {
      if (m.sessionId !== sessionId) return;
      // the editor's change stream stays open for good; it is not something to wait for
      if (m.method === 'Network.requestWillBeSent') m.params.type !== 'EventSource' && (inflight.set(m.params.requestId, m.params.request?.url ?? ''), (lastNet = Date.now()));
      else if (m.method === 'Network.responseReceived' && /event-stream/.test(m.params.response?.mimeType ?? '')) inflight.delete(m.params.requestId);
      else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inflight.delete(m.params.requestId), (lastNet = Date.now());
    });
    // quiet: nothing in flight for half a second (an event stream that never ends is not waited for past `max`)
    const quiet = async (max = 20_000) => {
      const until = Date.now() + max;
      while (Date.now() < until && (inflight.size > 0 || Date.now() - lastNet < 500)) await new Promise((r) => setTimeout(r, 100));
      if (inflight.size) log('debug', 'page.export.busy', { still: [...inflight.values()].map((u) => u.slice(0, 120)).join(' ') });
    };
    // what the page says goes to the debug log (DC_LOG_LEVEL=debug), to see why an export came back empty
    cdp.on((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.consoleAPICalled') log('debug', 'page.console', { type: m.params.type, text: m.params.args?.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(' ') });
      else if (m.method === 'Runtime.exceptionThrown') log('debug', 'page.error', { text: m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text });
    });
    await s('Emulation.setDeviceMetricsOverride', { width: o.width ?? 1440, height: o.height ?? 900, deviceScaleFactor: 1, mobile: false });
    // light, in the command's language: the same file whoever runs it
    const url = new URL(o.editor);
    url.searchParams.set('p', o.project);
    url.searchParams.set('lang', o.lang);
    url.searchParams.set('theme', 'light');
    const loaded = new Promise<void>((ok) => cdp.on((m) => m.method === 'Page.loadEventFired' && m.sessionId === sessionId && ok()));
    const nav = await s<{ errorText?: string }>('Page.navigate', { url: url.href });
    if (nav.errorText) throw new PageExportError('no-editor', `${url.origin}: ${nav.errorText}`);
    await within(loaded, 30_000, 'no-editor', url.origin);
    const call = async <T>(expression: string, ms: number): Promise<T> => {
      const r = await within(s<{ result: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), ms, 'failed', expression);
      if (r.exceptionDetails) throw new PageExportError('failed', r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'error');
      return r.result.value as T;
    };
    // the page is the editor once it answers; a page that never does (a 404, another app on the port) is not
    const deadline = Date.now() + 30_000;
    while (!(await call<boolean>('!!window.tinglyDesign', 5_000))) {
      if (Date.now() > deadline) throw new PageExportError('no-editor', url.origin);
      await new Promise((r) => setTimeout(r, 200));
    }
    // the menu shows once the project has loaded; until then there is nothing to run
    await call('window.tinglyDesign.exports()', 45_000).catch(() => {
      throw new PageExportError('no-editor', url.href);
    });
    log('info', 'page.export.start', { project: o.project, jobs: o.jobs.length, editor: url.origin });
    const out: PageResult[] = [];
    for (const job of o.jobs) {
      if (job.pick !== undefined && !(await call<boolean>(`window.tinglyDesign.pick(${JSON.stringify(job.pick)})`, 30_000))) {
        out.push({ ...job, files: [], errors: [`no-pick:${job.pick}`] });
        continue;
      }
      await quiet();
      const r = await call<{ files: { name: string; type: string; data: string }[]; errors: string[] }>(`window.tinglyDesign.run(${JSON.stringify(job.item)})`, 120_000);
      out.push({ ...job, errors: r.errors, files: r.files.map((f) => ({ name: f.name, type: f.type, data: Buffer.from(f.data, 'base64') })) });
    }
    log('info', 'page.export.done', { project: o.project, files: out.reduce((n, r) => n + r.files.length, 0), errors: out.reduce((n, r) => n + r.errors.length, 0) });
    return out;
  } catch (e) {
    log('warn', 'page.export.failed', { project: o.project, error: (e as Error).message });
    if (o.signal?.aborted) throw new PageExportError('failed', 'aborted');
    throw e instanceof PageExportError ? e : new PageExportError('failed', (e as Error).message);
  } finally {
    o.signal?.removeEventListener('abort', stop);
    const exited = new Promise((ok) => (browser.exitCode !== null || browser.signalCode !== null ? ok(null) : browser.once('close', ok)));
    stop();
    await exited;
    await new Promise((r) => setTimeout(r, 300));
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* the system clears its temp folder */
    }
  }
}

function within<T>(p: Promise<T>, ms: number, code: PageExportError['code'], what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, fail) => (timer = setTimeout(() => fail(new PageExportError(code, `${what}: timed out`)), ms)))]).finally(() => clearTimeout(timer));
}
