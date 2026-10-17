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
import { basename, dirname, join, resolve } from 'node:path';
import { boardFilesFor, parseMotion, sceneFile } from '@dc/core';
import { Clock, type ExportReport } from '@dc/export/timing';
import { logInfo } from './log';

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

/**
 * How we start Chrome: headless, driven over its debugging pipe. Its sandbox needs
 * user namespaces, which root and some CI runners (Ubuntu 24.04's AppArmor rule) do
 * not allow; `DC_CHROME_SANDBOX=0` turns it off there.
 */
export function chromeArgs(profile: string): string[] {
  const args = ['--headless=new', '--remote-debugging-pipe', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank'];
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
  /**
   * The file to make: an MP4 (the default), a GIF (no sound, a 256-colour palette made for the
   * whole loop), or a PNG of the cover (the frame at `from` when the piece names no cover).
   */
  container?: 'mp4' | 'gif' | 'png';
  /** Where the file goes; the project's renders/ folder when left out. */
  out?: string;
  /**
   * Also write the cover as `<project>-<format>-cover.png` beside the video, embed it in an MP4
   * as its cover art, and make it the first frame unless motion.json says `coverFirstFrame: false`,
   * so apps that thumbnail frame 0 show it. The editor's export leaves this off.
   */
  cover?: boolean;
  /** The file's frame size, same aspect ratio as the piece; the piece's own when left out. */
  width?: number;
  height?: number;
  /** Draw each frame at this many device pixels per pixel (1–4) and let ffmpeg bring it down to the file's size: sharper type, slower. */
  scale?: number;
  /** Frames per second of the file; the piece's own when left out. */
  fps?: number;
  /** MP4 only: encoder effort, `high` by default. */
  quality?: 'low' | 'medium' | 'high';
  /** Only this stretch of the piece, in milliseconds on its timeline (after speed); sound is left out of a stretch. */
  from?: number;
  to?: number;
  signal?: AbortSignal;
  onProgress?(done: number, total: number): void;
}

export interface RenderResult {
  file: string;
  /** The cover PNG, when one was asked for and the piece has one. */
  coverFile?: string;
  report: ExportReport;
}

export class RenderError extends Error {
  constructor(public code: 'no-renderer' | 'no-format' | 'aborted' | 'failed', message = '') {
    super(message || code);
  }
}

const CRF = { low: 28, medium: 23, high: 18 } as const;
const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

interface Encode {
  fps: number;
  seconds: number;
  container: 'mp4' | 'gif';
  /** File size when it differs from the page's. */
  size?: [number, number];
  quality: keyof typeof CRF;
  /** Mix the project's audio in (the whole piece, MP4 only). */
  sound: boolean;
}

/** ffmpeg arguments: PNG frames on stdin, the project's audio mixed in, H.264 or a GIF out. */
function encodeArgs(motion: ReturnType<typeof parseMotion>, dir: string, e: Encode, file: string): string[] {
  const a = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(e.fps), '-i', '-'];
  const scale = e.size ? `scale=${e.size[0]}:${e.size[1]}:flags=lanczos,` : '';
  if (e.container === 'gif') {
    // one palette for the whole loop (stats from the changed pixels), then dithered with it: far less banding than ffmpeg's default palette
    a.push('-filter_complex', `[0:v]${scale}split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[v]`, '-map', '[v]', '-loop', '0', '-t', e.seconds.toFixed(3), '-f', 'gif', file);
    return a;
  }
  const audio = e.sound ? motion.audio.filter((x) => /^[A-Za-z0-9_./-]+$/.test(x.src) && !x.src.includes('..') && existsSync(join(dir, x.src))) : [];
  for (const x of audio) a.push('-i', join(dir, x.src));
  if (!audio.length) a.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  const filters = [`[0:v]${scale}format=yuv420p[v]`];
  audio.forEach((x, i) => {
    const ms = Math.round((x.start ?? 0) * 1000);
    filters.push(`[${i + 1}:a]adelay=${ms}|${ms},volume=${x.gain ?? 0}dB[a${i}]`);
  });
  if (audio.length) filters.push(`${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0[a]`);
  a.push('-filter_complex', filters.join(';'), '-map', '[v]');
  // a piece without sound still gets a silent track: some platforms refuse a video with no audio stream
  if (audio.length) a.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
  else a.push('-map', '1:a', '-c:a', 'aac', '-b:a', '128k');
  a.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(CRF[e.quality]), '-r', String(e.fps), '-t', e.seconds.toFixed(3), '-movflags', '+faststart', file);
  return a;
}

