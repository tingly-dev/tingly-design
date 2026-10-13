import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { UPLOADS_DIR, isKeptPath, sandboxDoc } from '@dc/core';
import type { Extracted } from './model';
import { pickLanguage, translator } from '@dc/i18n';
import { describeReport, toCanvas, type BoardOut } from './generate';
import { embeddedAssets } from './assets';

// the report and the note on the canvas follow DC_LANG (as the server does), else the locale, else English
const t = translator(pickLanguage([process.env.DC_LANG, process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG]) ?? undefined);

/**
 * dc-import: the import pipeline from a terminal.
 *
 *   dc-import html <file.html | url> [--name n] [--title t] [--width 1280] [--split auto|on|off]
 *                                   [--projects dir] [--force] [--check] [--out dir] [--insecure]
 *   dc-import svg <file.svg | url> [--name n] [--title t] [--projects dir] [--force] [--check] [--out dir]
 *   dc-import check <project> --against <file.html | url> [--width 1280] [--out dir] [--insecure]
 *
 * `html` lays the page out in headless Chromium (scripts run, so pages built
 * by JavaScript work here), extracts it, copies its images and fonts into
 * assets/ and writes a canvas project. `svg` reads an SVG drawing onto one
 * artboard, moving embedded images out into assets/. `check` renders a project's artboards
 * through the editor's own runtime and compares them, pixel by pixel, with
 * the original page: the number every import is judged by.
 */

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../..');
const SANDBOX_DIST = join(REPO, 'packages/sandbox/dist');

const ASSET_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf', 'application/font-woff': 'woff', 'application/x-font-woff': 'woff',
  'application/font-woff2': 'woff2', 'application/x-font-ttf': 'ttf', 'application/x-font-otf': 'otf',
};
const EXTS = new Set(Object.values(ASSET_EXT).concat('jpeg'));
const MAX_ASSET = 20 * 1024 * 1024;
const debug = (...a: unknown[]) => process.env.DC_DEBUG && console.error('[dc-import]', ...a);

interface Args {
  _: string[];
  [k: string]: string | boolean | string[];
}

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[k] = next;
        i++;
      } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

function chromePath(): string | undefined {
  if (process.env.DC_CHROME) return process.env.DC_CHROME;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const p = join(root, d, 'chrome-linux', 'chrome');
    if (existsSync(p)) return p;
  }
  return undefined;
}

async function open(insecure: boolean): Promise<{ browser: Browser; context: BrowserContext }> {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({
    executablePath: chromePath(),
    // stylesheets from other origins must be readable to see which rules apply
    args: ['--disable-web-security', '--font-render-hinting=none'],
    ...(proxy ? { proxy: { server: proxy, bypass: ['localhost', '127.0.0.1', lanAddress()].join(',') } } : {}),
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: insecure, deviceScaleFactor: 1 });
  return { browser, context };
}

function pageUrl(input: string): string {
  return /^(https?|file):/i.test(input) ? input : pathToFileURL(resolve(input)).href;
}

/** Every file a page loads, as the browser received it: what the import keeps as the original. */
type Received = Map<string, Buffer>;

async function loadPage(context: BrowserContext, input: string, width: number, received?: Received): Promise<Page> {
  const page = await context.newPage();
  if (received)
    page.on('response', (res) => {
      const url = res.url();
      if (!/^(https?|file):/i.test(url) || !res.ok()) return;
      res.body().then((b) => b.length && b.length <= MAX_ASSET && received.set(url.split('#')[0], b), () => undefined);
    });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(pageUrl(input), { waitUntil: 'load', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // scroll through once, slowly enough for lazy images and scroll-reveal effects to fire, then back to the top
  await page.evaluate(async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await wait(120);
    }
    window.scrollTo(0, 0);
    await wait(150);
    // settle: transitions and finite animations jump to where they end, so the import is not caught mid-fade
    for (const a of document.getAnimations()) {
      try {
        if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish();
      } catch {
        // an animation with no end can't be finished; it stays where it is
      }
    }
  });
  await page.waitForTimeout(300);
  return page;
}

/**
 * Write what the page loaded under uploads/<name>-<hash>/, keeping the tree:
 * files beside the page by their path relative to it, others under
 * _ext/<host>/. Returns url → kept path for the files that may be kept.
 */
