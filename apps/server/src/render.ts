/**
 * The exact renderer: the Chrome or Edge already on the machine draws every
 * frame of a motion piece and ffmpeg encodes them. It draws what the browser
 * export cannot (an embed, a video layer, a canvas effect), so the editor
 * sends a piece here when it holds one. No Playwright and no download: Chrome is
 * driven over its own debugging pipe. See .design/export.md.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseMotion, sceneFile } from '@dc/core';

export interface RenderCapabilities {
  chrome: boolean;
  ffmpeg: boolean;
}

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

let ffmpegChecked: Promise<boolean> | null = null;
/** ffmpeg on PATH (or DC_FFMPEG). Asked once. */
export function ffmpegPath(): string {
  return process.env.DC_FFMPEG || 'ffmpeg';
}
function hasFfmpeg(): Promise<boolean> {
  ffmpegChecked ??= new Promise((ok) => execFile(ffmpegPath(), ['-version'], (err) => ok(!err)));
  return ffmpegChecked;
}

export async function renderCapabilities(): Promise<RenderCapabilities> {
  return { chrome: findChrome() !== null, ffmpeg: await hasFfmpeg() };
}

/** Chrome's debugging protocol over the pipe it is started with: JSON messages ending in a NUL byte. */
class Cdp {
  private id = 0;
  private waiting = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  private buf = '';
  private handlers: ((m: any) => void)[] = [];
  constructor(private child: ChildProcess) {
    const input = child.stdio[4] as NodeJS.ReadableStream;
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
    child.on('close', () => {
      for (const w of this.waiting.values()) w.fail(new Error('Chrome closed'));
      this.waiting.clear();
    });
  }
  on(h: (m: any) => void) {
    this.handlers.push(h);
  }
  send<T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    const id = ++this.id;
    return new Promise((ok, fail) => {
      this.waiting.set(id, { ok, fail });
      (this.child.stdio[3] as NodeJS.WritableStream).write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };

/** The page is drawn from a string, so files a scene points at (uploads/…) go in as data: URLs. */
function inlineFiles(html: string, dir: string): string {
  const data = (u: string) => {
    if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u)) return null;
    const p = resolve(dir, u.replace(/^\.?\//, ''));
    const type = MIME[p.split('.').pop()!.toLowerCase()];
    if (!type || !p.startsWith(dir + '/') || !existsSync(p)) return null;
    return `data:${type};base64,${readFileSync(p).toString('base64')}`;
  };
  return html
    .replace(/\b(src|poster|href)="([^"]+)"/g, (m, a, u) => {
      const d = data(u);
      return d ? `${a}="${d}"` : m;
    })
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => {
      const d = data(u);
      return d ? `url(${q}${d}${q})` : m;
    });
}

export interface RenderOptions {
  /** The project's folder. */
  dir: string;
  /** The built sandbox's motion.js. */
  runtime: string;
  format?: string;
  speed?: number;
  signal?: AbortSignal;
  onProgress?(done: number, total: number): void;
}

export class RenderError extends Error {
  constructor(public code: 'no-renderer' | 'no-format' | 'aborted' | 'failed', message = '') {
    super(message || code);
  }
}