function attachCover(video: string, png: string, file: string): Promise<void> {
  return new Promise((ok, fail) =>
    execFile(ffmpegPath(), ['-y', '-loglevel', 'error', '-i', video, '-i', png, '-map', '0', '-map', '1', '-c', 'copy', '-c:v:1', 'png', '-disposition:v:1', 'attached_pic', file], (err, _out, stderr) =>
      err ? fail(new RenderError('failed', `ffmpeg (cover art): ${stderr || err.message}`)) : ok(),
    ),
  );
}

/** What a page needs to play a piece: its scenes and the artboards they embed with their files inlined, the cover, the runtime. */
function loadPiece(dir: string, runtimeJs: string, withCover: boolean) {
  const motion = parseMotion(readFileSync(join(dir, 'motion.json'), 'utf8'));
  const scenes = Object.fromEntries(motion.order.filter((id) => existsSync(join(dir, sceneFile(id)))).map((id) => [id, inlineFiles(readFileSync(join(dir, sceneFile(id)), 'utf8'), dir)]));
  const cover = withCover ? motion.cover : undefined;
  const coverScene = cover && 'scene' in cover && existsSync(join(dir, sceneFile(cover.scene))) ? cover.scene : null;
  const coverHtml = coverScene ? inlineFiles(readFileSync(join(dir, sceneFile(coverScene)), 'utf8'), dir) : null;
  const raw = (f: string) => {
    const p = resolve(dir, f);
    return p.startsWith(resolve(dir) + '/') && existsSync(p) ? readFileSync(p, 'utf8') : undefined;
  };
  // artboards the scenes embed (imported from a canvas), drawn by the artboard runtime written into the page (.design/import-from-project.md)
  const files = Object.fromEntries(Object.entries(boardFilesFor([...Object.values(scenes), ...(coverHtml ? [coverHtml] : [])], raw)).map(([f, src]) => [f, inlineFiles(src, dir)]));
  const boardJs = join(dirname(runtimeJs), 'runtime.js');
  const boardRuntime = Object.keys(files).length && existsSync(boardJs) ? { inline: readFileSync(boardJs, 'utf8') } : undefined;
  const runtime = readFileSync(runtimeJs, 'utf8').replace(/<\/script/gi, '<\\/script');
  return { motion, scenes, files, boardRuntime, cover, coverScene, coverHtml, runtime };
}

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