function keepReceived(received: Received, entry: string, name: string, dir: string): Map<string, string> {
  const base = new URL('.', entry);
  const rels = new Map<string, string>();
  for (const url of received.keys()) {
    const u = new URL(url);
    const inside = u.origin === base.origin && u.pathname.startsWith(base.pathname);
    const path = inside ? u.pathname.slice(base.pathname.length) : `_ext/${u.host || 'local'}${u.pathname}`;
    let rel = decodeURIComponent(path).replace(/\/+$/, '/index.html').replace(/^\/+/, '');
    if (!/\.[a-z0-9]+$/i.test(rel)) rel += url === entry ? '.html' : '';
    rels.set(url, rel);
  }
  const hash = createHash('sha256');
  for (const [url, rel] of [...rels].sort((a, b) => a[1].localeCompare(b[1]))) hash.update(rel).update(received.get(url)!);
  const root = `${UPLOADS_DIR}/${name}-${hash.digest('hex').slice(0, 8)}`;
  const kept = new Map<string, string>();
  for (const [url, rel] of rels) {
    const path = `${root}/${rel}`;
    if (!isKeptPath(path)) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), received.get(url)!);
    kept.set(url, path);
  }
  return kept;
}

let extractorSource: string | undefined;
async function extractor(): Promise<string> {
  if (!extractorSource) {
    const r = await build({ entryPoints: [join(here, 'browser-entry.ts')], bundle: true, format: 'iife', target: 'es2020', write: false });
    extractorSource = r.outputFiles[0].text;
  }
  return extractorSource;
}

async function extract(page: Page): Promise<Extracted> {
  // evaluated, not added as a <script>, so the page's own script count stays its own
  return page.evaluate(`${await extractor()}\n;window.dcExtract(window)`) as Promise<Extracted>;
}