/** ffmpeg arguments: PNG frames on stdin, the project's audio mixed in, H.264 out. */
function encodeArgs(motion: ReturnType<typeof parseMotion>, dir: string, fps: number, seconds: number, file: string): string[] {
  const a = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
  const audio = motion.audio.filter((x) => /^[A-Za-z0-9_./-]+$/.test(x.src) && !x.src.includes('..') && existsSync(join(dir, x.src)));
  for (const x of audio) a.push('-i', join(dir, x.src));
  const filters = ['[0:v]format=yuv420p[v]'];
  audio.forEach((x, i) => {
    const ms = Math.round((x.start ?? 0) * 1000);
    filters.push(`[${i + 1}:a]adelay=${ms}|${ms},volume=${x.gain ?? 0}dB[a${i}]`);
  });
  if (audio.length) filters.push(`${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0[a]`);
  a.push('-filter_complex', filters.join(';'), '-map', '[v]');
  if (audio.length) a.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
  a.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', String(fps), '-t', seconds.toFixed(3), '-movflags', '+faststart', file);
  return a;
}

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** Render one format of a motion piece to `renders/<project>-<format>.mp4`; resolves to the file's path. */
export async function renderMotion(o: RenderOptions): Promise<string> {
  const chrome = findChrome();
  if (!chrome || !(await hasFfmpeg())) throw new RenderError('no-renderer');
  const motion = parseMotion(readFileSync(join(o.dir, 'motion.json'), 'utf8'));
  const format = o.format && motion.formats[o.format] ? o.format : Object.keys(motion.formats)[0];
  if (!format) throw new RenderError('no-format');
  const [w, h] = motion.formats[format].size;
  const scenes = Object.fromEntries(
    motion.order.filter((id) => existsSync(join(o.dir, sceneFile(id)))).map((id) => [id, inlineFiles(readFileSync(join(o.dir, sceneFile(id)), 'utf8'), o.dir)]),
  );
  const runtime = readFileSync(o.runtime, 'utf8').replace(/<\/script/gi, '<\\/script');
  const tmp = mkdtempSync(join(tmpdir(), 'dc-render-'));
  const page = join(tmp, 'page.html');
  writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style></head><body><div id="root"></div><script>${runtime}</script></body></html>`);
  const out = join(o.dir, 'renders');
  mkdirSync(out, { recursive: true });
  const file = join(out, `${basename(o.dir)}-${format}.mp4`);
  const partial = file.replace(/\.mp4$/, '.part.mp4');

  const args = ['--headless=new', '--remote-debugging-pipe', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(tmp, 'profile')}`, 'about:blank'];
  if (process.getuid?.() === 0) args.unshift('--no-sandbox');
  const browser = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let ffmpeg: ChildProcess | null = null;
  const stop = () => {
    browser.kill('SIGKILL');
    ffmpeg?.kill('SIGKILL');
  };
  o.signal?.addEventListener('abort', stop);
  let ffmpegErr = '';
  try {
    if (o.signal?.aborted) throw new RenderError('aborted');
    const cdp = new Cdp(browser);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = <T = any>(method: string, params: object = {}) => cdp.send<T>(method, params, sessionId);
    await s('Page.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await s('Page.navigate', { url: `file://${page}` });
    const evalIn = async <T = any>(expression: string): Promise<T> => {
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    await evalIn('new Promise(r => document.readyState === "complete" ? r() : addEventListener("load", r))');
    const info = await evalIn<{ duration: number; fps: number }>(
      `(async()=>{window.__stage=await window.dcMotion.mount({motion:${json(motion)},scenes:${json(scenes)},format:${json(format)},speed:${o.speed ? Number(o.speed) : 'undefined'},root:document.getElementById('root')});return{duration:window.__stage.duration,fps:window.__stage.fps}})()`,
    );
    const frames = Math.max(1, Math.round((info.duration / 1000) * info.fps));
    ffmpeg = spawn(ffmpegPath(), encodeArgs(motion, o.dir, info.fps, info.duration / 1000, partial), { stdio: ['pipe', 'ignore', 'pipe'] });
    ffmpeg.stderr!.on('data', (d) => (ffmpegErr = (ffmpegErr + d).slice(-2000)));
    const closed = new Promise<number | null>((ok) => ffmpeg!.on('close', ok));
    ffmpeg.stdin!.on('error', () => {});
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new RenderError('aborted');
      await evalIn(`window.__stage.seek(${(i * 1000) / info.fps})`);
      const { data } = await s('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
      if (!ffmpeg.stdin!.write(Buffer.from(data, 'base64'))) await new Promise((r) => ffmpeg!.stdin!.once('drain', r));
      o.onProgress?.(i + 1, frames);
    }
    ffmpeg.stdin!.end();
    const code = await closed;
    if (code !== 0) throw new RenderError('failed', `ffmpeg exited ${code}: ${ffmpegErr}`);
    renameSync(partial, file);
    return file;
  } catch (e) {
    if (o.signal?.aborted) throw new RenderError('aborted');
    throw e instanceof RenderError ? e : new RenderError('failed', (e as Error).message);
  } finally {
    o.signal?.removeEventListener('abort', stop);
    const exited = new Promise((ok) => (browser.exitCode !== null ? ok(null) : browser.once('close', ok)));
    stop();
    await exited;
    await new Promise((r) => setTimeout(r, 300));
    // Chrome may still be flushing its profile for a moment; leftovers in the temp folder are not worth failing a render for
    rmSync(partial, { force: true });
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* the system clears its temp folder */
    }
  }
}