/** Render one format of a motion piece to `renders/<project>-<format>.mp4` (or `.gif`); resolves to the file's path and where the time went. */
export async function renderMotion(o: RenderOptions): Promise<RenderResult> {
  const clock = new Clock();
  const chrome = findChrome();
  // a cover PNG is one screenshot: Chrome alone draws it
  if (!chrome || (o.container !== 'png' && !(await hasFfmpeg()))) throw new RenderError('no-renderer');
  const piece = loadPiece(o.dir, o.runtime, !!(o.cover || o.container === 'png'));
  const { motion, scenes, files, boardRuntime, cover, coverScene, coverHtml, runtime } = piece;
  const format = o.format && motion.formats[o.format] ? o.format : Object.keys(motion.formats)[0];
  if (!format) throw new RenderError('no-format');
  const [w, h] = motion.formats[format].size;
  const scale = Math.max(1, Math.min(4, Math.round(o.scale ?? 1)));
  const tmp = mkdtempSync(join(tmpdir(), 'dc-render-'));
  const page = join(tmp, 'page.html');
  writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style></head><body><div id="root"></div><div id="cover" style="position:absolute;left:0;top:0"></div><script>${runtime}</script></body></html>`);
  const out = o.out ? resolve(o.out) : join(o.dir, 'renders');
  mkdirSync(out, { recursive: true });
  const ext = o.container ?? 'mp4';
  const stem = `${basename(o.dir)}-${format}`;
  const file = join(out, ext === 'png' ? `${stem}-cover.png` : `${stem}.${ext}`);
  const partial = file.replace(new RegExp(`\\.${ext}$`), `.part.${ext}`);
  const artFile = join(out, `${stem}.art.mp4`);

  const browser = spawn(chrome, chromeArgs(join(tmp, 'profile')), { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let ffmpeg: ChildProcess | null = null;
  const stop = () => {
    browser.kill('SIGKILL');
    ffmpeg?.kill('SIGKILL');
  };
  o.signal?.addEventListener('abort', stop);
  let ffmpegErr = '';
  try {
    if (o.signal?.aborted) throw new RenderError('aborted');
    const launched = performance.now();
    const cdp = new Cdp(browser);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = <T = any>(method: string, params: object = {}) => cdp.send<T>(method, params, sessionId);
    await s('Page.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false });
    await s('Page.navigate', { url: `file://${page}` });
    const evalIn = async <T = any>(expression: string): Promise<T> => {
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    await evalIn('new Promise(r => document.readyState === "complete" ? r() : addEventListener("load", r))');
    const info = await evalIn<{ duration: number; fps: number }>(
      `(async()=>{window.__stage=await window.dcMotion.mount({motion:${json(motion)},scenes:${json(scenes)},files:${json(files)},boardRuntime:${json(boardRuntime ?? null)}||undefined,format:${json(format)},speed:${o.speed ? Number(o.speed) : 'undefined'},root:document.getElementById('root')});return{duration:window.__stage.duration,fps:window.__stage.fps}})()`,
    );
    clock.add('launch', performance.now() - launched);
    const from = Math.max(0, o.from ?? 0);
    const to = Math.min(info.duration, o.to ?? info.duration);
    const shot = async () => Buffer.from((await s<{ data: string }>('Page.captureScreenshot', { format: 'png' })).data, 'base64');
    // the cover: a frame of the piece, or a scene outside the order drawn finished, over the stage and then taken away
    let coverPng: Buffer | null = null;
    if (cover && 'at' in cover) {
      await evalIn(`window.__stage.seek(${Math.min(cover.at, info.duration)})`);
      coverPng = await shot();
    } else if (coverScene) {
      // the stage hides while the cover is up, so a cover with a see-through background shows nothing behind it
      await evalIn(
        `(async()=>{document.getElementById('root').style.visibility='hidden';const c=await window.dcMotion.mount({motion:{...${json(motion)},order:[${json(coverScene)}]},scenes:{[${json(coverScene)}]:${json(coverHtml)}},files:${json(files)},boardRuntime:${json(boardRuntime ?? null)}||undefined,format:${json(format)},root:document.getElementById('cover')});await c.seek(c.duration);window.__cover=c})()`,
      );
      coverPng = await shot();
      await evalIn(`(()=>{window.__cover.destroy?.();document.getElementById('cover').remove();document.getElementById('root').style.visibility=''})()`);
    }
    if (o.container === 'png') {
      if (!coverPng) {
        await evalIn(`window.__stage.seek(${from})`);
        coverPng = await shot();
      }
      writeFileSync(file, coverPng);
      const report = clock.report({ route: 'server', frames: 1, width: w, height: h });
      logInfo('render.done', { project: basename(o.dir), format, size: `${w}x${h}`, container: 'png', frames: 1, wall_ms: report.wallMs });
      return { file, report };
    }
    const coverFile = o.cover && coverPng ? join(out, `${stem}-cover.png`) : undefined;
    if (coverFile) writeFileSync(coverFile, coverPng!);
    const whole = from === 0 && to >= info.duration;
    const fps = Math.max(1, Math.min(120, o.fps ?? info.fps));
    const length = Math.max(1, to - from);
    const frames = Math.max(1, Math.round((length / 1000) * fps));
    // the page is w×h; a different size is drawn by ffmpeg from the full-size screenshot, in the same aspect ratio
    // one side given: the other keeps the piece's aspect ratio
    const outW = even(o.width ?? (o.height ? (o.height * w) / h : w));
    const outH = even(o.height ?? (o.width ? (o.width * h) / w : h));
    const encode: Encode = { fps, seconds: length / 1000, container: o.container === 'gif' ? 'gif' : 'mp4', size: outW === w && outH === h && scale === 1 ? undefined : [outW, outH], quality: o.quality ?? 'high', sound: whole };
    ffmpeg = spawn(ffmpegPath(), encodeArgs(motion, o.dir, encode, partial), { stdio: ['pipe', 'ignore', 'pipe'] });
    ffmpeg.stderr!.on('data', (d) => (ffmpegErr = (ffmpegErr + d).slice(-2000)));
    const closed = new Promise<number | null>((ok) => ffmpeg!.on('close', ok));
    ffmpeg.stdin!.on('error', () => {});
    const coverFirst = coverFile && whole && motion.coverFirstFrame !== false;
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new RenderError('aborted');
      let frame: Buffer;
      if (i === 0 && coverFirst) frame = coverPng!;
      else {
        await clock.time('seek', () => evalIn(`window.__stage.seek(${from + (i * 1000) / fps})`));
        const { data } = await clock.time('capture', () => s('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true }));
        frame = Buffer.from(data, 'base64');
      }
      // ffmpeg's input pipe is full when it is the slower side: this is time spent waiting on the encoder
      await clock.time('write', async () => {
        if (!ffmpeg!.stdin!.write(frame)) await new Promise((r) => ffmpeg!.stdin!.once('drain', r));
      });
      o.onProgress?.(i + 1, frames);
    }
    ffmpeg.stdin!.end();
    const code = await clock.time('finish', () => closed);
    if (code !== 0) throw new RenderError('failed', `ffmpeg exited ${code}: ${ffmpegErr}`);
    if (coverFile && encode.container === 'mp4') {
      // cover art: an attached picture stream, which Finder, Explorer and most players show as the thumbnail
      await clock.time('finish', () => attachCover(partial, coverFile, artFile));
      renameSync(artFile, partial);
    }
    renameSync(partial, file);
    const report = clock.report({ route: 'server', frames, width: outW, height: outH });
    logInfo('render.done', { project: basename(o.dir), format, size: `${outW}x${outH}`, container: encode.container, frames, wall_ms: report.wallMs, fps: report.fps, ...Object.fromEntries(Object.entries(report.stages).map(([k, v]) => [`${k}_ms`, v.ms])) });
    return { file, report, ...(coverFile ? { coverFile } : {}) };
  } catch (e) {
    if (o.signal?.aborted) throw new RenderError('aborted');
    throw e instanceof RenderError ? e : new RenderError('failed', (e as Error).message);
  } finally {
    o.signal?.removeEventListener('abort', stop);
    const exited = new Promise((ok) => (browser.exitCode !== null || browser.signalCode !== null ? ok(null) : browser.once('close', ok)));
    stop();
    await exited;
    await new Promise((r) => setTimeout(r, 300));
    // Chrome may still be flushing its profile for a moment; leftovers in the temp folder are not worth failing a render for
    rmSync(partial, { force: true });
    if (ext === 'mp4') rmSync(artFile, { force: true });
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* the system clears its temp folder */
    }
  }
}

