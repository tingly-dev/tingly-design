/**
 * Pictures of what a project shows, as PNG files, for every kind. A kind that draws in
 * the editor's own page hands over a node (`nodeToPng`), one that has its page as HTML
 * hands over the markup (`htmlToPng`), and one that runs in a sandboxed frame asks the
 * frame (each runtime answers with a data URL or a blob). Saving and failing look the
 * same everywhere: one toast, a file named after the project.
 */
import { canvasPng, fontCss, rasterize } from '@dc/export';
import { download } from './local';
import { t } from './i18n';
import { toast } from './store';

export const fileStem = (title: string, fallback: string) => (title || fallback).replace(/[\\/:*?"<>|]+/g, '-').trim() || fallback;

/** The web fonts a document names: its stylesheet links (fetched, cut to `text` and inlined by `fontCss`) plus the faces its inline styles declare. */
async function fontEmbedCss(doc: Document, text: string): Promise<string> {
  const sources: (string | { family: string; url: string })[] = [];
  for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')) if (link.href) sources.push(link.href);
  for (const style of doc.querySelectorAll('style')) {
    for (const m of style.textContent?.matchAll(/font-family\s*:\s*"([^"]+)"[^{}]*?url\(\s*"?([^")]+)"?\s*\)/g) ?? []) {
      sources.push({ family: m[1], url: new URL(m[2], doc.baseURI).href });
    }
  }
  try {
    return await fontCss(sources, text);
  } catch {
    return '';
  }
}

/** A node of the editor's page as a PNG; `filter` leaves out chrome that sits inside it. A picture draws in a foreignObject that cannot fetch fonts, so a node whose document loads web fonts needs `fontEmbedCSS` (see `htmlToPng`). */
export async function nodeToPng(node: HTMLElement, o: { scale?: number; width?: number; height?: number; backgroundColor?: string; filter?: (n: Node) => boolean; style?: Partial<CSSStyleDeclaration>; fontEmbedCSS?: string } = {}): Promise<Blob> {
  const canvas = await rasterize(node, { pixelRatio: o.scale ?? 2, width: o.width, height: o.height, backgroundColor: o.backgroundColor, fontEmbedCSS: o.fontEmbedCSS, embedFonts: o.fontEmbedCSS === undefined, filter: o.filter, style: o.style });
  return canvasPng(canvas);
}

const clear = (c: string) => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c);
/** The first of these colours that paints, else white: a page with no background still needs one in a picture. */
const opaque = (...colors: string[]) => colors.find((c) => !clear(c)) ?? '#fff';

/** A page given as HTML, drawn in an off-screen frame of this width (the height is the page's own unless given). */
export async function htmlToPng(html: string, o: { width: number; height?: number; scale?: number; backgroundColor?: string }): Promise<Blob> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', left: '-100000px', top: '0', width: `${o.width}px`, height: `${o.height ?? 800}px`, border: '0', visibility: 'hidden' });
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error('frame'));
      frame.srcdoc = html;
    });
    const doc = frame.contentDocument!;
    await doc.fonts?.ready;
    await Promise.all([...doc.images].map((i) => (i.complete ? null : new Promise((r) => ((i.onload = i.onerror = r), undefined)))));
    const height = o.height ?? Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
    const fontEmbedCSS = await fontEmbedCss(doc, (doc.body.textContent ?? '').slice(0, 4000));
    return await nodeToPng(doc.body, { scale: o.scale, width: o.width, height, backgroundColor: o.backgroundColor ?? opaque(getComputedStyle(doc.body).backgroundColor, getComputedStyle(doc.documentElement).backgroundColor), fontEmbedCSS });
  } finally {
    frame.remove();
  }
}

export function dataUrlBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: /data:([^;]+)/.exec(head)?.[1] ?? 'image/png' });
}

// --------------------------------------------------------------- original image files

/** Where a picture named in a file lives: an address of its own stands, anything else is project-root relative (`uploads/pic.png` against the raw file base). */
export function originalImageUrl(src: string, base: string): string {
  return /^(https?:|data:|blob:)/.test(src) ? src : base + src.replace(/^\//, '');
}

/** The last path piece, with its extension: the original file's own name. */
const originalImageName = (src: string) => src.split(/[?#]/)[0].split('/').pop() || 'image';

/** Fetch an element's original picture as it is on disk: its own bytes and type, nothing drawn again. */
async function originalImageBlob(src: string, base: string): Promise<Blob> {
  const r = await fetch(originalImageUrl(src, base));
  if (!r.ok) throw new Error(String(r.status));
  const blob = await r.blob();
  if (!blob.size) throw new Error('empty');
  return blob;
}

/** Save the original picture under its own name and extension. One toast either way, like `saveImage`. */
export async function saveOriginalImage(src: string, base: string): Promise<void> {
  const name = originalImageName(src);
  try {
    download(name, await originalImageBlob(src, base));
    toast(t('common.image.saved', { name }));
  } catch (e) {
    toast(t('common.image.failed', { message: (e as Error).message }), 'error');
  }
}

/**
 * The one image type every browser holds on the clipboard is PNG; anything else it may refuse.
 * Put the original bytes there when the browser takes them, else decode the same bytes and
 * re-encode them as PNG (the pixels, not a rendering of the element); returns what landed.
 */
async function clipboardImageBlob(blob: Blob): Promise<'original' | 'png'> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('no image clipboard');
  const type = blob.type === 'image/png' || !blob.type ? 'image/png' : blob.type;
  try {
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
    return 'original';
  } catch {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': await canvasPng(canvas) })]);
    return 'png';
  }
}

/** Copy the original picture to the clipboard (PNG when the browser refuses its format); a refused clipboard falls back to the download, and the toast says so. */
export async function copyOriginalImage(src: string, base: string): Promise<void> {
  try {
    const blob = await originalImageBlob(src, base);
    try {
      const where = await clipboardImageBlob(blob);
      toast(t(where === 'original' ? 'common.image.copiedOriginal' : 'common.image.copied'));
    } catch {
      download(originalImageName(src), blob);
      toast(t('common.image.copyFallback'));
    }
  } catch (e) {
    toast(t('common.image.failed', { message: (e as Error).message }), 'error');
  }
}


/** Make the picture, save it, say so; a failure is one toast. Returns whether a file was saved. */
export async function saveImage(name: string, make: () => Promise<Blob>): Promise<boolean> {
  try {
    download(name, await make());
    toast(t('common.image.saved', { name }));
    return true;
  } catch (e) {
    toast(t('common.image.failed', { message: (e as Error).message }), 'error');
    return false;
  }
}

/**
 * Make the picture and put it on the clipboard. The clipboard item takes the promise itself so the
 * write starts inside the click (Safari drops it otherwise). A browser that cannot hold an image there,
 * or refuses, gets the same picture as a download instead, and the toast says so. Returns whether the
 * picture was made.
 */
export async function copyImage(fallbackName: string, make: () => Promise<Blob>): Promise<boolean> {
  const blob = make();
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('no image clipboard');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast(t('common.image.copied'));
    return true;
  } catch {
    try {
      download(fallbackName, await blob);
    } catch (e) {
      toast(t('common.image.failed', { message: (e as Error).message }), 'error');
      return false;
    }
    toast(t('common.image.copyFallback'));
    return true;
  }
}
