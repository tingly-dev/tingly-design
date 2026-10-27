/**
 * Exports that only the editor's page can make (pictures of boards, slides, tabs and views; a
 * deck's or a doc's PDF, HTML and Markdown): the machine's Chrome opens the editor on the project
 * and runs the Import / Export menu's own items through `window.tinglyDesign` (the editor's
 * headless.ts), so the file is the one the button saves. Used by `tingly-design export` and
 * `check --snapshots`; see .design/cli.md §4.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type LayoutFinding, layoutProbe } from './layoutProbe';
import { log } from './log';
import { findChrome, launchBrowser } from './chrome';

/** A PowerPoint export keeps its own deadline in the page (it grows with the deck, up to ten minutes); this only catches a page that stopped answering. */
const PPTX_DEADLINE = 660_000;

export interface PageJob {
  /** a board, slide, tab or view to show first */
  pick?: string;
  /** the menu item's id */
  item: string;
  /** what the command line named for this run (a slides pptx range), handed to the item */
  arg?: string;
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

/**
 * What went wrong inside the work while the page showed it: a script in a board, slide, page or
 * preview that threw, or a picture, font, stylesheet or script it asked for that did not arrive.
 * `where` is the frame's title (the board's name, the slide's id), when it has one.
 */
export interface PageIssue {
  kind: 'error' | 'missing';
  where?: string;
  /** the error's message, or the address that did not load and why */
  text: string;
}

/** A layout finding in one frame of the work; `where` as for a PageIssue. */
export interface PageLayout extends LayoutFinding {
  where?: string;
}

export class PageExportError extends Error {
  constructor(public code: 'no-chrome' | 'no-editor' | 'failed', message = '') {
    super(message || code);
  }
}

export interface PageOptions {
  /** the editor's address, with a trailing slash */
  editor: string;
  project: string;
  lang: string;
  signal?: AbortSignal;
  width?: number;
  height?: number;
}

/** In the editor's page: an expression evaluated there, awaited, and its value; `quiet` waits for what the page is still fetching. */
export interface Page {
  call<T>(expression: string, ms: number): Promise<T>;
  quiet(max?: number): Promise<void>;
  /** what went wrong in the work so far, each once */
  issues(): Promise<PageIssue[]>;
  /** what the layout probe finds in every work frame showing now; `fixed` when a frame is the work's own size */
  layout(fixed: boolean, page?: boolean): Promise<PageLayout[]>;
}

/** Opens `editor` on `project` and runs `jobs` in order; with `issues`, also what went wrong in the work while it showed. */
export async function exportFromPage(o: PageOptions & { jobs: PageJob[]; layout?: { fixed: boolean; page?: boolean } }): Promise<{ results: PageResult[]; issues: PageIssue[]; layout: PageLayout[] }> {
  return withPage(o, async ({ call, quiet, issues, layout }) => {
    log('info', 'page.export.start', { project: o.project, jobs: o.jobs.length, editor: new URL(o.editor).origin });
    // the menu shows once the project has loaded; until then there is nothing to run
    await call('window.tinglyDesign.exports()', 45_000).catch(() => {
      throw new PageExportError('no-editor', o.editor);
    });
    const out: PageResult[] = [];
    const looked = new Map<string, PageLayout>();
    for (const job of o.jobs) {
      if (job.pick !== undefined && !(await call<boolean>(`window.tinglyDesign.pick(${JSON.stringify(job.pick)})`, 30_000))) {
        out.push({ ...job, files: [], errors: [`no-pick:${job.pick}`] });
        continue;
      }
      await quiet();
      const r = await call<{ files: { name: string; type: string; data: string }[]; errors: string[] }>(`window.tinglyDesign.run(${JSON.stringify(job.item)}${job.arg !== undefined ? `, ${JSON.stringify(job.arg)}` : ''})`, job.item === 'pptx' ? PPTX_DEADLINE : 120_000);
      out.push({ ...job, errors: r.errors, files: r.files.map((f) => ({ name: f.name, type: f.type, data: Buffer.from(f.data, 'base64') })) });
      // each job shows its own board, slide or view: look at what is on screen now, each finding once
      if (o.layout) for (const f of await layout(o.layout.fixed, o.layout.page)) looked.set(JSON.stringify(f), f);
    }
    await quiet();
    const seen = await issues();
    log('info', 'page.export.done', { project: o.project, files: out.reduce((n, r) => n + r.files.length, 0), errors: out.reduce((n, r) => n + r.errors.length, 0), issues: seen.length });
    return { results: out, issues: seen, layout: [...looked.values()] };
  });
}

/** Opens `editor` on `project` in the machine's Chrome, waits until the page answers (`window.tinglyDesign`), runs `fn` against it and closes Chrome. */
export async function withPage<T>(o: PageOptions, fn: (page: Page) => Promise<T>): Promise<T> {
  const chrome = findChrome();
  if (!chrome) throw new PageExportError('no-chrome');
  const tmp = mkdtempSync(join(tmpdir(), 'dc-page-'));
  const run = launchBrowser({ chrome, tmp, signal: o.signal });
  try {
    const { cdp } = run;
    const { sessionId, send: s } = await run.page();
    await s('Page.enable');
    // boards, slides and previews are sandboxed frames, which Chrome may run as frames of their own: attach to them too
    const sessions = new Set([sessionId]);
    // a frame waits until it is watched, so an error its first script throws is seen
    const watch = (sid: string, waiting = false) =>
      Promise.all([
        cdp.send('Runtime.enable', {}, sid),
        cdp.send('Network.enable', {}, sid),
        cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sid),
      ])
        .catch(() => {})
        .then(() => waiting && cdp.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {}));
    // what went wrong inside the work: a context's frame, each request's frame and kind, and what was found
    const contexts = new Map<string, string>();
    // each frame's page context while it lives, for the layout probe
    const live = new Map<string, { sid: string; id: number; frame: string }>();
    const requests = new Map<string, { url: string; type: string; frame: string }>();
    const found = new Map<string, { kind: PageIssue['kind']; frame: string; text: string }>();
    let mainFrame = '';
    const note = (kind: PageIssue['kind'], frame: string, text: string) => found.set(`${kind}\0${frame}\0${text}`, { kind, frame, text });
    const missed = (sid: string, requestId: string, why: string) => {
      const r = requests.get(`${sid}:${requestId}`);
      // the editor's own requests are its business; the work's pictures, fonts, styles and scripts are the person's
      if (!r || !WORK_TYPES.has(r.type) || r.url.startsWith('data:')) return;
      if (r.frame === mainFrame && !r.url.includes('/raw/')) return;
      note('missing', r.frame, `${r.url.length > 160 ? r.url.slice(0, 160) + '…' : r.url} (${why})`);
    };
    cdp.on((m) => {
      if (!sessions.has(m.sessionId)) return;
      const sid: string = m.sessionId;
      if (m.method === 'Target.attachedToTarget' && m.params.targetInfo?.type === 'iframe') {
        sessions.add(m.params.sessionId);
        void watch(m.params.sessionId, m.params.waitingForDebugger);
      } else if (m.method === 'Runtime.executionContextCreated') {
        contexts.set(`${sid}:${m.params.context.id}`, m.params.context.auxData?.frameId ?? '');
        if (m.params.context.auxData?.isDefault) live.set(`${sid}:${m.params.context.id}`, { sid, id: m.params.context.id, frame: m.params.context.auxData.frameId ?? '' });
      } else if (m.method === 'Runtime.executionContextDestroyed') live.delete(`${sid}:${m.params.executionContextId}`);
      else if (m.method === 'Runtime.executionContextsCleared') for (const k of [...live.keys()]) k.startsWith(`${sid}:`) && live.delete(k);
      else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        const frame = contexts.get(`${sid}:${d?.executionContextId}`) ?? '';
        if (frame && frame !== mainFrame) note('error', frame, (d?.exception?.description ?? d?.text ?? 'error').split('\n')[0]);
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        // a board's renderer catches what its script throws and logs the error object
        const frame = contexts.get(`${sid}:${m.params.executionContextId}`) ?? '';
        const err = (m.params.args ?? []).find((a: { subtype?: string }) => a.subtype === 'error');
        if (frame && frame !== mainFrame && err?.description) note('error', frame, err.description.split('\n')[0]);
      } else if (m.method === 'Network.requestWillBeSent') requests.set(`${sid}:${m.params.requestId}`, { url: m.params.request?.url ?? '', type: m.params.type ?? '', frame: m.params.frameId ?? '' });
      else if (m.method === 'Network.responseReceived' && m.params.response?.status >= 400) missed(sid, m.params.requestId, String(m.params.response.status));
      else if (m.method === 'Network.loadingFailed' && !m.params.canceled) missed(sid, m.params.requestId, m.params.errorText || m.params.blockedReason || 'failed');
    });
    const issues = async (): Promise<PageIssue[]> => {
      const titles = new Map<string, string | undefined>();
      const out: PageIssue[] = [];
      for (const f of found.values()) {
        if (!titles.has(f.frame)) titles.set(f.frame, await frameTitle(s, f.frame));
        const where = titles.get(f.frame);
        out.push({ kind: f.kind, ...(where ? { where } : {}), text: f.text });
      }
      return out;
    };
    // what the page is still fetching (datasets, fonts, pictures, a frame's files): a picture taken before they arrive shows placeholders
    const inflight = new Map<string, string>();
    let lastNet = Date.now();
    cdp.on((m) => {
      if (!sessions.has(m.sessionId)) return;
      // the editor's change stream stays open for good; it is not something to wait for
      const id = `${m.sessionId}:${m.params?.requestId}`;
      if (m.method === 'Network.requestWillBeSent') m.params.type !== 'EventSource' && (inflight.set(id, m.params.request?.url ?? ''), (lastNet = Date.now()));
      else if (m.method === 'Network.responseReceived' && /event-stream/.test(m.params.response?.mimeType ?? '')) inflight.delete(id);
      else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inflight.delete(id), (lastNet = Date.now());
    });
    // quiet: nothing in flight for half a second (an event stream that never ends is not waited for past `max`)
    const quiet = async (max = 20_000) => {
      const until = Date.now() + max;
      while (Date.now() < until && (inflight.size > 0 || Date.now() - lastNet < 500)) await new Promise((r) => setTimeout(r, 100));
      if (inflight.size) log('debug', 'page.export.busy', { still: [...inflight.values()].map((u) => u.slice(0, 120)).join(' ') });
    };
    // what the page says goes to the debug log (DC_LOG_LEVEL=debug), to see why an export came back empty
    cdp.on((m) => {
      if (!sessions.has(m.sessionId)) return;
      if (m.method === 'Runtime.consoleAPICalled') log('debug', 'page.console', { type: m.params.type, text: m.params.args?.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(' ') });
      else if (m.method === 'Runtime.exceptionThrown') log('debug', 'page.error', { text: m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text });
    });
    await watch(sessionId);
    await s('Emulation.setDeviceMetricsOverride', { width: o.width ?? 1440, height: o.height ?? 900, deviceScaleFactor: 1, mobile: false });
    // light, in the command's language: the same file whoever runs it
    const url = new URL(o.editor);
    url.searchParams.set('p', o.project);
    url.searchParams.set('lang', o.lang);
    url.searchParams.set('theme', 'light');
    const loaded = new Promise<void>((ok) => cdp.on((m) => m.method === 'Page.loadEventFired' && m.sessionId === sessionId && ok()));
    const nav = await s<{ frameId: string; errorText?: string }>('Page.navigate', { url: url.href });
    mainFrame = nav.frameId;
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
    const layout = async (fixed: boolean, page = false): Promise<PageLayout[]> => {
      const out: PageLayout[] = [];
      for (const c of [...live.values()]) {
        if (!c.frame || c.frame === mainFrame) continue;
        const r = await within(cdp.send<{ result: { value?: LayoutFinding[] } }>('Runtime.evaluate', { expression: layoutProbe(fixed, page), contextId: c.id, returnByValue: true }, c.sid), 5_000, 'failed', 'layout').catch(() => undefined);
        const found = r?.result.value;
        if (!Array.isArray(found) || !found.length) continue;
        const where = await frameTitle(s, c.frame);
        for (const f of found) out.push({ ...f, ...(where ? { where } : {}) });
      }
      return out;
    };
    return await fn({ call, quiet, issues, layout });
  } catch (e) {
    log('warn', 'page.export.failed', { project: o.project, error: (e as Error).message });
    if (o.signal?.aborted) throw new PageExportError('failed', 'aborted');
    throw e instanceof PageExportError ? e : new PageExportError('failed', (e as Error).message);
  } finally {
    await run.close();
  }
}

/** What a page's work asks for: a request of any other kind is the editor's own. */
const WORK_TYPES = new Set(['Image', 'Font', 'Stylesheet', 'Script', 'Media']);

/** The title of the frame element showing `frame` (a board's name, a slide's id), if it has one. */
async function frameTitle(s: <T = any>(method: string, params?: object) => Promise<T>, frame: string): Promise<string | undefined> {
  try {
    const { backendNodeId } = await s<{ backendNodeId: number }>('DOM.getFrameOwner', { frameId: frame });
    const { node } = await s<{ node: { attributes?: string[] } }>('DOM.describeNode', { backendNodeId });
    const a = node.attributes ?? [];
    const i = a.indexOf('title');
    return i >= 0 && a[i + 1] ? a[i + 1] : undefined;
  } catch {
    return undefined;
  }
}

function within<T>(p: Promise<T>, ms: number, code: PageExportError['code'], what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, fail) => (timer = setTimeout(() => fail(new PageExportError(code, `${what}: timed out`)), ms)))]).finally(() => clearTimeout(timer));
}