/** Write embedded data: files, and any image or font that could not be kept under uploads/, into assets/. */
async function copyAssets(context: BrowserContext, urls: string[], dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  mkdirSync(join(dir, 'assets'), { recursive: true });
  for (const embedded of embeddedAssets(urls)) {
    const rel = `assets/embedded-${createHash('sha256').update(embedded.bytes).digest('hex').slice(0, 8)}.${embedded.ext}`;
    writeFileSync(join(dir, rel), embedded.bytes);
    map.set(embedded.url, rel);
  }
  for (const url of urls) {
    if (url.startsWith('data:')) continue;
    try {
      let bytes: Buffer;
      let type = '';
      if (url.startsWith('file:')) {
        bytes = readFileSync(fileURLToPath(url.split(/[?#]/)[0]));
      } else {
        const res = await context.request.get(url, { timeout: 20_000 });
        if (!res.ok()) continue;
        bytes = await res.body();
        type = (res.headers()['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      }
      if (!bytes.length || bytes.length > MAX_ASSET) continue;
      const fromUrl = extname(new URL(url).pathname).slice(1).toLowerCase();
      const ext = ASSET_EXT[type] ?? (EXTS.has(fromUrl) ? (fromUrl === 'jpeg' ? 'jpg' : fromUrl) : '');
      if (!ext) continue;
      const stem =
        decodeURIComponent(new URL(url).pathname.split('/').pop() ?? 'file')
          .replace(/\.[^.]*$/, '')
          .replace(/[^A-Za-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'file';
      const rel = `assets/${stem}-${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.${ext}`;
      writeFileSync(join(dir, rel), bytes);
      map.set(url, rel);
    } catch {
      // left as a link; the report counts it
    }
  }
  return map;
}

// ------------------------------------------------------------------ check

function serveFile(path: string): { body: Buffer; contentType: string } | null {
  if (!existsSync(path)) return null;
  const ext = extname(path).slice(1).toLowerCase();
  const types: Record<string, string> = { js: 'text/javascript', html: 'text/html', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
  return { body: readFileSync(path), contentType: types[ext] ?? 'application/octet-stream' };
}

function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return '127.0.0.1';
}

/** A local server for the check: the sandbox runtime, and one project's files where the editor serves them. */
function serve(projectDir: string): Promise<{ origin: string; close: () => void }> {
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname === '/harness') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><html><body style="margin:0"></body></html>');
    }
    const sb = /^\/sandbox\/(.+)$/.exec(u.pathname);
    const raw = /^\/api\/projects\/[^/]+\/raw\/(.+)$/.exec(u.pathname);
    const f = sb ? serveFile(join(SANDBOX_DIST, sb[1])) : raw ? serveFile(join(projectDir, decodeURIComponent(raw[1]))) : null;
    if (!f || (raw && decodeURIComponent(raw[1]).includes('..'))) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': f.contentType, 'access-control-allow-origin': '*' });
    res.end(f.body);
  });
  // not on loopback: with a proxy configured, Playwright sends loopback traffic through it
  const host = lanAddress();
  return new Promise((done) =>
    server.listen(0, host, () => {
      const { port } = server.address() as AddressInfo;
      done({ origin: `http://${host}:${port}`, close: () => server.close() });
    }),
  );
}

/** Render one artboard file of a project through the editor's runtime and take its picture. */
async function shootBoard(context: BrowserContext, origin: string, file: string, w: number, h: number, projectDir: string): Promise<PNG> {
  if (!existsSync(join(SANDBOX_DIST, 'runtime.js'))) throw new Error('packages/sandbox/dist/runtime.js is missing: run `pnpm --filter @dc/sandbox build`');
  const page = await context.newPage();
  await page.setViewportSize({ width: Math.max(w, 200), height: Math.min(Math.max(h, 200), 16_000) });
  debug('board', file);
  if (process.env.DC_DEBUG) {
    page.on('console', (m) => debug('console', m.text()));
    page.on('requestfailed', (r) => debug('failed', r.url().slice(0, 120), r.failure()?.errorText));
    page.on('request', (r) => debug('request', r.url().slice(0, 120)));
  }
  await page.goto(`${origin}/harness`);
  debug('harness up');
  const source = readFileSync(join(projectDir, file), 'utf8');
  const files: Record<string, string> = {};
  for (const n of readdirSync(projectDir)) if (n.endsWith('.dc.html')) files[n] = readFileSync(join(projectDir, n), 'utf8');
  await page.evaluate(
    ({ doc, w, h, msg }) =>
      new Promise<void>((done) => {
        const f = document.createElement('iframe');
        f.setAttribute('sandbox', 'allow-scripts');
        f.style.cssText = `border:0;display:block;width:${w}px;height:${h}px`;
        f.srcdoc = doc;
        window.addEventListener('message', (e) => {
          if ((e.data as { dc?: string })?.dc === 'ready') {
            f.contentWindow!.postMessage(msg, '*');
            setTimeout(done, 200);
          }
        });
        document.body.appendChild(f);
      }),
    {
      doc: sandboxDoc(origin, 'runtime'),
      w,
      h,
      msg: { dc: 'render', file, source, files, props: {}, mode: 'play', selected: null, base: `${origin}/api/projects/p/raw/` },
    },
  );
  debug('rendered');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  const shot = await page.locator('iframe').screenshot();
  await page.close();
  return PNG.sync.read(shot);
}

function crop(src: PNG, at: number, h: number, w: number): PNG {
  const top = Math.round(at);
  const out = new PNG({ width: w, height: h });
  out.data.fill(255);
  for (let y = 0; y < h; y++) {
    const sy = y + top;
    if (sy < 0 || sy >= src.height) continue;
    const n = Math.min(w, src.width) * 4;
    src.data.copy(out.data, y * w * 4, sy * src.width * 4, sy * src.width * 4 + n);
  }
  return out;
}

export interface BoardCheck {
  file: string;
  /** share of pixels that differ visibly, 0–1 */
  mismatch: number;
}

/** Compare a project's artboards with the original page; writes a diff picture per artboard into `out`. */
async function checkProject(context: BrowserContext, projectDir: string, original: PNG, boards: BoardOut[], out?: string): Promise<BoardCheck[]> {
  const results: BoardCheck[] = [];
  const { origin, close } = await serve(projectDir);
  try {
  for (const b of boards) {
    const shot = await shootBoard(context, origin, b.file, b.w, b.h, projectDir);
    const w = Math.max(b.w, 1);
    // the board's own height decides how much of the original it is compared with; a board taller or shorter than its part of the page counts the gap
    const h = Math.max(shot.height, b.h);
    const want = crop(original, b.top, h, w);
    const got = crop(shot, 0, h, w);
    const diff = new PNG({ width: w, height: h });
    const n = pixelmatch(want.data, got.data, diff.data, w, h, { threshold: 0.12, includeAA: false });
    results.push({ file: b.file, mismatch: n / (w * h) });
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, b.file.replace(/\.dc\.html$/, '') + '.diff.png'), PNG.sync.write(diff));
      writeFileSync(join(out, b.file.replace(/\.dc\.html$/, '') + '.got.png'), PNG.sync.write(got));
    }
  }
  } finally {
    close();
  }
  return results;
}

async function shootOriginal(context: BrowserContext, input: string, width: number, out?: string): Promise<PNG> {
  debug('original', input);
  const page = await loadPage(context, input, width);
  debug('loaded');
  const png = await page.screenshot({ fullPage: true });
  await page.close();
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'original.png'), png);
  }
  return PNG.sync.read(png);
}

