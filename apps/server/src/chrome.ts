/**
 * The Chrome or Edge already on the machine, driven over its own debugging pipe: where it is,
 * how it is started, the protocol client, and one way to open it for a job and close it again.
 * Rendering, PDF printing and the page exports (`render.ts`, `pdf.ts`, `pageExport.ts`) share it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** The first Chrome-family browser we can run: DC_CHROME, then the usual places on each system, then Playwright's own. */
export function findChrome(): string | null {
  const fromEnv = process.env.DC_CHROME;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  const home = process.env.HOME ?? '';
  const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[];
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium', join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')]
      : process.platform === 'win32'
        ? pf.flatMap((d) => [join(d, 'Google/Chrome/Application/chrome.exe'), join(d, 'Microsoft/Edge/Application/msedge.exe'), join(d, 'Chromium/Application/chrome.exe')])
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium', '/opt/google/chrome/chrome'];
  for (const c of candidates) if (existsSync(c)) return c;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(root)) {
    for (const d of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      const p = join(root, d, 'chrome-linux', 'chrome');
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * How we start Chrome: headless, driven over its debugging pipe. Its sandbox needs
 * user namespaces, which root and some CI runners (Ubuntu 24.04's AppArmor rule) do
 * not allow; `DC_CHROME_SANDBOX=0` turns it off there.
 */
export function chromeArgs(profile: string): string[] {
  // WebGL (a shader effect) draws on SwiftShader, the CPU: the same picture on every machine, GPU or not.
  // Chrome stopped falling back to it on its own (137+), so without the last flag every effect came out blank
  const args = ['--headless=new', '--remote-debugging-pipe', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank'];
  if (process.getuid?.() === 0 || process.env.DC_CHROME_SANDBOX === '0') args.unshift('--no-sandbox');
  return args;
}

/** Chrome's debugging protocol over the pipe it is started with: JSON messages ending in a NUL byte. */
export class Cdp {
  private id = 0;
  private waiting = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  private buf = '';
  private handlers: ((m: any) => void)[] = [];
  /** Set once Chrome has gone: a later request fails at once instead of waiting forever. */
  private closed: Error | null = null;
  constructor(private child: ChildProcess) {
    const input = child.stdio[4] as NodeJS.ReadableStream;
    // what Chrome said last, to say why it stopped; reading it also keeps the pipe from filling
    let said = '';
    child.stdio[2]?.on('data', (d: Buffer) => (said = (said + d.toString()).slice(-600)));
    // a Chrome that dies at once resets the pipes: that is a failed render, not a crash
    (child.stdio[3] as NodeJS.WritableStream | null)?.on('error', () => {});
    input.on('error', () => {});
    input.setEncoding('utf8');
    input.on('data', (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf('\0')) >= 0) {
        const msg = JSON.parse(this.buf.slice(0, i));
        this.buf = this.buf.slice(i + 1);
        if (msg.id !== undefined) {
          const w = this.waiting.get(msg.id);
          this.waiting.delete(msg.id);
          if (w) msg.error ? w.fail(new Error(msg.error.message)) : w.ok(msg.result);
        } else for (const h of this.handlers) h(msg);
      }
    });
    child.on('error', (e) => (said += `\n${e.message}`));
    child.on('close', () => {
      const why = said.trim().split('\n').slice(-3).join(' ');
      this.closed = new Error(why ? `Chrome closed: ${why}` : 'Chrome closed');
      for (const w of this.waiting.values()) w.fail(this.closed);
      this.waiting.clear();
    });
  }
  on(h: (m: any) => void) {
    this.handlers.push(h);
  }
  send<T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = ++this.id;
    return new Promise((ok, fail) => {
      if (this.closed) return fail(this.closed);
      this.waiting.set(id, { ok, fail });
      (this.child.stdio[3] as NodeJS.WritableStream).write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }
}


export interface BrowserRun {
  browser: ChildProcess;
  cdp: Cdp;
  /** Kills Chrome (and whatever `onStop` adds). Safe to call more than once. */
  stop: () => void;
  /** A new page, attached: commands go to it through `send`. */
  page: () => Promise<{ sessionId: string; send: <T = any>(method: string, params?: object) => Promise<T> }>;
  /** Stops Chrome, waits until it has gone and removes the folder it ran in. */
  close: () => Promise<void>;
}

/**
 * Starts Chrome for one job in `tmp`, a folder the job owns: `close()` removes it.
 * `signal` and `timeoutMs` stop it; `onStop` stops what else belongs to the job (an encoder).
 */
export function launchBrowser(o: { chrome: string; tmp: string; signal?: AbortSignal; timeoutMs?: number; onStop?: () => void }): BrowserRun {
  const { tmp } = o;
  const browser = spawn(o.chrome, chromeArgs(join(tmp, 'profile')), { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const stop = () => {
    browser.kill('SIGKILL');
    o.onStop?.();
  };
  o.signal?.addEventListener('abort', stop);
  // an already-aborted signal never fires its event
  if (o.signal?.aborted) stop();
  const timer = o.timeoutMs ? setTimeout(stop, o.timeoutMs) : null;
  const cdp = new Cdp(browser);
  return {
    browser,
    cdp,
    stop,
    async page() {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      return { sessionId, send: <T = any>(method: string, params: object = {}) => cdp.send<T>(method, params, sessionId) };
    },
    async close() {
      if (timer) clearTimeout(timer);
      o.signal?.removeEventListener('abort', stop);
      const exited = new Promise((ok) => (browser.exitCode !== null || browser.signalCode !== null ? ok(null) : browser.once('close', ok)));
      stop();
      await exited;
      await new Promise((r) => setTimeout(r, 300));
      // Chrome may still be flushing its profile for a moment; leftovers in the temp folder are not worth failing a job for
      try {
        rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        /* the system clears its temp folder */
      }
    },
  };
}
