import { embeddedAssets, packPage, parseSvg, readSvg, toCanvas, type Extracted, type Generated, type InFile, type ImportReport } from '@dc/import';
import { extractPage } from '@dc/import/extract';
import { isKeptPath } from '@dc/core';
import { api } from './api';
import { slugOf } from './projectName';
import { t } from './i18n';

/**
 * Import an HTML page or an SVG drawing (and the files beside it) as a new
 * canvas, through @dc/import's sources and its one generator.
 *
 * An HTML page is laid out in a hidden frame with scripts off and no network
 * except Google Fonts and web images, then read back with the extractor:
 * every element keeps the style its author gave it, inline. Pages that need
 * JavaScript to show anything import from a terminal instead (`dc-import
 * html`, which runs them in a headless browser). An SVG needs no layout: it
 * is parsed and goes onto one artboard as a drawing.
 */

export type ImportStep = 'layout' | 'assets' | 'write';

const ASSET_EXT = /\.(png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf)$/i;
const MIME: Record<string, string> = {
  css: 'text/css', html: 'text/html', htm: 'text/html', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
};
const WIDTH = 1280;

export interface Picked {
  files: InFile[];
  /** the file to import: index.html when there is one, else the first .html, else the first .svg */
  entry: string;
  pages: string[];
  title: string;
  /** the picked folder's own name, when a folder was picked or dropped */
  folder: string;
}

/** Files from a picker or a drop → paths relative to the folder they came from. */
export async function readPicked(list: { file: File; path: string }[]): Promise<Picked> {
  // drop the common folder prefix so index.html's own directory is the root
  const paths = list.map((f) => f.path.replace(/\\/g, '/').replace(/^\/+/, ''));
  const first = paths[0]?.split('/') ?? [];
  let common = 0;
  while (common < first.length - 1 && paths.every((p) => p.split('/')[common] === first[common])) common++;
  const files: InFile[] = await Promise.all(
    list.map(async ({ file }, i) => {
      const path = paths[i].split('/').slice(common).join('/');
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
      return { path, type: file.type || MIME[ext] || 'application/octet-stream', bytes: new Uint8Array(await file.arrayBuffer()) };
    }),
  );
  return pick(files, common > 0 ? first[common - 1] : '');
}

/** SVG markup pasted from a design tool (Figma's "Copy as SVG") → a picked file; null when it is not SVG. */
export function pickedFromText(text: string): Picked | null {
  if (!/<svg[\s>]/i.test(text)) return null;
  return pick([{ path: 'pasted.svg', type: 'image/svg+xml', bytes: new TextEncoder().encode(text) }]);
}

const depth = (p: string) => p.split('/').length;
const isSvg = (p: string) => /\.svg$/i.test(p);

function pick(files: InFile[], folder = ''): Picked {
  const html = files.map((f) => f.path).filter((p) => /\.html?$/i.test(p));
  const svg = files.map((f) => f.path).filter(isSvg);
  const order = (a: string, b: string) => depth(a) - depth(b) || a.localeCompare(b);
  // a folder with a page in it imports the page; its .svg files are just its images
  const pages = (html.length ? html : svg).sort(order);
  const entry = pages.find((p) => /(^|\/)index\.html?$/i.test(p)) ?? pages[0] ?? '';
  const text = entry ? new TextDecoder().decode(files.find((f) => f.path === entry)!.bytes) : '';
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1].replace(/\s+/g, ' ').trim() ?? '';
  return { files, entry, pages, title, folder };
}

/** Everything a drop carries, folders walked. */
export async function droppedFiles(dt: DataTransfer): Promise<{ file: File; path: string }[]> {
  const out: { file: File; path: string }[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((ok, no) => (entry as FileSystemFileEntry).file(ok, no));
      out.push({ file, path: prefix + entry.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, no) => reader.readEntries(ok, no));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length) for (const e of entries) await walk(e, '');
  else for (const file of [...dt.files]) out.push({ file, path: file.name });
  return out;
}

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src data: https://fonts.gstatic.com',
  'img-src data: https:',
].join('; ');