/** The original drawing as the browser paints an SVG image, at the size the import gave it. */
async function shootSvg(context: BrowserContext, text: string, x: Extracted, out?: string): Promise<PNG> {
  const w = Math.ceil(x.width);
  const h = Math.ceil(x.height);
  const svg = text.slice(Math.max(0, text.search(/<\?xml|<svg[\s>]/i)), text.lastIndexOf('</svg>') + 6);
  const page = await context.newPage();
  await page.setViewportSize({ width: w, height: h });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.setContent(`<body style="margin:0;background:#fff"><img src="${src}" width="${x.width}" height="${x.height}" style="display:block"></body>`);
  await page.waitForFunction(() => document.images[0]?.complete);
  const png = await page.screenshot();
  await page.close();
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'original.png'), png);
  }
  return PNG.sync.read(png);
}

function boardsOf(projectDir: string): BoardOut[] {
  const canvas = JSON.parse(readFileSync(join(projectDir, 'canvas.json'), 'utf8')) as { order: string[]; boards: Record<string, { w: number; h: number; title?: string; importTop?: number }> };
  let top = 0;
  return canvas.order.map((file) => {
    const b = canvas.boards[file];
    const out = { file, top: b.importTop ?? top, title: b.title ?? file, w: b.w, h: b.h, elements: 0 };
    top += b.h;
    return out;
  });
}

function printCheck(results: BoardCheck[], boards: BoardOut[]): number {
  let px = 0;
  let total = 0;
  for (const r of results) {
    const b = boards.find((x) => x.file === r.file)!;
    console.log(`  ${r.file.padEnd(32)} ${(r.mismatch * 100).toFixed(2).padStart(6)}% of pixels differ`);
    px += r.mismatch * b.w * b.h;
    total += b.w * b.h;
  }
  const all = total ? px / total : 0;
  console.log(`  ${'overall'.padEnd(32)} ${(all * 100).toFixed(2).padStart(6)}%`);
  return all;
}

