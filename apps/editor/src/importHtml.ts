import { packPage, toCanvas, type InFile, type ImportReport } from '@dc/import';
import { extractPage } from '@dc/import/extract';
import { api } from './api';

/**
 * Import an HTML page (and the files beside it) as a new canvas.
 *
 * The page is laid out in a hidden frame with scripts off and no network
 * except Google Fonts and web images, then read back with @dc/import's
 * extractor: every element keeps the style its author gave it, inline.
 * Pages that need JavaScript to show anything import from a terminal
 * instead (`dc-import html`, which runs them in a headless browser).
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
  /** the page to import: index.html when there is one, else the first .html */
  entry: string;
  pages: string[];
  title: string;
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
  const pages = files.map((f) => f.path).filter((p) => /\.html?$/i.test(p)).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const entry = pages.find((p) => /(^|\/)index\.html?$/i.test(p)) ?? pages[0] ?? '';
  const html = entry ? new TextDecoder().decode(files.find((f) => f.path === entry)!.bytes) : '';
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1].replace(/\s+/g, ' ').trim() ?? '';
  return { files, entry, pages, title };
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

export interface ImportResult {
  report: ImportReport;
}

export async function importHtml(picked: Picked, name: string, title: string, onStep: (s: ImportStep) => void): Promise<ImportResult> {
  onStep('layout');
  const packed = packPage(picked.files, picked.entry);
  const { frame, win } = await layOut(packed.html);
  let extracted;
  try {
    extracted = extractPage(win);
  } finally {
    frame.remove();
  }
  extracted.report.unreadableSheets.push(...packed.remoteCss);
  if (extracted.report.elements < 4 && extracted.report.scripts > 0)
    throw new Error('这个页面要运行脚本才会显示内容，编辑器里不运行导入页面的脚本。请在终端用 `pnpm dc-import html <文件>` 导入。');

  await api.createProject(name, title || extracted.title || name, 'design');
  onStep('assets');
  // the files the page used, uploaded once each; their data: urls point at the copies
  const local = new Map<string, string>();
  const byPath = new Map(picked.files.map((f) => [f.path, f]));
  for (const [dataUrl, path] of packed.paths) {
    if (!ASSET_EXT.test(path)) continue;
    const f = byPath.get(path)!;
    const up = await api.upload(name, new File([f.bytes as Uint8Array<ArrayBuffer>], path.split('/').pop()!, { type: f.type }));
    local.set(dataUrl, up.path);
  }

  onStep('write');
  const out = toCanvas(extracted, { title: title || undefined, source: picked.entry, mapUrl: (u) => local.get(u), missing: packed.missing });
  const { files } = await api.files(name);
  // artboards first, the index last, so the canvas never lists a file that is not there yet
  const order = [...Object.keys(out.files).filter((f) => f !== 'canvas.json'), 'canvas.json'];
  for (const path of order) {
    const r = await api.put(name, path, { content: out.files[path], baseVersion: files[path]?.version ?? null, actor: 'human', summary: `imported ${picked.entry}` });
    if ('conflict' in r) throw new Error(`${path} changed while importing; try again`);
  }
  return { report: out.report };
}