export interface SeekCheck {
  format: string;
  /** frames that came out byte for byte the same when seeked to again in reverse order */
  same: number;
  total: number;
  /** the frame that differed most: how many pixels, by how much at most (0–255), at what time */
  worst?: { pixels: number; max: number; at: number };
  /** what differs is antialiasing at most (a few pixels, faintly), not the picture */
  ok: boolean;
}

/**
 * Whether a piece is the same picture at the same time whatever was shown before: frames across
 * one format seeked in order, then again in reverse, and compared. A scene that reads the clock,
 * draws at random or animates on its own shows up here. `check --snapshots` runs it.
 */
export async function checkSeek(o: { dir: string; runtime: string; format: string; frames?: number; signal?: AbortSignal }): Promise<SeekCheck> {
  const chrome = findChrome();
  if (!chrome) throw new RenderError('no-renderer');
  const { motion, scenes, files, boardRuntime, runtime } = loadPiece(o.dir, o.runtime, false);
  if (!motion.formats[o.format]) throw new RenderError('no-format');
  const [w, h] = motion.formats[o.format].size;
  const tmp = mkdtempSync(join(tmpdir(), 'dc-seek-'));
  const page = join(tmp, 'page.html');
  writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style></head><body><div id="root"></div><script>${runtime}</script></body></html>`);
  const browser = spawn(chrome, chromeArgs(join(tmp, 'profile')), { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const stop = () => browser.kill('SIGKILL');
  o.signal?.addEventListener('abort', stop);
  try {
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
    const duration = await evalIn<number>(
      `(async()=>{window.__stage=await window.dcMotion.mount({motion:${json(motion)},scenes:${json(scenes)},files:${json(files)},boardRuntime:${json(boardRuntime ?? null)}||undefined,format:${json(o.format)},root:document.getElementById('root')});return window.__stage.duration})()`,
    );
    const shot = async (t: number) => {
      await evalIn(`window.__stage.seek(${t})`);
      return (await s<{ data: string }>('Page.captureScreenshot', { format: 'png' })).data;
    };
    const n = o.frames ?? 16;
    const times = Array.from({ length: n }, (_, i) => Math.round((duration * (i + 0.5)) / n));
    const forward: string[] = [];
    for (const t of times) forward.push(await shot(t));
    let same = 0;
    let worst: SeekCheck['worst'];
    for (let i = n - 1; i >= 0; i--) {
      const again = await shot(times[i]);
      if (again === forward[i]) {
        same++;
        continue;
      }
      // compared in the page, which can decode PNGs
      const d = await evalIn<{ pixels: number; max: number }>(
        `(async()=>{const load=async s=>createImageBitmap(await (await fetch('data:image/png;base64,'+s)).blob());const [a,b]=await Promise.all([load(${json(forward[i])}),load(${json(again)})]);const px=i=>{const c=new OffscreenCanvas(i.width,i.height),g=c.getContext('2d');g.drawImage(i,0,0);return g.getImageData(0,0,i.width,i.height).data};const da=px(a),db=px(b);let pixels=0,max=0;for(let k=0;k<da.length;k+=4){const m=Math.max(Math.abs(da[k]-db[k]),Math.abs(da[k+1]-db[k+1]),Math.abs(da[k+2]-db[k+2]));if(m)pixels++;if(m>max)max=m}return{pixels,max}})()`,
      );
      if (!worst || d.pixels > worst.pixels) worst = { ...d, at: times[i] };
    }
    // a few faint pixels are antialiasing; anything more is the picture changing
    const ok = same === n || (!!worst && worst.max <= 16 && worst.pixels / (w * h) < 0.001);
    return { format: o.format, same, total: n, ...(worst ? { worst } : {}), ok };
  } catch (e) {
    if (o.signal?.aborted) throw new RenderError('aborted');
    throw e instanceof RenderError ? e : new RenderError('failed', (e as Error).message);
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

/**
 * PNGs brought down to at most `max` pixels on their longer side, for a model to look at: a
 * board at full size costs far more than it shows. Done in Chrome, which decodes and scales
 * PNGs; a picture already small enough, or one that cannot be read, comes back as it was.
 */
export async function shrinkPictures(pngs: Buffer[], max: number): Promise<Buffer[]> {
  const chrome = findChrome();
  if (!chrome || !pngs.length) return pngs;
  const tmp = mkdtempSync(join(tmpdir(), 'dc-shrink-'));
  const browser = spawn(chrome, chromeArgs(join(tmp, 'profile')), { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  try {
    const cdp = new Cdp(browser);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const out: Buffer[] = [];
    for (const png of pngs) {
      const r = await cdp.send<{ result: { value?: string | null } }>(
        'Runtime.evaluate',
        {
          expression: `(async()=>{const b=await createImageBitmap(await (await fetch('data:image/png;base64,${png.toString('base64')}')).blob());const k=${max}/Math.max(b.width,b.height);if(k>=1)return null;const c=new OffscreenCanvas(Math.max(1,Math.round(b.width*k)),Math.max(1,Math.round(b.height*k)));const g=c.getContext('2d');g.imageSmoothingQuality='high';g.drawImage(b,0,0,c.width,c.height);const u=new Uint8Array(await (await c.convertToBlob({type:'image/png'})).arrayBuffer());let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode(...u.subarray(i,i+0x8000));return btoa(s)})()`,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
      ).catch(() => ({ result: { value: null } }));
      out.push(r.result.value ? Buffer.from(r.result.value, 'base64') : png);
    }
    return out;
  } catch {
    return pngs;
  } finally {
    const exited = new Promise((ok) => (browser.exitCode !== null || browser.signalCode !== null ? ok(null) : browser.once('close', ok)));
    browser.kill('SIGKILL');
    await exited;
    await new Promise((r) => setTimeout(r, 300));
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* the system clears its temp folder */
    }
  }
}

/**
 * The piece as one HTML file anyone can open: every format, the speeds, a scrubber, the cover
 * until it plays, and the scene checks' warnings. Its pictures and fonts are inside it. The
 * piece's note is for the people making it and stays out.
 */
export function motionPlayer(o: { dir: string; runtime: string; labels: { play: string; time: string; format: string; speed: string } }): string {
  const { motion, scenes, files, boardRuntime, cover, coverScene, coverHtml, runtime } = loadPiece(o.dir, o.runtime, true);
  const { note: _, ...shared } = motion;
  const coverAt = cover && 'at' in cover ? cover.at : null;
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const title = esc(motion.title || basename(o.dir));
  const l = Object.fromEntries(Object.entries(o.labels).map(([k, v]) => [k, esc(v)])) as typeof o.labels;
  const css = `body{margin:0;background:#111;color:#ddd;font:14px system-ui;display:flex;flex-direction:column;height:100vh}#wrap{flex:1;position:relative;overflow:hidden}#root,#dc-cover{position:absolute;left:50%;top:50%}#bar{display:flex;gap:12px;align-items:center;padding:10px 16px;background:#1b1b1b}#scrub{flex:1}#issues{color:#f5a524;padding:0 16px 8px;white-space:pre-wrap}`;
  const boot = `const motion=${json(shared)},scenes=${json(scenes)},files=${json(files)},boardRuntime=${json(boardRuntime ?? null)}||undefined,coverAt=${json(coverAt)},coverScene=${json(coverScene)},coverHtml=${json(coverHtml)};let stage,cover,started=false;const coverRoot=document.getElementById('dc-cover');const wrap=document.getElementById('wrap'),root=document.getElementById('root');
const fmt=document.getElementById('fmt'),scrub=document.getElementById('scrub'),time=document.getElementById('time'),play=document.getElementById('play');
const spd=document.getElementById('spd'),base=motion.speed||1;for(const v of [...new Set([base,0.75,1,1.25,1.5,2])].sort((a,b)=>a-b)){const o=document.createElement('option');o.value=v;o.textContent=v+'×';o.selected=v===base;spd.appendChild(o)}
for(const f of Object.keys(motion.formats)){const o=document.createElement('option');o.value=f;o.textContent=f+' '+motion.formats[f].size.join('×');fmt.appendChild(o)}
function fit(){if(!stage)return;const s=Math.min(wrap.clientWidth/stage.width,wrap.clientHeight/stage.height);for(const r of [root,coverRoot]){r.style.width=stage.width+'px';r.style.height=stage.height+'px';r.style.transform='translate(-50%,-50%) scale('+s+')'}}
const uncover=()=>{if(!started){started=true;coverRoot.style.display='none'}};
const show=t=>{scrub.value=t;time.textContent=(t/1000).toFixed(2)+' s / '+(stage.duration/1000).toFixed(2)+' s'};let playing=false;
async function load(f){stage&&stage.destroy();cover&&cover.destroy();cover=null;stage=await dcMotion.mount({motion,scenes,files,boardRuntime,format:f,speed:+spd.value,root});scrub.max=stage.duration;
if(!started&&coverScene){cover=await dcMotion.mount({motion:{...motion,order:[coverScene]},scenes:{[coverScene]:coverHtml},files,boardRuntime,format:f,root:coverRoot});cover.seek(cover.duration)}
if(!started&&coverAt!=null)stage.seek(coverAt);fit();show(0);
document.getElementById('issues').textContent=stage.issues.map(i=>i.level+': '+i.scene+' '+i.message).join('\\n')}
fmt.onchange=spd.onchange=()=>{playing=false;play.textContent='▶';load(fmt.value)};addEventListener('resize',fit);
play.onclick=()=>{uncover();playing=!playing;play.textContent=playing?'❚❚':'▶';if(playing){const from=+scrub.value>=stage.duration?0:+scrub.value;stage.play(from,t=>{show(t);if(t>=stage.duration&&!motion.loop){playing=false;play.textContent='▶'}})}else stage.pause()};
scrub.oninput=()=>{uncover();playing=false;play.textContent='▶';stage.pause();stage.seek(+scrub.value);show(+scrub.value)};load(fmt.value);`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}</style></head><body><div id="wrap"><div id="root"></div><div id="dc-cover"></div></div><div id="bar"><button id="play" aria-label="${l.play}">▶</button><input id="scrub" type="range" min="0" step="1" value="0" aria-label="${l.time}"><span id="time">0.00 s</span><select id="fmt" aria-label="${l.format}"></select><select id="spd" aria-label="${l.speed}"></select></div><div id="issues"></div><script>${runtime}</script><script>${boot.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