// ------------------------------------------------------------------ main

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  debug('args', JSON.stringify(args));
  const [cmd, input] = args._;
  const width = Number(args.width ?? 1280);
  const insecure = args.insecure === true;
  const projectsDir = resolve(String(args.projects ?? process.env.DC_PROJECTS ?? join(REPO, 'projects')));
  if (cmd === 'html' && input) {
    const name = String(args.name ?? (basenameOf(input) || 'imported'));
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error('--name: letters, digits, - and _ only');
    const dir = join(projectsDir, name);
    if (existsSync(dir) && !args.force) throw new Error(`${dir} exists (pass --force to write into it)`);
    const { browser, context } = await open(insecure);
    try {
      const t0 = Date.now();
      const received: Received = new Map();
      const page = await loadPage(context, input, width, received);
      const x = await extract(page);
      await page.close();
      mkdirSync(dir, { recursive: true });
      // the page as received, kept under uploads/ with its own tree; the artboards point at those files
      // files the page names but the browser never asked for (a .woff beside the .woff2 it used, a lazy image) belong with the rest
      for (const u of x.urls) {
        if (received.has(u) || !/^(https?|file):/.test(u)) continue;
        try {
          if (u.startsWith('file:')) received.set(u, readFileSync(fileURLToPath(u.split(/[?#]/)[0])));
          else {
            const res = await context.request.get(u, { timeout: 20_000 });
            if (res.ok()) received.set(u, await res.body());
          }
        } catch {
          // left for copyAssets, which reports what it could not fetch
        }
      }
      const kept = keepReceived(received, pageUrl(input), name, dir);
      const assets = await copyAssets(context, x.urls.filter((u) => !kept.has(u)), dir);
      for (const [u, rel] of kept) assets.set(u, rel);
      const split = args.split === 'on' ? true : args.split === 'off' ? false : 'auto';
      const original = kept.get(pageUrl(input).split('#')[0]);
      const out = toCanvas(x, { title: typeof args.title === 'string' ? args.title : undefined, source: input, mapUrl: (u) => assets.get(u), split, kept: original, t });
      // the check needs to know where each artboard came from on the page
      const canvas = JSON.parse(out.files['canvas.json']);
      for (const b of out.report.boards) canvas.boards[b.file].importTop = Math.round(b.top);
      out.files['canvas.json'] = JSON.stringify(canvas, null, 2) + '\n';
      for (const [rel, text] of Object.entries(out.files)) writeFileSync(join(dir, rel), text);
      console.log(`imported ${input} → ${dir} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      console.log(`  ${kept.size} original files kept under uploads/, ${assets.size - kept.size} assets copied, ${(out.report.styleBytes / 1024).toFixed(1)} KB of inline style`);
      for (const line of describeReport(out.report, t)) console.log(`  ${line}`);
      if (args.check) {
        const shotDir = typeof args.out === 'string' ? args.out : undefined;
        const original = await shootOriginal(context, input, width, shotDir);
        printCheck(await checkProject(context, dir, original, out.report.boards, shotDir), out.report.boards);
      }
      if (args.json) writeFileSync(String(args.json), JSON.stringify(out.report, null, 2));
    } finally {
      await browser.close();
    }
    return;
  }
  if (cmd === 'svg' && input) {
    const name = String(args.name ?? (basenameOf(input) || 'imported'));
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error('--name: letters, digits, - and _ only');
    const dir = join(projectsDir, name);
    if (existsSync(dir) && !args.force) throw new Error(`${dir} exists (pass --force to write into it)`);
    const { browser, context } = await open(insecure);
    try {
      const t0 = Date.now();
      const url = pageUrl(input);
      const text = url.startsWith('file:') ? readFileSync(fileURLToPath(url), 'utf8') : await (await context.request.get(url, { timeout: 30_000 })).text();
      const page = await context.newPage();
      await page.addScriptTag({ content: await extractor() });
      const x = (await page.evaluate((t) => (window as unknown as { dcReadSvg(t: string): Extracted }).dcReadSvg(t), text)) as Extracted;
      await page.close();
      mkdirSync(dir, { recursive: true });
      // the drawing as given, named by its content like any single file a person brings in
      const stem = basenameOf(input) || 'drawing';
      const original = `${UPLOADS_DIR}/${stem}-${createHash('sha256').update(text).digest('hex').slice(0, 8)}.svg`;
      mkdirSync(join(dir, UPLOADS_DIR), { recursive: true });
      writeFileSync(join(dir, original), text);
      const assets = await copyAssets(context, x.urls, dir);
      const out = toCanvas(x, { title: typeof args.title === 'string' ? args.title : undefined, source: input, mapUrl: (u) => assets.get(u), kept: original, t });
      for (const [rel, file] of Object.entries(out.files)) writeFileSync(join(dir, rel), file);
      console.log(`imported ${input} → ${dir} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      console.log(`  ${assets.size} assets copied`);
      for (const line of describeReport(out.report, t)) console.log(`  ${line}`);
      if (args.check) {
        const shotDir = typeof args.out === 'string' ? args.out : undefined;
        const original = await shootSvg(context, text, x, shotDir);
        printCheck(await checkProject(context, dir, original, out.report.boards, shotDir), out.report.boards);
      }
      if (args.json) writeFileSync(String(args.json), JSON.stringify(out.report, null, 2));
    } finally {
      await browser.close();
    }
    return;
  }
  if (cmd === 'check' && input && typeof args.against === 'string') {
    const dir = existsSync(input) ? resolve(input) : join(projectsDir, input);
    const { browser, context } = await open(insecure);
    try {
      const shotDir = typeof args.out === 'string' ? args.out : undefined;
      const original = await shootOriginal(context, args.against, width, shotDir);
      const boards = boardsOf(dir);
      const all = printCheck(await checkProject(context, dir, original, boards, shotDir), boards);
      if (args.json) writeFileSync(String(args.json), JSON.stringify({ overall: all }, null, 2));
    } finally {
      await browser.close();
    }
    return;
  }
  console.log(`usage:
  dc-import html <file.html | url> [--name n] [--title t] [--width 1280] [--split auto|on|off] [--projects dir] [--force] [--check] [--out dir]
  dc-import svg <file.svg | url> [--name n] [--title t] [--projects dir] [--force] [--check] [--out dir]
  dc-import check <project> --against <file.html | url> [--width 1280] [--out dir]`);
  process.exitCode = 2;
}

function basenameOf(input: string): string {
  const last = input.replace(/[?#].*$/, '').replace(/\/+$/, '').split(/[\\/]/).pop() ?? '';
  return last.replace(/\.(html?|svg)$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}