/** Lay the page out in a hidden, script-less frame of our own origin, so the extractor can read it. */
async function layOut(html: string): Promise<{ frame: HTMLIFrameElement; win: Window }> {
  const frame = document.createElement('iframe');
  // same origin so we can read styles; no allow-scripts, so nothing in the page runs
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${WIDTH}px;height:900px;border:0;visibility:hidden`;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  frame.srcdoc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + meta) : meta + html;
  const loaded = new Promise<void>((ok) => frame.addEventListener('load', () => ok(), { once: true }));
  document.body.appendChild(frame);
  await loaded;
  const win = frame.contentWindow!;
  await Promise.race([win.document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
  await new Promise((r) => setTimeout(r, 250));
  return { frame, win };
}

/** A short name for a set of files (crypto.subtle is missing on plain-http hosts, and this needs no secrecy). */
function fnv1a(files: InFile[]): string {
  let h = 0x811c9dc5;
  for (const f of files) {
    for (const bytes of [new TextEncoder().encode(f.path), f.bytes]) for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface ImportResult {
  report: ImportReport;
}

/**
 * Keep what the person picked under the project's uploads/, as it was: one
 * file named by its content (as chat attachments are), a folder with its own
 * tree so the links between its files hold. Returns picked path → kept path,
 * and the files uploads/ cannot hold.
 */
export async function keepPicked(project: string, picked: Picked, name: string): Promise<{ at: Map<string, string>; skipped: string[] }> {
  const at = new Map<string, string>();
  const skipped: string[] = [];
  if (picked.files.length === 1) {
    const f = picked.files[0];
    const up = await api.upload(project, new File([f.bytes as Uint8Array<ArrayBuffer>], f.path.split('/').pop()!, { type: f.type }), 'uploads');
    at.set(f.path, up.path);
    return { at, skipped };
  }
  const root = `uploads/${slugOf(picked.folder || name) || 'import'}-${fnv1a(picked.files)}`;
  for (const f of picked.files) {
    const path = `${root}/${f.path}`;
    if (!isKeptPath(path)) {
      skipped.push(f.path);
      continue;
    }
    await api.keepUpload(project, path, f.bytes);
    at.set(f.path, path);
  }
  return { at, skipped };
}

/** Lay the picked page out (or parse the drawing) and read it back as the page model. */
export async function readPage(picked: Picked): Promise<{ extracted: Extracted; packed: ReturnType<typeof packPage> }> {
  const packed = packPage(picked.files, picked.entry);
  let extracted: Extracted;
  if (isSvg(picked.entry)) {
    extracted = readSvg(parseSvg(packed.html));
  } else {
    const { frame, win } = await layOut(packed.html);
    try {
      extracted = extractPage(win);
    } finally {
      frame.remove();
    }
    extracted.report.unreadableSheets.push(...packed.remoteCss);
    if (extracted.report.elements < 4 && extracted.report.scripts > 0)
      throw new Error(t('importer.needsScripts'));
  }
  return { extracted, packed };
}

/**
 * Keep what the person brought in under the project's uploads/, as it was,
 * and generate the artboards pointing at it there: one file named by its
 * content (as chat attachments are), a folder with its own tree so its links
 * hold. Images cut out of the file itself (data: urls) go to assets/.
 */
export async function writePage(
  project: string,
  picked: Picked,
  page: Awaited<ReturnType<typeof readPage>>,
  title: string,
): Promise<Generated> {
  const { extracted, packed } = page;
  const local = new Map<string, string>();
  const { at, skipped } = await keepPicked(project, picked, picked.entry.replace(/\.[a-z]+$/i, ''));
  for (const [dataUrl, path] of packed.paths) {
    const kept = at.get(path);
    if (kept) local.set(dataUrl, kept);
    else if (ASSET_EXT.test(path)) {
      const f = picked.files.find((x) => x.path === path)!;
      const up = await api.upload(project, new File([f.bytes as Uint8Array<ArrayBuffer>], path.split('/').pop()!, { type: f.type }));
      local.set(dataUrl, up.path);
    }
  }
  // images the file carried inside itself (Figma's SVGs embed screenshots this way): made here, so assets/
  for (const a of embeddedAssets(extracted.urls)) {
    if (local.has(a.url)) continue;
    // the server names uploads by their content, so each embedded file lands once
    const up = await api.upload(project, new File([a.bytes as Uint8Array<ArrayBuffer>], `embedded.${a.ext}`, { type: a.type }));
    local.set(a.url, up.path);
  }
  if (skipped.length) (extracted.report.notes ??= []).push(
      t(skipped.length > 3 ? 'importer.skippedMore' : 'importer.skipped', { count: skipped.length, files: skipped.slice(0, 3).join(t('importer.listSeparator')) }),
    );
  const source = picked.entry === 'pasted.svg' && picked.files.length === 1 ? undefined : picked.entry;
  return toCanvas(extracted, { title: title || extracted.title || undefined, source, mapUrl: (u) => local.get(u), missing: packed.missing, kept: at.get(picked.entry) });
}

/** A page or drawing as a new canvas project. */
export async function importPicked(picked: Picked, name: string, title: string, onStep: (s: ImportStep) => void): Promise<ImportResult> {
  onStep('layout');
  const page = await readPage(picked);
  await api.createProject(name, title || page.extracted.title || name, 'design');
  onStep('assets');
  const out = await writePage(name, picked, page, title || page.extracted.title || name);
  onStep('write');
  const { files } = await api.files(name);
  // artboards first, the index last, so the canvas never lists a file that is not there yet
  const order = [...Object.keys(out.files).filter((f) => f !== 'canvas.json'), 'canvas.json'];
  for (const path of order) {
    const r = await api.put(name, path, { content: out.files[path], baseVersion: files[path]?.version ?? null, actor: 'human', summary: `imported ${picked.entry}` });
    if ('conflict' in r) throw new Error(`${path} changed while importing; try again`);
  }
  return { report: out.report };
}
